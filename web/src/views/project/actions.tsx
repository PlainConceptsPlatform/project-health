import {
  type ActionsEntry,
  MINUTES_SURGE,
  OS_LABEL,
  STORAGE_LIMIT_BYTES,
  minutesLabel,
  storageSize,
  summariseActions,
  trendMax,
} from '@/shared/lib/actions'
import { monthName } from '@/shared/lib/format'
import { Panel, Stat, Unavailable } from '@/shared/ui'
import { Sparkline } from '@/shared/ui/sparkline'

function Trend({
  points,
  label,
  floor,
  bad,
}: {
  points: { month: string; score: number | null }[]
  label: string
  floor: number
  bad: boolean
}) {
  if (points.length < 2) return null
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <Sparkline
        points={points}
        max={trendMax(points, floor)}
        width={180}
        height={36}
        tone={bad ? 'down' : 'default'}
        label={label}
      />
      <span>
        {label}, {points[0]?.month} to {points.at(-1)?.month}
      </span>
    </div>
  )
}

export function ActionsPanel({ history }: { history: ActionsEntry[] }) {
  const a = summariseActions(history)
  const m = a.minutes
  const s = a.storage
  const pct = a.change === null ? null : Math.round(a.change * 100)

  return (
    <Panel
      title="GitHub Actions usage"
      description={`Billable minutes${a.month ? ` in ${monthName(a.month)}` : ''} and the storage Actions keeps for the repository. Storage over ${storageSize(STORAGE_LIMIT_BYTES)}, or minutes up more than ${MINUTES_SURGE * 100}% on the previous month, reads red.`}
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-4">
          <p className="text-sm font-medium">Minutes</p>
          {m ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Stat
                  label="This month"
                  value={minutesLabel(m.total)}
                  tone={a.minutesSurge ? 'bad' : undefined}
                  hint={
                    pct === null
                      ? 'no previous month to compare'
                      : `${pct > 0 ? '+' : ''}${pct}% daily pace on last month`
                  }
                />
                {m.source === 'billing' ? (
                  <Stat
                    label="Source"
                    value="Billing report"
                    hint="the organization's billed minutes for this repository"
                  />
                ) : (
                  <Stat
                    label="Runs timed"
                    value={`${m.timed}/${m.runs + m.pending}`}
                    hint={
                      m.pending > 0
                        ? `${m.pending} still running or waiting for the next collection`
                        : m.timed < m.runs || m.truncated
                          ? 'some runs unreadable, the total is a floor'
                          : 'complete'
                    }
                  />
                )}
              </div>
              <ul className="space-y-1.5 text-sm">
                {Object.entries(m.byOs).length > 0 ? (
                  Object.entries(m.byOs)
                    .sort(([, x], [, y]) => y - x)
                    .map(([os, n]) => (
                      <li key={os} className="flex justify-between gap-4">
                        <span className="text-muted-foreground">{OS_LABEL[os] ?? os}</span>
                        <span className="tabular-nums">{minutesLabel(n)}</span>
                      </li>
                    ))
                ) : (
                  <li className="text-muted-foreground">
                    No billable minutes: public repositories and self-hosted runners are free.
                  </li>
                )}
              </ul>
              <Trend
                points={a.minutesTrend}
                label="Minutes by month"
                floor={10}
                bad={a.minutesSurge}
              />
            </>
          ) : (
            <Unavailable reason={a.minutesReason ?? 'Not collected yet.'} />
          )}
        </div>

        <div className="space-y-4">
          <p className="text-sm font-medium">Storage</p>
          {s ? (
            <>
              <div className="grid grid-cols-3 gap-4">
                <Stat
                  label="Total"
                  value={storageSize(s.totalBytes)}
                  tone={a.storageOver ? 'bad' : undefined}
                  hint={`read ${s.measuredAt.slice(0, 10)}`}
                />
                <Stat
                  label="Caches"
                  value={storageSize(s.cache?.bytes)}
                  hint={s.cache ? `${s.cache.count} active` : 'not readable'}
                />
                <Stat
                  label="Artifacts"
                  value={storageSize(s.artifacts?.bytes)}
                  hint={
                    s.artifacts
                      ? `${s.artifacts.count}${s.artifacts.truncated ? '+' : ''} not expired`
                      : 'not readable'
                  }
                />
              </div>
              <Trend
                points={a.storageTrend}
                label="Storage in GB by month"
                floor={1}
                bad={a.storageOver}
              />
            </>
          ) : (
            <Unavailable reason={a.storageReason ?? 'Not collected yet.'} />
          )}
        </div>
      </div>
    </Panel>
  )
}
