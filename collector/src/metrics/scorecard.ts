import type { PracticeDefinition, ScorecardConfig } from '../config.ts'
import { type WorkflowRun, get, paginate } from '../github.ts'
import {
  type AiUsage,
  type DetectedMode,
  type EngineeringExcellence,
  type FacetSeries,
  type HygieneData,
  type LastRun,
  type MetricBlock,
  PROJECT_TYPES,
  type PracticeResult,
  type PracticeResultState,
  type PracticeSource,
  type ProjectConfig,
  type ProjectType,
  type Rag,
  type Scorecard,
  type ScorecardAlert,
  type SecurityData,
  skip,
} from '../types.ts'
import { type CommitLike, summarizeAiUsage } from './ai-usage.ts'
import {
  GHERKIN_NOT_RUN,
  GHERKIN_TOOL,
  SPEC_PRACTICE,
  detectGherkinRuns,
  featureSuites,
} from './gherkin-detection.ts'
import {
  type PracticeDetection,
  callersOf,
  detectTools,
  summarizeDetections,
} from './workflow-detection.ts'

const DAY_MS = 86_400_000

/** What is known about one practice, from one source, before it is rated. */
export interface PracticeEvidence {
  source: Exclude<PracticeSource, 'none'>
  tools: string[]
  /** null when the source cannot tell, which a facet cannot: it reports a result, not a mode. */
  mode: DetectedMode | null
  result: PracticeResultState
  resultAt: string | null
  lastRun: LastRun | null
  /** Found only through tools below the practice's standard, so it can be yellow at best. */
  weak?: boolean
  /** Why the practice is there but not running, which holds it at yellow whatever else is known. */
  shortfall?: string
}

export const projectTypeOf = (project: ProjectConfig): ProjectType =>
  project.type && (PROJECT_TYPES as readonly string[]).includes(project.type)
    ? project.type
    : 'other'

/** Whether a practice applies to a project, and if not, why. */
export function applicability(
  practice: PracticeDefinition,
  project: ProjectConfig,
  config: ScorecardConfig,
): { applicable: boolean; reason: string | null } {
  if (practice.enabled === false) {
    return { applicable: false, reason: 'Disabled for every project in config/scorecard.json.' }
  }
  const type = projectTypeOf(project)
  if (config.types[type]?.notApplicable.includes(practice.id)) {
    return {
      applicable: false,
      reason: `Not expected of a ${config.types[type].label.toLowerCase()} project.`,
    }
  }
  if (project.scorecard?.notApplicable?.includes(practice.id)) {
    return { applicable: false, reason: 'Marked not applicable for this project in projects.json.' }
  }
  if (practice.optIn) {
    const optedIn = (project.scorecard as Record<string, unknown> | undefined)?.[practice.id]
    const typeDefault = config.types[type]?.applicable?.includes(practice.id) ?? false
    if (typeDefault && optedIn === false) {
      return {
        applicable: false,
        reason: `Opted out with scorecard.${practice.id}: false in projects.json.`,
      }
    }
    if (!typeDefault && optedIn !== true) {
      return {
        applicable: false,
        reason: `Only expected when required; opt in with scorecard.${practice.id} in projects.json.`,
      }
    }
  }
  return { applicable: true, reason: null }
}

/**
 * The colour of one practice. The order matters: a failing blocking gate is red even when it is
 * also stale, because the last thing known about it is that the default branch is broken.
 */
