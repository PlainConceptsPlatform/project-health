import type { AgenticAdoption, DataIndex, MonthlyReport } from './types'

/**
 * current: matches the newest release on npm. patch: only a patch behind, which an update picks up
 * without anything changing shape. behind: a minor or major behind. missing: not installed.
 * unknown: installed, but the registry could not be read to compare.
 */
export type VersionState = 'current' | 'patch' | 'behind' | 'missing' | 'unknown'

const parts = (version: string) => version.split('.').map((n) => Number.parseInt(n, 10) || 0)

export function versionState(version: string | null, latest: string | null): VersionState {
  if (!version) return 'missing'
  if (!latest) return 'unknown'
  const [a = 0, b = 0, c = 0] = parts(version)
  const [x = 0, y = 0, z = 0] = parts(latest)
  if (a > x || (a === x && b > y) || (a === x && b === y && c >= z)) return 'current'
  return a === x && b === y ? 'patch' : 'behind'
}

/**
 * Where a project stands against the platform's way of running agents, best first.
 * aligned: the standard router with the harness, both on the current minor release.
 * behind: the standard router, but an old release or no harness.
 * custom: agent automation built outside the package. none: no agent tooling.
 */
export type AgenticVerdict = 'aligned' | 'behind' | 'custom' | 'none'

export const VERDICT_LABEL: Record<AgenticVerdict, string> = {
  aligned: 'Standard, up to date',
  behind: 'Standard, behind',
  custom: 'Own setup',
  none: 'No agents',
}

export const VERDICT_DESCRIPTION: Record<AgenticVerdict, string> = {
  aligned: 'Runs the agentic workflows router and the agent harness on the current release.',
  behind: 'Runs the agentic workflows router, but an older release or without the agent harness.',
  custom:
    'Has agent automation, but not through the platform packages, so it misses their updates.',
  none: 'No agent harness and no agent workflows on the default branch.',
}

export const VERDICT_ORDER: Record<AgenticVerdict, number> = {
  aligned: 0,
  behind: 1,
  custom: 2,
  none: 3,
}

const upToDate = (state: VersionState) =>
  state === 'current' || state === 'patch' || state === 'unknown'

export function verdictOf(adoption: AgenticAdoption): AgenticVerdict {
  if (adoption.setup !== 'standard') return adoption.setup
  const harness = versionState(adoption.harness.version, adoption.harness.latest)
  const workflows = versionState(adoption.workflows.version, adoption.workflows.latest)
  return upToDate(harness) && upToDate(workflows) && adoption.workflows.retired.length === 0
    ? 'aligned'
    : 'behind'
}

export interface AgenticRow {
  id: string
  name: string
  repo: string
  /** The month the adoption is from, the newest one that has it. */
  month: string | null
  adoption: AgenticAdoption | null
  verdict: AgenticVerdict | null
  /** Why there is no adoption, when there is none. */
  reason: string | null
}

/** One row per configured project, from the newest month that recorded adoption. */
export function agenticRows(
  index: DataIndex,
  months: Record<string, Record<string, MonthlyReport | null>>,
): AgenticRow[] {
  return index.projects
    .map((entry) => {
      const collected = [...entry.months].sort()
      const reports = collected.map((month) => ({ month, report: months[month]?.[entry.id] }))
      const latest = reports.findLast((r) => r.report?.agentic?.available)
      const newest = reports.at(-1)?.report
      const adoption = latest?.report?.agentic?.available ? latest.report.agentic.data : null
      const reason = adoption
        ? null
        : newest?.agentic && !newest.agentic.available
          ? newest.agentic.reason
          : collected.length === 0
            ? 'Nothing collected yet.'
            : 'Not checked yet; it appears after the next collection.'
      return {
        id: entry.id,
        name: entry.name,
        repo: entry.repo,
        month: latest?.month ?? null,
        adoption,
        verdict: adoption ? verdictOf(adoption) : null,
        reason,
      }
    })
    .sort(
      (a, b) =>
        (a.verdict ? VERDICT_ORDER[a.verdict] : 9) - (b.verdict ? VERDICT_ORDER[b.verdict] : 9) ||
        (b.adoption?.bot.merged ?? 0) - (a.adoption?.bot.merged ?? 0) ||
        a.name.localeCompare(b.name),
    )
}

/** Projects per verdict, for the summary line above the table. */
export function verdictCounts(rows: AgenticRow[]): Record<AgenticVerdict, number> {
  const counts: Record<AgenticVerdict, number> = { aligned: 0, behind: 0, custom: 0, none: 0 }
  for (const row of rows) if (row.verdict) counts[row.verdict] += 1
  return counts
}
