'use client'

import { type ActionsRow, flaggedCount } from '@/shared/lib/actions'
import type { AgenticRow } from '@/shared/lib/agentic'
import type { CodeRow } from '@/shared/lib/code'
import type { FamilyRow } from '@/shared/lib/family'
import {
  DELTA_DAYS,
  DELTA_TITLE,
  type DeltaBasis,
  ENV_LABEL,
  type PortfolioAlert,
  type PortfolioEnv,
  type PortfolioRow,
  type PortfolioSort,
  byGroup,
  portfolioKpis,
  sortRows,
} from '@/shared/lib/portfolio'
import {
  type PortfolioQuery,
  type RowContext,
  emptyQuery,
  formatQuery,
  matchesQuery,
  parseQuery,
} from '@/shared/lib/portfolio-query'
import { GROUP_LABEL, LEVEL_BAR, typeLabel } from '@/shared/lib/scorecard'
import type { ProjectSummary } from '@/shared/lib/summary'
import type { ProjectFamily } from '@/shared/lib/types'
import { rememberOverviewQuery } from '@/shared/lib/url-state'
import { withBase } from '@/shared/lib/utils'
import { cn } from '@/shared/ui'
import { LevelBadge } from '@/shared/ui/scorecard'
import { Sparkline } from '@/shared/ui/sparkline'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActionsTable } from './actions'
import { AgenticTable } from './agentic'
import { CodeTable } from './code'
import { FamilyTable } from './family'
import { Chip, FilterBar } from './filter-bar'
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
  na: 'text-sm text-muted-foreground',
}

const envTitle = (row: PortfolioRow) =>
  row.env === 'na'
    ? 'Platform tooling is not deployed to PRE/PRO environments, so the environment does not apply.'
    : row.environment?.available
      ? row.environment.data.environments
          .map(
            (e) =>
              `${e.name}: ${e.tier ?? 'unknown'} (${e.resourceGroup ?? 'from the environment name'})`,
          )
          .join('\n')
      : row.environment?.reason

