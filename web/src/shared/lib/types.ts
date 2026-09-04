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
