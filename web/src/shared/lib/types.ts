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
  warnings: Warning[]
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

export const FACETS = ['coverage', 'complexity', 'mutation', 'security', 'sbom'] as const
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

export interface FacetDataMap {
  coverage: CoverageData
  complexity: ComplexityData
  mutation: MutationData
  security: SecurityData
  sbom: SbomData
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
