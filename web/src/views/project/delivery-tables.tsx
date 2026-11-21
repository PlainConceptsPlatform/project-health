'use client'

import { RUNS_PAGE, filterReleases, filterRuns } from '@/shared/lib/delivery'
import { dateTime, seconds, shortDate, tokens } from '@/shared/lib/format'
import type { AgentRun, Release } from '@/shared/lib/types'
import { writeQuery } from '@/shared/lib/url-state'
import { Badge } from '@/shared/ui'
import { Chip } from '@/shared/ui/chip'
import { ResponsiveTable } from '@/shared/ui/responsive-table'
import { SearchIcon } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'

function Search({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder: string
}) {
  return (
    <label className="relative min-w-0 flex-[1_1_220px] md:max-w-xs">
      <span className="sr-only">{label}</span>
      <SearchIcon
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onChange('')
        }}
        placeholder={placeholder}
        autoComplete="off"
        className="h-11 w-full rounded-md border border-input bg-background pr-3 pl-8 text-base md:h-9 md:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  )
}

function Toolbar({
  children,
  shown,
  total,
  noun,
}: {
  children: ReactNode
  shown: number
  total: number
  noun: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      <span className="text-[13px] text-muted-foreground" aria-live="polite">
        <strong className="text-foreground tabular-nums">{shown}</strong> of {total} {noun}
      </span>
    </div>
  )
}

function NoMatch({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/40 px-4 py-3">
      <p className="text-sm font-medium text-muted-foreground">Nothing matches</p>
      <button
        type="button"
        onClick={onClear}
        className="mt-1 text-xs font-medium text-primary underline underline-offset-4"
      >
        Clear filters
      </button>
    </div>
  )
}

/** Distinct commits that reached production, searchable, with the unplanned ones a click away. */
export function ReleasesTable({ releases }: { releases: Release[] }) {
  const [query, setQuery] = useState('')
  const [unplannedOnly, setUnplannedOnly] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setQuery(params.get('rq') ?? '')
    setUnplannedOnly(params.get('unplanned') === '1')
  }, [])

  const update = (q: string, unplanned: boolean) => {
    setQuery(q)
    setUnplannedOnly(unplanned)
    writeQuery({ rq: q.trim(), unplanned: unplanned ? '1' : null })
  }

  const shown = filterReleases(releases, { query, unplannedOnly })
  const unplanned = releases.filter((r) => r.unplanned).length

  return (
    <div className="space-y-3">
      <Toolbar shown={shown.length} total={releases.length} noun="releases">
        <Search
          value={query}
          onChange={(q) => update(q, unplannedOnly)}
          label="Search releases"
          placeholder="Search ref, commit or person"
        />
        <Chip
          active={unplannedOnly}
          onClick={() => update(query, !unplannedOnly)}
          className="min-h-11 rounded-lg px-3 text-[13px] md:min-h-9"
        >
          Unplanned only
          <span className="text-xs tabular-nums opacity-80">{unplanned}</span>
        </Chip>
      </Toolbar>
      {shown.length === 0 ? (
        <NoMatch onClear={() => update('', false)} />
      ) : (
        <ResponsiveTable
          label="Releases"
          rows={shown}
          rowKey={(r) => r.sha}
          breakpoint="md"
          columns={[
            { key: 'ref', label: 'Ref', className: 'font-medium', cell: (r) => r.ref },
            {
              key: 'deployed',
              label: 'Deployed',
              className: 'text-muted-foreground',
              cell: (r) => dateTime(r.deployedAt),
            },
            {
              key: 'by',
              label: 'By',
              className: 'text-muted-foreground',
              cell: (r) => r.deployedBy ?? 'unknown',
            },
            {
              key: 'commit',
              label: 'Commit',
              className: 'font-mono text-xs text-muted-foreground',
              cell: (r) => r.sha.slice(0, 8),
            },
            {
              key: 'signals',
              label: 'Signals',
              className: 'space-x-1.5',
              cell: (r) => (
                <>
                  {r.unplanned ? <Badge variant="destructive">unplanned</Badge> : null}
                  {r.outOfProcess ? <Badge variant="outline">not a tag</Badge> : null}
                  {r.deploymentIds.length > 1 ? (
                    <Badge variant="secondary">{r.deploymentIds.length} records</Badge>
                  ) : null}
                </>
              ),
            },
          ]}
        />
      )}
    </div>
  )
}

/** Every agent run of the period, searchable, loaded RUNS_PAGE at a time. */
export function RunsTable({ runs, repo }: { runs: AgentRun[]; repo: string }) {
  const [query, setQuery] = useState('')
  const [count, setCount] = useState(RUNS_PAGE)

  useEffect(() => setQuery(new URLSearchParams(window.location.search).get('runq') ?? ''), [])

  const update = (q: string) => {
    setQuery(q)
    setCount(RUNS_PAGE)
    writeQuery({ runq: q.trim() })
  }

  const matching = filterRuns(runs, query)
  const shown = matching.slice(0, count)

  return (
    <div className="space-y-3">
      <Toolbar shown={matching.length} total={runs.length} noun="runs">
        <Search
          value={query}
          onChange={update}
          label="Search agent runs"
          placeholder="Search kind, run or issue"
        />
      </Toolbar>
      {matching.length === 0 ? (
        <NoMatch onClear={() => update('')} />
      ) : (
        <ResponsiveTable
          label="Agent runs"
          rows={shown}
          rowKey={(r) => String(r.runId)}
          breakpoint="md"
          columns={[
            {
              key: 'run',
              label: 'Run',
              cell: (run) => (
                <a
                  href={`https://github.com/${repo}/actions/runs/${run.runId}`}
                  className="font-mono text-xs hover:underline"
                >
                  {run.runId}
                </a>
              ),
            },
            { key: 'kind', label: 'Kind', className: 'capitalize', cell: (run) => run.kind },
            {
              key: 'issue',
              label: 'Issue',
              className: 'text-muted-foreground',
              cell: (run) =>
                run.issueNumber ? (
                  <a
                    href={`https://github.com/${repo}/issues/${run.issueNumber}`}
                    className="hover:underline"
                  >
                    #{run.issueNumber}
                  </a>
                ) : (
                  'n/a'
                ),
            },
            {
              key: 'started',
              label: 'Started',
              className: 'text-muted-foreground',
              cell: (run) => shortDate(run.startedAt),
            },
            {
              key: 'duration',
              label: 'Duration',
              className: 'tabular-nums',
              cell: (run) =>
                run.executionSeconds === null ? 'n/a' : seconds(run.executionSeconds),
            },
            {
              key: 'input',
              label: 'Input',
              className: 'tabular-nums',
              cell: (run) => (run.usage ? tokens(run.usage.inputTokens) : 'n/a'),
            },
            {
              key: 'output',
              label: 'Output',
              className: 'tabular-nums',
              cell: (run) => (run.usage ? tokens(run.usage.outputTokens) : 'n/a'),
            },
          ]}
        />
      )}
      {matching.length > shown.length ? (
        <button
          type="button"
          onClick={() => setCount((n) => n + RUNS_PAGE)}
          className="min-h-11 rounded-lg border px-4 text-sm font-medium hover:bg-muted md:min-h-9"
        >
          Show more ({Math.min(RUNS_PAGE, matching.length - shown.length)} of{' '}
          {matching.length - shown.length} left)
        </button>
      ) : null}
    </div>
  )
}