export function ratePractice(
  practice: PracticeDefinition,
  applicable: { applicable: boolean; reason: string | null },
  evidence: PracticeEvidence | null,
  reference: Date,
  staleDays: number,
): { rag: Rag; reason: string } {
  if (!applicable.applicable) {
    return { rag: 'grey', reason: applicable.reason ?? 'Not applicable.' }
  }
  if (!evidence) {
    return {
      rag: 'red',
      reason:
        'Expected but absent: no workflow on the default branch runs it and no facet reports it.',
    }
  }

  if (evidence.shortfall) return { rag: 'yellow', reason: evidence.shortfall }

  const expectsBlocking = practice.mode === 'blocking' || practice.mode === 'threshold'
  if (
    practice.mode === 'blocking' &&
    evidence.result === 'failing' &&
    evidence.mode !== 'report-only'
  ) {
    return { rag: 'red', reason: 'Blocking gate failing on the default branch.' }
  }
  if (expectsBlocking && evidence.mode === 'report-only') {
    return {
      rag: 'yellow',
      reason: `Runs report-only, where ${practice.mode === 'blocking' ? 'blocking' : 'an enforced threshold'} is expected.`,
    }
  }
  if (evidence.result === 'failing') {
    return {
      rag: 'yellow',
      reason: practice.mode === 'threshold' ? 'Threshold not met.' : 'Policy check failing.',
    }
  }
  if (evidence.result === 'unknown') {
    return {
      rag: 'yellow',
      reason: 'Present, but no completed run on the default branch to judge it by.',
    }
  }
  if (evidence.weak) {
    return {
      rag: 'yellow',
      reason: `Present through ${evidence.tools.join(', ')} only, which falls short of the standard: ${practice.description}`,
    }
  }
  if (evidence.resultAt) {
    const age = Math.floor((reference.getTime() - new Date(evidence.resultAt).getTime()) / DAY_MS)
    if (age > staleDays) {
      return {
        rag: 'yellow',
        reason: `Last result is ${age} days old, past the ${staleDays} day limit.`,
      }
    }
  }
  return {
    rag: 'green',
    reason:
      practice.mode === 'threshold'
        ? 'Present and threshold met.'
        : practice.mode === 'policy'
          ? 'Present and within policy.'
          : 'Present, blocking and passing.',
  }
}

const find = (practices: PracticeResult[], id: string) => practices.find((p) => p.id === id)

/** A practice that is disabled or does not apply never holds a project back. */
const isGreen = (practices: PracticeResult[], id: string) => {
  const p = find(practices, id)
  return !p || !p.applicable || p.rag === 'green'
}

const isPresent = (practices: PracticeResult[], id: string) => {
  const p = find(practices, id)
  return !p || !p.applicable || p.rag === 'green' || p.rag === 'yellow'
}

/** L0 to L3, cumulative, where only green gates count towards a level. */
export function engineeringLevel(practices: PracticeResult[]): number {
  const n1 =
    isGreen(practices, 'secrets') &&
    isGreen(practices, 'vulnerabilities') &&
    isGreen(practices, 'sast') &&
    isPresent(practices, 'tests')
  if (!n1) return 0
  const n2 = isGreen(practices, 'tests') && isGreen(practices, 'spec') && isGreen(practices, 'sbom')
  if (!n2) return 1
  const n3 =
    isGreen(practices, 'mutation') && isGreen(practices, 'dast') && isGreen(practices, 'complexity')
  return n3 ? 3 : 2
}

/** (green + half of yellow) over applicable, 0 to 100. null when nothing applies. */
export function engineeringScore(practices: PracticeResult[]): number | null {
  const applicable = practices.filter((p) => p.applicable)
  if (applicable.length === 0) return null
  const green = applicable.filter((p) => p.rag === 'green').length
  const yellow = applicable.filter((p) => p.rag === 'yellow').length
  return Math.round(((green + 0.5 * yellow) / applicable.length) * 100)
}

/**
 * Gates in place, green or yellow, out of those that apply, in every phase: leaving out the test
 * environment hid a red DAST or Performance behind a full count.
 */
export function gateCounts(practices: PracticeResult[]): { present: number; applicable: number } {
  const applicable = practices.filter((p) => p.applicable)
  return {
    present: applicable.filter((p) => p.rag === 'green' || p.rag === 'yellow').length,
    applicable: applicable.length,
  }
}

