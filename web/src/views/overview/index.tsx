import { agenticRows } from '@/shared/lib/agentic'
import { portfolioRows } from '@/shared/lib/portfolio'
import { type DailyScore, scorecardRows } from '@/shared/lib/scorecard'
import { type ProjectSummary, summarise } from '@/shared/lib/summary'
import type { DataIndex, MonthlyReport } from '@/shared/lib/types'
import { Unavailable } from '@/shared/ui'
import { Portfolio } from './portfolio'

export function OverviewView({
  index,
  reports,
  months,
  daily,
  typeLabels,
}: {
  index: DataIndex
  reports: Record<string, MonthlyReport | null>
  months: Record<string, Record<string, MonthlyReport | null>>
  daily: Record<string, DailyScore[]>
  typeLabels: Record<string, string>
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
    <Portfolio
      rows={portfolioRows(scorecardRows(index, months, daily))}
      typeLabels={typeLabels}
      projects={projects}
      byMonth={byMonth}
      agentic={agenticRows(index, months)}
    />
  )
}
