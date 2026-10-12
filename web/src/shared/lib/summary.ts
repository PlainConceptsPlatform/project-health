import type { MetricBlock, MonthlyReport } from './types'

/**
 * A flat, serializable view of one project for the dashboard.
 *
 * The grid sorts and filters in the browser, so everything it needs has to survive the server to
 * client boundary as plain data. Keeping the flattening here means the client never has to reach
 * into the nested report shape, and every "why is this missing" reason is carried alongside the
 * value rather than being recomputed from a null.
 */
export interface ProjectSummary {
  id: string
  name: string
  repo: string
  status: 'production' | 'pre-production' | 'planned'
  months: string[]
  month: string | null
  hasData: boolean

  releases: number | null
  perWeek: number | null
  partialMonth: boolean

  leadTimeP50Hours: number | null
  issueToStagingP50Hours: number | null

  reworkRate: number | null
  reworkLabel: string | null
  reworkMarked: boolean

  agentRuns: number | null
  agentTokens: number | null
  agentSeconds: number | null
  agentMeasured: number | null

  reasons: {
    frequency?: string
    leadTime?: string
    rework?: string
    agents?: string
  }
}

const reasonOf = <T>(block: MetricBlock<T> | undefined): string | undefined =>
  block && !block.available ? block.reason : undefined

export function summarise(
  entry: { id: string; name: string; repo: string; status: string; months: string[] },
  report: MonthlyReport | null,
): ProjectSummary {
  const status = (entry.status as ProjectSummary['status']) ?? 'production'

  const base: ProjectSummary = {
    id: entry.id,
    name: entry.name,
    repo: entry.repo,
    status,
    months: entry.months,
    month: null,
    hasData: false,
    releases: null,
    perWeek: null,
    partialMonth: false,
    leadTimeP50Hours: null,
    issueToStagingP50Hours: null,
    reworkRate: null,
    reworkLabel: null,
    reworkMarked: false,
    agentRuns: null,
    agentTokens: null,
    agentSeconds: null,
    agentMeasured: null,
    reasons: {},
  }

  if (!report) return base

  const frequency = report.delivery.deploymentFrequency
  const leadTime = report.delivery.leadTime
  const rework = report.delivery.reworkRate

  const agents = report.agents.available
    ? Object.values(report.agents.data.byKind).reduce(
        (acc, kind) => ({
          runs: acc.runs + kind.runs,
          measured: acc.measured + (kind.runsWithUsage ?? 0),
          tokens: acc.tokens + kind.tokens.inputTokens + kind.tokens.outputTokens,
          seconds: acc.seconds + kind.totalExecutionSeconds,
        }),
        { runs: 0, measured: 0, tokens: 0, seconds: 0 },
      )
    : null

  return {
    ...base,
    month: `${report.period.year}-${String(report.period.month).padStart(2, '0')}`,
    hasData: true,
    releases: frequency.available ? frequency.data.count : null,
    perWeek: frequency.available ? frequency.data.perWeek : null,
    partialMonth: frequency.available ? Boolean(frequency.data.partialMonth) : false,
    leadTimeP50Hours:
      leadTime.available && leadTime.data.commitToProduction.available
        ? leadTime.data.commitToProduction.data.p50Hours
        : null,
    issueToStagingP50Hours:
      leadTime.available && leadTime.data.issueToStaging.available
        ? leadTime.data.issueToStaging.data.p50Hours
        : null,
    reworkRate: rework.available ? rework.data.rate : null,
    reworkLabel: rework.available ? (rework.data.label ?? null) : null,
    reworkMarked: rework.available && rework.data.confidence !== 'none',
    agentRuns: agents?.runs ?? null,
    agentTokens: agents?.tokens ?? null,
    agentSeconds: agents?.seconds ?? null,
    agentMeasured: agents?.measured ?? null,
    reasons: {
      frequency: reasonOf(frequency),
      leadTime: reasonOf(leadTime),
      rework: reasonOf(rework),
      agents: reasonOf(report.agents),
    },
  }
}

export type SortKey =
  | 'name'
  | 'frequency'
  | 'leadTime'
  | 'rework'
  | 'tokens'
  | 'agentTime'
  | 'status'

export const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name',
  frequency: 'Deploy frequency',
  leadTime: 'Lead time (fastest first)',
  rework: 'Rework rate',
  tokens: 'Agent tokens',
  agentTime: 'Agent time',
  status: 'Status',
}

const STATUS_ORDER: Record<ProjectSummary['status'], number> = {
  production: 0,
  'pre-production': 1,
  planned: 2,
}

/**
 * Sorts by the chosen key, with a project that cannot report the number always last.
 *
 * A missing value must not sort as zero. Doing that would put every project without production
 * data at the top of "fastest lead time", which reads as a ranking it has not earned.
 */
export function sortSummaries(items: ProjectSummary[], key: SortKey): ProjectSummary[] {
  const byName = (a: ProjectSummary, b: ProjectSummary) => a.name.localeCompare(b.name)

  const numeric = (
    pick: (p: ProjectSummary) => number | null,
    direction: 'asc' | 'desc',
  ): ProjectSummary[] =>
    [...items].sort((a, b) => {
      const av = pick(a)
      const bv = pick(b)
      if (av === null && bv === null) return byName(a, b)
      if (av === null) return 1
      if (bv === null) return -1
      return av === bv ? byName(a, b) : direction === 'asc' ? av - bv : bv - av
    })

  switch (key) {
    case 'name':
      return [...items].sort(byName)
    case 'frequency':
      return numeric((p) => p.perWeek, 'desc')
    case 'leadTime':
      return numeric((p) => p.leadTimeP50Hours, 'asc')
    case 'rework':
      return numeric((p) => (p.reworkMarked ? p.reworkRate : null), 'desc')
    case 'tokens':
      return numeric((p) => p.agentTokens, 'desc')
    case 'agentTime':
      return numeric((p) => p.agentSeconds, 'desc')
    case 'status':
      return [...items].sort(
        (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byName(a, b),
      )
  }
}

export interface Filters {
  status: ProjectSummary['status'] | 'all'
  search: string
  agentsOnly: boolean
  withDataOnly: boolean
}

export function filterSummaries(items: ProjectSummary[], filters: Filters): ProjectSummary[] {
  const needle = filters.search.trim().toLowerCase()
  return items.filter((p) => {
    if (filters.status !== 'all' && p.status !== filters.status) return false
    if (filters.agentsOnly && !p.agentRuns) return false
    if (filters.withDataOnly && !p.hasData) return false
    if (needle && !`${p.name} ${p.repo}`.toLowerCase().includes(needle)) return false
    return true
  })
}
