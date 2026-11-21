import { deltaOf, envOf, riskOf } from '@/shared/lib/portfolio'
import { type DailyScore, LEVEL_BAR, groupOf } from '@/shared/lib/scorecard'
import type { MonthlyReport, ProjectGroup } from '@/shared/lib/types'
import { cn } from '@/shared/ui'
import { AlertPill, EnvChip } from '@/shared/ui/alert-pill'
import { LevelBadge } from '@/shared/ui/scorecard'
import { BackToProjects } from './back-link'

/**
 * The project's name, environment, level, score and its most pressing alert, in one line that
 * stays at the top of the page while scrolling, on a phone too. The level and score are today's,
 * from the newest collected month; the alert is the overview's, so both pages agree.
 */
export function ProjectHeader({
  report,
  group,
  daily = [],
}: {
  /** The report the Engineering tab shows: the newest collected month. */
  report: MonthlyReport
  group?: ProjectGroup
  daily?: DailyScore[]
}) {
  const card = report.scorecard?.available ? report.scorecard.data : null
  const row = {
    group: group ?? groupOf({ type: card?.projectType }),
    environment: report.environment ?? null,
    card,
  }
  const env = envOf(row)
  const { delta, deltaBasis } = deltaOf({ trend: [], daily })
  const { alert } = riskOf(row, env, delta, deltaBasis)
  return (
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      <span className="hidden sm:inline">
        <BackToProjects />
      </span>
      <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight sm:text-xl">
        {report.name}
      </h1>
      {env !== 'none' && env !== 'na' ? (
        <EnvChip row={{ env, environment: row.environment }} />
      ) : null}
      {card ? (
        <span className="flex shrink-0 items-center gap-2">
          <LevelBadge level={card.level} />
          <span
            className="text-base font-semibold tabular-nums"
            title="Engineering score, 0 to 100"
          >
            {card.score ?? 'n/a'}
          </span>
          <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block">
            <span
              className={cn('block h-1.5 rounded-full', LEVEL_BAR[card.level] ?? LEVEL_BAR[0])}
              style={{ width: `${card.score ?? 0}%` }}
            />
          </span>
        </span>
      ) : null}
      {alert ? (
        <span className="ml-auto shrink-0">
          <AlertPill alert={alert} compact />
        </span>
      ) : null}
    </div>
  )
}
