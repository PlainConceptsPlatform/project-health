/**
 * A metric is never assumed to exist. Every project carries a block per metric that is either
 * present with data, or absent with a human readable reason. Nothing downstream may throw
 * because a project lacks a capability.
 */
export type MetricBlock<T> = { available: true; data: T } | { available: false; reason: string }

export const ok = <T>(data: T): MetricBlock<T> => ({ available: true, data })
export const skip = <T>(reason: string): MetricBlock<T> => ({ available: false, reason })

export type WarningCode =
  | 'NO_PRODUCTION_ENVIRONMENT'
  | 'NO_PRODUCTION_DEPLOYMENTS'
  | 'NON_TAG_PRODUCTION_REF'
  | 'DUPLICATE_DEPLOYMENT_OBJECTS'
  | 'SKIPPED_TAG'
  | 'ROLLBACK_DETECTED'
  | 'USAGE_ARTIFACT_MISSING'
  | 'AGENTS_DISABLED'
  | 'COLLECTION_ERROR'
  | 'SMALL_SAMPLE'
  | 'ENGINEERING_EXCELLENCE_ARTIFACT_MISSING'
  | 'ENGINEERING_EXCELLENCE_SCHEMA_MISMATCH'
  | 'ROADMAP_PERMISSION_MISSING'
  | 'LABEL_SET_BY_WORKFLOW'

export type WarningSeverity = 'info' | 'warn'

export interface Warning {
  code: WarningCode
  /** Set once per report rather than at every push site. See applySeverity in index.ts. */
  severity?: WarningSeverity
  message: string
  context?: Record<string, string | number | null>
}

export interface ProjectConfig {
  id: string
  name: string
  repo: string
  enabled: boolean
  status: 'production' | 'pre-production' | 'planned'
  environments: { production: string | null; staging: string | null }
  productionRefPattern: string
  agents: {
    enabled: boolean
    workflow: string | null
    /** Run titles that cannot be an agent run, excluded before jobs are fetched, to save calls. */
    ignoreTitlePatterns?: string[]
  }
  /**
   * Label marking an issue as work intended to ship, used for the issue to staging measure.
   * null means the project has no such convention, which is reported rather than guessed.
   */
  workItemLabel?: string | null
  /** Label marking a release as unplanned. Broader labels overstate rework; see the README. */
  reworkLabel?: string
  /**
   * Whether that label means only unplanned production fixes ("incident") or any bug fix
   * ("broad"). Only an incident marker is used to place the project on the stability axis.
   */
  reworkLabelPrecision?: 'incident' | 'broad'
  /**
   * Opt in to reading the engineering excellence facet artifacts the repository's own CI uploads.
   * See schema/engineering-excellence-facets.schema.json for the contract.
   */
  engineeringExcellence?: {
    enabled: boolean
    /** Only artifacts from runs on this branch are read. Defaults to main. */
    branch?: string
    /** Artifact name prefix; the facet name is appended. Defaults to engineering-excellence-. */
    artifactPrefix?: string
  }
  /**
   * Opt in to reading every issue's timeline, so the site can show who had each issue at each
   * moment. Only meaningful where agents and people hand issues over with labels.
   */
  roadmap?: {
    enabled: boolean
    /** Label names, when a repository does not use the defaults in metrics/roadmap.ts. */
    labels?: Partial<RoadmapLabels>
    /** Branch the evidence workflow commits screenshots to. Defaults to evidence. */
    evidenceBranch?: string
  }
  /** Decides which scorecard practices apply. Absent means other, where every practice applies. */
  type?: ProjectType
  /**
   * The dashboard section the project is ranked in. Absent means tooling for a library or
   * static-site and applications otherwise; the site resolves it, the collector measures both alike.
   */
  group?: ProjectGroup
  scorecard?: {
    /**
     * Performance testing is only expected when a project says it needs it, or its type expects
     * it by default. false opts out of a type default.
     */
    performance?: boolean
    /** Practice ids that do not apply to this project, on top of its type's defaults. */
    notApplicable?: string[]
  }
  notes?: string
}

export const PROJECT_TYPES = [
  'back-front',
  'mobile',
  'data',
  'ml',
  'library',
  'browser-extension',
  'static-site',
  'other',
] as const
export type ProjectType = (typeof PROJECT_TYPES)[number]

