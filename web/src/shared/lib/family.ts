import type { DailyScore } from './scorecard'
import type { DataIndex, Family, MonthlyReport, ProjectFamily } from './types'

export const MODE_LABEL: Record<Family['mode'], string> = {
  contract: 'Contract',
  legacy: 'Implicit contract',
  baseline: 'Baseline',
}

export const MODE_DESCRIPTION: Record<Family['mode'], string> = {
  contract:
    'The owned paths of .platform/contract.yml, byte for byte against the template version the app records.',
  legacy:
    'No contract.yml yet: .platform/manifest and .copier-answers.yml read as one, byte for byte against the recorded template version.',
  baseline:
    'Before adoption: a provisional list of platform paths against the baseline template’s default branch, with app names normalised.',
}

/** The template's display name; files written before the contract was read only have its repo. */
export const templateName = (family: Family): string => family.source?.name ?? family.reference.repo

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
  /** The member's contract cannot be read; reason says which file and field. */
  invalid: boolean
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
export function lagLabel(template: Family['template'], mode: Family['mode']): string {
  if (template.tag === null) return mode === 'baseline' ? 'Not adopted yet' : 'No version tag'
  if (template.lag === null) return 'Tags not readable'
  return template.lag === 0
    ? 'Current'
    : `${template.lag} tag${template.lag === 1 ? '' : 's'} behind`
}

const ORDER: Record<ProjectFamily, number> = { member: 0, 'own-design': 1 }

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
      const invalid =
        newest?.family && !newest.family.available && 'invalid' in newest.family
          ? newest.family.reason
          : null
      const family = !invalid && compared?.family?.available ? compared.family.data : null
      return [
        {
          id: entry.id,
          name: entry.name,
          repo: entry.repo,
          family: entry.family,
          familyReason: entry.familyReason ?? null,
          drift: family,
          reason:
            family || entry.family !== 'member'
              ? null
              : newest?.family && !newest.family.available
                ? newest.family.reason
                : 'Not compared yet; it appears after the next collection.',
          invalid: invalid !== null,
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
