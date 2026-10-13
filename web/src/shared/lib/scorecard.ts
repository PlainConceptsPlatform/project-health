import type {
  DataIndex,
  FinalEnvironment,
  MetricBlock,
  MonthlyReport,
  Rag,
  Scorecard,
  StandardMode,
} from './types'

/** Words for every colour, so a status never depends on the dot alone. */
export const RAG_LABEL: Record<Rag, string> = {
  green: 'Meets standard',
  yellow: 'Below standard',
  red: 'Missing or failing',
  grey: 'Not applicable',
}

export const RAG_DOT: Record<Rag, string> = {
  green: 'bg-success',
  yellow: 'bg-warning',
  red: 'bg-destructive',
  grey: 'bg-muted-foreground/30',
}

export const MODE_LABEL: Record<StandardMode, string> = {
  blocking: 'Blocking',
  threshold: 'Threshold',
  policy: 'Policy',
}

/** What each mode means, for the legend and the icon tooltips. */
export const MODE_DESCRIPTION: Record<StandardMode, string> = {
  blocking: 'A failure stops the merge or the deploy.',
  threshold: 'Measured against a floor that has to hold.',
  policy: 'Produced and kept as evidence, with no pass or fail.',
}

export const LEVEL_CLASS = [
  'border-destructive/40 bg-destructive/10 text-destructive',
  'border-warning/60 bg-warning/15 text-warning-foreground dark:text-warning',
  'border-primary/30 bg-primary/10 text-primary',
  'border-primary/30 bg-primary/10 text-primary',
] as const

/** The score bar beside a level badge, in the badge's colour. */
export const LEVEL_BAR = ['bg-destructive', 'bg-warning', 'bg-primary/60', 'bg-primary'] as const

export const PHASES = [
  { key: 'build', label: 'Every build' },
  { key: 'test-env', label: 'After deploying to test env' },
] as const

const FALLBACK_TYPE_LABELS: Record<string, string> = {
  'back-front': 'Back + front',
  mobile: 'Mobile',
  data: 'Data',
  ml: 'ML',
  library: 'Library',
  'browser-extension': 'Browser extension',
  'static-site': 'Static site',
  other: 'Other',
}

export const typeLabel = (type: string, labels: Record<string, string>) =>
  labels[type] ?? FALLBACK_TYPE_LABELS[type] ?? type

/** How many months the overview sparkline spans. */
export const TREND_MONTHS = 6

export interface ScorecardRow {
  id: string
  name: string
  repo: string
  status: string
  /** The month the row's scorecard is from, the newest one that has a scorecard. */
  month: string | null
  card: Scorecard | null
  /** Why there is no card, when there is none. */
  reason: string | null
  trend: { month: string; score: number | null }[]
  /** Daily scores, oldest first, for deltas over a fixed number of days. */
  daily: DailyScore[]
  /** From the newest report that measured it; null when no report has. */
  environment: MetricBlock<FinalEnvironment> | null
}

export interface DailyScore {
  date: string
  score: number | null
}

const cardOf = (report: MonthlyReport | null | undefined) =>
  report?.scorecard?.available ? report.scorecard.data : null

/** One overview row per configured project, from every collected month of its reports. */
export function scorecardRows(
  index: DataIndex,
  months: Record<string, Record<string, MonthlyReport | null>>,
  daily: Record<string, DailyScore[]> = {},
): ScorecardRow[] {
  return index.projects.map((entry) => {
    const collected = [...entry.months].sort()
    const reports = collected.map((month) => ({ month, report: months[month]?.[entry.id] }))
    const withCard = reports.filter((r) => cardOf(r.report))
    const latest = withCard.at(-1)
    const newest = reports.at(-1)?.report
    const reason =
      entry.status === 'planned' && collected.length === 0
        ? 'On the roadmap; scored once its repository exists.'
        : collected.length === 0
          ? 'Nothing collected yet.'
          : newest?.scorecard && !newest.scorecard.available
            ? newest.scorecard.reason
            : 'Not scored yet; it appears after the next collection.'
    return {
      id: entry.id,
      name: entry.name,
      repo: entry.repo,
      status: entry.status,
      month: latest?.month ?? null,
      card: cardOf(latest?.report),
      reason: latest ? null : reason,
      trend: reports
        .filter((r) => !latest || r.month <= latest.month)
        .slice(-TREND_MONTHS)
        .map((r) => ({ month: r.month, score: cardOf(r.report)?.score ?? null })),
      daily: daily[entry.id] ?? [],
      environment: reports.findLast((r) => r.report?.environment)?.report?.environment ?? null,
    }
  })
}