export const PROJECT_GROUPS = ['applications', 'tooling'] as const
export type ProjectGroup = (typeof PROJECT_GROUPS)[number]

export interface Release {
  ref: string
  sha: string
  deployedAt: string
  deployedBy: string | null
  deploymentIds: number[]
  outOfProcess: boolean
  unplanned: boolean
  unplannedSource: 'label' | 'out-of-process' | null
}

export interface DeploymentFrequency {
  /** True when the period has not finished, so perWeek is over elapsed days only. */
  partialMonth?: boolean
  elapsedDays?: number
  releases: Release[]
  count: number
  rawObjectCount: number
  perWeek: number
  medianIntervalHours: number | null
}

export interface Distribution {
  count: number
  p50Hours: number
  p75Hours: number
  p90Hours: number
}

export interface SecondsDistribution {
  count: number
  p50: number
  p75: number
  p90: number
}

export interface LeadTime {
  commitToProduction: MetricBlock<Distribution>
  issueToStaging: MetricBlock<Distribution>
}

export interface ReworkRate {
  /** Which label was used, so a broad one is visible rather than implied. */
  label?: string
  unplanned: number
  total: number
  rate: number
  confidence: 'marked' | 'inferred' | 'none'
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  ambientContext: number
  aiCredits: number
  primaryModel: string | null
}

export interface AgentRun {
  runId: number
  workflow: string
  kind: string
  conclusion: string | null
  startedAt: string
  actor: string | null
  issueNumber: number | null
  executionSeconds: number | null
  usage: TokenUsage | null
}

export interface AgentKindSummary {
  runs: number
  /** Runs that actually reported token usage. Totals are a floor when this is below runs. */
  runsWithUsage: number
  successful: number
  tokens: TokenUsage
  executionSeconds: MetricBlock<SecondsDistribution>
  totalExecutionSeconds: number
}

export interface AgentSummary {
  runs: AgentRun[]
  byKind: Record<string, AgentKindSummary>
  /**
   * Finished runs of the router and the single-kind workflows whose jobs showed no agent. Kept so
   * the next collection of the month does not read their jobs again. Absent in older months.
   */
  notAgentRunIds?: number[]
}

export interface Placement {
  /** False when no archetype matches the measured axes and the closest were shown instead. */
  exact?: boolean
  throughput: 'high' | 'medium' | 'low' | 'unknown'
  stability: 'high' | 'medium' | 'low' | 'unknown'
  wellbeing: 'unknown'
  candidateProfiles: { id: string; name: string }[]
  note: string
}

export interface Contributor {
  login: string
  count: number
  bot: boolean
}

export interface Contributors {
  requesters: Contributor[]
  deployers: Contributor[]
}

export type EnvironmentTier = 'PRO' | 'PRE'

/** One deployment environment with at least one successful deployment. */
export interface DeployedEnvironment {
  name: string
  /** The Azure resource group it deploys to, when the repository names one. */
  resourceGroup: string | null
  tier: EnvironmentTier | null
  /** resource-group when the RG name decided the tier, environment-name when there was no RG. */
  source: 'resource-group' | 'environment-name'
  lastDeployedAt: string
}

/** The furthest environment the application has reached, and the evidence for it. */
export interface FinalEnvironment {
  final: EnvironmentTier | null
  environments: DeployedEnvironment[]
}

export interface CodeHotspot {
  path: string
  codeLines: number
  commentLines: number
  slop: number
}

/** Comments and tests on the default branch, scanned from its source. */
export interface Codebase {
  branch: string
  sha: string | null
  files: { source: number; test: number; generated: number }
  comments: {
    codeLines: number
    commentLines: number
    /** commentLines / codeLines of production code. */
    density: number | null
    slop: { findings: number; byRule: Record<string, number> }
    heuristics: { history: number; essay: number; internalDoc: number }
  }
  tests: {
    files: number
    lines: number
    commentLines: number
    cases: number
    /** Test lines per production code line. */
    ratio: number | null
    casesPerKloc: number | null
    features: number
    scenarios: number
    suspicious: {
      skipped: number
      focused: number
      snapshot: number
      noAssertion: number
      mockOnly: number
    }
  }
  /** Production files with the most comment lines. */
  hotspots: CodeHotspot[]
}

