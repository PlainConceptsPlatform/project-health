import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PracticeDefinition, ScorecardConfig } from './config.ts'
import {
  type CommitLike,
  OTHER_AGENT,
  aiAssistant,
  aiUsageLevel,
  summarizeAiUsage,
} from './metrics/ai-usage.ts'
import {
  GHERKIN_NOT_RUN,
  GHERKIN_TOOL,
  detectGherkinRuns,
  featureSuites,
} from './metrics/gherkin-detection.ts'
import {
  type PracticeEvidence,
  type RunWithJobs,
  type ScorecardSource,
  applicability,
  collectScorecard,
  detectedEvidence,
  engineeringLevel,
  engineeringScore,
  facetEvidence,
  gateCounts,
  matchJob,
  mergeEvidence,
  ratePractice,
  scorecardAlerts,
} from './metrics/scorecard.ts'
import {
  callersOf,
  detectTools,
  segmentWorkflow,
  summarizeDetections,
} from './metrics/workflow-detection.ts'
import type {
  AiUsage,
  EngineeringExcellence,
  MetricBlock,
  PracticeResult,
  ProjectConfig,
  Rag,
} from './types.ts'
import { PROJECT_GROUPS, PROJECT_TYPES, ok, skip } from './types.ts'

/**
 * The scorecard is a chain of heuristics and rules, and each one can quietly paint a project the
 * wrong colour. These tests pin the cases where that would happen: a scanner that runs but cannot
 * fail, a tool named only in an upload step, a reusable workflow with no runs of its own, a
 * dependency bot counted as AI, a not-applicable gate holding a project back.
 */

const config = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', 'config', 'scorecard.json'), 'utf8'),
) as ScorecardConfig

const workflow = (name: string) =>
  readFileSync(join(import.meta.dirname, 'fixtures', 'scorecard', name), 'utf8')

const practice = (id: string): PracticeDefinition => {
  const found = config.practices.find((p) => p.id === id)
  if (!found) throw new Error(`no practice ${id}`)
  return found
}

const project = (over: Partial<ProjectConfig> = {}): ProjectConfig => ({
  id: 'checkout',
  name: 'Checkout',
  repo: 'your-org/checkout',
  enabled: true,
  status: 'production',
  environments: { production: 'pro', staging: 'pre' },
  productionRefPattern: '^v',
  agents: { enabled: false, workflow: null },
  ...over,
})

const NOW = new Date('2026-10-20T00:00:00Z')
const APPLIES: { applicable: boolean; reason: string | null } = { applicable: true, reason: null }

const evidence = (over: Partial<PracticeEvidence> = {}): PracticeEvidence => ({
  source: 'detected',
  tools: ['tool'],
  mode: 'blocking',
  result: 'passing',
  resultAt: '2026-10-18T00:00:00Z',
  lastRun: null,
  ...over,
})

const rate = (id: string, e: PracticeEvidence | null, applies = APPLIES) =>
  ratePractice(practice(id), applies, e, NOW, config.staleDays)

describe('segmentWorkflow', () => {
  it('splits jobs and steps and reads the job display name, not a step name', () => {
    const jobs = segmentWorkflow(workflow('ci-blocking.yml'))
    expect(jobs.map((j) => j.key)).toEqual(['test', 'acceptance', 'security'])
    expect(jobs.map((j) => j.name)).toEqual(['Unit tests', null, 'Security'])
    expect(jobs[0]?.steps).toHaveLength(4)
  })

  it('marks a job with continue-on-error as report-only', () => {
    const jobs = segmentWorkflow(workflow('security-report-only.yml'))
    expect(jobs.find((j) => j.key === 'dast')?.reportOnly).toBe(true)
    expect(jobs.find((j) => j.key === 'scan')?.reportOnly).toBe(false)
  })
})

describe('detectTools', () => {
  const enabled = config.practices
  const detect = (name: string) =>
    summarizeDetections(detectTools(`.github/workflows/${name}`, workflow(name), enabled))

  it('finds every build practice in a fully gated CI workflow, all blocking', () => {
    const found = detect('ci-blocking.yml')
    expect([...found.keys()].sort()).toEqual(
      ['complexity', 'sast', 'sbom', 'secrets', 'spec', 'tests', 'vulnerabilities'].sort(),
    )
    for (const detection of found.values()) expect(detection.mode).toBe('blocking')
    expect(found.get('tests')?.tools).toEqual(['coverlet', '--coverage'])
    // check-complexity also matches the generic complexity pattern; it must be named once.
    expect(found.get('complexity')?.tools).toEqual(['check-complexity'])
    expect(found.get('spec')?.tools).toEqual(['playwright-bdd'])
  })

  it('reads continue-on-error, || true and a default Trivy exit code as report-only', () => {
    const found = detect('security-report-only.yml')
    expect(found.get('secrets')?.mode).toBe('report-only')
    expect(found.get('sast')?.mode).toBe('report-only')
    // Trivy exits 0 unless told otherwise, so a step without exit-code cannot block.
    expect(found.get('vulnerabilities')?.mode).toBe('report-only')
    expect(found.get('dast')?.mode).toBe('report-only')
  })

  it('does not detect a scanner from an upload step that only names its report file', () => {
    // The upload step has no report-only flag. Matching it would turn Semgrep blocking.
    const hits = detectTools('w.yml', workflow('security-report-only.yml'), [practice('sast')])
    expect(hits).toHaveLength(1)
    expect(hits[0]?.mode).toBe('report-only')
  })

  it('ignores a commented-out step', () => {
    const text =
      'jobs:\n  a:\n    steps:\n      # - uses: trufflesecurity/trufflehog@main\n      - run: echo hi\n'
    expect(detectTools('w.yml', text, [practice('secrets')])).toEqual([])
  })

  it('prefers a blocking occurrence over a report-only one for the same practice', () => {
    const hits = [
      ...detectTools('a.yml', workflow('security-report-only.yml'), [practice('secrets')]),
      ...detectTools('b.yml', workflow('ci-blocking.yml'), [practice('secrets')]),
    ]
    const secrets = summarizeDetections(hits).get('secrets')
    expect(secrets?.mode).toBe('blocking')
    expect(secrets?.workflow).toBe('b.yml')
    expect(secrets?.jobName).toBe('Security')
  })

  it('finds a tool inside a reusable workflow, and the workflow that calls it', () => {
    const files = ['reusable-ci.yml', 'deploy.yml', 'ci-blocking.yml'].map((name) => ({
      path: `.github/workflows/${name}`,
      text: workflow(name),
    }))
    const found = detect('reusable-ci.yml')
    expect(found.get('mutation')?.tools).toEqual(['Stryker'])
    expect(callersOf('.github/workflows/reusable-ci.yml', files)).toEqual([
      '.github/workflows/deploy.yml',
    ])
    expect(detect('deploy.yml').get('performance')?.tools).toEqual(['k6'])
  })

  it('detects Lighthouse CI as a performance tool, blocking unless marked report-only', () => {
    const lighthouse = (step: string) =>
      summarizeDetections(
        detectTools('w.yml', `jobs:\n  perf:\n    steps:\n${step}`, [practice('performance')]),
      ).get('performance')
    for (const step of [
      '      - run: npx @lhci/cli@0.14.x autorun\n',
      '      - run: lhci autorun --upload.target=temporary-public-storage\n',
      '      - uses: treosh/lighthouse-ci-action@v12\n',
    ]) {
      expect(lighthouse(step)).toMatchObject({ tools: ['Lighthouse CI'], mode: 'blocking' })
    }
    expect(lighthouse('      - run: lhci autorun\n        continue-on-error: true\n')?.mode).toBe(
      'report-only',
    )
    expect(lighthouse('      - run: npm run lighthouse\n')).toBeUndefined()
  })
})