/**
 * Alerts that read the two axes together.
 *
 * `previousScores` are the scores of the months before this one, oldest first, already trimmed to
 * the alert window. A decline is measured from the best of them, so a dip that recovered and fell
 * again is still caught.
 */
export function scorecardAlerts(
  input: {
    level: number
    score: number | null
    aiUsage: MetricBlock<AiUsage>
    previousScores: (number | null)[]
  },
  config: ScorecardConfig['alerts'],
): ScorecardAlert[] {
  const alerts: ScorecardAlert[] = []
  if (
    input.aiUsage.available &&
    input.aiUsage.data.level >= config.highAiUsage &&
    input.level <= config.lowLevel
  ) {
    alerts.push({
      code: 'HIGH_AI_LOW_ENGINEERING',
      severity: 'red',
      message: `High AI usage, low engineering: AI usage is ${input.aiUsage.data.level}/5 while the engineering level is L${input.level}, so AI-assisted change lands without the gates that would catch its mistakes.`,
    })
  }

  const earlier = input.previousScores.filter((s): s is number => s !== null)
  if (input.score !== null && earlier.length > 0) {
    const best = Math.max(...earlier)
    if (best - input.score >= config.decliningPoints) {
      alerts.push({
        code: 'ENGINEERING_DECLINING',
        severity: 'amber',
        message: `Engineering declining: the score fell from ${best} to ${input.score} within the last ${config.decliningMonths} months.`,
      })
    }
  }
  return alerts
}

const runUrl = (repo: string, runId: number | null) =>
  runId === null ? null : `https://github.com/${repo}/actions/runs/${runId}`

const jobResult = (jobs: SecurityData['jobs'], pattern: RegExp): PracticeResultState | null => {
  const entry = Object.entries(jobs).find(([name]) => pattern.test(name))
  if (!entry) return null
  return entry[1] === 'success' ? 'passing' : entry[1] === 'failure' ? 'failing' : 'unknown'
}

/**
 * A swallowed-exception count of null means the producer ran no scanner, which is not a finding.
 * Dead code only counts when the build does not already fail on it.
 */
export function hygieneVerdict(data: HygieneData): PracticeResultState {
  const duplication = data.gate?.violations ?? 0
  const swallowed = data.global.swallowedExceptions ?? 0
  const dead = data.deadCode.gated ? 0 : data.deadCode.warnings
  const comments = data.commentSlop?.gate?.violations ?? 0
  return duplication + swallowed + dead + comments === 0 ? 'passing' : 'failing'
}

/**
 * Evidence from the engineering excellence facets, when the repository publishes them. Facets are
 * the stronger source, because they carry the gate's own verdict rather than a guess from YAML.
 */
