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
  notes?: string
}

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
  warnings: Warning[]
}