describe('ratePractice', () => {
  it('is green for a blocking gate that passed recently', () => {
    expect(rate('secrets', evidence()).rag).toBe('green')
  })

  it('is red for an applicable practice nobody runs', () => {
    expect(rate('secrets', null).rag).toBe('red')
  })

  it('is red for a blocking gate failing on the default branch, even when stale', () => {
    expect(
      rate('sast', evidence({ result: 'failing', resultAt: '2026-08-01T00:00:00Z' })).rag,
    ).toBe('red')
  })

  it('is yellow for a blocking practice running report-only', () => {
    const rated = rate('vulnerabilities', evidence({ mode: 'report-only' }))
    expect(rated.rag).toBe('yellow')
    expect(rated.reason).toContain('report-only')
  })

  it('is yellow, not red, for a threshold practice under its threshold', () => {
    const rated = rate('mutation', evidence({ result: 'failing' }))
    expect(rated).toEqual({ rag: 'yellow', reason: 'Threshold not met.' })
  })

  it('is yellow when the result is unknown or older than the stale limit', () => {
    expect(rate('secrets', evidence({ result: 'unknown' })).rag).toBe('yellow')
    expect(rate('secrets', evidence({ resultAt: '2026-10-05T00:00:00Z' })).rag).toBe('yellow')
    // Exactly at the limit is still fresh.
    expect(rate('secrets', evidence({ resultAt: '2026-10-06T00:00:00Z' })).rag).toBe('green')
  })

  it('accepts a policy practice that does not block', () => {
    expect(rate('sbom', evidence({ mode: 'report-only' })).rag).toBe('green')
  })

  it('is grey when not applicable, whatever the evidence', () => {
    const rated = rate('dast', evidence({ result: 'failing' }), {
      applicable: false,
      reason: 'n/a',
    })
    expect(rated.rag).toBe('grey')
  })
})

describe('applicability', () => {
  const applies = (id: string, over: Partial<ProjectConfig> = {}) =>
    applicability(practice(id), project(over), config).applicable

  it('treats a project without a type as other, where everything but opt-ins applies', () => {
    expect(config.practices.filter((p) => applies(p.id)).map((p) => p.id)).not.toContain(
      'performance',
    )
    expect(applies('dast')).toBe(true)
  })

  it('applies the type defaults', () => {
    expect(applies('dast', { type: 'mobile' })).toBe(false)
    expect(applies('mutation', { type: 'data' })).toBe(false)
    expect(applies('spec', { type: 'ml' })).toBe(false)
    expect(applies('spec', { type: 'back-front' })).toBe(true)
  })

  it('applies performance only when opted in, and honours a per-project exclusion', () => {
    expect(applies('performance', { scorecard: { performance: true } })).toBe(true)
    expect(applies('sbom', { scorecard: { notApplicable: ['sbom'] } })).toBe(false)
  })

  it('applies every build practice to a browser extension, but not DAST or performance', () => {
    const build = config.practices.filter((p) => p.phase === 'build').map((p) => p.id)
    for (const id of build) expect(applies(id, { type: 'browser-extension' })).toBe(true)
    expect(applies('dast', { type: 'browser-extension' })).toBe(false)
    expect(applies('performance', { type: 'browser-extension' })).toBe(false)
  })

  it('expects performance and DAST of a static site, but not spec, mutation or complexity', () => {
    const site = { type: 'static-site' } as const
    expect(applies('performance', site)).toBe(true)
    expect(applies('dast', site)).toBe(true)
    expect(applies('spec', site)).toBe(false)
    expect(applies('mutation', site)).toBe(false)
    expect(applies('complexity', site)).toBe(false)
    expect(applies('secrets', site)).toBe(true)
  })

  it('lets a static site opt out of its default performance practice', () => {
    const optedOut = applicability(
      practice('performance'),
      project({ type: 'static-site', scorecard: { performance: false } }),
      config,
    )
    expect(optedOut).toEqual({
      applicable: false,
      reason: 'Opted out with scorecard.performance: false in projects.json.',
    })
  })

  it('drops a practice disabled in config for every project', () => {
    const disabled = { ...practice('complexity'), enabled: false }
    expect(applicability(disabled, project(), config).applicable).toBe(false)
  })
})

