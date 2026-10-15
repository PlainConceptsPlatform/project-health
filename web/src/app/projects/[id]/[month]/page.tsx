import {
  currentMonth,
  readDailyScores,
  readExcellenceHistory,
  readIndex,
  readReport,
  readScorecardTypeLabels,
  readTrend,
} from '@/shared/lib/data'
import { Unavailable } from '@/shared/ui'
import { ProjectView } from '@/views/project'

export function generateStaticParams() {
  const projects = readIndex().projects
  const collected = projects.flatMap((project) =>
    project.months.map((month) => ({ id: project.id, month })),
  )

  // Before any collection has run there are no months. Static export treats an empty parameter
  // list as a missing generateStaticParams, so the current month is generated as an empty state
  // and becomes a real page once the collector has written it.
  if (collected.length > 0) return collected
  return projects.map((project) => ({ id: project.id, month: currentMonth() }))
}

export default async function Page({ params }: { params: Promise<{ id: string; month: string }> }) {
  const { id, month } = await params
  const entry = readIndex().projects.find((p) => p.id === id)
  const report = readReport(id, month)

  if (!entry) {
    return <Unavailable reason={`No project with id "${id}" is configured in projects.json.`} />
  }
  if (!report) {
    return (
      <Unavailable
        reason={`Nothing has been collected for ${entry.name} in ${month} yet. Run the backfill workflow for this project, or wait for the daily collection.`}
      />
    )
  }
  const shown = `${report.period.year}-${String(report.period.month).padStart(2, '0')}`
  return (
    <ProjectView
      report={report}
      months={entry.months}
      trend={readTrend(id)}
      excellence={readExcellenceHistory(id, shown)}
      typeLabels={readScorecardTypeLabels()}
      daily={readDailyScores(id)}
    />
  )
}
