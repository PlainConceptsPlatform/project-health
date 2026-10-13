'use client'

import {
  ENV_LABEL,
  FILTERS,
  type PortfolioAlert,
  type PortfolioEnv,
  type PortfolioFilter,
  type PortfolioRow,
  type PortfolioSort,
  SORTS,
  matches,
  portfolioKpis,
  sortRows,
} from '@/shared/lib/portfolio'
import { LEVEL_BAR, typeLabel } from '@/shared/lib/scorecard'
import type { ProjectSummary } from '@/shared/lib/summary'
import { cn } from '@/shared/ui'
import { LevelBadge } from '@/shared/ui/scorecard'
import { Sparkline } from '@/shared/ui/sparkline'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { AlertTriangleIcon, ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'
import { ProjectGrid } from './grid'

const ALERT_TONE: Record<PortfolioAlert['severity'], string> = {
  red: 'bg-destructive/10 text-destructive',
  amber: 'bg-warning/15 text-warning-foreground dark:text-warning',
}

// PRO stands out, PRE is quieter, and no environment is plain text: it is an absence, not a tier.
const ENV_CHIP: Record<PortfolioEnv, string> = {
  pro: 'rounded-md border border-transparent bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary',
  pre: 'rounded-md border border-muted-foreground/40 px-2 py-0.5 text-xs font-semibold text-muted-foreground',
  none: 'text-sm text-muted-foreground',
}

function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 border px-3.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-background text-foreground hover:bg-muted',
        className,
      )}
    >
      {children}
    </button>
  )
}

function Kpi({
  label,
  value,
  unit,
  hint,
  critical,
}: {
  label: string
  value: React.ReactNode
  unit?: string
  hint: string
  critical?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-xl border p-4',
        critical && 'border-destructive/30 bg-destructive/5',
      )}
    >
      <span
        className={cn('text-sm text-muted-foreground', critical && 'font-medium text-destructive')}
      >
        {label}
      </span>
      <span className={cn('text-3xl font-semibold tabular-nums', critical && 'text-destructive')}>
        {value}
        {unit ? <span className="text-base font-normal text-muted-foreground"> {unit}</span> : null}
      </span>
      <span className={cn('text-sm text-muted-foreground', critical && 'text-destructive/80')}>
        {hint}
      </span>
    </div>
  )
}

function AlertPill({ alert }: { alert: PortfolioAlert }) {
  return (
    <span
      title={alert.detail}
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-2 text-xs font-semibold',
        ALERT_TONE[alert.severity],
      )}
    >
      <AlertTriangleIcon className="size-3" aria-hidden="true" />
      {alert.text}
    </span>
  )
}

function AiSquares({ row }: { row: PortfolioRow }) {
  const usage = row.card?.aiUsage
  if (!usage?.available) {
    return (
      <span
        className="text-sm text-muted-foreground"
        title={usage?.available === false ? usage.reason : undefined}
      >
        No data
      </span>
    )
  }
  const { level, aiCommits, totalCommits, share } = usage.data
  const title = `AI usage ${level} of 5 · ${aiCommits} of ${totalCommits} commits AI-assisted (${Math.round(share * 100)}%)`
  return (
    <span className="flex gap-1" title={title} role="img" aria-label={title}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={cn('size-2.5 rounded-[2px]', i < level ? 'bg-primary' : 'bg-muted')}
        />
      ))}
    </span>
  )
}

