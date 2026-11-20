'use client'

import { type PortfolioRow, type PortfolioSort, SORTS } from '@/shared/lib/portfolio'
import {
  ALERT_FILTERS,
  type AlertFilter,
  ENV_FILTERS,
  type EnvFilter,
  FAMILY_FILTERS,
  type FamilyFilter,
  LEVELS,
  type Level,
  type PortfolioQuery,
  type RowContext,
  activeFilterCount,
  chipCount,
  emptyQuery,
  toggle,
} from '@/shared/lib/portfolio-query'
import { GROUP_LABEL } from '@/shared/lib/scorecard'
import { cn } from '@/shared/ui'
import { LevelBadge } from '@/shared/ui/scorecard'
import { CheckIcon, LinkIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function Chip({
  active,
  onClick,
  children,
  className,
  ...rest
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'className' | 'children'>) {
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
      {...rest}
    >
      {children}
    </button>
  )
}

const RAG_DOT: Record<AlertFilter, string> = {
  critical: 'bg-destructive',
  attention: 'bg-warning',
  declining: '',
}

const control =
  'h-11 rounded-md border bg-background px-3 text-sm text-foreground md:h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/** A small filter chip: 44 px tall on touch, where it has to be a comfortable target. */
const groupChip = 'min-h-11 rounded-lg px-3 text-[13px] md:min-h-8 md:px-2.5'

function Count({ n }: { n: number }) {
  return <span className="text-xs tabular-nums opacity-80">{n}</span>
}

function Group({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0">
      <legend className="float-left mr-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {legend}
      </legend>
      {children}
    </fieldset>
  )
}

/**
 * Search, sort and filters for the scorecard. Sticky, so the controls stay in reach while scrolling
 * a long list; on a phone the filter groups fold behind a Filters button so the list stays visible.
 */
export function FilterBar({
  rows,
  query,
  onChange,
  contextOf,
  shown,
  hasFamily,
  hasTooling,
  shareUrl,
}: {
  rows: PortfolioRow[]
  query: PortfolioQuery
  onChange: (next: PortfolioQuery) => void
  contextOf: (row: PortfolioRow) => RowContext
  shown: number
  hasFamily: boolean
  hasTooling: boolean
  shareUrl: () => string
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const search = useRef<HTMLInputElement>(null)

  // "/" focuses the search from anywhere on the page, unless the person is already typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault()
      search.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // No clipboard (an insecure origin, or permission refused): the address bar has the same link.
    }
  }

  const nFilters = activeFilterCount(query)
  const active: { key: string; label: string; remove: () => void }[] = []
  if (query.q.trim())
    active.push({
      key: 'q',
      label: `“${query.q.trim()}”`,
      remove: () => onChange({ ...query, q: '' }),
    })
  for (const l of LEVELS.filter((l) => query.level.has(l)))
    active.push({
      key: `level-${l}`,
      label: `L${l}`,
      remove: () => onChange(toggle(query, 'level', l)),
    })
  for (const f of ALERT_FILTERS.filter((f) => query.alert.has(f.key)))
    active.push({
      key: `alert-${f.key}`,
      label: f.label,
      remove: () => onChange(toggle(query, 'alert', f.key)),
    })
  for (const f of ENV_FILTERS.filter((f) => query.env.has(f.key)))
    active.push({
      key: `env-${f.key}`,
      label: f.label,
      remove: () => onChange(toggle(query, 'env', f.key)),
    })
  if (query.group)
    active.push({
      key: 'group',
      label: GROUP_LABEL[query.group],
      remove: () => onChange({ ...query, group: null }),
    })
  if (query.family) {
    const label = FAMILY_FILTERS.find((f) => f.key === query.family)?.label ?? query.family
    active.push({ key: 'family', label, remove: () => onChange({ ...query, family: null }) })
  }

  const count = (group: 'level' | 'alert' | 'env', value: Level | AlertFilter | EnvFilter) =>
    chipCount(rows, query, group, value, contextOf)

  return (
    <div
      className="sticky top-0 z-20 -mx-4 flex flex-col gap-2.5 border-b bg-background px-4 py-2.5 sm:-mx-6 sm:px-6 sm:py-3"
      data-testid="filter-bar"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-[1_1_100%] md:max-w-[420px] md:flex-[1_1_260px]">
          <span className="sr-only">Search projects</span>
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            ref={search}
            type="search"
            value={query.q}
            onChange={(e) => onChange({ ...query, q: e.target.value })}
            placeholder="Search name, repository or type"
            autoComplete="off"
            className="h-11 w-full rounded-md border border-input bg-background pr-9 pl-8 text-base md:h-9 md:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span
            aria-hidden="true"
            className="absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border px-1.5 font-mono text-[11px] text-muted-foreground md:inline"
          >
            /
          </span>
        </label>
        <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <span className="hidden sm:inline">Sort</span>
          <select
            value={query.sort}
            onChange={(e) => onChange({ ...query, sort: e.target.value as PortfolioSort })}
            className={cn(control, 'max-w-[190px]')}
            aria-label="Sort projects"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <Chip
            active={open}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="overview-filters"
            className="min-h-11 rounded-lg md:hidden"
          >
            <SlidersHorizontalIcon className="size-4" aria-hidden="true" />
            Filters
            {nFilters > 0 ? <Count n={nFilters} /> : null}
          </Chip>
          <Chip
            active={false}
            onClick={copy}
            title="Copy a link to this exact view"
            className="min-h-11 rounded-lg md:min-h-9"
          >
            {copied ? (
              <CheckIcon className="size-4" aria-hidden="true" />
            ) : (
              <LinkIcon className="size-4" aria-hidden="true" />
            )}
            <span aria-live="polite">{copied ? 'Copied' : 'Copy link'}</span>
          </Chip>
        </div>
      </div>

      <div
        id="overview-filters"
        className={cn(
          'flex-wrap items-center gap-x-5 gap-y-2.5 md:flex',
          open
            ? 'flex max-h-[55vh] flex-col items-stretch gap-3 overflow-y-auto pb-1 md:max-h-none md:flex-row md:items-center md:overflow-visible md:pb-0'
            : 'hidden',
        )}
      >
        <Group legend="Level">
          {LEVELS.map((l) => (
            <Chip
              key={l}
              active={query.level.has(l)}
              onClick={() => onChange(toggle(query, 'level', l))}
              className={groupChip}
              aria-label={`Level L${l}`}
            >
              <LevelBadge level={l} />
              <Count n={count('level', l)} />
            </Chip>
          ))}
        </Group>
        <Group legend="Alert">
          {ALERT_FILTERS.map((f) => (
            <Chip
              key={f.key}
              active={query.alert.has(f.key)}
              onClick={() => onChange(toggle(query, 'alert', f.key))}
              className={groupChip}
            >
              {RAG_DOT[f.key] ? (
                <span className={cn('size-2.5 rounded-full', RAG_DOT[f.key])} aria-hidden="true" />
              ) : (
                <span aria-hidden="true">▼</span>
              )}
              {f.label}
              <Count n={count('alert', f.key)} />
            </Chip>
          ))}
        </Group>
        <Group legend="Env">
          {ENV_FILTERS.map((f) => (
            <Chip
              key={f.key}
              active={query.env.has(f.key)}
              onClick={() => onChange(toggle(query, 'env', f.key))}
              className={groupChip}
            >
              {f.label}
              <Count n={count('env', f.key)} />
            </Chip>
          ))}
        </Group>
        {hasTooling ? (
          <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wide">Group</span>
            <select
              value={query.group ?? ''}
              onChange={(e) =>
                onChange({ ...query, group: (e.target.value || null) as PortfolioQuery['group'] })
              }
              className={control}
            >
              <option value="">All</option>
              <option value="applications">{GROUP_LABEL.applications}</option>
              <option value="tooling">{GROUP_LABEL.tooling}</option>
            </select>
          </label>
        ) : null}
        {hasFamily ? (
          <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wide">Family</span>
            <select
              value={query.family ?? ''}
              onChange={(e) =>
                onChange({ ...query, family: (e.target.value || null) as FamilyFilter | null })
              }
              className={control}
            >
              <option value="">Any</option>
              {FAMILY_FILTERS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div
        className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[13px] text-muted-foreground"
        aria-live="polite"
      >
        <span>
          <strong className="text-foreground tabular-nums">{shown}</strong> of {rows.length}{' '}
          projects
        </span>
        {active.map((a) => (
          <span
            key={a.key}
            className="inline-flex items-center gap-1 rounded-full bg-accent py-0.5 pr-1 pl-2.5 text-xs font-medium text-accent-foreground"
          >
            {a.label}
            <button
              type="button"
              onClick={a.remove}
              aria-label={`Remove filter ${a.label}`}
              className="inline-flex size-5 items-center justify-center rounded-full hover:bg-accent-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <XIcon className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        {active.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange({ ...emptyQuery(), sort: query.sort })}
            className="text-[13px] font-medium text-primary underline underline-offset-4"
          >
            Clear all
          </button>
        ) : null}
      </div>
    </div>
  )
}
