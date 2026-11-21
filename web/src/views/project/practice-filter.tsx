'use client'

import { shortDate } from '@/shared/lib/format'
import { filterRows, optionCounts, pickedCount, toggle } from '@/shared/lib/list-filter'
import type { Selection } from '@/shared/lib/list-filter'
import { PRACTICE_GROUPS, PRACTICE_KEYS, practiceQuery } from '@/shared/lib/practices'
import { PHASES, RAG_DOT } from '@/shared/lib/scorecard'
import type { PracticeResult } from '@/shared/lib/types'
import { readList, writeQuery } from '@/shared/lib/url-state'
import { Badge, cn } from '@/shared/ui'
import { Chip } from '@/shared/ui/chip'
import { type Column, ResponsiveTable } from '@/shared/ui/responsive-table'
import { ModeIcon, StatusDot } from '@/shared/ui/scorecard'
import { ToolList } from '@/shared/ui/tools'
import { SearchIcon } from 'lucide-react'
import { useEffect, useState } from 'react'

function SourceCell({ practice }: { practice: PracticeResult }) {
  if (practice.source === 'none') return <span className="text-xs text-muted-foreground">None</span>
  return (
    <Badge variant={practice.source === 'facet' ? 'secondary' : 'outline'}>
      {practice.source === 'facet' ? 'Facet' : 'Detected'}
    </Badge>
  )
}

function LastRunCell({ practice }: { practice: PracticeResult }) {
  const run = practice.lastRun
  if (!run) return <span className="text-xs text-muted-foreground">n/a</span>
  const file = run.workflow.split('/').at(-1)
  return (
    <a href={run.url} className="text-xs hover:underline" title={run.workflow}>
      {shortDate(run.at)} · {run.conclusion ?? 'no conclusion'}
      <span className="block text-muted-foreground">{file}</span>
    </a>
  )
}

const REASON_TONE = {
  red: 'text-destructive',
  yellow: 'text-warning-foreground dark:text-warning',
  green: 'text-muted-foreground',
  grey: 'text-muted-foreground',
} as const

const COLUMNS: Column<PracticeResult>[] = [
  {
    key: 'practice',
    label: 'Practice',
    className: 'min-w-0 max-w-md whitespace-normal',
    cell: (p) => (
      <div className={cn('flex flex-col gap-1', !p.applicable && 'text-muted-foreground')}>
        <span className="font-medium">
          <span className="mr-1.5 tabular-nums text-muted-foreground">{p.number}</span>
          {p.name}
        </span>
        {/* The reason for the colour leads; the description of the practice follows it. */}
        {p.rag !== 'green' ? (
          <span className={cn('text-xs font-medium', REASON_TONE[p.rag])}>{p.reason}</span>
        ) : null}
        <span className="text-xs text-muted-foreground">{p.description}</span>
      </div>
    ),
  },
  {
    key: 'tools',
    label: 'Tool(s)',
    className: 'max-w-56 whitespace-normal text-xs',
    cell: (p) => (
      <>
        <ToolList tools={p.tools} />
        {p.mode === 'report-only' ? (
          <span className="block text-muted-foreground">report-only</span>
        ) : null}
      </>
    ),
  },
  { key: 'mode', label: 'Mode', cell: (p) => <ModeIcon mode={p.standardMode} /> },
  { key: 'status', label: 'Status', cell: (p) => <StatusDot rag={p.rag} reason={p.reason} /> },
  { key: 'source', label: 'Source', cell: (p) => <SourceCell practice={p} /> },
  { key: 'run', label: 'Last run', cell: (p) => <LastRunCell practice={p} /> },
]

const readSelection = (params: URLSearchParams): Selection => ({
  state: readList(
    params,
    PRACTICE_KEYS.state,
    PRACTICE_GROUPS[0]?.options.map((o) => o.value),
  ),
  phase: readList(
    params,
    PRACTICE_KEYS.phase,
    PRACTICE_GROUPS[1]?.options.map((o) => o.value),
  ),
})

/**
 * Every practice, grouped by when it runs, filtered by state, phase and a search. With nothing
 * picked every practice shows, grey ones included: not applicable is an answer, not noise.
 */
export function PracticeTables({ practices }: { practices: PracticeResult[] }) {
  const [selection, setSelection] = useState<Selection>({})
  const [search, setSearch] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setSelection(readSelection(params))
    setSearch(params.get(PRACTICE_KEYS.search) ?? '')
  }, [])

  const update = (next: Selection, text: string) => {
    setSelection(next)
    setSearch(text)
    writeQuery({
      [PRACTICE_KEYS.state]: next.state ?? [],
      [PRACTICE_KEYS.phase]: next.phase ?? [],
      [PRACTICE_KEYS.search]: text.trim(),
    })
  }

  const query = practiceQuery(selection, search)
  const shown = filterRows(practices, query)
  const counts = optionCounts(practices, query)
  const filtered = pickedCount(selection) > 0 || search.trim() !== ''

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2.5 rounded-lg border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-0 flex-[1_1_220px] md:max-w-xs">
            <span className="sr-only">Search practices and tools</span>
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => update(selection, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') update(selection, '')
              }}
              placeholder="Search practice or tool"
              autoComplete="off"
              className="h-11 w-full rounded-md border border-input bg-background pr-3 pl-8 text-base md:h-9 md:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <span className="text-[13px] text-muted-foreground" aria-live="polite">
            <strong className="text-foreground tabular-nums">{shown.length}</strong> of{' '}
            {practices.length} practices
          </span>
          {filtered ? (
            <button
              type="button"
              onClick={() => update({}, '')}
              className="min-h-11 text-[13px] font-medium text-primary underline underline-offset-4 md:min-h-0"
            >
              Clear filters
            </button>
          ) : null}
        </div>
        {PRACTICE_GROUPS.map((group) => (
          <fieldset
            key={group.key}
            className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0"
          >
            <legend className="float-left mr-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </legend>
            {group.options.map((o) => (
              <Chip
                key={o.value}
                active={(selection[group.key] ?? []).includes(o.value)}
                onClick={() => update(toggle(selection, group.key, o.value), search)}
                className="min-h-11 rounded-lg px-3 text-[13px] md:min-h-8 md:px-2.5"
              >
                {group.key === 'state' ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-2.5 rounded-full',
                      RAG_DOT[o.value as keyof typeof RAG_DOT],
                    )}
                  />
                ) : null}
                {o.label}
                <span className="text-xs tabular-nums opacity-80">
                  {counts[group.key]?.[o.value] ?? 0}
                </span>
              </Chip>
            ))}
          </fieldset>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/40 px-4 py-3">
          <p className="text-sm font-medium text-muted-foreground">No practice matches</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => update({}, '')}
              className="font-medium text-primary underline underline-offset-4"
            >
              Clear filters
            </button>{' '}
            to see all {practices.length}.
          </p>
        </div>
      ) : (
        PHASES.map((phase) => {
          const rows = shown.filter((p) => p.phase === phase.key)
          if (rows.length === 0) return null
          return (
            <div key={phase.key}>
              <p className="mb-2 text-sm font-medium">{phase.label}</p>
              <ResponsiveTable
                label={`Practices: ${phase.label}`}
                rows={rows}
                columns={COLUMNS}
                rowKey={(p) => p.id}
                breakpoint="md"
              />
            </div>
          )
        })
      )}
    </div>
  )
}
