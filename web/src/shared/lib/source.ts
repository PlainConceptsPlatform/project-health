import type { MetricBlock, MonthlyReport } from './types'

/**
 * Months written by facet-store, on a host the GitHub collector cannot read.
 *
 * Those months only ever carry engineering facets. Every other block is either absent, which the page
 * would otherwise explain as "added after the data was collected, it will appear after the next
 * collection", or has a reason that names GitHub. Both are wrong there: no collection will ever fill
 * them, so the page has to say so.
 */

/** Written by facet-store into every block it cannot fill; kept for months created before `source`. */
const LEGACY_REASON = 'This month was written from engineering facets alone'

export const FACET_ONLY_REASON =
  'Not collected on this host. This month was written from the engineering facets its CI publishes, and no collector reads this metric there.'

export function isFacetOnly(report: MonthlyReport): boolean {
  if (report.source === 'facets') return true
  const frequency = report.delivery.deploymentFrequency
  return !frequency.available && frequency.reason.startsWith(LEGACY_REASON)
}

const missing = <T>(): MetricBlock<T> => ({ available: false, reason: FACET_ONLY_REASON })

/** Fills what facet-store never writes with a reason that is true for this host. */
export function withFacetOnlyReasons(report: MonthlyReport): MonthlyReport {
  if (!isFacetOnly(report)) return report
  return {
    ...report,
    source: 'facets',
    scorecard: report.scorecard ?? missing(),
    environment: report.environment ?? missing(),
    roadmap: report.roadmap ?? missing(),
    agentic: report.agentic ?? missing(),
    codebase: report.codebase ?? missing(),
    actions: report.actions ?? { minutes: missing(), storage: missing() },
  }
}

/** What the header and footer may claim about where the numbers come from. */
export type SiteSource = 'github' | 'facets' | 'mixed'

export function siteSource(reports: MonthlyReport[]): SiteSource {
  const facets = reports.filter(isFacetOnly).length
  if (facets === 0) return 'github'
  return facets === reports.length ? 'facets' : 'mixed'
}