const results = (
  colours: Partial<Record<string, Rag>>,
  notApplicable: string[] = [],
): PracticeResult[] =>
  config.practices.map((p) => ({
    id: p.id,
    number: p.number,
    name: p.name,
    phase: p.phase,
    standardMode: p.mode,
    description: p.description,
    applicable: !notApplicable.includes(p.id),
    rag: notApplicable.includes(p.id) ? 'grey' : (colours[p.id] ?? 'red'),
    reason: '',
    source: 'detected',
    tools: [],
    mode: null,
    result: null,
    resultAt: null,
    lastRun: null,
  }))

const L1 = { secrets: 'green', vulnerabilities: 'green', sast: 'green', tests: 'yellow' } as const
const L2 = { ...L1, tests: 'green', spec: 'green', sbom: 'green' } as const
const L3 = { ...L2, mutation: 'green', dast: 'green', complexity: 'green' } as const

describe('engineeringLevel', () => {
  it('is L0 when a security gate is only yellow', () => {
    expect(engineeringLevel(results({ ...L1, sast: 'yellow' }))).toBe(0)
  })

  it('is L0 when tests are absent, even with every security gate green', () => {
    expect(engineeringLevel(results({ ...L1, tests: 'red' }))).toBe(0)
  })

  it('counts present-but-yellow tests for L1 and needs them green for L2', () => {
    expect(engineeringLevel(results(L1))).toBe(1)
    expect(engineeringLevel(results({ ...L2, tests: 'yellow' }))).toBe(1)
    expect(engineeringLevel(results(L2))).toBe(2)
  })

  it('needs mutation, DAST and complexity green for L3', () => {
    expect(engineeringLevel(results({ ...L3, complexity: 'yellow' }))).toBe(2)
    expect(engineeringLevel(results(L3))).toBe(3)
  })

  it('does not let a not-applicable gate hold a project back', () => {
    // An ML project has no spec, mutation or DAST; requiring them would cap it at L1 forever.
    const { spec: _s, mutation: _m, dast: _d, ...rest } = L3
    expect(engineeringLevel(results(rest, ['spec', 'mutation', 'dast']))).toBe(3)
  })
})

describe('engineeringScore and gateCounts', () => {
  it('weighs yellow as half and ignores not-applicable practices', () => {
    // 8 applicable: 4 green, 2 yellow, 2 red = (4 + 1) / 8.
    const practices = results(
      {
        secrets: 'green',
        vulnerabilities: 'green',
        sast: 'green',
        tests: 'green',
        spec: 'yellow',
        sbom: 'yellow',
      },
      ['dast', 'performance', 'hygiene'],
    )
    expect(engineeringScore(practices)).toBe(63)
    expect(gateCounts(practices)).toEqual({ present: 6, applicable: 8 })
  })

  it('counts gates of every phase, test environment included', () => {
    const practices = results({ dast: 'green' }, ['performance'])
    expect(gateCounts(practices)).toEqual({ present: 1, applicable: 10 })
  })

  it('has no score when nothing applies', () => {
    expect(
      engineeringScore(
        results(
          {},
          config.practices.map((p) => p.id),
        ),
      ),
    ).toBeNull()
  })
})

const commit = (message: string, author?: CommitLike['author'], parents = 1): CommitLike => ({
  sha: Math.random().toString(16).slice(2),
  parents: Array.from({ length: parents }, (_, i) => ({ sha: `p${i}` })),
  commit: { message },
  author: author ?? { login: 'someone', type: 'User' },
})

describe('AI usage', () => {
  it('reads assistants from Co-authored-by trailers, in any case', () => {
    expect(
      aiAssistant(
        commit('feat: x\n\nCo-Authored-By: Claude Opus <noreply@anthropic.com>'),
        config.aiUsage,
      ),
    ).toBe('Claude')
    expect(
      aiAssistant(commit('fix: y\n\nco-authored-by: Copilot <copilot@github.com>'), config.aiUsage),
    ).toBe('Copilot')
    expect(
      aiAssistant(
        commit('fix\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>'),
        config.aiUsage,
      ),
    ).toBe('Cursor')
  })

  it('does not count a human co-author or an assistant named only in the subject', () => {
    expect(aiAssistant(commit('docs: mention Claude in the README'), config.aiUsage)).toBeNull()
    expect(
      aiAssistant(commit('feat\n\nCo-authored-by: A Person <person@example.com>'), config.aiUsage),
    ).toBeNull()
  })

  it('counts agent bots but not dependency or Actions bots', () => {
    const bot = (login: string) => commit('chore', { login, type: 'Bot' })
    expect(aiAssistant(bot('copilot-swe-agent[bot]'), config.aiUsage)).toBe('Copilot')
    expect(aiAssistant(bot('devin-ai-integration[bot]'), config.aiUsage)).toBe('Devin')
    expect(aiAssistant(bot('some-agent[bot]'), config.aiUsage)).toBe(OTHER_AGENT)
    expect(aiAssistant(bot('dependabot[bot]'), config.aiUsage)).toBeNull()
    expect(aiAssistant(bot('renovate[bot]'), config.aiUsage)).toBeNull()
    expect(aiAssistant(bot('github-actions[bot]'), config.aiUsage)).toBeNull()
  })

  it('buckets the share at the configured boundaries', () => {
    const level = (share: number) => aiUsageLevel(share, config.aiUsage.buckets)
    expect([0, 0.099, 0.1, 0.249, 0.25, 0.49, 0.5, 0.749, 0.75, 1].map(level)).toEqual([
      1, 1, 2, 2, 3, 3, 4, 4, 5, 5,
    ])
  })

  it('stores share and counts, leaving merge commits out of both', () => {
    const usage = summarizeAiUsage(
      [
        commit('a\n\nCo-authored-by: Claude <noreply@anthropic.com>'),
        commit('b\n\nCo-authored-by: Claude <noreply@anthropic.com>'),
        commit('c', { login: 'copilot-swe-agent[bot]', type: 'Bot' }),
        commit('d'),
        commit('Merge pull request #1', undefined, 2),
      ],
      config.aiUsage,
    )
    expect(usage).toEqual(
      ok({
        level: 5,
        share: 0.75,
        aiCommits: 3,
        totalCommits: 4,
        byAssistant: { Claude: 2, Copilot: 1 },
      }),
    )
  })

  it('is unavailable rather than level 1 for a month with no commits', () => {
    expect(summarizeAiUsage([], config.aiUsage).available).toBe(false)
  })
})

