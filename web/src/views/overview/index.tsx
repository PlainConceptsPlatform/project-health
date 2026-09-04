import { type ProjectSummary, summarise } from '@/shared/lib/summary'
import type { DataIndex, MonthlyReport } from '@/shared/lib/types'
import { Unavailable } from '@/shared/ui'
import { ProjectGrid } from './grid'

export function OverviewView({
  index,
  reports,
  months,
}: {
  index: DataIndex
  reports: Record<string, MonthlyReport | null>
  months: Record<string, Record<string, MonthlyReport | null>>
}) {
  if (index.projects.length === 0) {
    return (
      <Unavailable reason="No project is enabled in projects.json, so there is nothing to show." />
    )
  }

  // Flattened here so the client grid receives plain data and never touches the nested report.
  const projects: ProjectSummary[] = index.projects.map((entry) =>
    summarise(entry, reports[entry.id] ?? null),
  )

  // The same flattening for every collected month. A project with nothing in a given month is still
  // summarised, so picking a month shows the whole fleet with gaps rather than a shorter list that
  // silently drops the projects that were quiet.
  const byMonth: Record<string, ProjectSummary[]> = {}
  for (const [month, reportsForMonth] of Object.entries(months)) {
    byMonth[month] = index.projects.map((entry) =>
      summarise(entry, reportsForMonth[entry.id] ?? null),
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Three of the five DORA metrics are measured here. Change fail rate and failed deployment
          recovery time need to know that a release caused a problem in production, which GitHub
          does not record, so they are not shown rather than estimated.
        </p>
      </div>

      <ProjectGrid projects={projects} byMonth={byMonth} />
    </div>
  )
}
