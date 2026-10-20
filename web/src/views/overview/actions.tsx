import {
  type ActionsRow,
  MINUTES_SURGE,
  OS_LABEL,
  STORAGE_LIMIT_BYTES,
  minutesLabel,
  storageSize,
  trendMax,
} from '@/shared/lib/actions'
import { withBase } from '@/shared/lib/utils'
import { cn } from '@/shared/ui'
import { Sparkline } from '@/shared/ui/sparkline'

const COLUMNS = ['Project', 'Minutes this month', 'By runner', 'Storage', 'Caches', 'Artifacts']

const BAD = 'text-destructive'

function Change({ change, surge }: { change: number | null; surge: boolean }) {
  if (change === null) return null
  const pct = Math.round(change * 100)
  return (
    <span
      title="Daily pace against the previous month"
      className={cn(
        'text-xs font-semibold tabular-nums',
        surge ? BAD : pct < 0 ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      {pct > 0 ? `+${pct}%` : pct < 0 ? `−${Math.abs(pct)}%` : '0%'}
    </span>
  )
}

export function ActionsTable({ rows }: { rows: ActionsRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Billable GitHub Actions minutes for the month and the storage Actions keeps for each
        repository: active caches plus artifacts that have not expired. Red marks storage over{' '}
        {storageSize(STORAGE_LIMIT_BYTES)} or minutes up more than {MINUTES_SURGE * 100}% on the
        previous month.
      </p>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[960px] text-sm">
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
              const m = row.minutes
              const s = row.storage
              const flagged = row.storageOver || row.minutesSurge
              return (
                <tr
                  key={row.id}
                  className={cn('border-t align-middle', flagged && 'bg-destructive/[0.03]')}
                >
                  <td className="px-4 py-3.5">
                    <a
                      href={withBase(`/projects/${row.id}/`)}
                      className="text-[15px] font-semibold hover:underline"
                    >
                      {row.name}
                    </a>
                    <div className="text-xs text-muted-foreground">{row.month ?? row.repo}</div>
                  </td>
                  <td className="px-4 py-3.5">
                    {m ? (
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col">
                          <span
                            className={cn(
                              'text-base font-semibold tabular-nums',
                              row.minutesSurge && BAD,
                            )}
                          >
                            {minutesLabel(m.total)}
                          </span>
                          <span className="flex gap-2 text-xs text-muted-foreground tabular-nums">
                            <Change change={row.change} surge={row.minutesSurge} />
                            {m.source === 'billing' ? (
                              <span title="From the organization's billing usage report">
                                billed
                              </span>
                            ) : (
                              <span title="Runs whose timing was read, of the runs seen">
                                {m.timed}/{m.runs + m.pending} runs
                              </span>
                            )}
                          </span>
                        </div>
                        {row.minutesTrend.length > 1 ? (
                          <Sparkline
                            points={row.minutesTrend}
                            max={trendMax(row.minutesTrend, 10)}
                            width={72}
                            tone={row.minutesSurge ? 'down' : 'default'}
                            label={`${row.name} Actions minutes, last ${row.minutesTrend.length} months`}
                          />
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{row.minutesReason}</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-xs text-muted-foreground tabular-nums">
                    {m && Object.keys(m.byOs).length > 0
                      ? Object.entries(m.byOs)
                          .sort(([, a], [, b]) => b - a)
                          .map(([os, n]) => `${OS_LABEL[os] ?? os} ${minutesLabel(n)}`)
                          .join(' · ')
                      : m
                        ? 'None billable'
                        : null}
                  </td>
                  <td className="px-4 py-3.5">
                    {s ? (
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            'text-base font-semibold tabular-nums',
                            row.storageOver && BAD,
                          )}
                          title={`Read ${s.measuredAt.slice(0, 10)}`}
                        >
                          {storageSize(s.totalBytes)}
                        </span>
                        {row.storageTrend.length > 1 ? (
                          <Sparkline
                            points={row.storageTrend}
                            max={trendMax(row.storageTrend, 1)}
                            width={72}
                            tone={row.storageOver ? 'down' : 'default'}
                            label={`${row.name} Actions storage in GB, last ${row.storageTrend.length} months`}
                          />
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{row.storageReason}</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 tabular-nums">
                    {s?.cache ? (
                      <>
                        {storageSize(s.cache.bytes)}
                        <div className="text-xs text-muted-foreground">{s.cache.count} caches</div>
                      </>
                    ) : s ? (
                      <span className="text-xs text-muted-foreground">n/a</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3.5 tabular-nums">
                    {s?.artifacts ? (
                      <>
                        {storageSize(s.artifacts.bytes)}
                        <div className="text-xs text-muted-foreground">
                          {s.artifacts.count}
                          {s.artifacts.truncated ? '+' : ''} artifacts
                        </div>
                      </>
                    ) : s ? (
                      <span className="text-xs text-muted-foreground">n/a</span>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted-foreground">
        Minutes are summed from each run's billable timing, every job rounded up to the minute;
        public repositories and self-hosted runners are free and read zero. The change compares
        minutes per day, so a month in progress is not read as a drop. Storage is read as it is on
        the day of collection.
      </p>
    </div>
  )
}
