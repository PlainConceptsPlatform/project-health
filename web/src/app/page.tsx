import { readIndex, readLatestReport, readReport, readScorecardTypeLabels } from '@/shared/lib/data'
import type { MonthlyReport } from '@/shared/lib/types'
import { OverviewView } from '@/views/overview'

export default function Page() {
  const index = readIndex()

  // Every collected month is read at build time, so the dashboard can be stepped back through
  // history without fetching anything. The client receives flattened summaries rather than these
  // reports, which keeps the payload to a few numbers per project per month.
  const latest: Record<string, MonthlyReport | null> = {}
  const months: Record<string, Record<string, MonthlyReport | null>> = {}
  for (const project of index.projects) {
    latest[project.id] = readLatestReport(project.id)
    for (const month of project.months) {
      months[month] ??= {}
      months[month][project.id] = readReport(project.id, month)
    }
  }

  return (
    <OverviewView
      index={index}
      reports={latest}
      months={months}
      typeLabels={readScorecardTypeLabels()}
    />
  )
}
