import { shortDate } from '@/shared/lib/format'
import { PHASES, typeLabel } from '@/shared/lib/scorecard'
import type { MonthlyReport, PracticeResult, Scorecard } from '@/shared/lib/types'
import { Badge, DataTable, InfoTip, Metric, Panel, Stat, TableCell, TableRow } from '@/shared/ui'
import {
  AiUsageValue,
  AlertBadge,
  LevelBadge,
  ModeIcon,
  ScorecardLegend,
  StatusDot,
} from '@/shared/ui/scorecard'

const HEAD = ['#', 'Practice', 'Description', 'Tool(s)', 'Mode', 'Status', 'Source', 'Last run']

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

function PracticeRow({ practice }: { practice: PracticeResult }) {
  return (
    <TableRow className={practice.applicable ? undefined : 'text-muted-foreground'}>
      <TableCell className="tabular-nums text-muted-foreground">{practice.number}</TableCell>
      <TableCell className="font-medium">{practice.name}</TableCell>
      <TableCell className="min-w-72 max-w-md whitespace-normal text-xs text-muted-foreground">
        {practice.description}
      </TableCell>
      <TableCell className="max-w-56 whitespace-normal text-xs">
        {practice.tools.length > 0 ? practice.tools.join(', ') : 'none found'}
        {practice.mode === 'report-only' ? (
          <span className="block text-muted-foreground">report-only</span>
        ) : null}
      </TableCell>
      <TableCell>
        <ModeIcon mode={practice.standardMode} />
      </TableCell>
      <TableCell>
        <StatusDot rag={practice.rag} reason={practice.reason} />
      </TableCell>
      <TableCell>
        <SourceCell practice={practice} />
      </TableCell>
      <TableCell>
        <LastRunCell practice={practice} />
      </TableCell>
    </TableRow>
  )
}

function Summary({ card, typeLabels }: { card: Scorecard; typeLabels: Record<string, string> }) {
  return (
    <div className="grid grid-cols-2 gap-5 rounded-md border bg-muted/30 p-4 sm:grid-cols-4">
      <Stat
        label="Engineering level"
        explain="engineeringLevel"
        value={<LevelBadge level={card.level} />}
        hint={typeLabel(card.projectType, typeLabels)}
      />
      <Stat
        label="Engineering score"
        explain="engineeringScore"
        value={card.score ?? 'n/a'}
        hint="0 to 100"
      />
      <Stat
        label="Gates"
        explain="gates"
        value={`${card.gates.present}/${card.gates.applicable}`}
        hint="present / applicable"
      />
      <Stat
        label="AI usage"
        explain="aiUsage"
        value={<AiUsageValue usage={card.aiUsage} />}
        hint={
          card.aiUsage.available
            ? `${card.aiUsage.data.aiCommits} of ${card.aiUsage.data.totalCommits} commits`
            : card.aiUsage.reason
        }
      />
    </div>
  )
}

/**
 * Every practice, grouped by when it runs, with the evidence behind its colour. Projects that
 * publish no facets say so up front, because every cell is then a heuristic over workflow files.
 */
export function ScorecardPanel({
  report,
  typeLabels,
}: {
  report: MonthlyReport
  typeLabels: Record<string, string>
}) {
  return (
    <Panel
      title="Engineering scorecard"
      description="Which practices guard this project on its default branch, in which mode, and whether they last passed."
    >
      <Metric block={report.scorecard}>
        {(card) => (
          <div className="space-y-5">
            <Summary card={card} typeLabels={typeLabels} />

            <div className="flex flex-wrap items-center gap-2">
              {!card.facetsPublished ? (
                <Badge variant="outline" className="border-info/50 bg-info/10 text-foreground">
                  Detected from workflows — no facets published
                </Badge>
              ) : (
                <Badge variant="secondary">Facets published</Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {card.workflowsScanned} workflow file{card.workflowsScanned === 1 ? '' : 's'} read
                on {card.defaultBranch ?? 'the default branch'}
                <InfoTip term="scorecardSource" />
              </span>
            </div>

            {card.alerts.length > 0 ? (
              <div className="space-y-2">
                {card.alerts.map((alert) => (
                  <div key={alert.code} className="flex flex-wrap items-start gap-2">
                    <AlertBadge alert={alert} />
                    <p className="text-sm text-muted-foreground">{alert.message}</p>
                  </div>
                ))}
              </div>
            ) : null}

            <ScorecardLegend />

            {PHASES.map((phase) => {
              const practices = card.practices.filter((p) => p.phase === phase.key)
              if (practices.length === 0) return null
              return (
                <div key={phase.key}>
                  <p className="mb-2 text-sm font-medium">{phase.label}</p>
                  <DataTable head={HEAD}>
                    {practices.map((practice) => (
                      <PracticeRow key={practice.id} practice={practice} />
                    ))}
                  </DataTable>
                </div>
              )
            })}
          </div>
        )}
      </Metric>
    </Panel>
  )
}
