/**
 * Mirror of the shape the collector writes to data/. Kept in the web package so the site builds
 * without depending on the collector at runtime. schemaVersion guards against the two drifting.
 */

export type MetricBlock<T> = { available: true; data: T } | { available: false; reason: string }

export interface Warning {
  code: string
  severity?: 'info' | 'warn'
  message: string
  context?: Record<string, string | number | null>
}

export interface Release {
  ref: string
  sha: string
  deployedAt: string
  deployedBy: string | null
  deploymentIds: number[]
  outOfProcess: boolean
  unplanned: boolean
  unplannedSource: string | null
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
  runsWithUsage?: number
  successful: number
  tokens: TokenUsage
  executionSeconds: MetricBlock<SecondsDistribution>
  totalExecutionSeconds: number
}

export interface AgentSummary {
  runs: AgentRun[]
  byKind: Record<string, AgentKindSummary>
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

export interface DeployedEnvironment {
  name: string
  resourceGroup: string | null
  tier: EnvironmentTier | null
  source: 'resource-group' | 'environment-name'
  lastDeployedAt: string
}

/** The furthest environment the application has reached, read from where it deploys. */
export interface FinalEnvironment {
  final: EnvironmentTier | null
  environments: DeployedEnvironment[]
}

export interface MonthlyReport {
  schemaVersion: 1
  /** True for the example data shipped with the template, so the site can say the numbers are made up. */
  synthetic?: boolean
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
  /** Absent in files written before it existed. */
  agentic?: MetricBlock<AgenticAdoption>
  warnings: Warning[]
}

/** Mirrors the collector's adoption types; see collector/src/types.ts for what each field means. */
export type AgenticSetup = 'standard' | 'custom' | 'none'

export interface AgenticAdoption {
  defaultBranch: string
  setup: AgenticSetup
  harness: {
    version: string | null
    latest: string | null
    legacy: boolean
    legacyVersion: string | null
  }
  workflows: {
    version: string | null
    latest: string | null
    router: boolean
    workers: { name: string; present: boolean }[]
    evidence: boolean
    retired: string[]
    custom: string[]
  }
  verifyEnvironment: boolean | null
  bot: { prefix: string; merged: number; lastMergedAt: string | null }
}

export interface DataIndex {
  generatedAt: string
  projects: {
    id: string
    name: string
    repo: string
    status: string
    months: string[]
    latest: string | null
  }[]
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
  [F in Exclude<Facet, 'hygiene'>]: MetricBlock<FacetSeries<FacetDataMap[F]>>
} & {
  /** Absent from months collected before the hygiene facet existed. */
  hygiene?: MetricBlock<FacetSeries<HygieneData>>
}

/** Mirrors the collector's scorecard types; see collector/src/types.ts for the rules behind them. */
export type ProjectType =
  | 'back-front'
  | 'mobile'
  | 'data'
  | 'ml'
  | 'library'
  | 'browser-extension'
  | 'static-site'
  | 'other'
export type PracticePhase = 'build' | 'test-env'
export type StandardMode = 'blocking' | 'threshold' | 'policy'
export type DetectedMode = 'blocking' | 'report-only'
export type Rag = 'green' | 'yellow' | 'red' | 'grey'
export type PracticeSource = 'facet' | 'detected' | 'none'

export interface PracticeResult {
  id: string
  number: number
  name: string
  phase: PracticePhase
  standardMode: StandardMode
  description: string
  applicable: boolean
  rag: Rag
  reason: string
  source: PracticeSource
  tools: string[]
  mode: DetectedMode | null
  result: 'passing' | 'failing' | 'unknown' | null
  resultAt: string | null
  lastRun: { workflow: string; url: string; conclusion: string | null; at: string } | null
}

export interface AiUsage {
  level: number
  share: number
  aiCommits: number
  totalCommits: number
  byAssistant: Record<string, number>
}

export interface ScorecardAlert {
  code: 'HIGH_AI_LOW_ENGINEERING' | 'ENGINEERING_DECLINING'
  severity: 'red' | 'amber'
  message: string
}

export interface Scorecard {
  projectType: ProjectType
  defaultBranch: string | null
  facetsPublished: boolean
  workflowsScanned: number
  practices: PracticeResult[]
  level: number
  score: number | null
  gates: { present: number; applicable: number }
  aiUsage: MetricBlock<AiUsage>
  alerts: ScorecardAlert[]
}

/** agent, person, merge or queued from the labels; manual when it never went through an agent. */
export type JourneyState = 'agent' | 'person' | 'queued' | 'merge' | 'manual'

export interface JourneySegment {
  state: JourneyState
  /** Minutes from the issue's creation. */
  from: number
  to: number
}

export interface JourneyMark {
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
  detail: string | null
}

export interface LinkedPullRequest {
  number: number
  title: string
  author: string | null
  byAgent: boolean
  closes: boolean
  createdAt: string
  mergedAt: string | null
  mergedBy: string | null
  additions: number
  deletions: number
  changedFiles: number
  mergeGate: string | null
}

export interface EvidenceWaypoint {
  /** Absent in files collected before plans were recorded. */
  plan?: string | null
  n: number
  capture: string
  expect: string | null
  reached: boolean
  image: string | null
}

export interface JourneyEvidence {
  pullRequest: number
  url: string
  waypoints: EvidenceWaypoint[]
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
  updatedAt: string
  outcome: JourneyOutcome
  estimate: number | null
  segments: JourneySegment[]
  marks: JourneyMark[]
  events: JourneyEvent[]
  pullRequests: LinkedPullRequest[]
  evidence: JourneyEvidence | null
  agent: { runs: number; inputTokens: number; outputTokens: number; seconds: number }
}

export interface Roadmap {
  asOf: string
  issues: IssueJourney[]
}