/** What the merged bot pull requests of the period added, from their diffs. */
export interface BotAdditions {
  pullRequests: number
  codeLines: number
  commentLines: number
  testLines: number
  testCases: number
  slop: number
}

/**
 * How the period's merged bot pull requests got merged. gate: the merge gate's App merged it.
 * parked: the gate's last verdict left it for a person, who merged it. person: a person merged it
 * without the gate parking it, usually before the gate gave a verdict at all.
 */
export interface BotOutcomes {
  gate: number
  person: number
  parked: number
}

/**
 * standard: the workflows package's router is installed. custom: agent automation exists, but not
 * through the package (hand-built workflows, or only the harness). none: no agent tooling found.
 */
export type AgenticSetup = 'standard' | 'custom' | 'none'

export interface AgenticWorker {
  name: string
  present: boolean
}

/** How far a repository has adopted the platform's agent harness and agentic workflows. */
export interface AgenticAdoption {
  defaultBranch: string
  setup: AgenticSetup
  harness: {
    /** harnessVersion from .opencode/harness.json; null when the harness is not installed. */
    version: string | null
    /** Newest version on npm when collected; null when the registry could not be read. */
    latest: string | null
    /** opencode-onboard, the harness before agent-harness, is installed instead. */
    legacy: boolean
    legacyVersion: string | null
  }
  workflows: {
    /** From the "Managed by" header of the installed files, not the package.json pin. */
    version: string | null
    latest: string | null
    router: boolean
    workers: AgenticWorker[]
    evidence: boolean
    /** Workers the package has retired that are still installed. */
    retired: string[]
    /** Agent workflows outside the package, listed only when the standard router is absent. */
    custom: string[]
  }
  /** Whether pc-repo-verify records how to start the app; null when the skill is absent. */
  verifyEnvironment: boolean | null
  bot: {
    /** Title prefix that marks the implement worker's pull requests. */
    prefix: string
    /** Merged in the period. */
    merged: number
    /** Newest merge up to the end of the period. */
    lastMergedAt: string | null
    /** Absent in files written before it existed. */
    added?: BotAdditions
    /** How the period's merged bot pull requests ended. Absent in files written before it existed. */
    outcomes?: BotOutcomes
  }
}

export interface MonthlyReport {
  schemaVersion: 1
  project: string
  name: string
  repo: string
  status: string
  period: { year: number; month: number; from: string; to: string }
  generatedAt: string
  delivery: {
    productionEnvironment: string | null
    stagingEnvironment: string | null
    deploymentFrequency: MetricBlock<DeploymentFrequency>
    leadTime: MetricBlock<LeadTime>
    reworkRate: MetricBlock<ReworkRate>
  }
  agents: MetricBlock<AgentSummary>
  contributors: MetricBlock<Contributors>
  placement: MetricBlock<Placement>
  /** Absent when the project has not opted in, and in files written before it existed. */
  engineeringExcellence?: EngineeringExcellence
  /** Absent in files written before the scorecard existed. */
  scorecard?: MetricBlock<Scorecard>
  /** Absent in files written before it existed. */
  environment?: MetricBlock<FinalEnvironment>
  /** Absent when the project has not opted in, and in files written before it existed. */
  roadmap?: MetricBlock<Roadmap>
  /** Absent in files written before adoption was collected. */
  agentic?: MetricBlock<AgenticAdoption>
  /** Scanned for the current month only; absent in older files. */
  codebase?: MetricBlock<Codebase>
  /** GitHub Actions minutes and storage; absent in files written before it existed. */
  actions?: ActionsUsage
  warnings: Warning[]
}

/** Billable runner time and the storage Actions keeps, per repository. See metrics/actions.ts. */
export interface ActionsUsage {
  minutes: MetricBlock<ActionsMinutes>
  storage: MetricBlock<ActionsStorage>
}