function Kpi({
  label,
  value,
  unit,
  hint,
  critical,
  onShow,
}: {
  label: string
  value: React.ReactNode
  unit?: string
  hint: string
  critical?: boolean
  /** Filters the list down to the projects this figure counts. */
  onShow?: () => void
}) {
  const Box = onShow ? 'button' : 'div'
  return (
    <Box
      {...(onShow ? { type: 'button' as const, onClick: onShow } : {})}
      className={cn(
        'flex flex-col gap-1.5 rounded-xl border p-3 text-left sm:p-4',
        critical && 'border-destructive/30 bg-destructive/5',
        onShow &&
          'cursor-pointer transition hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
        {onShow ? <span className="font-medium underline underline-offset-4"> · show</span> : null}
      </span>
    </Box>
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
  const window = row.card?.window
  return (
    <Measure
      value={level}
      of={5}
      title={`AI usage ${level} of 5 · ${aiCommits} of ${totalCommits} commits AI-assisted (${Math.round(share * 100)}%)${window ? ` in the last ${window.days} days` : ''}`}
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
  const url = withBase(href)
  if (e.metaKey || e.ctrlKey) window.open(url, '_blank', 'noopener')
  else window.location.assign(url)
}

/**
 * The table's columns. A column with sorts sorts the list from its header: the first click picks the
 * first sort, a second click on the same header the second one (score high to low, then low to high).
 */
const COLUMNS: { label: string; sorts?: PortfolioSort[]; className?: string }[] = [
  { label: 'Project', sorts: ['name'] },
  { label: 'Engineering', sorts: ['engineering', 'engineering-asc'] },
  { label: 'Gates', sorts: ['gates'] },
  { label: 'AI usage', className: 'hidden lg:table-cell' },
  { label: `Last ${DELTA_DAYS} days`, sorts: ['trend'] },
  { label: '' },
]

/** What aria-sort says for a column, given the active sort. */
function ariaSort(sorts: PortfolioSort[] | undefined, sort: PortfolioSort) {
  if (!sorts?.includes(sort)) return undefined
  return sort === 'engineering' ? 'descending' : 'ascending'
}

function SortHeader({
  label,
  sorts,
  sort,
  onSort,
}: {
  label: string
  sorts: PortfolioSort[]
  sort: PortfolioSort
  onSort: (sort: PortfolioSort) => void
}) {
  const at = sorts.indexOf(sort)
  const next = sorts[(at + 1) % sorts.length] ?? sorts[0]
  const Arrow = sort === 'engineering' ? ArrowDownIcon : ArrowUpIcon
  return (
    <button
      type="button"
      onClick={() => next && onSort(next)}
      className="-mx-1 inline-flex items-center gap-1 rounded px-1 uppercase tracking-wide hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
      {at >= 0 ? <Arrow className="size-3" aria-hidden="true" /> : null}
    </button>
  )
}

const projectHref = (row: PortfolioRow) => `/projects/${row.id}/`

function EnvChip({ row }: { row: PortfolioRow }) {
  return (
    <span className={cn('inline-flex whitespace-nowrap', ENV_CHIP[row.env])} title={envTitle(row)}>
      {ENV_LABEL[row.env]}
    </span>
  )
}

function Inferred({ row }: { row: PortfolioRow }) {
  return row.card && !row.card.facetsPublished ? (
    <span
      title="No facets published: values detected from workflows"
      className="rounded border border-dashed border-muted-foreground/60 px-1.5 text-[11px] text-muted-foreground"
    >
      inferred
    </span>
  ) : null
}

function Engineering({ row }: { row: PortfolioRow }) {
  const card = row.card
  if (!card) return null
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5">
        <LevelBadge level={card.level} />
        <span className="text-xl font-semibold tabular-nums">{card.score ?? 'n/a'}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-2 rounded-full', LEVEL_BAR[card.level] ?? LEVEL_BAR[0])}
          style={{ width: `${card.score ?? 0}%` }}
        />
      </div>
    </div>
  )
}

function Gates({ row }: { row: PortfolioRow }) {
  const card = row.card
  if (!card) return null
  return (
    <Measure
      value={card.gates.present}
      of={card.gates.applicable}
      tone={row.gatesPct !== null && row.gatesPct < 50 ? 'text-destructive' : undefined}
      title={`${card.gates.present} of ${card.gates.applicable} applicable gates pass`}
    >
      <div className="h-[5px] overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-[5px] rounded-full', gatesBar(row.gatesPct ?? 0))}
          style={{ width: `${row.gatesPct ?? 0}%` }}
        />
      </div>
    </Measure>
  )
}

/** The table, from a tablet up. Below that the same rows render as ProjectCards. */
function ScorecardRows({
  rows,
  typeLabels,
  sort,
  onSort,
}: {
  rows: PortfolioRow[]
  typeLabels: Record<string, string>
  sort: PortfolioSort
  onSort: (sort: PortfolioSort) => void
}) {
  return (
    <div className="hidden rounded-xl border md:block">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-[30%] lg:w-[26%]" />
          <col className="w-[26%] lg:w-[22%]" />
          <col className="w-[18%] lg:w-[14%]" />
          <col className="hidden lg:table-column lg:w-[14%]" />
          <col className="w-[150px]" />
          <col className="w-[56px]" />
        </colgroup>
        <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.label || 'open'}
                scope="col"
                aria-sort={ariaSort(c.sorts, sort)}
                className={cn('px-4 py-3 font-semibold', c.className)}
              >
                {!c.label ? (
                  <span className="sr-only">Open</span>
                ) : c.sorts ? (
                  <SortHeader label={c.label} sorts={c.sorts} sort={sort} onSort={onSort} />
                ) : (
                  c.label
                )}
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
                onClick={(e) => openRow(e, projectHref(row))}
                className={cn(
                  'cursor-pointer border-t align-middle transition-colors hover:bg-muted/60',
                  row.risk === 0 && 'bg-destructive/[0.03]',
                )}
              >
                <td className="px-4 py-3.5">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={withBase(projectHref(row))}
                        className="text-[15px] font-semibold hover:underline"
                      >
                        {row.name}
                      </a>
                      <EnvChip row={row} />
                      <Inferred row={row} />
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
                      <Engineering row={row} />
                    </td>
                    <td className="px-4 py-3.5">
                      <Gates row={row} />
                    </td>
                    <td className="hidden px-4 py-3.5 lg:table-cell">
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
                    href={withBase(projectHref(row))}
                    aria-label={`Open ${row.name}`}
                    className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronRightIcon className="size-4" aria-hidden="true" />
                  </a>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The phone layout: one card per project, the whole card a link. AI usage is left to the project
 * page; level, score, gates and the 30-day change are what decide whether to open it.
 */
function ProjectCards({
  rows,
  typeLabels,
}: { rows: PortfolioRow[]; typeLabels: Record<string, string> }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0 md:hidden">
      {rows.map((row) => {
        const card = row.card
        return (
          <li key={row.id}>
            <a
              href={withBase(projectHref(row))}
              className={cn(
                'grid grid-cols-[1fr_auto] gap-2 rounded-xl border bg-card p-3.5 transition-colors hover:bg-muted/60 hover:no-underline',
                row.risk === 0 && 'border-destructive/35',
              )}
            >
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
                <span className="text-base font-semibold">{row.name}</span>
                <EnvChip row={row} />
                <Inferred row={row} />
              </span>
              <ChevronRightIcon className="mt-1 size-4 text-muted-foreground" aria-hidden="true" />
              <span className="col-span-2 -mt-1 text-[13px] text-muted-foreground">
                {card ? typeLabel(card.projectType, typeLabels) : row.repo}
              </span>
              {card ? (
                <span className="col-span-2 grid grid-cols-[1.3fr_1fr_1fr] items-end gap-3">
                  <Engineering row={row} />
                  <span className="flex flex-col">
                    <span className="mb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                      Gates
                    </span>
                    <Gates row={row} />
                  </span>
                  <span className="flex flex-col">
                    <span className="mb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {DELTA_DAYS} days
                    </span>
                    <Delta delta={row.delta} basis={row.deltaBasis} />
                  </span>
                </span>
              ) : (
                <span className="col-span-2 text-xs text-muted-foreground">{row.reason}</span>
              )}
              {row.alert ? (
                <span className="col-span-2">
                  <AlertPill alert={row.alert} />
                </span>
              ) : null}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

/** The empty state when the filters hide every project: never a blank table. */
function NoMatch({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/40 px-4 py-3">
      <p className="text-sm font-medium text-muted-foreground">No project matches these filters</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Try fewer filters, or{' '}
        <button
          type="button"
          onClick={onClear}
          className="font-medium text-primary underline underline-offset-4"
        >
          clear them all
        </button>
        . Search and filters are part of the link, so a shared view opens the same way.
      </p>
    </div>
  )
}

const TABS = ['scorecard', 'delivery', 'agentic', 'code', 'actions', 'family'] as const

/**
 * The current view as a query string: the scorecard's search, filters and sort, plus the tab when it
 * is not the scorecard. Read once on load and written back on every change, so the address bar is
 * always a link to what is on screen. replaceState keeps the history to one entry per visit.
 */
function useUrlState(defaultTab: string) {
  const [query, setQuery] = useState<PortfolioQuery>(emptyQuery)
  const [tab, setTab] = useState(defaultTab)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const search = window.location.search
    setQuery(parseQuery(search))
    const t = new URLSearchParams(search).get('tab')
    if (t && (TABS as readonly string[]).includes(t)) setTab(t)
    setLoaded(true)
  }, [])

  const queryString = useMemo(
    () => formatQuery(query, tab === defaultTab ? {} : { tab }),
    [query, tab, defaultTab],
  )

  useEffect(() => {
    if (!loaded) return
    const search = queryString ? `?${queryString}` : ''
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${search}${window.location.hash}`,
    )
    // "Back to projects" on a project page reopens this exact view.
    rememberOverviewQuery(search)
  }, [queryString, loaded])

  const shareUrl = useCallback(
    () =>
      `${window.location.origin}${window.location.pathname}${queryString ? `?${queryString}` : ''}`,
    [queryString],
  )

  return { query, setQuery, tab, setTab, shareUrl }
}

/**
 * The portfolio at a glance: who meets the standard, who is live without it, and where to look
 * first. Search, filters, sort and the tab are client state kept in the query string; every number
 * is derived from the collected reports.
 */
export function Portfolio({
  rows,
  typeLabels,
  projects,
  byMonth,
  agentic,
  code,
  actions = [],
  family = [],
  familyOf = {},
}: {
  rows: PortfolioRow[]
  typeLabels: Record<string, string>
  projects: ProjectSummary[]
  byMonth: Record<string, ProjectSummary[]>
  agentic: AgenticRow[]
  code: CodeRow[]
  actions?: ActionsRow[]
  /** Projects in a family; the tab is left out when none is. */
  family?: FamilyRow[]
  /** Each project's place in a family, for the Family filter; absent means no family. */
  familyOf?: Record<string, ProjectFamily>
}) {
  const [showInfo, setShowInfo] = useState(false)
  const { query, setQuery, tab, setTab, shareUrl } = useUrlState('scorecard')

  const { applications, tooling } = byGroup(rows)
  const kpi = portfolioKpis(applications)
  const toolingKpi = portfolioKpis(tooling)
  const actionsFlagged = flaggedCount(actions)
  const expiredExceptions = family.filter(
    (r) => (r.drift?.exceptions.expired.length ?? 0) > 0,
  ).length
  const attention = sortRows(
    rows.filter((r) => r.risk < 2),
    'risk',
  )
  const hasFamily = Object.keys(familyOf).length > 0

  const contextOf = useCallback(
    (row: PortfolioRow): RowContext => ({
      typeLabel: row.card ? typeLabel(row.card.projectType, typeLabels) : undefined,
      family: familyOf[row.id] ?? null,
    }),
    [typeLabels, familyOf],
  )
  const shownApps = sortRows(
    applications.filter((r) => matchesQuery(r, query, contextOf(r))),
    query.sort,
  )
  const shownTooling = sortRows(
    tooling.filter((r) => matchesQuery(r, query, contextOf(r))),
    query.sort,
  )
  const shown = shownApps.length + shownTooling.length
  // Every tab lists the same projects: the filter bar picks them once and each tab keeps its own
  // columns and order. The sort belongs to the scorecard, the one list ranked by risk.
  const visible = new Set([...shownApps, ...shownTooling].map((r) => r.id))
  const pick = <T extends { id: string }>(list: T[]) => list.filter((r) => visible.has(r.id))
  const clear = () => setQuery({ ...emptyQuery(), sort: query.sort })
  const listed = <T extends { id: string }>(list: T[], render: (rows: T[]) => React.ReactNode) => {
    const kept = pick(list)
    return kept.length > 0 || list.length === 0 ? render(kept) : <NoMatch onClear={clear} />
  }
  const onlyAttention = query.alert.has('attention') && query.alert.size === 1

  return (
    <div className="flex flex-col gap-5 sm:gap-7">
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
              Twelve engineering practices per project, read from the engineering excellence facets
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
            <p>
              Libraries and static sites are platform tooling unless projects.json says otherwise.
              They are ranked and averaged apart from the applications, keep the engineering
              scorecard and the AI usage alert, and read not applicable for the environment and the
              delivery metrics that assume one.
            </p>
          </div>
        ) : null}
      </section>

      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(210px,1fr))] sm:gap-4">
        <Kpi
          label="Gates passing, average"
          value={kpi.gatesAverage === null ? 'n/a' : `${kpi.gatesAverage}%`}
          hint={`${kpi.n3} of ${kpi.total} applications at L3`}
        />
        <Kpi
          label="In production below L1"
          value={kpi.critical}
          hint="live with almost no gates"
          critical={kpi.critical > 0}
          onShow={
            kpi.critical > 0
              ? () => {
                  setTab('scorecard')
                  setQuery({ ...emptyQuery(), alert: new Set(['critical']) })
                }
              : undefined
          }
        />
        <Kpi
          label="AI usage, average"
          value={kpi.aiAverage === null ? 'n/a' : kpi.aiAverage.toFixed(1)}
          unit="/ 5"
          hint={`across ${kpi.aiCount} applications with data`}
        />
        <Kpi
          label="Production at L3"
          value={kpi.proN3}
          unit={`/ ${kpi.pro}`}
          hint="live projects meeting the full standard"
        />
      </section>

      {attention.length > 0 ? (
        // Collapsed unless something is critical: the alerts are on the rows too, so the strip is a
        // summary to open, not a second list to scroll past every visit.
        <details
          className="group rounded-xl border px-3.5 py-2.5 sm:px-5 sm:py-3.5"
          open={kpi.critical > 0 ? true : undefined}
        >
          <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <h2 className="flex items-center gap-1.5 text-base font-semibold">
              <ChevronDownIcon
                className="size-4 -rotate-90 text-muted-foreground transition-transform group-open:rotate-0"
                aria-hidden="true"
              />
              Needs attention{' '}
              <span className="font-medium text-muted-foreground">({attention.length})</span>
            </h2>
            <Chip
              active={onlyAttention}
              className="min-h-11 rounded-lg md:min-h-9"
              onClick={() => {
                setTab('scorecard')
                setQuery(
                  onlyAttention
                    ? { ...query, alert: new Set() }
                    : { ...emptyQuery(), alert: new Set(['attention']) },
                )
              }}
            >
              {onlyAttention ? 'Showing only these' : 'Show only these'}
            </Chip>
          </summary>
          <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2.5">
            {attention.map((row) =>
              row.alert ? (
                <a
                  key={row.id}
                  href={withBase(projectHref(row))}
                  className={cn(
                    'flex items-start gap-2.5 rounded-lg p-3 transition hover:no-underline hover:opacity-90',
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
        </details>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        {/*
          Sticky, so another tab is one click away from anywhere down a long list. The list scrolls
          inside itself on a phone instead of widening the page. 60 px tall on a phone and 52 px
          from md up: the filter bar below pins itself at exactly that offset.
        */}
        <div className="sticky top-0 z-30 -mx-4 bg-background px-4 py-2 sm:-mx-6 sm:px-6">
          <div className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsList className="h-11 md:h-9">
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
              {family.length > 0 ? (
                <TabsTrigger value="family">
                  Family
                  {expiredExceptions > 0 ? (
                    <span
                      title={`${expiredExceptions} project(s) with an expired family exception`}
                      className="ml-1.5 rounded-full bg-destructive/10 px-1.5 text-xs font-semibold text-destructive tabular-nums"
                    >
                      {expiredExceptions}
                    </span>
                  ) : null}
                </TabsTrigger>
              ) : null}
            </TabsList>
          </div>
        </div>
        <FilterBar
          rows={rows}
          query={query}
          onChange={setQuery}
          contextOf={contextOf}
          shown={shown}
          hasFamily={hasFamily}
          hasTooling={tooling.length > 0}
          shareUrl={shareUrl}
          sortable={tab === 'scorecard'}
        />
        <TabsContent value="scorecard" className="flex flex-col gap-4">
          {shownApps.length > 0 ? (
            <section className="flex flex-col gap-3.5">
              {tooling.length > 0 ? (
                <h2 className="text-base font-semibold">
                  {GROUP_LABEL.applications}{' '}
                  <span className="font-medium text-muted-foreground">({shownApps.length})</span>
                </h2>
              ) : null}
              <ScorecardRows
                rows={shownApps}
                typeLabels={typeLabels}
                sort={query.sort}
                onSort={(sort) => setQuery({ ...query, sort })}
              />
              <ProjectCards rows={shownApps} typeLabels={typeLabels} />
            </section>
          ) : null}
          {shownTooling.length > 0 ? (
            <section className="flex flex-col gap-4 pt-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-base font-semibold">
                  {GROUP_LABEL.tooling}{' '}
                  <span className="font-medium text-muted-foreground">({shownTooling.length})</span>
                </h2>
                <p className="text-sm text-muted-foreground">
                  Libraries, sites and other platform pieces, ranked apart from the applications.
                  They are not deployed to PRE/PRO, so environment based metrics do not apply.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(210px,1fr))] sm:gap-4">
                <Kpi
                  label="Gates passing, average"
                  value={toolingKpi.gatesAverage === null ? 'n/a' : `${toolingKpi.gatesAverage}%`}
                  hint={`${toolingKpi.n3} of ${toolingKpi.total} at L3`}
                />
                <Kpi
                  label="AI usage, average"
                  value={toolingKpi.aiAverage === null ? 'n/a' : toolingKpi.aiAverage.toFixed(1)}
                  unit="/ 5"
                  hint={`across ${toolingKpi.aiCount} with data`}
                />
              </div>
              <ScorecardRows
                rows={shownTooling}
                typeLabels={typeLabels}
                sort={query.sort}
                onSort={(sort) => setQuery({ ...query, sort })}
              />
              <ProjectCards rows={shownTooling} typeLabels={typeLabels} />
            </section>
          ) : null}
          {shown === 0 ? <NoMatch onClear={clear} /> : null}
          <p className="text-sm text-muted-foreground">
            Hover a value for its counts. Open a project for the gate-by-gate breakdown. Search,
            filters and sort are part of the link, so a shared view opens the same way.
          </p>
        </TabsContent>
        <TabsContent value="delivery">
          {listed(projects, (kept) => (
            <ProjectGrid
              projects={kept}
              byMonth={Object.fromEntries(
                Object.entries(byMonth).map(([month, list]) => [month, pick(list)]),
              )}
            />
          ))}
        </TabsContent>
        <TabsContent value="agentic">
          {listed(agentic, (kept) => (
            <AgenticTable rows={kept} />
          ))}
        </TabsContent>
        <TabsContent value="code">
          {listed(code, (kept) => (
            <CodeTable rows={kept} />
          ))}
        </TabsContent>
        <TabsContent value="actions">
          {listed(actions, (kept) => (
            <ActionsTable rows={kept} />
          ))}
        </TabsContent>
        {family.length > 0 ? (
          <TabsContent value="family">
            {listed(family, (kept) => (
              <FamilyTable rows={kept} />
            ))}
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  )
}