export function facetEvidence(
  practiceId: string,
  excellence: EngineeringExcellence | undefined,
  repo: string,
): PracticeEvidence | null {
  if (!excellence) return null

  const evidence = <T>(
    block: MetricBlock<FacetSeries<T>>,
    tool: string,
    verdict: (latest: T) => PracticeResultState | null,
    mode: DetectedMode | null = null,
  ): PracticeEvidence | null => {
    if (!block.available) return null
    const result = verdict(block.data.latest)
    if (result === null) return null
    const at = block.data.latestGeneratedAt
    const url = runUrl(repo, block.data.samples.at(-1)?.runId ?? null)
    return {
      source: 'facet',
      tools: [tool],
      mode,
      result,
      resultAt: at,
      lastRun: url
        ? {
            workflow: 'engineering-excellence facet',
            url,
            conclusion: result === 'passing' ? 'success' : result === 'failing' ? 'failure' : null,
            at,
          }
        : null,
    }
  }
  const passed = (d: { passed: boolean }): PracticeResultState => (d.passed ? 'passing' : 'failing')
  // The security facet's `jobs` are, by contract, the results of the BLOCKING scanner jobs
  // (schema/engineering-excellence-facets.schema.json; Atlas, Janus and others write
  // secretScan / depsAndIac / sast). A scanner the facet reports is a gate, whatever its workflow
  // line looks like: a step that runs `bash scripts/security/sast.sh` hides `--error` from YAML.
  const SECRETS = /trufflehog|secret|gitleaks/i
  const VULNS = /trivy|depsandiac|dependenc/i
  const SAST = /semgrep|sast/i
  const securityJobs = excellence.security.available ? excellence.security.data.latest.jobs : null
  const gateMode = (pattern: RegExp): DetectedMode | null =>
    securityJobs && Object.keys(securityJobs).some((name) => pattern.test(name)) ? 'blocking' : null

  switch (practiceId) {
    case 'tests':
      return evidence(excellence.coverage, 'coverage facet', passed)
    case 'mutation':
      return evidence(excellence.mutation, 'mutation facet', passed)
    case 'complexity': {
      const gate = excellence.complexity.available ? excellence.complexity.data.latest.gate : null
      // Complexity measured without a gate is reported, not enforced.
      return gate
        ? evidence(excellence.complexity, 'complexity gate', (d) =>
            d.gate && d.gate.violations > 0 ? 'failing' : 'passing',
          )
        : evidence(excellence.complexity, 'complexity facet', () => 'passing', 'report-only')
    }
    case 'secrets':
      return evidence(
        excellence.security,
        'security facet',
        (d) => jobResult(d.jobs, SECRETS),
        gateMode(SECRETS),
      )
    case 'vulnerabilities':
      return evidence(
        excellence.security,
        'Trivy (facet)',
        (d) => {
          const job = jobResult(d.jobs, VULNS)
          if (job) return job
          if (!d.trivy) return null
          const { vuln, misconfig } = d.trivy
          const blocking = vuln.CRITICAL + vuln.HIGH + misconfig.CRITICAL + misconfig.HIGH
          return blocking === 0 ? 'passing' : 'failing'
        },
        gateMode(VULNS),
      )
    case 'sast':
      return evidence(
        excellence.security,
        'Semgrep (facet)',
        (d) => {
          const job = jobResult(d.jobs, SAST)
          if (job) return job
          if (!d.semgrep) return null
          return d.semgrep.ERROR === 0 ? 'passing' : 'failing'
        },
        gateMode(SAST),
      )
    case 'sbom':
      return evidence(excellence.sbom, 'SBOM facet', () => 'passing')
    case 'hygiene': {
      const gate = excellence.hygiene.available ? excellence.hygiene.data.latest.gate : null
      // Duplication measured without a gate is reported, not held.
      return gate
        ? evidence(excellence.hygiene, 'hygiene facet', hygieneVerdict, 'blocking')
        : evidence(excellence.hygiene, 'hygiene facet', () => 'passing', 'report-only')
    }
    default:
      return null
  }
}

/**
 * Facet evidence wins on result; workflow detection still names the tools and the mode. A facet
 * reports the gate itself, so the merged evidence is never weak.
 */
export function mergeEvidence(
  facet: PracticeEvidence | null,
  detected: PracticeEvidence | null,
): PracticeEvidence | null {
  if (!facet) return detected
  if (!detected) return facet
  return {
    ...facet,
    tools: [...new Set([...detected.tools, ...facet.tools])],
    mode: facet.mode ?? detected.mode,
    weak: false,
  }
}

export interface BuildInput {
  project: ProjectConfig
  config: ScorecardConfig
  reference: Date
  defaultBranch: string | null
  workflowsScanned: number
  excellence: EngineeringExcellence | undefined
  detected: Map<string, PracticeEvidence>
  aiUsage: MetricBlock<AiUsage>
  previousScores: (number | null)[]
}