function Delta({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-sm text-muted-foreground">n/a</span>
  const label = delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '0'
  return (
    <span
      className={cn(
        'w-8 text-sm font-semibold tabular-nums',
        delta < 0 ? 'text-destructive' : delta === 0 ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      {label}
    </span>
  )
}

/**
 * The whole row opens the project. The name and the chevron stay real links, so keyboard and
 * screen-reader users keep a focusable target and a click on either is left to the browser.
 * Cmd/Ctrl-click opens a new tab, as it would on a link.
 */
function openRow(e: React.MouseEvent<HTMLTableRowElement>, href: string) {
  if ((e.target as HTMLElement).closest('a, button')) return
  if (window.getSelection()?.toString()) return
  if (e.metaKey || e.ctrlKey) window.open(href, '_blank', 'noopener')
  else window.location.assign(href)
}

const COLUMNS = ['Project', 'Environment', 'Engineering', 'Gates', 'AI usage', 'Last 3 months', '']

function ScorecardRows({
  rows,
  typeLabels,
}: { rows: PortfolioRow[]; typeLabels: Record<string, string> }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[1000px] text-sm">
        <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <tr>
            {COLUMNS.map((c) => (
              <th key={c || 'open'} scope="col" className="px-4 py-3 font-semibold">
                {c ? c : <span className="sr-only">Open</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const card = row.card
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: a mouse shortcut only; the project name link in the row is the keyboard and screen-reader path
              <tr
                key={row.id}
                onClick={(e) => openRow(e, `/projects/${row.id}/`)}
                className={cn(
                  'cursor-pointer border-t align-middle transition-colors hover:bg-muted/60',
                  row.risk === 0 && 'bg-destructive/[0.03]',
                )}
              >
                <td className="px-4 py-3.5">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`/projects/${row.id}/`}
                        className="text-[15px] font-semibold hover:underline"
                      >
                        {row.name}
                      </a>
                      {card && !card.facetsPublished ? (
                        <span
                          title="No facets published: values detected from workflows"
                          className="rounded border border-dashed border-muted-foreground/60 px-1.5 text-[11px] text-muted-foreground"
                        >
                          inferred
                        </span>
                      ) : null}
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {card ? typeLabel(card.projectType, typeLabels) : row.repo}
                    </span>
                    {row.alert ? <AlertPill alert={row.alert} /> : null}
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <span
                    className={cn('inline-flex whitespace-nowrap', ENV_CHIP[row.env])}
                    title={
                      row.environment?.available
                        ? row.environment.data.environments
                            .map(
                              (e) =>
                                `${e.name}: ${e.tier ?? 'unknown'} (${e.resourceGroup ?? 'from the environment name'})`,
                            )
                            .join('\n')
                        : row.environment?.reason
                    }
                  >
                    {ENV_LABEL[row.env]}
                  </span>
                </td>
                {card ? (
                  <>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <LevelBadge level={card.level} />
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              'h-1.5 rounded-full',
                              LEVEL_BAR[card.level] ?? LEVEL_BAR[0],
                            )}
                            style={{ width: `${card.score ?? 0}%` }}
                          />
                        </div>
                        <span className="w-7 text-right tabular-nums">{card.score ?? 'n/a'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div
                        className="flex flex-col gap-1.5"
                        title={`${card.gates.present} of ${card.gates.applicable} applicable gates pass`}
                      >
                        <span className="tabular-nums">
                          {row.gatesPct === null ? 'n/a' : `${row.gatesPct}%`}
                        </span>
                        <div className="h-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-1 bg-muted-foreground"
                            style={{ width: `${row.gatesPct ?? 0}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <AiSquares row={row} />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <Sparkline
                          points={row.trend}
                          width={96}
                          label={`${row.name} engineering score`}
                          tone={row.delta !== null && row.delta < 0 ? 'down' : 'default'}
                        />
                        <Delta delta={row.delta} />
                      </div>
                    </td>
                  </>
                ) : (
                  <td colSpan={4} className="px-4 py-3.5 text-xs text-muted-foreground">
                    {row.reason}
                  </td>
                )}
                <td className="px-2 py-3.5">
                  <a
                    href={`/projects/${row.id}/`}
                    aria-label={`Open ${row.name}`}
                    className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronRightIcon className="size-4" aria-hidden="true" />
                  </a>
                </td>
              </tr>
            )
          })}
          {rows.length === 0 ? (
            <tr className="border-t">
              <td colSpan={COLUMNS.length} className="px-4 py-8 text-center text-muted-foreground">
                No projects match this filter.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The portfolio at a glance: who meets the standard, who is live without it, and where to look
 * first. Filters and sort are client state; every number is derived from the collected reports.
 */
export function Portfolio({
  rows,
  typeLabels,
  projects,
  byMonth,
}: {
  rows: PortfolioRow[]
  typeLabels: Record<string, string>
  projects: ProjectSummary[]
  byMonth: Record<string, ProjectSummary[]>
}) {
  const [showInfo, setShowInfo] = useState(false)
  const [filter, setFilter] = useState<PortfolioFilter>('all')
  const [sort, setSort] = useState<PortfolioSort>('risk')
  const [tab, setTab] = useState('scorecard')

  const kpi = portfolioKpis(rows)
  const attention = sortRows(
    rows.filter((r) => r.risk < 2),
    'risk',
  )
  const visible = sortRows(
    rows.filter((r) => matches(r, filter)),
    sort,
  )
  const counts = Object.fromEntries(
    FILTERS.map((f) => [f.key, rows.filter((r) => matches(r, f.key)).length]),
  )

  return (
    <div className="flex flex-col gap-7">
      <section className="flex flex-col gap-2.5">
        <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[15px] text-muted-foreground">
            Engineering practices and AI adoption for every project, read from GitHub.
          </p>
          <button
            type="button"
            aria-expanded={showInfo}
            onClick={() => setShowInfo((v) => !v)}
            className="text-sm font-medium text-primary underline underline-offset-4"
          >
            {showInfo ? 'Hide details' : 'How is this calculated?'}
          </button>
        </div>
        {showInfo ? (
          <div className="flex max-w-3xl flex-col gap-2 rounded-lg border bg-muted/40 px-4 py-4 text-sm leading-relaxed text-muted-foreground">
            <p>
              Eleven engineering practices per project, read from the engineering excellence facets
              a repository publishes or detected in its workflows on the default branch. Projects
              marked “inferred” do not publish facets, so their values come from workflow detection.
            </p>
            <p>
              Gates are shown as a share of the gates that apply to each project type, so projects
              of different types can be compared. The environment is the furthest one the
              application has deployed to successfully, read from the name of its resource group.
            </p>
            <p>
              Delivery shows three of the five DORA metrics. Change fail rate and failed deployment
              recovery time need production incident data, which GitHub does not record, so they are
              not shown rather than estimated.
            </p>
          </div>
        ) : null}
      </section>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-4">
        <Kpi
          label="At level N3"
          value={kpi.n3}
          unit={`/ ${kpi.total}`}
          hint="projects meet the full standard"
        />
        <Kpi
          label="In production below N1"
          value={kpi.critical}
          hint="live with almost no gates"
          critical={kpi.critical > 0}
        />
        <Kpi
          label="AI usage, average"
          value={kpi.aiAverage === null ? 'n/a' : kpi.aiAverage.toFixed(1)}
          unit="/ 5"
          hint={`across ${kpi.aiCount} projects with data`}
        />
        <Kpi
          label="Trend, last 3 months"
          value={kpi.up}
          unit="improving"
          hint={`${kpi.flat} flat · ${kpi.down} declining`}
        />
      </section>

      {attention.length > 0 ? (
        <section className="flex flex-col gap-3.5 rounded-xl border px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">
              Needs attention{' '}
              <span className="font-medium text-muted-foreground">({attention.length})</span>
            </h2>
            <Chip
              active={false}
              className="min-h-11 rounded-lg"
              onClick={() => {
                setTab('scorecard')
                setFilter('attention')
                setSort('risk')
              }}
            >
              Show only these
            </Chip>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
            {attention.map((row) =>
              row.alert ? (
                <a
                  key={row.id}
                  href={`/projects/${row.id}/`}
                  className={cn(
                    'flex items-start gap-2.5 rounded-lg p-3 transition hover:opacity-90',
                    ALERT_TONE[row.alert.severity],
                  )}
                >
                  <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-foreground">{row.name}</span>
                    <span className="text-sm">{row.alert.text}</span>
                    <span className="text-xs text-muted-foreground">{row.alert.detail}</span>
                  </span>
                </a>
              ) : null,
            )}
          </div>
        </section>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="scorecard">Engineering scorecard</TabsTrigger>
            <TabsTrigger value="delivery">Delivery</TabsTrigger>
          </TabsList>
          {tab === 'scorecard' ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Sort by</span>
              {SORTS.map((s) => (
                <Chip
                  key={s.key}
                  active={sort === s.key}
                  className="min-h-9 rounded-full"
                  onClick={() => setSort(s.key)}
                >
                  {s.label}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>
        <TabsContent value="scorecard" className="flex flex-col gap-4">
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">Filter projects</legend>
            {FILTERS.map((f) => (
              <Chip
                key={f.key}
                active={filter === f.key}
                className="min-h-11 rounded-lg"
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className="text-xs tabular-nums opacity-80">{counts[f.key]}</span>
              </Chip>
            ))}
          </fieldset>
          <ScorecardRows rows={visible} typeLabels={typeLabels} />
          <p className="text-sm text-muted-foreground">
            Hover a value for its counts. Open a project for the gate-by-gate breakdown.
          </p>
        </TabsContent>
        <TabsContent value="delivery">
          <ProjectGrid projects={projects} byMonth={byMonth} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
