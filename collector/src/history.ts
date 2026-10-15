import type { MonthlyReport } from './types.ts'

/** One day's engineering score, so a delta can look back a fixed number of days. */
export interface DailyPoint {
  /** YYYY-MM-DD, UTC. */
  date: string
  score: number | null
  level: number
  gatesPresent: number
  gatesApplicable: number
  commentDensity?: number | null
  testRatio?: number | null
}

export interface DailyHistory {
  schemaVersion: 1
  days: DailyPoint[]
}

/** About a year and a month: enough for a 30-day delta all year without the file growing forever. */
export const MAX_DAYS = 400

export const emptyHistory = (): DailyHistory => ({ schemaVersion: 1, days: [] })

/** Today's point from a report, or null when the report has no scorecard. */
export function pointOf(report: MonthlyReport, date: Date): DailyPoint | null {
  if (!report.scorecard?.available) return null
  const card = report.scorecard.data
  const code = report.codebase?.available ? report.codebase.data : null
  return {
    date: date.toISOString().slice(0, 10),
    score: card.score,
    level: card.level,
    gatesPresent: card.gates.present,
    gatesApplicable: card.gates.applicable,
    ...(code ? { commentDensity: code.comments.density, testRatio: code.tests.ratio } : {}),
  }
}

/**
 * Adds a point, replacing any earlier one for the same day: collection can run several times a day
 * and the last run is the one that stands. Days stay sorted and the oldest fall off past MAX_DAYS.
 */
export function withPoint(history: DailyHistory, point: DailyPoint): DailyHistory {
  const days = history.days.filter((d) => d.date !== point.date)
  days.push(point)
  days.sort((a, b) => a.date.localeCompare(b.date))
  return { schemaVersion: 1, days: days.slice(-MAX_DAYS) }
}

/** A corrupt or foreign file starts a fresh history rather than failing the collection. */
export function parseHistory(text: string | null): DailyHistory {
  if (!text) return emptyHistory()
  try {
    const parsed = JSON.parse(text) as Partial<DailyHistory>
    return Array.isArray(parsed.days) ? { schemaVersion: 1, days: parsed.days } : emptyHistory()
  } catch {
    return emptyHistory()
  }
}
