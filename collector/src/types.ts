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
  /** Decides which scorecard practices apply. Absent means other, where every practice applies. */
  type?: ProjectType
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
  warnings: Warning[]
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
  /** 0 to 3, N0 to N3. */
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