/** Every rule applied to the evidence. Pure, so the whole scorecard is testable without the API. */
export function buildScorecard(input: BuildInput): Scorecard {
  const { project, config } = input
  const practices: PracticeResult[] = [...config.practices]
    .sort((a, b) => a.number - b.number)
    .map((practice) => {
      const applies = applicability(practice, project, config)
      const evidence = mergeEvidence(
        facetEvidence(practice.id, input.excellence, project.repo),
        input.detected.get(practice.id) ?? null,
      )
      const { rag, reason } = ratePractice(
        practice,
        applies,
        evidence,
        input.reference,
        config.staleDays,
      )
      return {
        id: practice.id,
        number: practice.number,
        name: practice.name,
        phase: practice.phase,
        standardMode: practice.mode,
        description: practice.description,
        applicable: applies.applicable,
        rag,
        reason,
        source: evidence?.source ?? 'none',
        tools: evidence?.tools ?? [],
        mode: evidence?.mode ?? null,
        result: evidence?.result ?? null,
        resultAt: evidence?.resultAt ?? null,
        lastRun: evidence?.lastRun ?? null,
      }
    })

  const level = engineeringLevel(practices)
  const score = engineeringScore(practices)
  const facetsPublished = input.excellence
    ? Object.values(input.excellence).some((block) => block.available)
    : false

  return {
    projectType: projectTypeOf(project),
    defaultBranch: input.defaultBranch,
    facetsPublished,
    workflowsScanned: input.workflowsScanned,
    practices,
    level,
    score,
    gates: gateCounts(practices),
    aiUsage: input.aiUsage,
    alerts: scorecardAlerts(
      { level, score, aiUsage: input.aiUsage, previousScores: input.previousScores },
      config.alerts,
    ),
  }
}

export interface WorkflowFile {
  path: string
  text: string
}

/** Everything the scorecard reads from GitHub, behind one seam so tests need no network. */
export interface ScorecardSource {
  defaultBranch: () => Promise<string | null>
  workflows: (branch: string) => Promise<WorkflowFile[]>
  /** The newest completed run of a workflow on the branch created before `before`. */
  latestRun: (workflow: string, branch: string, before: Date) => Promise<RunWithJobs | null>
  commits: (branch: string, from: Date, to: Date) => Promise<CommitLike[]>
  /**
   * Every file path on the branch, or null when the tree cannot be read. When absent, repository
   * content is not consulted and detection reads workflows only.
   */
  files?: (branch: string) => Promise<string[] | null>
}

export interface RunWithJobs {
  id: number
  url: string
  conclusion: string | null
  at: string
  jobs: { name: string; conclusion: string | null }[]
}

interface ContentEntry {
  name: string
  path: string
  type: string
}

/** Workflow files change rarely, so a backfill reads them once per repository rather than per month. */
const workflowCache = new Map<string, Promise<WorkflowFile[]>>()
const treeCache = new Map<string, Promise<string[] | null>>()

