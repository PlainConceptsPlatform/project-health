import type { ExcellenceHistory } from '@/shared/lib/data'
import {
  dateTime,
  hours,
  monthName,
  percent,
  seconds,
  shortDate,
  tokens,
} from '@/shared/lib/format'
import type { MonthlyReport } from '@/shared/lib/types'
import {
  Badge,
  DataTable,
  InfoTip,
  Metric,
  Panel,
  Stat,
  TableCell,
  TableRow,
  Unavailable,
} from '@/shared/ui'
import {
  DurationByKind,
  MonthlyTrend,
  PeopleBars,
  ReleasesPerDay,
  TokensByKind,
} from '@/shared/ui/charts'
import { AdoptionPanel } from './agentic'
import { ExcellencePanel } from './excellence'
import { RoadmapView } from './roadmap'
import { ScorecardPanel } from './scorecard'
import { type ProjectTab, ProjectTabs } from './tabs'

export interface TrendPoint {
  month: string
  releases: number
  leadTimeHours: number | null
}

const monthKey = (r: MonthlyReport) => `${r.period.year}-${String(r.period.month).padStart(2, '0')}`

/** Every day of the month, so a quiet week reads as a gap rather than being collapsed away. */
function releasesPerDay(report: MonthlyReport) {
  if (!report.delivery.deploymentFrequency.available) return []
  const { year, month } = report.period
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const counts = new Map<number, number>()
  for (const release of report.delivery.deploymentFrequency.data.releases) {
    const day = new Date(release.deployedAt).getUTCDate()
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  return Array.from({ length: days }, (_, i) => ({
    day: String(i + 1),
    releases: counts.get(i + 1) ?? 0,
  }))
}

function DeliveryPanel({ report }: { report: MonthlyReport }) {
  const { deploymentFrequency, leadTime, reworkRate } = report.delivery
  return (
    <Panel
      title="Delivery"
      description={
        report.status === 'planned'
          ? 'Planned project: not deployed yet'
          : report.delivery.productionEnvironment
            ? `Production environment: ${report.delivery.productionEnvironment}`
            : 'No production environment configured'
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <p className="text-sm font-medium">Deployment frequency</p>
          <Metric block={deploymentFrequency}>
            {(d) => (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Stat label="Per week" explain="deployFrequency" value={d.perWeek} />
                  <Stat label="Releases" value={d.count} />
                  <Stat
                    label="Median gap"
                    explain="medianGap"
                    value={d.medianIntervalHours === null ? 'n/a' : hours(d.medianIntervalHours)}
                  />
                  <Stat
                    label="Deploy records"
                    explain="deployRecords"
                    value={d.rawObjectCount}
                    hint={d.rawObjectCount > d.count ? 'deduplicated by commit' : undefined}
                  />
                </div>
                <div className="mt-4">
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                    Releases per day
                  </p>
                  <ReleasesPerDay data={releasesPerDay(report)} />
                </div>
              </>
            )}
          </Metric>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium">Change lead time</p>
          <Metric block={leadTime}>
            {(d) => (
              <div className="space-y-4">
                <Metric block={d.commitToProduction}>
                  {(c) => (
                    <div className="grid grid-cols-3 gap-4">
                      <Stat label="p50" explain="leadTime" value={hours(c.p50Hours)} />
                      <Stat label="p75" value={hours(c.p75Hours)} />
                      <Stat
                        label="p90"
                        explain="percentiles"
                        value={hours(c.p90Hours)}
                        hint={`${c.count} commits`}
                      />
                    </div>
                  )}
                </Metric>
                <div>
                  <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                    Issue to staging
                  </p>
                  <Metric block={d.issueToStaging}>
                    {(i) => (
                      <div className="grid grid-cols-3 gap-4">
                        <Stat label="p50" explain="leadTimeIssue" value={hours(i.p50Hours)} />
                        <Stat label="p75" value={hours(i.p75Hours)} />
                        <Stat label="p90" value={hours(i.p90Hours)} hint={`${i.count} issues`} />
                      </div>
                    )}
                  </Metric>
                </div>
              </div>
            )}
          </Metric>

          <div className="border-t pt-4">
            <p className="mb-2 text-sm font-medium">Deployment rework rate</p>
            <Metric block={reworkRate}>
              {(d) =>
                d.confidence === 'none' ? (
                  <Unavailable
                    reason={`No release carries the ${d.label ?? 'hotfix'} label, so planned and unplanned releases cannot be told apart. The label is read from the issue that reported the problem as well as from the pull request that fixed it.`}
                  />
                ) : (
                  <div className="grid grid-cols-3 gap-4">
                    <Stat
                      label="Rate"
                      explain="reworkRate"
                      value={percent(d.rate)}
                      tone={d.rate > 0.15 ? 'bad' : undefined}
                    />
                    <Stat label="Unplanned" value={d.unplanned} />
                    <Stat
                      label="Total"
                      value={d.total}
                      hint={d.label ? `marked by the ${d.label} label` : undefined}
                    />
                  </div>
                )
              }
            </Metric>
          </div>
        </div>
      </div>
    </Panel>
  )
}

function AgentsPanel({ report }: { report: MonthlyReport }) {
  return (
    <Panel
      title="Agents"
      description="Cost is measured in tokens. Agent time is the wall clock of the OpenCode step, so it is longer than the sum of model request times shown in a run's own token table, because it also covers tool calls and file work."
    >
      <Metric block={report.agents}>
        {(data) => {
          const kinds = Object.entries(data.byKind)
          const tokenData = kinds.map(([kind, s]) => ({
            kind,
            input: s.tokens.inputTokens,
            output: s.tokens.outputTokens,
          }))
          const durationData = kinds
            .filter(([, s]) => s.executionSeconds.available)
            .map(([kind, s]) => ({
              kind,
              p50: s.executionSeconds.available ? s.executionSeconds.data.p50 : 0,
              p90: s.executionSeconds.available ? s.executionSeconds.data.p90 : 0,
            }))

          const totals = kinds.reduce(
            (acc, [, k]) => ({
              runs: acc.runs + k.runs,
              measured: acc.measured + (k.runsWithUsage ?? 0),
              input: acc.input + k.tokens.inputTokens,
              output: acc.output + k.tokens.outputTokens,
              seconds: acc.seconds + k.totalExecutionSeconds,
            }),
            { runs: 0, measured: 0, input: 0, output: 0, seconds: 0 },
          )
          const partial = totals.measured > 0 && totals.measured < totals.runs

          return (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-5 rounded-md border bg-muted/30 p-4 sm:grid-cols-4">
                <Stat
                  label="Total tokens"
                  explain="agentTokens"
                  value={tokens(totals.input + totals.output)}
                  hint={`${tokens(totals.input)} in, ${tokens(totals.output)} out`}
                />
                <Stat
                  label="Total agent time"
                  explain="agentTime"
                  value={seconds(totals.seconds)}
                  hint="OpenCode step"
                />
                <Stat label="Runs" explain="agentRuns" value={totals.runs} />
                <Stat
                  label="Measured"
                  explain="measured"
                  value={`${totals.measured}/${totals.runs}`}
                  tone={partial ? 'bad' : undefined}
                  hint={partial ? 'totals are a floor' : 'complete'}
                />
              </div>

              {partial ? (
                <p className="text-xs text-muted-foreground">
                  {totals.runs - totals.measured} run(s) reported no token usage, so the totals
                  above are a lower bound. A run writes usage only if it reached the model and
                  uploaded its artifact.
                </p>
              ) : null}

              <div className="grid gap-5 sm:grid-cols-2">
                {kinds.map(([kind, s]) => {
                  const total = s.tokens.inputTokens + s.tokens.outputTokens
                  return (
                    <div key={kind} className="rounded-md border p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="font-medium capitalize">{kind}</p>
                        <Badge variant="secondary">
                          {s.successful}/{s.runs} succeeded
                          {(s.runsWithUsage ?? s.runs) < s.runs
                            ? ` · ${s.runsWithUsage ?? 0} measured`
                            : ''}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <Stat
                          label="Total tokens"
                          value={tokens(total)}
                          hint={
                            (s.runsWithUsage ?? 0) > 0
                              ? `${tokens(Math.round(total / (s.runsWithUsage ?? 1)))} per measured run`
                              : undefined
                          }
                        />
                        <Stat
                          label="Agent time"
                          explain="agentTime"
                          value={seconds(s.totalExecutionSeconds)}
                          hint={s.tokens.primaryModel ?? undefined}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                    Tokens by kind
                  </p>
                  <TokensByKind data={tokenData} />
                </div>
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                    Agent step duration
                  </p>
                  {durationData.length > 0 ? (
                    <DurationByKind data={durationData} />
                  ) : (
                    <Unavailable reason="No agent step durations were recorded in this period." />
                  )}
                </div>
              </div>

              <DataTable head={['Run', 'Kind', 'Issue', 'Started', 'Duration', 'Input', 'Output']}>
                {data.runs.slice(0, 60).map((run) => (
                  <TableRow key={run.runId}>
                    <TableCell>
                      <a
                        href={`https://github.com/${report.repo}/actions/runs/${run.runId}`}
                        className="font-mono text-xs hover:underline"
                      >
                        {run.runId}
                      </a>
                    </TableCell>
                    <TableCell className="capitalize">{run.kind}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {run.issueNumber ? (
                        <a
                          href={`https://github.com/${report.repo}/issues/${run.issueNumber}`}
                          className="hover:underline"
                        >
                          #{run.issueNumber}
                        </a>
                      ) : (
                        'n/a'
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {shortDate(run.startedAt)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {run.executionSeconds === null ? 'n/a' : seconds(run.executionSeconds)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {run.usage ? tokens(run.usage.inputTokens) : 'n/a'}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {run.usage ? tokens(run.usage.outputTokens) : 'n/a'}
                    </TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </div>
          )
        }}
      </Metric>
    </Panel>
  )
}

function PeoplePanel({ report }: { report: MonthlyReport }) {
  return (
    <Panel
      title="People"
      description="Who opened the work and who released it. Every agent run is triggered by the bot App, so that is not charted."
    >
      <Metric block={report.contributors}>
        {(d) => (
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                Opened implement issues
              </p>
              {d.requesters.length > 0 ? (
                <PeopleBars data={d.requesters.slice(0, 6)} label="Issues" />
              ) : (
                <Unavailable reason="No implement issues were opened in this period." />
              )}
            </div>
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                Released to production
              </p>
              {d.deployers.length > 0 ? (
                <PeopleBars data={d.deployers.slice(0, 6)} label="Releases" />
              ) : (
                <Unavailable reason="No production releases in this period." />
              )}
            </div>
          </div>
        )}
      </Metric>
    </Panel>
  )
}

function ReleasesPanel({ report }: { report: MonthlyReport }) {
  return (
    <Panel title="Releases" description="Distinct commits that reached production">
      <Metric block={report.delivery.deploymentFrequency}>
        {(d) => (
          <DataTable head={['Ref', 'Deployed', 'By', 'Commit', 'Signals']}>
            {d.releases.map((release) => (
              <TableRow key={release.sha}>
                <TableCell className="font-medium">{release.ref}</TableCell>
                <TableCell className="text-muted-foreground">
                  {dateTime(release.deployedAt)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {release.deployedBy ?? 'unknown'}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {release.sha.slice(0, 8)}
                </TableCell>
                <TableCell className="space-x-1.5">
                  {release.unplanned ? <Badge variant="destructive">unplanned</Badge> : null}
                  {release.outOfProcess ? <Badge variant="outline">not a tag</Badge> : null}
                  {release.deploymentIds.length > 1 ? (
                    <Badge variant="secondary">{release.deploymentIds.length} records</Badge>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        )}
      </Metric>
    </Panel>
  )
}

/**
 * Notes are split by severity. Everything the collector reports is worth surfacing, but a project
 * with agents switched off is not a data quality problem and should not read like one.
 */
function NotesPanel({ report }: { report: MonthlyReport }) {
  const warn = report.warnings.filter((w) => w.severity !== 'info')
  const info = report.warnings.filter((w) => w.severity === 'info')

  const row = (
    w: MonthlyReport['warnings'][number],
    variant: 'outline' | 'secondary' | 'destructive',
  ) => (
    <div key={`${w.code}-${w.message}`} className="flex gap-3">
      <Badge variant={variant} className="h-fit shrink-0">
        {w.code.toLowerCase().replace(/_/g, ' ')}
      </Badge>
      <p className="text-sm text-muted-foreground">{w.message}</p>
    </div>
  )

  return (
    <Panel
      title="Notes"
      description="Warnings change how these numbers should be read. The rest is context about how the project is set up."
    >
      <div className="space-y-4">
        {warn.length > 0 ? (
          <div className="space-y-2">
            {warn.map((w) => row(w, w.code === 'ROLLBACK_DETECTED' ? 'destructive' : 'outline'))}
          </div>
        ) : null}
        {info.length > 0 ? (
          <div className="space-y-2 border-t pt-4">{info.map((w) => row(w, 'secondary'))}</div>
        ) : null}
      </div>
    </Panel>
  )
}

export function ProjectView({
  report,
  months,
  trend,
  excellence,
  typeLabels = {},
  engineering,
}: {
  report: MonthlyReport
  months: string[]
  trend: TrendPoint[]
  excellence?: ExcellenceHistory
  typeLabels?: Record<string, string>
  /**
   * The scorecard and engineering excellence describe the repository as it is now, not the month
   * the delivery cards fall back to. The default project page passes the newest collected month
   * here so a project whose last release was months ago still shows today's gates.
   */
  engineering?: { report: MonthlyReport; excellence?: ExcellenceHistory }
}) {
  const current = monthKey(report)
  const engineeringReport = engineering?.report ?? report
  const engineeringExcellence = engineering ? engineering.excellence : excellence
  const engineeringMonth = monthKey(engineeringReport)

  const tabs: ProjectTab[] = [
    {
      id: 'engineering',
      label: 'Engineering',
      content: (
        <>
          <ScorecardPanel report={engineeringReport} typeLabels={typeLabels} />
          <ExcellencePanel report={engineeringReport} history={engineeringExcellence} />
        </>
      ),
    },
    {
      id: 'delivery',
      label: 'Delivery',
      content: (
        <>
          <DeliveryPanel report={report} />
          {trend.length > 1 ? (
            <Panel title="Trend" description="Production releases across the collected months">
              <MonthlyTrend data={trend} />
            </Panel>
          ) : null}
          <PeoplePanel report={report} />
          <ReleasesPanel report={report} />
        </>
      ),
    },
  ]
  tabs.push({
    id: 'agentic',
    label: 'Agentic',
    content: (
      <>
        <AdoptionPanel report={engineeringReport} />
        <AgentsPanel report={report} />
      </>
    ),
  })
  // Only projects that opted in get the tab; for the rest it would be an empty promise.
  if (report.roadmap) {
    const roadmap = report.roadmap
    tabs.push({
      id: 'roadmap',
      label: 'Roadmap',
      content: roadmap.available ? (
        <RoadmapView
          roadmap={roadmap.data}
          repo={report.repo}
          from={report.period.from}
          to={report.period.to}
        />
      ) : (
        <Panel title="Roadmap">
          <Unavailable reason={roadmap.reason} />
        </Panel>
      ),
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <a href="/" className="text-sm text-muted-foreground hover:underline">
            Back to projects
          </a>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{report.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <a href={`https://github.com/${report.repo}`} className="hover:underline">
              {report.repo}
            </a>{' '}
            · {monthName(current)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {months.map((month) => (
            <a
              key={month}
              href={`/projects/${report.project}/${month}/`}
              className={
                month === current
                  ? 'rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground'
                  : 'rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent'
              }
            >
              {month}
            </a>
          ))}
        </div>
      </div>

      {engineeringMonth !== current ? (
        <p className="text-sm text-muted-foreground">
          Engineering scorecard and excellence show {monthName(engineeringMonth)}, the newest
          collected month; delivery shows {monthName(current)}, the latest month with releases.
        </p>
      ) : null}

      <ProjectTabs tabs={tabs} />

      {report.warnings.length > 0 ? <NotesPanel report={report} /> : null}
    </div>
  )
}
