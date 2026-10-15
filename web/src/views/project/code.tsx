import {
  COMMENT_CEILING,
  SLOP_LABEL,
  SUSPICIOUS_LABEL,
  TONE_TEXT,
  densityTone,
  densityTrend,
  percent,
} from '@/shared/lib/code'
import type { DailyScore } from '@/shared/lib/scorecard'
import type { Codebase, MonthlyReport } from '@/shared/lib/types'
import { DataTable, Metric, Panel, Stat, TableCell, TableRow, cn } from '@/shared/ui'
import { Sparkline } from '@/shared/ui/sparkline'

function Counts({ rows }: { rows: [string, number][] }) {
  const shown = rows.filter(([, n]) => n > 0)
  if (shown.length === 0) return <p className="text-sm text-muted-foreground">None found.</p>
  return (
    <ul className="space-y-1.5 text-sm">
      {shown.map(([label, n]) => (
        <li key={label} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{label}</span>
          <span className="tabular-nums">{n}</span>
        </li>
      ))}
    </ul>
  )
}

function blobUrl(repo: string, code: Codebase, path: string) {
  return `https://github.com/${repo}/blob/${code.sha ?? code.branch}/${path}`
}

export function CodePanel({ report, daily = [] }: { report: MonthlyReport; daily?: DailyScore[] }) {
  const trend = densityTrend(daily)
  return (
    <Panel
      title="Comments and tests"
      description={`Production code and tests on the default branch, scanned daily. The harness asks for at most ${percent(COMMENT_CEILING)} comment lines per line of code.`}
    >
      <Metric block={report.codebase}>
        {(c) => {
          const tone = densityTone(c.comments.density)
          return (
            <div className="space-y-8">
              <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
                <Stat
                  label="Comments per code line"
                  value={
                    <span className={cn(tone && TONE_TEXT[tone])}>
                      {percent(c.comments.density)}
                    </span>
                  }
                  hint={`${c.comments.commentLines.toLocaleString('en-GB')} of ${c.comments.codeLines.toLocaleString('en-GB')} lines`}
                />
                <Stat
                  label="Slop shapes"
                  value={c.comments.slop.findings}
                  hint="noise by shape alone"
                />
                <Stat
                  label="Test lines per code line"
                  value={c.tests.ratio === null ? 'n/a' : c.tests.ratio.toFixed(2)}
                  hint={`${c.tests.cases.toLocaleString('en-GB')} cases in ${c.tests.files} files`}
                />
                <Stat
                  label="Test cases per 1,000 lines"
                  value={c.tests.casesPerKloc ?? 'n/a'}
                  hint={`${c.tests.scenarios} Gherkin scenarios`}
                />
              </div>

              {trend.length > 1 ? (
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Sparkline
                    points={trend}
                    max={Math.max(40, ...trend.map((p) => p.score ?? 0))}
                    width={180}
                    height={36}
                    label="Comment density by day"
                  />
                  Comment density, last {trend.length} days
                </div>
              ) : null}

              <div className="grid gap-8 lg:grid-cols-3">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Slop shapes
                  </p>
                  <Counts
                    rows={Object.entries(c.comments.slop.byRule).map(([rule, n]) => [
                      SLOP_LABEL[rule] ?? rule,
                      n,
                    ])}
                  />
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Needs a person to judge
                  </p>
                  <Counts
                    rows={[
                      ['Incident stories (issue in the past tense)', c.comments.heuristics.history],
                      ['Blocks of five lines or more', c.comments.heuristics.essay],
                      ['Docs on internal symbols', c.comments.heuristics.internalDoc],
                    ]}
                  />
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Suspicious tests (approximate)
                  </p>
                  <Counts
                    rows={Object.entries(c.tests.suspicious).map(([key, n]) => [
                      SUSPICIOUS_LABEL[key as keyof typeof SUSPICIOUS_LABEL],
                      n,
                    ])}
                  />
                </div>
              </div>

              {c.hotspots.length > 0 ? (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Files with the most comment lines
                  </p>
                  <DataTable
                    head={['File', 'Comment lines', 'Code lines', 'Per code line', 'Slop']}
                  >
                    {c.hotspots.map((h) => (
                      <TableRow key={h.path}>
                        <TableCell className="max-w-[420px] truncate font-mono text-xs">
                          <a href={blobUrl(report.repo, c, h.path)} className="hover:underline">
                            {h.path}
                          </a>
                        </TableCell>
                        <TableCell className="tabular-nums">{h.commentLines}</TableCell>
                        <TableCell className="tabular-nums">{h.codeLines}</TableCell>
                        <TableCell className="tabular-nums">
                          {percent(h.codeLines > 0 ? h.commentLines / h.codeLines : null)}
                        </TableCell>
                        <TableCell className="tabular-nums">{h.slop}</TableCell>
                      </TableRow>
                    ))}
                  </DataTable>
                </div>
              ) : null}
            </div>
          )
        }}
      </Metric>
    </Panel>
  )
}
