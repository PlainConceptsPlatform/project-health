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
  type PracticeEvidence,
  type RunWithJobs,
  type ScorecardSource,
  applicability,
  collectScorecard,
  engineeringLevel,
  engineeringScore,
  facetEvidence,
  gateCounts,
  matchJob,
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
import { ok, skip } from './types.ts'

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

const N1 = { secrets: 'green', vulnerabilities: 'green', sast: 'green', tests: 'yellow' } as const
const N2 = { ...N1, tests: 'green', spec: 'green', sbom: 'green' } as const
const N3 = { ...N2, mutation: 'green', dast: 'green', complexity: 'green' } as const

describe('engineeringLevel', () => {
  it('is N0 when a security gate is only yellow', () => {
    expect(engineeringLevel(results({ ...N1, sast: 'yellow' }))).toBe(0)
  })

  it('is N0 when tests are absent, even with every security gate green', () => {
    expect(engineeringLevel(results({ ...N1, tests: 'red' }))).toBe(0)
  })

  it('counts present-but-yellow tests for N1 and needs them green for N2', () => {
    expect(engineeringLevel(results(N1))).toBe(1)
    expect(engineeringLevel(results({ ...N2, tests: 'yellow' }))).toBe(1)
    expect(engineeringLevel(results(N2))).toBe(2)
  })

  it('needs mutation, DAST and complexity green for N3', () => {
    expect(engineeringLevel(results({ ...N3, complexity: 'yellow' }))).toBe(2)
    expect(engineeringLevel(results(N3))).toBe(3)
  })

  it('does not let a not-applicable gate hold a project back', () => {
    // An ML project has no spec, mutation or DAST; requiring them would cap it at N1 forever.
    const { spec: _s, mutation: _m, dast: _d, ...rest } = N3
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
      ['dast', 'performance'],
    )
    expect(engineeringScore(practices)).toBe(63)
    expect(gateCounts(practices)).toEqual({ present: 6, applicable: 8 })
  })

  it('counts only build gates in the gates column', () => {
    const practices = results({ dast: 'green' }, ['performance'])
    expect(gateCounts(practices)).toEqual({ present: 0, applicable: 8 })
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

  it('raises high AI usage with low engineering at AI 4 and level N1, not at N2 or AI 3', () => {
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
    })
    expect(card.practices.find((p) => p.id === 'mutation')?.lastRun?.workflow).toBe(
      '.github/workflows/deploy.yml',
    )
    expect(card.facetsPublished).toBe(false)
    expect(card.practices.every((p) => p.source !== 'facet')).toBe(true)
    // Spec is failing, so N2 is out of reach.
    expect(card.level).toBe(1)
    expect(card.gates).toEqual({ present: 7, applicable: 8 })
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
