import {
  readDailyScores,
  readExcellenceHistory,
  readIndex,
  readLatestReport,
  readReport,
  readScorecardTypeLabels,
  readTrend,
} from '@/shared/lib/data'
import { Unavailable } from '@/shared/ui'
import { ProjectView } from '@/views/project'

export function generateStaticParams() {
  // Driven by projects.json, so every configured project has a page from the first build.
  return readIndex().projects.map((project) => ({ id: project.id }))
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const entry = readIndex().projects.find((p) => p.id === id)
  const report = readLatestReport(id)

  if (!entry) {
    return <Unavailable reason={`No project with id "${id}" is configured in projects.json.`} />
  }
  if (!report) {
    return (
      <Unavailable
        reason={`${entry.name} is configured but nothing has been collected yet. Run the backfill workflow for this project, or wait for the daily collection.`}
      />
    )
  }
  const shown = `${report.period.year}-${String(report.period.month).padStart(2, '0')}`
  const newest = entry.latest && entry.latest !== shown ? readReport(id, entry.latest) : null
  return (
    <ProjectView
      report={report}
      months={entry.months}
      trend={readTrend(id)}
      excellence={readExcellenceHistory(id, shown)}
      typeLabels={readScorecardTypeLabels()}
      daily={readDailyScores(id)}
      engineering={
        newest && entry.latest
          ? { report: newest, excellence: readExcellenceHistory(id, entry.latest) }
          : undefined
      }
    />
  )
}