export interface ActionsMinutes {
  /**
   * Where the minutes come from. `billing` is the organization's billing usage report, which is
   * exact and has no run counts (`runs`, `timed` and `pending` are 0). `timing` sums each run's
   * timing and is a floor. Absent in months collected before the report was used, which were timed.
   */
  source?: 'billing' | 'timing'
  /** Billable minutes of the month's runs, each job rounded up to the minute as GitHub bills it. */
  total: number
  /** Billable minutes by runner OS, as the timing endpoint names it: UBUNTU, MACOS, WINDOWS. */
  byOs: Record<string, number>
  /** Completed runs created in the month that were read. */
  runs: number
  /** Of those, the runs whose timing could be read. The rest add nothing, so the total is a floor. */
  timed: number
  /** Runs not counted yet: still in progress, or over this collection's timing budget. */
  pending: number
  /** A day listed 1,000 runs, the most the API returns for a date filter, so some were not seen. */
  truncated: boolean
  measuredAt: string
  /**
   * Incremental state. Every run created before `countedBefore` has been counted; `countedIds` are
   * the runs at or after it already counted. A later collection times only the runs that are new.
   */
  countedBefore: string | null
  countedIds: number[]
}

export interface ActionsStorage {
  /** Storage is read as it is now, not as it was during the month. */
  measuredAt: string
  /** Active caches. null when the cache usage endpoint could not be read. */
  cache: { bytes: number; count: number } | null
  /** Artifacts that have not expired. null when the artifact list could not be read. */
  artifacts: { bytes: number; count: number; truncated: boolean } | null
  /** Cache plus artifact bytes, over whichever of the two could be read. */
  totalBytes: number
}

export interface RoadmapLabels {
  /** Present while an agent is working on the issue. */
  working: string
  /** Present while the issue waits for a person: a question, a review, a stalled run. */
  waiting: string[]
  /** The subset of waiting that means an agent run gave up. Each application is one stall. */
  stalled: string
  /** Present while the issue's pull request waits for the merge gate. */
  merge: string
  /** Labels that ask an agent to act. An issue that never carried one was worked by hand. */
  triggers: string[]
}

/**
 * Who had an issue at a moment. agent: an agent was working. person: it waited for a person.
 * merge: its pull request waited to merge. queued: nobody had it. manual: it never went through
 * an agent, so a person had it the whole time.
 */
export type JourneyState = 'agent' | 'person' | 'queued' | 'merge' | 'manual'

export interface JourneySegment {
  state: JourneyState
  /** Minutes from the issue's creation. */
  from: number
  to: number
}

export interface JourneyMark {
  /** Minutes from the issue's creation. */
  at: number
  kind: 'stalled' | 'failed-run'
}

export type JourneyEventKind =
  | 'opened'
  | 'requested'
  | 'agent-started'
  | 'agent-stopped'
  | 'estimated'
  | 'review'
  | 'stalled'
  | 'failed-run'
  | 'pr-linked'
  | 'merged'
  | 'closed'
  | 'reopened'

export interface JourneyEvent {
  at: string
  kind: JourneyEventKind
  actor: string | null
  /** The label, pull request number or estimate the event is about. */
  detail: string | null
}

export interface LinkedPullRequest {
  number: number
  title: string
  author: string | null
  byAgent: boolean
  /** True when its body closes this issue, rather than only mentioning it. */
  closes: boolean
  createdAt: string
  mergedAt: string | null
  mergedBy: string | null
  additions: number
  deletions: number
  changedFiles: number
  /** The merge gate's verdict, when the repository runs one. */
  mergeGate: string | null
}

export interface EvidenceWaypoint {
  /** The change whose verification plan the waypoint belongs to. A pull request can carry several. */
  plan: string | null
  /** Position within its plan, so the same n repeats when a pull request carries several plans. */
  n: number
  capture: string
  expect: string | null
  reached: boolean
  /** Absolute URL of the screenshot, null when the waypoint produced none. */
  image: string | null
  /** The screenshot copied into the data folder, as a path from the site root. */
  copy?: string | null
}

/** Screenshots the evidence workflow replayed from a merged pull request's verification plan. */
export interface JourneyEvidence {
  pullRequest: number
  url: string
  waypoints: EvidenceWaypoint[]
  /** Set when nothing could be captured, for example because the app never answered. */
  note: string | null
}

export type IssueSource = 'person' | 'app-error' | 'audit' | 'nightly' | 'automation'

