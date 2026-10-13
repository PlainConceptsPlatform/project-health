import { monthName } from '@/shared/lib/format'
import { type ScorecardRow, TREND_MONTHS, typeLabel } from '@/shared/lib/scorecard'
import { DataTable, InfoTip, TableCell, TableRow } from '@/shared/ui'
import { AiUsageValue, AlertBadge, EnvironmentTag, LevelBadge } from '@/shared/ui/scorecard'
import { Sparkline } from '@/shared/ui/sparkline'

const HEAD = [
  'Project',
  'Type',
  'Environment',
  'AI usage',
  'Engineering',
  'Gates',
  `Engineering, ${TREND_MONTHS} months`,
  'Alert',
]

/**
 * The portfolio at a glance: how much AI is in the code and how well the engineering gates hold
 * it. Each row is the project's newest scored month, and the sparkline ends there.
 */
export function ScorecardTable({
  rows,
  typeLabels,
}: {
  rows: ScorecardRow[]
  typeLabels: Record<string, string>
}) {
  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Ten engineering practices per project, read from the engineering excellence facets a
        repository publishes or detected in its workflows on the default branch. Hover a value for
        its counts; open a project for the gate by gate breakdown.
        <InfoTip term="engineeringLevel" />
      </p>
      <DataTable head={HEAD}>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <a href={`/projects/${row.id}/`} className="font-medium hover:underline">
                {row.name}
              </a>
              <p className="text-xs text-muted-foreground">
                {row.month ? monthName(row.month) : row.repo}
                {row.card && !row.card.facetsPublished ? ' · detected from workflows' : ''}
              </p>
            </TableCell>
            {row.card ? (
              <>
                <TableCell>{typeLabel(row.card.projectType, typeLabels)}</TableCell>
                <TableCell>
                  <EnvironmentTag environment={row.environment} />
                </TableCell>
                <TableCell>
                  <AiUsageValue usage={row.card.aiUsage} />
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <LevelBadge level={row.card.level} />
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {row.card.score ?? 'n/a'}
                    </span>
                  </span>
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.card.gates.present}/{row.card.gates.applicable}
                </TableCell>
                <TableCell>
                  <Sparkline points={row.trend} label={`${row.name} engineering score`} />
                </TableCell>
                <TableCell>
                  {row.card.alerts.length > 0 ? (
                    <div className="flex flex-col items-start gap-1">
                      {row.card.alerts.map((alert) => (
                        <AlertBadge key={alert.code} alert={alert} />
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">None</span>
                  )}
                </TableCell>
              </>
            ) : (
              <TableCell colSpan={HEAD.length - 1} className="text-xs text-muted-foreground">
                {row.reason}
              </TableCell>
            )}
          </TableRow>
        ))}
      </DataTable>
      <p className="text-xs text-muted-foreground">
        AI usage is the share of default branch commits that are AI-assisted, from 1 to 5
        <InfoTip term="aiUsage" />. Gates counts the gates present, green or yellow, in every phase,
        out of those that apply
        <InfoTip term="gates" />. The trend is the engineering score from 0 to 100
        <InfoTip term="engineeringScore" />. Environment is the furthest one the application has
        deployed to successfully, PRO or PRE, read from the name of its resource group
        <InfoTip term="finalEnvironment" />.
      </p>
    </div>
  )
}