const usage = (level: number): MetricBlock<AiUsage> =>
  ok({ level, share: 0, aiCommits: 0, totalCommits: 1, byAssistant: {} })

describe('scorecardAlerts', () => {
  const alerts = (input: Parameters<typeof scorecardAlerts>[0]) =>
    scorecardAlerts(input, config.alerts).map((a) => a.code)

  it('raises high AI usage with low engineering at AI 4 and level L1, not at L2 or AI 3', () => {
    const base = { score: 50, previousScores: [] }
    expect(alerts({ ...base, level: 1, aiUsage: usage(4) })).toEqual(['HIGH_AI_LOW_ENGINEERING'])
    expect(alerts({ ...base, level: 0, aiUsage: usage(5) })).toEqual(['HIGH_AI_LOW_ENGINEERING'])
    expect(alerts({ ...base, level: 2, aiUsage: usage(5) })).toEqual([])
    expect(alerts({ ...base, level: 1, aiUsage: usage(3) })).toEqual([])
    expect(alerts({ ...base, level: 0, aiUsage: skip('none') })).toEqual([])
  })

  it('raises declining for a drop of 10 points from the best of the earlier months', () => {
    const base = { level: 2, aiUsage: usage(1) }
    expect(alerts({ ...base, score: 60, previousScores: [70, 65] })).toEqual([
      'ENGINEERING_DECLINING',
    ])
    expect(alerts({ ...base, score: 61, previousScores: [70, 65] })).toEqual([])
    expect(alerts({ ...base, score: 60, previousScores: [null, null] })).toEqual([])
  })
})

const series = <T>(latest: T, at: string, runId = 42) =>
  ok({
    samples: [
      { commitSha: 'abc', runId, runAttempt: 1, artifactId: 1, generatedAt: at, data: latest },
    ],
    latest,
    latestGeneratedAt: at,
  })

const severities = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 }

const excellence = (): EngineeringExcellence => ({
  coverage: series(
    { scopes: {}, global: { lineRate: 0.8, linesCovered: 8, linesValid: 10 }, passed: true },
    '2026-10-15T00:00:00Z',
  ),
  mutation: series(
    {
      scopes: {},
      global: {
        coveredScore: 0.6,
        fullScore: 0.5,
        killed: 1,
        timeout: 0,
        survived: 1,
        noCoverage: 0,
        valid: 2,
      },
      passed: false,
    },
    '2026-10-12T00:00:00Z',
  ),
  complexity: series(
    {
      thresholds: { cc: 10, crap: 30 },
      scopes: {},
      global: { methods: 1, ccP50: 1, ccP90: 1, ccMax: 1, over10: 0, crapOver30: 0 },
      gate: { ccMax: 10, crapMax: 30, baselined: 3, violations: 0, justified: 0 },
    },
    '2026-10-15T00:00:00Z',
  ),
  security: series(
    {
      trivy: {
        vuln: { ...severities, HIGH: 2 },
        misconfig: severities,
        secret: severities,
        fixableVulns: 0,
      },
      semgrep: { ERROR: 1, WARNING: 0, INFO: 0, total: 1, scanErrors: 0 },
      jobs: { trivy: 'success' },
      passed: true,
    },
    '2026-10-15T00:00:00Z',
  ),
  sbom: skip('No sbom artifact this month.'),
  hygiene: skip('No hygiene artifact this month.'),
})

