import {
  COMMENT_CEILING,
  type CodeRow,
  TONE_BAR,
  TONE_TEXT,
  addedDensity,
  densityTone,
  narrativeBlocks,
  percent,
  suspiciousTests,
} from '@/shared/lib/code'
import type { Codebase } from '@/shared/lib/types'
import { withBase } from '@/shared/lib/utils'
import { cn } from '@/shared/ui'
import { PROJECT_LINK } from '@/shared/ui/project-link'
import { type Column, ResponsiveTable } from '@/shared/ui/responsive-table'
import { Sparkline } from '@/shared/ui/sparkline'

function Density({ value }: { value: number | null }) {
  const tone = densityTone(value)
  return (
    <div className="flex flex-col gap-1.5">
      <span className={cn('text-base font-semibold tabular-nums', tone && TONE_TEXT[tone])}>
        {percent(value)}
      </span>
      <div className="h-[5px] w-28 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-[5px] rounded-full', tone ? TONE_BAR[tone] : 'bg-muted')}
          style={{ width: `${Math.min(100, ((value ?? 0) / 0.4) * 100)}%` }}
        />
      </div>
    </div>
  )
}

export function CodeTable({ rows }: { rows: CodeRow[] }) {
  const of = (row: CodeRow) => row.code as Codebase
  const columns: Column<CodeRow>[] = [
    {
      key: 'project',
      label: 'Project',
      cell: (row) => (
        <>
          <a href={withBase(`/projects/${row.id}/`)} className={PROJECT_LINK}>
            {row.name}
          </a>
          {row.code ? (
            <div className="text-xs text-muted-foreground tabular-nums">
              {row.code.comments.codeLines.toLocaleString('en-GB')} lines of code
            </div>
          ) : null}
        </>
      ),
    },
    {
      key: 'comments',
      label: 'Comments per code line',
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-3">
          <Density value={of(row).comments.density} />
          {row.trend.length > 1 ? (
            <Sparkline
              points={row.trend}
              max={Math.max(40, ...row.trend.map((p) => p.score ?? 0))}
              width={72}
              label={`${row.name} comment density, last ${row.trend.length} days`}
            />
          ) : null}
        </div>
      ),
    },
    {
      key: 'slop',
      label: 'Slop shapes',
      className: 'tabular-nums',
      cell: (row) => of(row).comments.slop.findings,
    },
    {
      key: 'stories',
      label: 'Stories and essays',
      className: 'tabular-nums',
      cell: (row) => (
        <span
          title={`${of(row).comments.heuristics.history} incident stories, ${of(row).comments.heuristics.essay} blocks of five lines or more`}
        >
          {narrativeBlocks(of(row))}
        </span>
      ),
    },
    {
      key: 'tests',
      label: 'Test lines per code line',
      cell: (row) => {
        const t = of(row).tests
        return (
          <>
            <span className="font-semibold tabular-nums">
              {t.ratio === null ? 'n/a' : t.ratio.toFixed(2)}
            </span>
            <div className="text-xs text-muted-foreground tabular-nums">
              {t.cases.toLocaleString('en-GB')} cases · {t.casesPerKloc ?? 'n/a'} per 1,000 lines
            </div>
          </>
        )
      },
    },
    {
      key: 'suspicious',
      label: 'Suspicious tests',
      className: 'tabular-nums',
      cell: (row) => suspiciousTests(of(row)),
    },
    {
      key: 'added',
      label: 'Bot PRs this month',
      cell: (row) => {
        const added = row.added
        if (!added || added.pullRequests === 0) {
          return <span className="text-sm text-muted-foreground">None</span>
        }
        const pct = addedDensity(added)
        const tone = densityTone(pct)
        return (
          <>
            <span className={cn('font-semibold tabular-nums', tone && TONE_TEXT[tone])}>
              {percent(pct)} comments
            </span>
            <div className="text-xs text-muted-foreground tabular-nums">
              {added.pullRequests} PRs · +{added.codeLines} code · +{added.testLines} test
            </div>
          </>
        )
      },
    },
  ]
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Production code and tests on each default branch, scanned daily. The harness asks for at
        most {percent(COMMENT_CEILING)} comment lines per line of code.
      </p>
      <ResponsiveTable
        label="Comments and tests by project"
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        note={(row) =>
          row.code ? null : <span className="text-muted-foreground">{row.reason}</span>
        }
      />
      <p className="text-sm text-muted-foreground">
        Slop shapes are comments that are noise by their shape alone. Stories and essays are
        comments retelling an incident or running five lines or more; they need a person to judge.
        Suspicious tests are approximate: an assertion inside a helper is not seen.
      </p>
    </div>
  )
}
