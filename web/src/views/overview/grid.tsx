'use client'

import { hours, monthName, percent, seconds, tokens } from '@/shared/lib/format'
import {
  type Filters,
  type ProjectSummary,
  SORT_LABELS,
  type SortKey,
  filterSummaries,
  sortSummaries,
} from '@/shared/lib/summary'
import { withBase } from '@/shared/lib/utils'
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  InfoTip,
  Stat,
  Unavailable,
  cn,
} from '@/shared/ui'
import { useMemo, useState } from 'react'

const STATUSES: { key: Filters['status']; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'production', label: 'Production' },
  { key: 'pre-production', label: 'Pre-production' },
  { key: 'planned', label: 'Planned' },
]

/** The sentinel for "no month picked", which is the default and is not itself a month. */
const LATEST = 'latest'

const statusBadge = (status: ProjectSummary['status']) =>
  status === 'production'
    ? { variant: 'default' as const, label: 'Production' }
    : status === 'pre-production'
      ? { variant: 'secondary' as const, label: 'Pre-production' }
      : { variant: 'outline' as const, label: 'Planned' }

function ProjectCard({ p, month }: { p: ProjectSummary; month: string | null }) {
  const badge = statusBadge(p.status)

  return (
    <a
      href={withBase(month ? `/projects/${p.id}/${month}/` : `/projects/${p.id}/`)}
      className="group block rounded-xl outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="h-full transition group-hover:border-primary/40 group-hover:shadow-md">
        <CardHeader>
          <CardTitle className="group-hover:text-primary">{p.name}</CardTitle>
          <CardDescription>
            {p.repo}
            {p.month ? ` · ${monthName(p.month)}` : null}
          </CardDescription>
          <div className="col-start-2 row-span-2 row-start-1 self-start">
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          {p.status === 'planned' ? (
            <Unavailable
              reason={
                p.months.length > 0
                  ? 'On the roadmap and not deployed yet, so delivery is not measured. Its Engineering scorecard is collected from the repository.'
                  : 'On the roadmap. Nothing is collected until its repository exists.'
              }
            />
          ) : !p.hasData ? (
            <Unavailable
              reason={
                month
                  ? `Nothing was collected for ${monthName(month)}. The project may not have existed yet, or simply had a quiet month.`
                  : 'Nothing has been collected for this project yet. Run the backfill workflow, or wait for the daily collection.'
              }
            />
          ) : (
            <>
              {p.group === 'tooling' ? (
                <p className="text-xs text-muted-foreground">
                  Platform tooling is not deployed to PRE/PRO, so deploy frequency, lead time and
                  rework rate do not apply. Its Engineering scorecard is collected as usual.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
                  {p.perWeek === null ? (
                    <Stat
                      label="Deploy frequency"
                      explain="deployFrequency"
                      value="n/a"
                      tone="muted"
                      hint="no production"
                    />
                  ) : (
                    <Stat
                      label="Deploy frequency"
                      explain="deployFrequency"
                      value={`${p.perWeek}/wk`}
                      hint={`${p.releases} release${p.releases === 1 ? '' : 's'}${p.partialMonth ? ', month in progress' : ''}`}
                    />
                  )}

                  <Stat
                    label="Lead time p50"
                    explain="leadTime"
                    value={p.leadTimeP50Hours === null ? 'n/a' : hours(p.leadTimeP50Hours)}
                    tone={p.leadTimeP50Hours === null ? 'muted' : undefined}
                    hint={
                      p.leadTimeP50Hours === null
                        ? (p.reasons.leadTime ?? 'not measured')
                        : 'commit to production'
                    }
                  />

                  {p.reworkMarked && p.reworkRate !== null ? (
                    <Stat
                      label="Rework rate"
                      explain="reworkRate"
                      value={percent(p.reworkRate)}
                      hint={p.reworkLabel ? `via the ${p.reworkLabel} label` : undefined}
                      tone={p.reworkRate > 0.15 ? 'bad' : undefined}
                    />
                  ) : (
                    <Stat
                      label="Rework rate"
                      explain="reworkRate"
                      value="Unmarked"
                      tone="muted"
                      hint={
                        p.reasons.rework ??
                        (p.reworkLabel ? `no ${p.reworkLabel} label found` : 'no marker configured')
                      }
                    />
                  )}
                </div>
              )}

              <div className="border-t pt-4">
                {p.agentRuns ? (
                  <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
                    <Stat label="Agent runs" explain="agentRuns" value={p.agentRuns} />
                    <Stat
                      label="Agent tokens"
                      explain="agentTokens"
                      value={tokens(p.agentTokens ?? 0)}
                      hint={
                        p.agentMeasured !== null && p.agentMeasured < p.agentRuns
                          ? `measured ${p.agentMeasured}/${p.agentRuns}`
                          : 'input plus output'
                      }
                    />
                    <Stat
                      label="Agent time"
                      explain="agentTime"
                      value={seconds(p.agentSeconds ?? 0)}
                      hint="OpenCode execution"
                    />
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {p.reasons.agents ?? 'No agent runs in this period.'}
                  </p>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                {p.months.length} month{p.months.length === 1 ? '' : 's'} collected · view detail
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </a>
  )
}

const control =
  'h-9 rounded-md border bg-background px-3 text-sm text-foreground outline-none transition focus-visible:ring-2 focus-visible:ring-ring'

export function ProjectGrid({
  projects,
  byMonth,
}: {
  projects: ProjectSummary[]
  byMonth: Record<string, ProjectSummary[]>
}) {
  const [sort, setSort] = useState<SortKey>('status')
  const [month, setMonth] = useState<string>(LATEST)
  const [filters, setFilters] = useState<Filters>({
    status: 'all',
    search: '',
    agentsOnly: false,
    withDataOnly: false,
  })

  const months = useMemo(() => Object.keys(byMonth).sort().reverse(), [byMonth])

  /**
   * The default is not the newest month. On the first of a month every project reads as empty, so
   * each card falls back to its own most recent month with activity, which is why this set can mix
   * months. Picking a month explicitly shows that one month for everybody.
   */
  const source = month === LATEST ? projects : (byMonth[month] ?? [])

  const shown = useMemo(
    () => sortSummaries(filterSummaries(source, filters), sort),
    [source, filters, sort],
  )

  const counts = useMemo(() => {
    const by = { all: source.length, production: 0, 'pre-production': 0, planned: 0 }
    for (const p of source) by[p.status] += 1
    return by
  }, [source])

  return (
    <div className="space-y-5">
      {/* One row of controls above the grid, so the whole set is visible at once. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {STATUSES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setFilters((f) => ({ ...f, status: s.key }))}
              aria-pressed={filters.status === s.key}
              className={cn(
                'h-9 rounded-md border px-3 text-sm transition',
                filters.status === s.key
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {s.label}
              <span className="ml-1.5 tabular-nums opacity-70">{counts[s.key]}</span>
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Month
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            aria-label="Show a specific month"
            className={control}
          >
            <option value={LATEST}>Latest activity</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
        </label>

        <input
          type="search"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          placeholder="Filter by name"
          aria-label="Filter projects by name"
          className={cn(control, 'w-44')}
        />

        <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground transition hover:bg-accent hover:text-accent-foreground">
          <input
            type="checkbox"
            checked={filters.agentsOnly}
            onChange={(e) => setFilters((f) => ({ ...f, agentsOnly: e.target.checked }))}
            className="size-3.5 accent-primary"
          />
          Runs agents
        </label>

        <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground transition hover:bg-accent hover:text-accent-foreground">
          <input
            type="checkbox"
            checked={filters.withDataOnly}
            onChange={(e) => setFilters((f) => ({ ...f, withDataOnly: e.target.checked }))}
            className="size-3.5 accent-primary"
          />
          Has data
        </label>

        <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort projects"
            className={control}
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {shown.length === 0 ? (
        <Unavailable reason="No project matches these filters." />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {shown.length} of {source.length} project
            {source.length === 1 ? '' : 's'}
            {month === LATEST
              ? ', each on its own most recent month with activity'
              : ` for ${monthName(month)}`}
            . Projects that cannot report the sorted number are listed last rather than treated as
            zero.
          </p>
          <div className="grid gap-5 lg:grid-cols-2">
            {shown.map((p) => (
              <ProjectCard key={p.id} p={p} month={month === LATEST ? null : month} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