describe('facetEvidence', () => {
  const ee = excellence()

  it('reads the facet verdicts and links the run that produced them', () => {
    expect(facetEvidence('tests', ee, 'o/r')).toMatchObject({
      source: 'facet',
      result: 'passing',
      lastRun: { url: 'https://github.com/o/r/actions/runs/42' },
    })
    expect(facetEvidence('mutation', ee, 'o/r')?.result).toBe('failing')
    expect(facetEvidence('complexity', ee, 'o/r')?.result).toBe('passing')
  })

  it('prefers the security job result over the raw finding counts', () => {
    // Two high vulnerabilities, but the repository's Trivy job passed: its own policy decides.
    expect(facetEvidence('vulnerabilities', ee, 'o/r')?.result).toBe('passing')
    // No semgrep job, so the error count decides.
    expect(facetEvidence('sast', ee, 'o/r')?.result).toBe('failing')
  })

  it('has nothing to say about a practice the facets do not cover', () => {
    expect(facetEvidence('secrets', ee, 'o/r')).toBeNull()
    expect(facetEvidence('sbom', ee, 'o/r')).toBeNull()
    expect(facetEvidence('spec', ee, 'o/r')).toBeNull()
  })

  it('treats a scanner the security facet reports as blocking, whatever its workflow line says', () => {
    const contract = excellence()
    if (contract.security.available) {
      contract.security.data.latest.jobs = {
        secretScan: 'success',
        depsAndIac: 'success',
        sast: 'success',
      }
    }
    for (const id of ['secrets', 'vulnerabilities', 'sast'] as const) {
      expect(facetEvidence(id, contract, 'o/r')).toMatchObject({
        mode: 'blocking',
        result: 'passing',
      })
    }
    // A step running `bash scripts/security/sast.sh` reads as report-only from YAML alone.
    const facet = facetEvidence('sast', contract, 'o/r')
    if (!facet) throw new Error('expected facet evidence for sast')
    const detected = { ...facet, source: 'detected' as const, mode: 'report-only' as const }
    expect(mergeEvidence(facet, detected)?.mode).toBe('blocking')
  })

  it('leaves the mode to workflow detection when the facet has no job for that scanner', () => {
    // The fixture's only job is Trivy: Semgrep's mode is not the facet's to claim.
    expect(facetEvidence('sast', ee, 'o/r')?.mode).toBeNull()
    expect(facetEvidence('vulnerabilities', ee, 'o/r')?.mode).toBe('blocking')
  })

  const hygiene = (
    patch: {
      violations?: number
      swallowed?: number | null
      dead?: number
      gated?: boolean
      gate?: boolean
      commentSlopViolations?: number
    } = {},
  ) => {
    const ee = excellence()
    const summary = {
      files: 10,
      lines: 1000,
      duplicatedLines: 40,
      duplicationRate: 0.04,
      codeLines: 800,
      commentLines: 80,
      commentDensity: 0.1,
      swallowedExceptions: patch.swallowed === undefined ? 0 : patch.swallowed,
      justifiedSwallows: 1,
    }
    ee.hygiene = series(
      {
        thresholds: { minLines: 10, minTokens: 70 },
        scopes: {},
        global: summary,
        deadCode: { gated: patch.gated ?? true, warnings: patch.dead ?? 0 },
        hotspots: [],
        gate:
          patch.gate === false
            ? null
            : {
                baselinedFiles: 5,
                baselineLines: 200,
                violations: patch.violations ?? 0,
                fixed: 0,
              },
        ...(patch.commentSlopViolations === undefined
          ? {}
          : {
              commentSlop: {
                findings: 4,
                byRule: { banner: 4 },
                byScope: { api: 4 },
                gate: {
                  baselinedFiles: 2,
                  baselineFindings: 3,
                  violations: patch.commentSlopViolations,
                  fixed: 0,
                },
              },
            }),
      },
      '2026-10-15T00:00:00Z',
    )
    return facetEvidence('hygiene', ee, 'o/r')
  }

  it('passes hygiene when the duplication gate holds and nothing is swallowed or dead', () => {
    expect(hygiene()).toMatchObject({
      result: 'passing',
      mode: 'blocking',
      tools: ['hygiene facet'],
    })
    // A producer that ran no empty-catch scanner reports null, which is not a finding.
    expect(hygiene({ swallowed: null })?.result).toBe('passing')
    // Dead code the build already fails on cannot be outstanding.
    expect(hygiene({ dead: 3, gated: true })?.result).toBe('passing')
  })

  it('fails hygiene on a new clone, a swallowed exception or ungated dead code', () => {
    expect(hygiene({ violations: 1 })?.result).toBe('failing')
    expect(hygiene({ swallowed: 2 })?.result).toBe('failing')
    expect(hygiene({ dead: 1, gated: false })?.result).toBe('failing')
  })

  it('fails hygiene on a comment-slop gate violation and ignores a producer without the rules', () => {
    expect(hygiene({ commentSlopViolations: 1 })?.result).toBe('failing')
    expect(hygiene({ commentSlopViolations: 0 })?.result).toBe('passing')
    expect(hygiene()?.result).toBe('passing')
  })

  it('treats hygiene measured without a duplication gate as report-only', () => {
    expect(hygiene({ gate: false })).toMatchObject({ mode: 'report-only', result: 'passing' })
  })

  it('treats complexity measured without a gate as report-only', () => {
    const noGate = excellence()
    if (noGate.complexity.available) noGate.complexity.data.latest.gate = null
    expect(facetEvidence('complexity', noGate, 'o/r')?.mode).toBe('report-only')
  })
})

describe('matchJob', () => {
  const jobs = [
    { name: 'Unit tests (ubuntu-latest)', conclusion: 'success' },
    { name: 'ci / Mutation tests', conclusion: 'failure' },
  ]

  it('matches a matrix job and a job reached through a reusable workflow', () => {
    expect(matchJob(jobs, 'Unit tests')?.conclusion).toBe('success')
    expect(matchJob(jobs, 'Mutation tests')?.conclusion).toBe('failure')
    expect(matchJob(jobs, 'Deploy')).toBeNull()
  })
})

