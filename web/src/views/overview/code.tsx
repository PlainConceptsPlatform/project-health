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
import { withBase } from '@/shared/lib/utils'
import { cn } from '@/shared/ui'
import { Sparkline } from '@/shared/ui/sparkline'

const COLUMNS = [
  'Project',
  'Comments per code line',
  'Slop shapes',
  'Stories and essays',
  'Test lines per code line',
  'Suspicious tests',
  'Bot PRs this month',
]

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
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Production code and tests on each default branch, scanned daily. The harness asks for at
        most {percent(COMMENT_CEILING)} comment lines per line of code.
      </p>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c} scope="col" className="px-4 py-3 font-semibold">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const c = row.code
              const added = row.added
              const addedPct = added ? addedDensity(added) : null
              return (
                <tr key={row.id} className="border-t align-middle">
                  <td className="px-4 py-3.5">
                    <a
                      href={withBase(`/projects/${row.id}/`)}
                      className="text-[15px] font-semibold hover:underline"
                    >
                      {row.name}
                    </a>
                    {c ? (
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {c.comments.codeLines.toLocaleString('en-GB')} lines of code
                      </div>
                    ) : null}
                  </td>
                  {c ? (
                    <>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <Density value={c.comments.density} />
                          {row.trend.length > 1 ? (
                            <Sparkline
                              points={row.trend}
                              max={Math.max(40, ...row.trend.map((p) => p.score ?? 0))}
                              width={72}
                              label={`${row.name} comment density, last ${row.trend.length} days`}
                            />
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 tabular-nums">{c.comments.slop.findings}</td>
                      <td
                        className="px-4 py-3.5 tabular-nums"
                        title={`${c.comments.heuristics.history} incident stories, ${c.comments.heuristics.essay} blocks of five lines or more`}
                      >
                        {narrativeBlocks(c)}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="font-semibold tabular-nums">
                          {c.tests.ratio === null ? 'n/a' : c.tests.ratio.toFixed(2)}
                        </span>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {c.tests.cases.toLocaleString('en-GB')} cases ·{' '}
                          {c.tests.casesPerKloc ?? 'n/a'} per 1,000 lines
                        </div>
                      </td>
                      <td className="px-4 py-3.5 tabular-nums">{suspiciousTests(c)}</td>
                      <td className="px-4 py-3.5">
                        {added && added.pullRequests > 0 ? (
                          <>
                            <span
                              className={cn(
                                'font-semibold tabular-nums',
                                densityTone(addedPct) && TONE_TEXT[densityTone(addedPct) ?? 'good'],
                              )}
                            >
                              {percent(addedPct)} comments
                            </span>
                            <div className="text-xs text-muted-foreground tabular-nums">
                              {added.pullRequests} PRs · +{added.codeLines} code · +
                              {added.testLines} test
                            </div>
                          </>
                        ) : (
                          <span className="text-sm text-muted-foreground">None</span>
                        )}
                      </td>
                    </>
                  ) : (
                    <td
                      colSpan={COLUMNS.length - 1}
                      className="px-4 py-3.5 text-xs text-muted-foreground"
                    >
                      {row.reason}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted-foreground">
        Slop shapes are comments that are noise by their shape alone. Stories and essays are
        comments retelling an incident or running five lines or more; they need a person to judge.
        Suspicious tests are approximate: an assertion inside a helper is not seen.
      </p>
    </div>
  )
}
