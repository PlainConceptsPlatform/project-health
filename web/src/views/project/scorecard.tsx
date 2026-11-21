import { typeLabel } from '@/shared/lib/scorecard'
import type { MonthlyReport, Scorecard } from '@/shared/lib/types'
import { Badge, InfoTip, Metric, Panel, type PanelSection, Stat } from '@/shared/ui'
import { AiUsageValue, AlertBadge, LevelBadge, ScorecardLegend } from '@/shared/ui/scorecard'
import { PracticeTables } from './practice-filter'

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
            ? `${card.aiUsage.data.aiCommits} of ${card.aiUsage.data.totalCommits} commits${card.window ? `, last ${card.window.days} days` : ''}`
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
  section,
}: {
  report: MonthlyReport
  typeLabels: Record<string, string>
  section?: PanelSection
}) {
  return (
    <Panel
      section={section}
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
              {card.window ? (
                <span className="text-xs text-muted-foreground">
                  · AI usage and facets over the last {card.window.days} days, while the month is in
                  progress
                </span>
              ) : null}
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

            <PracticeTables practices={card.practices} />
          </div>
        )}
      </Metric>
    </Panel>
  )
}