export type JourneyOutcome = 'open' | 'merged' | 'auto-merged' | 'merged-by-hand' | 'closed'

export interface IssueJourney {
  number: number
  title: string
  author: string | null
  source: IssueSource
  createdAt: string
  closedAt: string | null
  /** Lets a later collection reuse a closed issue that has not changed. */
  updatedAt: string
  outcome: JourneyOutcome
  /** Story points from an sp-N label, null when the issue carries none. */
  estimate: number | null
  segments: JourneySegment[]
  marks: JourneyMark[]
  events: JourneyEvent[]
  pullRequests: LinkedPullRequest[]
  evidence: JourneyEvidence | null
  /** Agent runs whose title names this issue, joined from the agents block. */
  agent: { runs: number; inputTokens: number; outputTokens: number; seconds: number }
}

export interface Roadmap {
  /** The moment open issues are measured up to: the end of the period, or the collection. */
  asOf: string
  issues: IssueJourney[]
}

export type PracticePhase = 'build' | 'test-env'
/** How the practice is expected to run: fail the build, hold a score, or follow a policy. */
export type StandardMode = 'blocking' | 'threshold' | 'policy'
export type DetectedMode = 'blocking' | 'report-only'
export type Rag = 'green' | 'yellow' | 'red' | 'grey'
/** What decided a cell: a published facet, workflow detection, or nothing found. */
export type PracticeSource = 'facet' | 'detected' | 'none'
export type PracticeResultState = 'passing' | 'failing' | 'unknown'

export interface LastRun {
  workflow: string
  url: string
  conclusion: string | null
  at: string
}

export interface PracticeResult {
  id: string
  number: number
  name: string
  phase: PracticePhase
  standardMode: StandardMode
  description: string
  applicable: boolean
  rag: Rag
  /** Why the cell has its colour, in a sentence, so nobody has to reverse engineer the rules. */
  reason: string
  source: PracticeSource
  tools: string[]
  mode: DetectedMode | null
  result: PracticeResultState | null
  /** When the result was produced, which is what staleness is measured against. */
  resultAt: string | null
  lastRun: LastRun | null
}

export interface AiUsage {
  /** 1 to 5, from the share of AI-assisted commits. */
  level: number
  share: number
  aiCommits: number
  totalCommits: number
  byAssistant: Record<string, number>
}

export type ScorecardAlertCode = 'HIGH_AI_LOW_ENGINEERING' | 'ENGINEERING_DECLINING'

export interface ScorecardAlert {
  code: ScorecardAlertCode
  severity: 'red' | 'amber'
  message: string
}

export interface Scorecard {
  projectType: ProjectType
  defaultBranch: string | null
  /** False when no engineering excellence facet was available, so every cell came from workflows. */
  facetsPublished: boolean
  workflowsScanned: number
  practices: PracticeResult[]
  /** 0 to 3, L0 to L3. */
  level: number
  /** 0 to 100, null when nothing applies. */
  score: number | null
  /** Gates of every phase that are present (green or yellow) out of those that apply. */
  gates: { present: number; applicable: number }
  aiUsage: MetricBlock<AiUsage>
  alerts: ScorecardAlert[]
}

export const FACETS = ['coverage', 'complexity', 'mutation', 'security', 'sbom', 'hygiene'] as const
export type Facet = (typeof FACETS)[number]

export interface LineStats {
  lineRate: number | null
  branchRate: number | null
  linesCovered: number
  linesValid: number
}

/**
 * Facet data mirrors schema/engineering-excellence-facets.schema.json. Fields marked optional are
 * the heavy per-module detail: they are kept on the latest sample of a month and dropped from the
 * others, because a month of per-commit samples with every module would make each stored file
 * several megabytes for a trend line that only reads the scope totals.
 */
export interface CoverageData {
  scopes: Record<string, LineStats & { floor: number | null; modules?: Record<string, LineStats> }>
  global: { lineRate: number | null; linesCovered: number; linesValid: number }
  passed: boolean
}

export interface ComplexitySummary {
  methods: number
  ccP50: number | null
  ccP90: number | null
  ccMax: number | null
  over10: number
  crapOver30: number
}

export interface Hotspot {
  scope: string
  module: string
  file: string
  method: string
  line: number | null
  cc: number
  coverage: number
  crap: number
}