describe('collectScorecard', () => {
  const files = ['ci-blocking.yml', 'reusable-ci.yml', 'deploy.yml'].map((name) => ({
    path: `.github/workflows/${name}`,
    text: workflow(name),
  }))

  const runs: Record<string, RunWithJobs> = {
    '.github/workflows/ci-blocking.yml': {
      id: 1,
      url: 'https://github.com/o/r/actions/runs/1',
      // The run failed, but only the acceptance job did; the security job passed.
      conclusion: 'failure',
      at: '2026-10-14T00:00:00Z',
      jobs: [
        { name: 'Unit tests', conclusion: 'success' },
        { name: 'acceptance', conclusion: 'failure' },
        { name: 'Security', conclusion: 'success' },
      ],
    },
    '.github/workflows/deploy.yml': {
      id: 2,
      url: 'https://github.com/o/r/actions/runs/2',
      conclusion: 'success',
      at: '2026-10-14T00:00:00Z',
      jobs: [
        { name: 'ci / Mutation tests', conclusion: 'success' },
        { name: 'load', conclusion: 'success' },
      ],
    },
  }

  const source = (commits: CommitLike[] = []): ScorecardSource => ({
    defaultBranch: async () => 'main',
    workflows: async () => files,
    latestRun: async (w) => runs[w] ?? null,
    commits: async () => commits,
  })

  const period = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') }

  const collect = async (
    over: Partial<ProjectConfig>,
    ee?: EngineeringExcellence,
    commits?: CommitLike[],
  ) => {
    const block = await collectScorecard(
      project(over),
      config,
      period,
      ee,
      [],
      source(commits),
      NOW,
    )
    if (!block.available) throw new Error(block.reason)
    return block.data
  }

  it('rates each practice from the job that runs it, and reads a reusable workflow through its caller', async () => {
    const card = await collect({ type: 'back-front' })
    const rag = Object.fromEntries(card.practices.map((p) => [p.id, p.rag]))
    expect(rag).toEqual({
      spec: 'red',
      tests: 'green',
      mutation: 'green',
      secrets: 'green',
      vulnerabilities: 'green',
      sast: 'green',
      sbom: 'green',
      complexity: 'green',
      dast: 'red',
      performance: 'grey',
      hygiene: 'red',
    })
    expect(card.practices.find((p) => p.id === 'mutation')?.lastRun?.workflow).toBe(
      '.github/workflows/deploy.yml',
    )
    expect(card.facetsPublished).toBe(false)
    expect(card.practices.every((p) => p.source !== 'facet')).toBe(true)
    // Spec is failing, so L2 is out of reach.
    expect(card.level).toBe(1)
    // DAST is red and now counts: the test environment is a phase like any other.
    expect(card.gates).toEqual({ present: 7, applicable: 10 })
  })

  it('lets facets decide the result while workflows still name the tools', async () => {
    const card = await collect(
      { type: 'back-front', scorecard: { performance: true } },
      excellence(),
    )
    const mutation = card.practices.find((p) => p.id === 'mutation')
    expect(mutation).toMatchObject({
      source: 'facet',
      rag: 'yellow',
      tools: ['Stryker', 'mutation facet'],
    })
    expect(card.practices.find((p) => p.id === 'sast')).toMatchObject({
      source: 'facet',
      rag: 'red',
    })
    expect(card.practices.find((p) => p.id === 'secrets')?.source).toBe('detected')
    expect(card.practices.find((p) => p.id === 'performance')?.rag).toBe('green')
    expect(card.facetsPublished).toBe(true)
  })

  it('raises the AI alert for a heavily assisted project with weak gates', async () => {
    const assisted = Array.from({ length: 4 }, () =>
      commit('x\n\nCo-authored-by: Claude <noreply@anthropic.com>'),
    )
    const card = await collect({ type: 'back-front' }, excellence(), assisted)
    expect(card.aiUsage).toMatchObject({ available: true, data: { level: 5 } })
    expect(card.level).toBe(0)
    expect(card.alerts.map((a) => a.code)).toEqual(['HIGH_AI_LOW_ENGINEERING'])
  })
})

