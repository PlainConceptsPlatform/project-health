import type {
  ActionsMinutes,
  ActionsStorage,
  ActionsUsage,
  DataIndex,
  MonthlyReport,
} from './types'

const GB = 1024 ** 3
const DAY_MS = 86_400_000

/** Half the 10 GB cache cap GitHub applies to each repository. */
export const STORAGE_LIMIT_BYTES = 5 * GB
/** Month over month growth in minutes, at the same daily pace, that is worth a look. */
export const MINUTES_SURGE = 0.5
/** Below this many minutes in the previous month a jump is noise, not a trend. */
export const MINUTES_SURGE_FLOOR = 100

/** How many months the trend lines show. */
export const TREND_MONTHS = 6

export const storageSize = (bytes: number | null | undefined): string => {
  if (bytes === null || bytes === undefined) return 'n/a'
  if (bytes < GB) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${(bytes / GB).toFixed(1)} GB`
}

export const minutesLabel = (minutes: number | null | undefined): string =>
  minutes === null || minutes === undefined ? 'n/a' : minutes.toLocaleString('en-GB')

export const OS_LABEL: Record<string, string> = {
  UBUNTU: 'Linux',
  MACOS: 'macOS',
  WINDOWS: 'Windows',
}

/** One month of one project, reduced to what the Actions views read. */
export interface ActionsEntry {
  month: string
  period: { from: string; to: string }
  actions?: ActionsUsage
}

export const entryOf = (month: string, report: MonthlyReport | null | undefined) =>
  report ? { month, period: report.period, actions: report.actions } : null

/**
 * Minutes per elapsed day. A month in progress has had fewer days to spend minutes in, so comparing
 * raw totals would read every current month as a drop.
 */
export function minutesPerDay(
  minutes: ActionsMinutes,
  period: ActionsEntry['period'],
): number | null {
  const from = Date.parse(period.from)
  const end = Math.min(Date.parse(period.to), Date.parse(minutes.measuredAt))
  const days = (end - from) / DAY_MS
  return days >= 1 ? minutes.total / days : null
}

/** Growth of the daily pace against the month before, or null when there is nothing to compare. */
export function minutesChange(current: ActionsEntry | null, previous: ActionsEntry | null) {
  const now = current?.actions?.minutes
  const before = previous?.actions?.minutes
  if (!now?.available || !before?.available || !current || !previous) return null
  if (before.data.total < MINUTES_SURGE_FLOOR) return null
  const a = minutesPerDay(now.data, current.period)
  const b = minutesPerDay(before.data, previous.period)
  if (a === null || b === null || b === 0) return null
  return a / b - 1
}

export const storageOver = (storage: ActionsStorage | null) =>
  storage !== null && storage.totalBytes > STORAGE_LIMIT_BYTES

export const minutesSurge = (change: number | null) => change !== null && change > MINUTES_SURGE

export interface ActionsSummary {
  /** The newest month, which the minutes belong to. */
  month: string | null
  minutes: ActionsMinutes | null
  minutesReason: string | null
  /** The newest storage reading, which may come from an earlier month than the minutes. */
  storage: ActionsStorage | null
  storageReason: string | null
  change: number | null
  storageOver: boolean
  minutesSurge: boolean
  minutesTrend: { month: string; score: number | null }[]
  storageTrend: { month: string; score: number | null }[]
}

const NOT_COLLECTED =
  'Not collected yet; it appears after the next collection with Actions read access.'

/** Summarises a project's months, oldest first, up to the month being shown. */
export function summariseActions(entries: ActionsEntry[]): ActionsSummary {
  const newest = entries.at(-1) ?? null
  const previous = entries.at(-2) ?? null
  const minutesBlock = newest?.actions?.minutes
  const minutes = minutesBlock?.available ? minutesBlock.data : null
  const stored = entries.findLast((e) => e.actions?.storage.available)?.actions?.storage
  const storage = stored?.available ? stored.data : null
  const newestStorage = newest?.actions?.storage
  const change = minutesChange(newest, previous)
  const recent = entries.slice(-TREND_MONTHS)

  return {
    month: newest?.month ?? null,
    minutes,
    minutesReason: minutes
      ? null
      : minutesBlock && !minutesBlock.available
        ? minutesBlock.reason
        : NOT_COLLECTED,
    storage,
    storageReason: storage
      ? null
      : newestStorage && !newestStorage.available
        ? newestStorage.reason
        : NOT_COLLECTED,
    change,
    storageOver: storageOver(storage),
    minutesSurge: minutesSurge(change),
    minutesTrend: recent.map((e) => ({
      month: e.month,
      score: e.actions?.minutes.available ? e.actions.minutes.data.total : null,
    })),
    storageTrend: recent.map((e) => ({
      month: e.month,
      score: e.actions?.storage.available
        ? Math.round((e.actions.storage.data.totalBytes / GB) * 100) / 100
        : null,
    })),
  }
}

/** A sparkline's ceiling: the highest point with some headroom, never zero. */
export const trendMax = (points: { score: number | null }[], floor = 1) =>
  Math.max(floor, ...points.map((p) => (p.score ?? 0) * 1.1))

export interface ActionsRow extends ActionsSummary {
  id: string
  name: string
  repo: string
}

/** Every project, the ones over a threshold first, then by storage. */
export function actionsRows(
  index: DataIndex,
  months: Record<string, Record<string, MonthlyReport | null>>,
): ActionsRow[] {
  return index.projects
    .map((entry) => {
      const entries = [...entry.months]
        .sort()
        .flatMap((month) => entryOf(month, months[month]?.[entry.id]) ?? [])
      return { id: entry.id, name: entry.name, repo: entry.repo, ...summariseActions(entries) }
    })
    .sort(
      (a, b) =>
        Number(b.storageOver || b.minutesSurge) - Number(a.storageOver || a.minutesSurge) ||
        (b.storage?.totalBytes ?? -1) - (a.storage?.totalBytes ?? -1) ||
        a.name.localeCompare(b.name),
    )
}

export const flaggedCount = (rows: ActionsSummary[]) =>
  rows.filter((r) => r.storageOver || r.minutesSurge).length