export interface ComplexityData {
  thresholds: { cc: number; crap: number }
  scopes: Record<string, ComplexitySummary & { modules?: Record<string, ComplexitySummary> }>
  global: ComplexitySummary
  hotspots?: Hotspot[]
  /**
   * The repository's blocking complexity gate as evaluated on this commit, when it runs one.
   * baselined is the remaining backlog of known violations, so it should only go down.
   */
  gate?: ComplexityGate | null
}

export interface ComplexityGate {
  ccMax: number
  crapMax: number
  baselined: number
  violations: number
  justified: number
}

export interface MutationScores {
  coveredScore: number
  fullScore: number
  killed: number
  timeout: number
  survived: number
  noCoverage: number
  valid: number
}

export interface MutationData {
  scopes: Record<
    string,
    MutationScores & {
      floor: number | null
      passed: boolean
      modules?: Record<string, MutationScores>
    }
  >
  global: MutationScores
  passed: boolean
}

export type Severities = Record<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN', number>

export interface SecurityData {
  trivy: {
    vuln: Severities
    misconfig: Severities
    secret: Severities
    fixableVulns: number
  } | null
  semgrep: {
    ERROR: number
    WARNING: number
    INFO: number
    total: number
    scanErrors: number
  } | null
  jobs: Record<string, 'success' | 'failure' | 'cancelled' | 'skipped'>
  passed: boolean
}

export interface SbomData {
  format: string
  specVersion: string | null
  components: number
  byEcosystem: Record<string, number>
  licenses?: Record<string, number>
  unlicensed: number
  sha256: string
}

export interface HygieneSummary {
  files: number
  lines: number
  duplicatedLines: number
  /** duplicatedLines / lines. */
  duplicationRate: number | null
  codeLines: number
  commentLines: number
  /** commentLines / codeLines. A line-based approximation, so a trend and never a gate. */
  commentDensity: number | null
  /** Unjustified empty catch blocks. null when the producer had no scanner result, not zero. */
  swallowedExceptions: number | null
  justifiedSwallows: number
}

export interface HygieneHotspot {
  scope: string
  module: string
  file: string
  duplicatedLines: number
  lines: number
  duplicationRate: number | null
}

/**
 * The repository's blocking duplication gate as evaluated on this commit. baselineLines is the
 * duplicated code accepted into the baseline, so like the complexity backlog it should only go down.
 */
export interface HygieneGate {
  baselinedFiles: number
  baselineLines: number
  violations: number
  fixed: number
}

/**
 * Deterministic comment-slop findings (banners, untracked TODOs, doc comments that restate the
 * member name, commented-out code). The gate is per file against a baseline, like duplication.
 */
export interface CommentSlop {
  findings: number
  byRule: Record<string, number>
  byScope: Record<string, number>
  gate: {
    baselinedFiles: number
    baselineFindings: number
    violations: number
    fixed: number
  } | null
}

export interface HygieneData {
  thresholds: { minLines: number; minTokens: number }
  scopes: Record<
    string,
    HygieneSummary & { deadCodeWarnings: number; modules?: Record<string, HygieneSummary> }
  >
  global: HygieneSummary
  deadCode: { gated: boolean; warnings: number }
  hotspots?: HygieneHotspot[]
  gate: HygieneGate | null
  /** Absent when the repository runs no comment-slop rules. */
  commentSlop?: CommentSlop
}

export interface FacetDataMap {
  coverage: CoverageData
  complexity: ComplexityData
  mutation: MutationData
  security: SecurityData
  sbom: SbomData
  hygiene: HygieneData
}

export interface FacetSample<T> {
  commitSha: string | null
  runId: number | null
  runAttempt: number | null
  /** Lets a later collection skip an artifact it has already read. */
  artifactId: number
  generatedAt: string
  data: T
}

export interface FacetSeries<T> {
  /** One per commit, oldest first, carrying the scope totals only. */
  samples: FacetSample<T>[]
  /** The full data of the newest sample, per-module detail included. */
  latest: T
  latestGeneratedAt: string
}

export type EngineeringExcellence = {
  [F in Facet]: MetricBlock<FacetSeries<FacetDataMap[F]>>
}