export const githubScorecardSource = (repo: string): ScorecardSource => ({
  defaultBranch: async () =>
    (await get<{ default_branch: string }>(`/repos/${repo}`))?.default_branch ?? null,

  workflows: (branch) => {
    const key = `${repo}@${branch}`
    const cached = workflowCache.get(key)
    if (cached) return cached
    const load = (async () => {
      const entries =
        (await get<ContentEntry[]>(
          `/repos/${repo}/contents/.github/workflows?ref=${encodeURIComponent(branch)}`,
        )) ?? []
      const files = entries.filter((e) => e.type === 'file' && /\.ya?ml$/i.test(e.name))
      const read = await Promise.all(
        files.map(async (file) => {
          const content = await get<{ content?: string; encoding?: string }>(
            `/repos/${repo}/contents/${file.path}?ref=${encodeURIComponent(branch)}`,
          )
          if (!content?.content) return null
          const text =
            content.encoding === 'base64'
              ? Buffer.from(content.content, 'base64').toString('utf8')
              : content.content
          return { path: file.path, text }
        }),
      )
      return read.filter((f): f is WorkflowFile => f !== null)
    })()
    workflowCache.set(key, load)
    return load
  },

  files: (branch) => {
    const key = `${repo}@${branch}`
    const cached = treeCache.get(key)
    if (cached) return cached
    const load = (async () => {
      const ref = branch.split('/').map(encodeURIComponent).join('/')
      const tree = await get<{ tree: { path: string; type: string }[]; truncated: boolean }>(
        `/repos/${repo}/git/trees/${ref}?recursive=1`,
      )
      if (!tree) return null
      // A truncated tree is still a true sample: feature files found in it are real, and missing
      // ones only mean less is detected, never that a suite is reported that does not exist.
      return tree.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.path)
    })()
    treeCache.set(key, load)
    return load
  },

  latestRun: async (workflow, branch, before) => {
    const file = workflow.split('/').at(-1) ?? workflow
    const runs = await get<{
      workflow_runs: (WorkflowRun & { html_url: string; updated_at: string })[]
    }>(
      `/repos/${repo}/actions/workflows/${encodeURIComponent(file)}/runs?branch=${encodeURIComponent(branch)}&status=completed&per_page=1&created=%3C${before.toISOString().slice(0, 10)}`,
    )
    const run = runs?.workflow_runs?.[0]
    if (!run) return null
    const jobs = await paginate<{ name: string; conclusion: string | null }>(
      `/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`,
      2,
    )
    return {
      id: run.id,
      url: run.html_url,
      conclusion: run.conclusion,
      at: run.updated_at ?? run.run_started_at,
      jobs,
    }
  },

  commits: (branch, from, to) =>
    paginate<CommitLike>(
      `/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&since=${from.toISOString()}&until=${to.toISOString()}&per_page=100`,
    ),
})

/**
 * The job a tool was found in, as the jobs API names it. A matrix adds " (…)" and a reusable
 * workflow is reported as "<caller job> / <job>", so an exact match alone misses both.
 */
export function matchJob(
  jobs: RunWithJobs['jobs'],
  name: string,
): RunWithJobs['jobs'][number] | null {
  return (
    jobs.find(
      (j) =>
        j.name === name ||
        j.name.startsWith(`${name} (`) ||
        j.name.endsWith(` / ${name}`) ||
        j.name.includes(` / ${name} (`),
    ) ?? null
  )
}

const stateOf = (conclusion: string | null): PracticeResultState =>
  conclusion === 'success' ? 'passing' : conclusion === 'failure' ? 'failing' : 'unknown'

/**
 * Turns a detection into evidence by reading the newest DECISIVE run of the job it was found in,
 * across the workflow itself and every workflow that calls it. A reusable CI workflow often has
 * runs of its own (a weekly schedule) in which the job is skipped, while on the default branch it
 * actually runs inside the caller (CD calling CI). Taking the first workflow that has any run
 * read Numa's scheduled `skipped` as "unknown" while its CD-hosted runs passed.
 */