describe('weak tools', () => {
  const ci = (testStep: string) => `name: CI
jobs:
  test:
    name: Tests
    steps:
      - uses: actions/checkout@v4
      - run: ${testStep}
  security:
    name: Security
    steps:
      - uses: trufflesecurity/trufflehog@v3.82.0
      - uses: aquasecurity/trivy-action@0.28.0
        with:
          exit-code: '1'
      - run: semgrep scan --config auto --error
`
  const testsOf = (text: string, path = '.github/workflows/ci.yml') =>
    summarizeDetections(detectTools(path, text, [practice('tests')])).get('tests')

  it.each([
    ['dotnet test', 'dotnet test Janus.sln -c Release'],
    ['npm test', 'npm run test'],
    ['pnpm test', 'pnpm test'],
    ['yarn test', 'yarn test --ci'],
    ['Vitest', 'npx vitest run'],
    ['Jest', 'npx jest'],
    ['pytest', 'python -m pytest tests/'],
    ['go test', 'go test ./...'],
    ['Maven', 'mvn -B -ntp verify'],
    ['Gradle', './gradlew test'],
    ['cargo test', 'cargo test --workspace'],
  ])('detects %s as a weak tests tool', (tool, step) => {
    expect(testsOf(ci(step))).toMatchObject({ tools: [tool], weak: true })
  })

  it('names a step strong when it runs the tests with a coverage tool', () => {
    expect(testsOf(ci('dotnet test --collect:"XPlat Code Coverage"'))).toMatchObject({
      tools: ['coverlet'],
      weak: false,
    })
  })

  it('lets a strong hit in another workflow decide the job whose run is read', () => {
    const hits = [
      ...detectTools('.github/workflows/a.yml', ci('dotnet test'), [practice('tests')]),
      ...detectTools('.github/workflows/b.yml', ci('npx vitest run --coverage'), [
        practice('tests'),
      ]),
    ]
    expect(summarizeDetections(hits).get('tests')).toMatchObject({
      tools: ['dotnet test', '--coverage'],
      workflow: '.github/workflows/b.yml',
      weak: false,
    })
  })

  it('rates weak-only evidence yellow even when blocking and passing, but red when failing', () => {
    const weak = rate('tests', evidence({ tools: ['dotnet test'], weak: true }))
    expect(weak.rag).toBe('yellow')
    expect(weak.reason).toContain('dotnet test')
    expect(rate('tests', evidence({ weak: true, result: 'failing' })).rag).toBe('red')
  })

  const collectWith = async (testStep: string, ee?: EngineeringExcellence) => {
    const block = await collectScorecard(
      project({ type: 'library' }),
      config,
      { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') },
      ee,
      [],
      {
        defaultBranch: async () => 'main',
        workflows: async () => [{ path: '.github/workflows/ci.yml', text: ci(testStep) }],
        latestRun: async () => ({
          id: 7,
          url: 'https://github.com/o/r/actions/runs/7',
          conclusion: 'success',
          at: '2026-10-18T00:00:00Z',
          jobs: [
            { name: 'Tests', conclusion: 'success' },
            { name: 'Security', conclusion: 'success' },
          ],
        }),
        commits: async () => [],
      },
      NOW,
    )
    if (!block.available) throw new Error(block.reason)
    return block.data
  }

  it('counts plain test runs as present for L1 but not green for L2', async () => {
    const card = await collectWith('dotnet test')
    const tests = card.practices.find((p) => p.id === 'tests')
    expect(tests).toMatchObject({ rag: 'yellow', source: 'detected', tools: ['dotnet test'] })
    expect(card.level).toBe(1)
  })

  it('rates tests with a coverage tool green, the strong path', async () => {
    const card = await collectWith('dotnet test --collect:"XPlat Code Coverage"')
    expect(card.practices.find((p) => p.id === 'tests')).toMatchObject({
      rag: 'green',
      tools: ['coverlet'],
    })
  })

  it('lets a passing coverage facet lift weak detection to green', async () => {
    const card = await collectWith('dotnet test', excellence())
    expect(card.practices.find((p) => p.id === 'tests')).toMatchObject({
      rag: 'green',
      source: 'facet',
      tools: ['dotnet test', 'coverage facet'],
    })
  })
})

describe('Gherkin suites from repository content', () => {
  // The layout of a .NET repository whose Reqnroll suite runs through plain dotnet test.
  const reqnrollTree = [
    'App.sln',
    'src/App.Core/App.Core.csproj',
    'tests/App.Core.UnitTests/App.Core.UnitTests.csproj',
    'tests/App.AcceptanceTests/App.AcceptanceTests.csproj',
    'tests/App.AcceptanceTests/Features/Sync.feature',
    'tests/App.AcceptanceTests/Features/Routing.feature',
    'tests/App.AcceptanceTests/Steps/SyncSteps.cs',
  ]
  const suites = featureSuites(reqnrollTree)

  const step = (run: string, extra = '') => `jobs:
  test:
    name: Tests
    steps:
      - uses: actions/checkout@v4
      - run: ${run}
${extra}`

  it('groups feature files under the nearest project file', () => {
    expect(suites).toEqual([
      {
        root: 'tests/App.AcceptanceTests',
        projectFile: 'tests/App.AcceptanceTests/App.AcceptanceTests.csproj',
        featureDirs: ['tests/App.AcceptanceTests/Features'],
      },
    ])
  })

  it('detects a folded dotnet test line that targets the suite project, blocking', () => {
    const hits = detectGherkinRuns('q.yml', workflow('reqnroll-dotnet-test.yml'), suites)
    // Only the acceptance step: the unit test loop and the build step do not reach the suite.
    expect(hits).toEqual([
      {
        practice: 'spec',
        tool: GHERKIN_TOOL,
        workflow: 'q.yml',
        job: 'tests',
        jobName: 'Tests + coverage (unit, acceptance)',
        mode: 'blocking',
        weak: false,
      },
    ])
    // Tool-name detection alone misses it, which is the gap this closes.
    expect(detectTools('q.yml', workflow('reqnroll-dotnet-test.yml'), [practice('spec')])).toEqual(
      [],
    )
  })

  it.each([
    ['the solution', 'dotnet test App.sln -c Release'],
    ['the whole tree', 'dotnet test --no-build'],
    ['the project directory', 'dotnet test ./tests/App.AcceptanceTests'],
  ])('counts a dotnet test that runs %s', (_, run) => {
    expect(detectGherkinRuns('w.yml', step(run), suites)).toHaveLength(1)
  })

  it.each([
    ['another project', 'dotnet test tests/App.Core.UnitTests/App.Core.UnitTests.csproj'],
    ['a build, not a test', 'dotnet build App.sln'],
    ['a test run inside another directory', 'dotnet test', '        working-directory: src'],
  ])('does not count %s', (_, run, extra = '') => {
    expect(detectGherkinRuns('w.yml', step(run, extra), suites)).toEqual([])
  })

  it('reads a report-only step as report-only', () => {
    const run = 'dotnet test App.sln || true'
    expect(detectGherkinRuns('w.yml', step(run), suites)[0]?.mode).toBe('report-only')
  })

  it('reaches a JavaScript suite only from its own package root', () => {
    const web = featureSuites(['package.json', 'web/package.json', 'web/features/cart.feature'])
    expect(web.map((s) => s.root)).toEqual(['web'])
    expect(detectGherkinRuns('w.yml', step('npm test'), web)).toEqual([])
    expect(
      detectGherkinRuns('w.yml', step('npm test', '        working-directory: web'), web),
    ).toHaveLength(1)
    expect(detectGherkinRuns('w.yml', step('cd web && npm test'), web)).toHaveLength(1)
  })

  const collectWith = async (tree: string[] | null, text: string) => {
    const block = await collectScorecard(
      project({ type: 'library' }),
      config,
      { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') },
      undefined,
      [],
      {
        defaultBranch: async () => 'main',
        workflows: async () => [{ path: '.github/workflows/quality.yml', text }],
        latestRun: async () => ({
          id: 9,
          url: 'https://github.com/o/r/actions/runs/9',
          conclusion: 'failure',
          at: '2026-10-18T00:00:00Z',
          jobs: [{ name: 'Tests + coverage (unit, acceptance)', conclusion: 'success' }],
        }),
        commits: async () => [],
        files: async () => tree,
      },
      NOW,
    )
    if (!block.available) throw new Error(block.reason)
    return block.data.practices.find((p) => p.id === 'spec')
  }

  it('rates a Reqnroll suite run by dotnet test green from its own job', async () => {
    expect(await collectWith(reqnrollTree, workflow('reqnroll-dotnet-test.yml'))).toMatchObject({
      rag: 'green',
      source: 'detected',
      tools: [GHERKIN_TOOL],
      mode: 'blocking',
      result: 'passing',
      lastRun: { workflow: '.github/workflows/quality.yml', conclusion: 'success' },
    })
  })

  it('rates feature files that no workflow runs yellow, not red', async () => {
    const buildOnly = 'jobs:\n  build:\n    steps:\n      - run: dotnet build App.sln\n'
    expect(await collectWith(reqnrollTree, buildOnly)).toMatchObject({
      rag: 'yellow',
      reason: GHERKIN_NOT_RUN,
      tools: [GHERKIN_TOOL],
      lastRun: null,
    })
  })

  it.each([
    ['has no feature files', reqnrollTree.filter((p) => !p.endsWith('.feature'))],
    ['cannot be read', null],
  ])('leaves spec absent when the repository %s', async (_, tree) => {
    expect(await collectWith(tree, workflow('reqnroll-dotnet-test.yml'))).toMatchObject({
      rag: 'red',
      source: 'none',
      tools: [],
    })
  })
})

describe('project types', () => {
  const schema = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', '..', 'schema', 'projects.schema.json'), 'utf8'),
  ) as { properties: { projects: { items: { properties: { type: { enum: string[] } } } } } }
  const schemaTypes = schema.properties.projects.items.properties.type.enum

  it('accepts browser-extension and static-site in projects.json', () => {
    expect(schemaTypes).toContain('browser-extension')
    expect(schemaTypes).toContain('static-site')
  })

  it('keeps the schema, the collector and config/scorecard.json on the same types', () => {
    expect([...schemaTypes].sort()).toEqual([...PROJECT_TYPES].sort())
    expect(Object.keys(config.types).sort()).toEqual([...PROJECT_TYPES].sort())
  })

  it('labels the new types', () => {
    expect(config.types['browser-extension'].label).toBe('Browser extension')
    expect(config.types['static-site'].label).toBe('Static site')
  })
})

describe('project groups', () => {
  const schema = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', '..', 'schema', 'projects.schema.json'), 'utf8'),
  ) as {
    properties: {
      projects: { items: { required: string[]; properties: { group: { enum: string[] } } } }
    }
  }
  const items = schema.properties.projects.items

  it('keeps the schema and the collector on the same groups', () => {
    expect([...items.properties.group.enum].sort()).toEqual([...PROJECT_GROUPS].sort())
  })

  it('leaves group optional, so a projects.json written before it existed still validates', () => {
    expect(items.required).not.toContain('group')
  })
})

