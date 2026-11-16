import { type EngineeringExcellence, FACETS, type MeasurementWindow } from './types.ts'

const DAY_MS = 24 * 3_600_000

/** How far back the month in progress looks, so its numbers do not restart on the first. */
export const ROLLING_DAYS = 30

/** The span a period-based number is measured over. */
export interface Window {
  from: Date
  to: Date
  days: number
  /** True for the trailing window of a month in progress; false for a calendar month. */
  rolling: boolean
}

/**
 * The window the period-based numbers of a month are measured over.
 *
 * A finished month is its calendar month, so history and the monthly trend never change. The month
 * in progress is the last ROLLING_DAYS days up to the collection: measured from the first, it held
 * a day or two of releases, runs and commits on the 2nd, so deploy frequency, lead time, rework and
 * AI usage dropped at the start of every month and recovered by its end.
 */
export function measurementWindow(
  period: { from: Date; to: Date },
  now: Date,
  days: number = ROLLING_DAYS,
): Window {
  const inProgress = now >= period.from && now < period.to
  if (!inProgress) {
    return {
      from: period.from,
      to: period.to,
      days: Math.round((period.to.getTime() - period.from.getTime()) / DAY_MS),
      rolling: false,
    }
  }
  return { from: new Date(now.getTime() - days * DAY_MS), to: now, days, rolling: true }
}

/** What a report stores about its window: only a rolling one, so calendar months stay as they were. */
export const storedWindow = (window: Window): MeasurementWindow | undefined =>
  window.rolling
    ? {
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        days: window.days,
        rolling: true,
      }
    : undefined

/**
 * The facets the scorecard rates the month in progress by: this month's where it has one, otherwise
 * the previous month's when its newest sample still falls inside the window.
 *
 * That is the newest sample of the window, because a sample from this month is always newer. Without
 * it, a weekly mutation run left the practice to workflow detection for the first days of a month,
 * which dropped a level and put a healthy project on the attention list. Only the scorecard reads
 * this: the stored facets stay per month, so the facet history holds each sample once.
 */
export function carryFacets(
  current: EngineeringExcellence | undefined,
  previous: EngineeringExcellence | null | undefined,
  since: Date,
): EngineeringExcellence | undefined {
  if (!current || !previous) return current
  const carried = { ...current }
  for (const facet of FACETS) {
    const block = current[facet]
    const before = previous[facet]
    if (block?.available || !before?.available) continue
    if (Date.parse(before.data.latestGeneratedAt) < since.getTime()) continue
    ;(carried as Record<string, unknown>)[facet] = before
  }
  return carried
}