export async function detectedEvidence(
  detection: PracticeDetection,
  files: WorkflowFile[],
  branch: string,
  before: Date,
  source: ScorecardSource,
): Promise<PracticeEvidence> {
  // Only locations as strong as the summary count: a report-only or weak copy of a tool must not
  // speak for the blocking one.
  const strongest = (detection.locations ?? []).filter(
    (l) => l.weak === detection.weak && l.mode === detection.mode,
  )
  const locations = strongest.length > 0 ? strongest : [detection]
  type Seen = { workflow: string; run: RunWithJobs; conclusion: string | null }
  const seen: Seen[] = []
  const read = new Set<string>()
  for (const location of locations) {
    for (const workflow of [location.workflow, ...callersOf(location.workflow, files)]) {
      const key = `${workflow}::${location.jobName ?? location.job}`
      if (read.has(key)) continue
      read.add(key)
      let run: RunWithJobs | null = null
      try {
        run = await source.latestRun(workflow, branch, before)
      } catch {
        run = null
      }
      if (!run) continue
      const job = matchJob(run.jobs, location.jobName ?? location.job)
      seen.push({ workflow, run, conclusion: job ? job.conclusion : run.conclusion })
    }
  }
  const newest = (list: Seen[]) =>
    [...list].sort((a, b) => Date.parse(b.run.at) - Date.parse(a.run.at))[0]
  const decisive = seen.filter((s) => s.conclusion === 'success' || s.conclusion === 'failure')
  const pick = newest(decisive.length > 0 ? decisive : seen)
  if (pick) {
    return {
      source: 'detected',
      tools: detection.tools,
      mode: detection.mode,
      result: stateOf(pick.conclusion),
      resultAt: pick.run.at,
      lastRun: {
        workflow: pick.workflow,
        url: pick.run.url,
        conclusion: pick.conclusion,
        at: pick.run.at,
      },
      weak: detection.weak,
    }
  }
  return {
    source: 'detected',
    tools: detection.tools,
    mode: detection.mode,
    result: 'unknown',
    resultAt: null,
    lastRun: null,
    weak: detection.weak,
  }
}

/** A tree that cannot be read leaves detection to the workflows, as it was before. */
async function repositoryFiles(source: ScorecardSource, branch: string): Promise<string[]> {
  if (!source.files) return []
  try {
    return (await source.files(branch)) ?? []
  } catch {
    return []
  }
}

/**
 * Collects one month's scorecard: workflow detection and run results, AI usage from commits, and
 * the facets already collected for the month.
 *
 * Workflows are read at the default branch as it is now, so a backfilled month reports today's
 * gates with that month's run results and commits.
 */
export async function collectScorecard(
  project: ProjectConfig,
  config: ScorecardConfig,
  period: { from: Date; to: Date },
  excellence: EngineeringExcellence | undefined,
  previousScores: (number | null)[],
  source: ScorecardSource = githubScorecardSource(project.repo),
  now: Date = new Date(),
): Promise<MetricBlock<Scorecard>> {
  const branch = await source.defaultBranch()
  if (!branch) return skip('The repository could not be read, so no scorecard was produced.')

  const files = await source.workflows(branch)
  const enabled = config.practices.filter((p) => p.enabled !== false)
  const hits = files.flatMap((file) => detectTools(file.path, file.text, enabled))
  const suites = enabled.some((p) => p.id === SPEC_PRACTICE)
    ? featureSuites(await repositoryFiles(source, branch))
    : []
  hits.push(...files.flatMap((file) => detectGherkinRuns(file.path, file.text, suites)))
  const detections = summarizeDetections(hits)

  const reference = new Date(Math.min(now.getTime(), period.to.getTime()))
  const detected = new Map<string, PracticeEvidence>()
  for (const [practice, detection] of detections) {
    detected.set(practice, await detectedEvidence(detection, files, branch, period.to, source))
  }
  if (suites.length > 0 && !detected.has(SPEC_PRACTICE)) {
    detected.set(SPEC_PRACTICE, {
      source: 'detected',
      tools: [GHERKIN_TOOL],
      mode: null,
      result: 'unknown',
      resultAt: null,
      lastRun: null,
      shortfall: GHERKIN_NOT_RUN,
    })
  }

  let aiUsage: MetricBlock<AiUsage>
  try {
    aiUsage = summarizeAiUsage(await source.commits(branch, period.from, period.to), config.aiUsage)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    aiUsage = skip(`Commits could not be read: ${message}`)
  }

  return {
    available: true,
    data: buildScorecard({
      project,
      config,
      reference,
      defaultBranch: branch,
      workflowsScanned: files.length,
      excellence,
      detected,
      aiUsage,
      previousScores,
    }),
  }
}