describe('detectedEvidence', () => {
  const ci = '.github/workflows/app-ci.yml'
  const cd = '.github/workflows/app-deploy.yml'
  const files = [
    { path: ci, text: 'on:\n  schedule:\n  workflow_call:\njobs:\n  api:\n    name: API\n' },
    { path: cd, text: 'jobs:\n  ci:\n    uses: ./.github/workflows/app-ci.yml\n' },
  ]
  const detection = {
    tools: ['Gherkin (.feature files)'],
    mode: 'blocking' as const,
    workflow: ci,
    job: 'api',
    jobName: 'API',
    weak: false,
  }
  const run = (id: number, at: string, job: string | null): RunWithJobs => ({
    id,
    url: `https://github.com/o/r/actions/runs/${id}`,
    conclusion: 'success',
    at,
    jobs: [{ name: id === 1 ? 'API' : 'ci / API', conclusion: job }],
  })
  const source = (runs: Record<string, RunWithJobs>): ScorecardSource => ({
    defaultBranch: async () => 'main',
    workflows: async () => files,
    latestRun: async (w) => runs[w] ?? null,
    commits: async () => [],
  })
  const before = new Date('2026-11-01T00:00:00Z')

  it('reads the caller when the reusable workflow its own newest run skipped the job', async () => {
    // Numa: a weekly schedule of app-ci skips the API job, while CD runs it on main and passes.
    const evidence = await detectedEvidence(
      detection,
      files,
      'main',
      before,
      source({
        [ci]: run(1, '2026-10-12T06:00:00Z', 'skipped'),
        [cd]: run(2, '2026-10-11T22:00:00Z', 'success'),
      }),
    )

    expect(evidence.result).toBe('passing')
    expect(evidence.lastRun?.workflow).toBe(cd)
  })

  it('prefers the newest decisive run when both have one', async () => {
    const evidence = await detectedEvidence(
      detection,
      files,
      'main',
      before,
      source({
        [ci]: run(1, '2026-10-12T06:00:00Z', 'failure'),
        [cd]: run(2, '2026-10-11T22:00:00Z', 'success'),
      }),
    )

    expect(evidence.result).toBe('failing')
    expect(evidence.lastRun?.workflow).toBe(ci)
  })

  it('stays unknown when no run decided anything', async () => {
    const evidence = await detectedEvidence(
      detection,
      files,
      'main',
      before,
      source({ [ci]: run(1, '2026-10-12T06:00:00Z', 'skipped') }),
    )

    expect(evidence.result).toBe('unknown')
  })

  it('reads every location of a practice, so a never-run post-deploy scan does not hide the weekly one', async () => {
    // Compass: ZAP lives in cd.yml (post-deploy, no environment yet, never ran) and security.yml.
    const weekly = '.github/workflows/security.yml'
    const deploy = '.github/workflows/cd.yml'
    const zap = {
      tools: ['OWASP ZAP'],
      mode: 'blocking' as const,
      workflow: deploy,
      job: 'dast',
      jobName: 'DAST',
      weak: false,
      locations: [
        { workflow: deploy, job: 'dast', jobName: 'DAST', mode: 'blocking' as const, weak: false },
        {
          workflow: weekly,
          job: 'dast',
          jobName: 'DAST (OWASP ZAP)',
          mode: 'blocking' as const,
          weak: false,
        },
        {
          workflow: weekly,
          job: 'zap-report',
          jobName: 'ZAP report',
          mode: 'report-only' as const,
          weak: false,
        },
      ],
    }
    const evidence = await detectedEvidence(zap, [], 'main', before, {
      ...source({}),
      latestRun: async (w) =>
        w === weekly
          ? {
              id: 9,
              url: 'https://github.com/o/r/actions/runs/9',
              conclusion: 'success',
              at: '2026-10-12T10:00:00Z',
              jobs: [
                { name: 'DAST (OWASP ZAP)', conclusion: 'success' },
                { name: 'ZAP report', conclusion: 'failure' },
              ],
            }
          : null,
    })

    expect(evidence.result).toBe('passing')
    expect(evidence.lastRun?.workflow).toBe(weekly)
  })
})
