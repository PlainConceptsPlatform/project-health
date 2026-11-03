import type { DailyScore } from './scorecard'
import type { DataIndex, Family, MonthlyReport, ProjectFamily } from './types'

export const MODE_LABEL: Record<Family['mode'], string> = {
  manifest: 'Manifest',
  baseline: 'Baseline',
}

export const MODE_DESCRIPTION: Record<Family['mode'], string> = {
  manifest:
    'The paths in .platform/manifest, byte for byte against the template tag the app last rendered.',
  baseline:
    'Before adoption: a provisional list of platform paths against the template’s default branch, with app names normalised.',
}

export interface FamilyRow {
  id: string
  name: string
  repo: string
  family: ProjectFamily
  /** Why an own-design project keeps its own architecture. */
  familyReason: string | null
  drift: Family | null
  /** Why a family member has no comparison yet. */
  reason: string | null
  trend: { month: string; score: number | null }[]
}

export function identicalTrend(daily: DailyScore[]) {
  return daily
    .filter((d) => d.familyIdentical !== undefined)
    .slice(-30)
    .map((d) => ({
      month: d.date,
      score:
        d.familyIdentical === null || d.familyIdentical === undefined
          ? null
          : d.familyIdentical * 100,
    }))
}

/** Template tags the app is behind, as words. */
export function lagLabel(template: Family['template']): string {
  if (template.tag === null) return 'Not adopted yet'
  if (template.lag === null) return 'Tags not readable'
  return template.lag === 0
    ? 'Current'
    : `${template.lag} tag${template.lag === 1 ? '' : 's'} behind`
}

const ORDER: Record<ProjectFamily, number> = { 'kitchen-sink': 0, 'own-design': 1 }

/** One row per project in a family, members first, from the newest month that compared it. */
export function familyRows(
  index: DataIndex,
  months: Record<string, Record<string, MonthlyReport | null>>,
  daily: Record<string, DailyScore[]> = {},
): FamilyRow[] {
  return index.projects
    .flatMap((entry) => {
      if (!entry.family) return []
      const reports = [...entry.months]
        .sort()
        .map((month) => months[month]?.[entry.id])
        .filter((r): r is MonthlyReport => Boolean(r))
      const compared = reports.findLast((r) => r.family?.available)
      const newest = reports.at(-1)
      const family = compared?.family?.available ? compared.family.data : null
      return [
        {
          id: entry.id,
          name: entry.name,
          repo: entry.repo,
          family: entry.family,
          familyReason: entry.familyReason ?? null,
          drift: family,
          reason:
            family || entry.family !== 'kitchen-sink'
              ? null
              : newest?.family && !newest.family.available
                ? newest.family.reason
                : 'Not compared yet; it appears after the next collection.',
          trend: identicalTrend(daily[entry.id] ?? []),
        },
      ]
    })
    .sort(
      (a, b) =>
        ORDER[a.family] - ORDER[b.family] ||
        Number(b.drift?.isReference ?? false) - Number(a.drift?.isReference ?? false) ||
        (b.drift?.identicalShare ?? -1) - (a.drift?.identicalShare ?? -1) ||
        a.name.localeCompare(b.name),
    )
}
