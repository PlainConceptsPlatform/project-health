'use client'

import { type ActionsRow, flaggedCount } from '@/shared/lib/actions'
import type { AgenticRow } from '@/shared/lib/agentic'
import type { CodeRow } from '@/shared/lib/code'
import {
  DELTA_DAYS,
  DELTA_TITLE,
  type DeltaBasis,
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
import { ActionsTable } from './actions'
import { AgenticTable } from './agentic'
import { CodeTable } from './code'
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

/** A medium figure over a thin bar: Gates and AI usage share it so they read at the same weight. */
function Measure({
  value,
  of,
  tone,
  title,
  children,
}: {
  value: number
  of: number
  tone?: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5" title={title}>
      <span className={cn('text-sm font-semibold tabular-nums', tone)}>
        {value}
        <span className="font-medium text-muted-foreground">/{of}</span>
      </span>
      {children}
    </div>
  )
}

function AiUsage({ row }: { row: PortfolioRow }) {
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
  return (
    <Measure
      value={level}
      of={5}
      title={`AI usage ${level} of 5 · ${aiCommits} of ${totalCommits} commits AI-assisted (${Math.round(share * 100)}%)`}
    >
      <span className="flex gap-[3px]" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn('h-[5px] flex-1 rounded-full', i < level ? 'bg-primary' : 'bg-muted')}
          />
        ))}
      </span>
    </Measure>
  )
}

/** Passing share of applicable gates: under half is red, under 80% amber. */
const gatesBar = (pct: number) =>
  pct >= 80 ? 'bg-primary' : pct >= 50 ? 'bg-warning' : 'bg-destructive'

function Delta({ delta, basis }: { delta: number | null; basis: DeltaBasis }) {
  if (delta === null) return <span className="text-sm text-muted-foreground">n/a</span>
  const label = delta > 0 ? `+${delta}` : delta < 0 ? `−${Math.abs(delta)}` : '0'
  return (
    <span
      title={DELTA_TITLE[basis]}
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

const COLUMNS = ['Project', 'Engineering', 'Gates', 'AI usage', `Last ${DELTA_DAYS} days`, '']

function ScorecardRows({
  rows,
  typeLabels,
}: { rows: PortfolioRow[]; typeLabels: Record<string, string> }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full min-w-[960px] table-fixed text-sm">
        <colgroup>
          <col className="w-[22%]" />
          <col className="w-[26%]" />
          <col className="w-[16%]" />
          <col className="w-[16%]" />
          <col className="w-[150px]" />
          <col className="w-[56px]" />
        </colgroup>
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
                {card ? (
                  <>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2.5">
                          <LevelBadge level={card.level} />
                          <span className="text-xl font-semibold tabular-nums">
                            {card.score ?? 'n/a'}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              'h-2 rounded-full',
                              LEVEL_BAR[card.level] ?? LEVEL_BAR[0],
                            )}
                            style={{ width: `${card.score ?? 0}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <Measure
                        value={card.gates.present}
                        of={card.gates.applicable}
                        tone={
                          row.gatesPct !== null && row.gatesPct < 50
                            ? 'text-destructive'
                            : undefined
                        }
                        title={`${card.gates.present} of ${card.gates.applicable} applicable gates pass`}
                      >
                        <div className="h-[5px] overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn('h-[5px] rounded-full', gatesBar(row.gatesPct ?? 0))}
                            style={{ width: `${row.gatesPct ?? 0}%` }}
                          />
                        </div>
                      </Measure>
                    </td>
                    <td className="px-4 py-3.5">
                      <AiUsage row={row} />
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <Sparkline
                          points={row.trend}
                          width={96}
                          label={`${row.name} engineering score, last 6 months`}
                          tone={row.delta !== null && row.delta < 0 ? 'down' : 'default'}
                        />
                        <Delta delta={row.delta} basis={row.deltaBasis} />
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
  agentic,
  code,
  actions = [],
}: {
  rows: PortfolioRow[]
  typeLabels: Record<string, string>
  projects: ProjectSummary[]
  byMonth: Record<string, ProjectSummary[]>
  agentic: AgenticRow[]
  code: CodeRow[]
  actions?: ActionsRow[]
}) {
  const [showInfo, setShowInfo] = useState(false)
  const [filter, setFilter] = useState<PortfolioFilter>('all')
  const [sort, setSort] = useState<PortfolioSort>('risk')
  const [tab, setTab] = useState('scorecard')

  const kpi = portfolioKpis(rows)
  const actionsFlagged = flaggedCount(actions)
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
          label="Gates passing, average"
          value={kpi.gatesAverage === null ? 'n/a' : `${kpi.gatesAverage}%`}
          hint={`${kpi.n3} of ${kpi.total} projects at L3`}
        />
        <Kpi
          label="In production below L1"
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
          label="Production at L3"
          value={kpi.proN3}
          unit={`/ ${kpi.pro}`}
          hint="live projects meeting the full standard"
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
            <TabsTrigger value="agentic">Agentic</TabsTrigger>
            <TabsTrigger value="code">Code</TabsTrigger>
            <TabsTrigger value="actions">
              Actions
              {actionsFlagged > 0 ? (
                <span
                  title={`${actionsFlagged} project(s) over an Actions threshold`}
                  className="ml-1.5 rounded-full bg-destructive/10 px-1.5 text-xs font-semibold text-destructive tabular-nums"
                >
                  {actionsFlagged}
                </span>
              ) : null}
            </TabsTrigger>
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
        <TabsContent value="agentic">
          <AgenticTable rows={agentic} />
        </TabsContent>
        <TabsContent value="code">
          <CodeTable rows={code} />
        </TabsContent>
        <TabsContent value="actions">
          <ActionsTable rows={actions} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
