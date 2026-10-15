import { VERDICT_DESCRIPTION, gateShare, verdictOf } from '@/shared/lib/agentic'
import { addedDensity, percent } from '@/shared/lib/code'
import { shortDate } from '@/shared/lib/format'
import type { MonthlyReport } from '@/shared/lib/types'
import { Metric, Panel } from '@/shared/ui'
import { Mark, VerdictBadge, VersionCell } from '@/shared/ui/agentic'
import type { ReactNode } from 'react'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t py-3 first:border-t-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}

/**
 * How this project runs agents against the platform's standard: the agent harness, the agentic
 * workflows router and its workers, the evidence replay, and whether the bot is shipping.
 */
export function AdoptionPanel({ report }: { report: MonthlyReport }) {
  return (
    <Panel
      title="Agent tooling"
      description="Read from the default branch: the installed agent harness and agentic workflows, against the newest releases on npm."
    >
      <Metric block={report.agentic}>
        {(a) => {
          const verdict = verdictOf(a)
          return (
            <div className="grid gap-8 lg:grid-cols-2">
              <div>
                <div className="mb-4 flex flex-col gap-2">
                  <VerdictBadge verdict={verdict} />
                  <p className="text-sm text-muted-foreground">{VERDICT_DESCRIPTION[verdict]}</p>
                </div>
                <Row label="Agent harness">
                  <VersionCell
                    version={a.harness.version}
                    latest={a.harness.latest}
                    fallback={
                      a.harness.legacy
                        ? `opencode-onboard ${a.harness.legacyVersion ?? ''}`.trim()
                        : null
                    }
                  />
                </Row>
                <Row label="Agentic workflows">
                  <VersionCell version={a.workflows.version} latest={a.workflows.latest} />
                </Row>
                <Row label="Work router">
                  <Mark
                    ok={a.workflows.router}
                    label={a.workflows.router ? 'Installed' : 'Absent'}
                  />
                </Row>
                <Row label="Evidence on merge">
                  <Mark
                    ok={a.workflows.evidence}
                    label={a.workflows.evidence ? 'Installed' : 'Absent'}
                  />
                </Row>
                <Row label="Verify plan knows how to start the app">
                  <Mark
                    ok={a.verifyEnvironment}
                    label={
                      a.verifyEnvironment === null
                        ? 'No verify skill'
                        : a.verifyEnvironment
                          ? 'Recorded'
                          : 'Still the shipped defaults'
                    }
                  />
                </Row>
                <Row label={`Bot pull requests merged, titled “${a.bot.prefix}”`}>
                  <span className="tabular-nums">
                    {a.bot.merged} this month
                    {a.bot.lastMergedAt ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · last {shortDate(a.bot.lastMergedAt)}
                      </span>
                    ) : null}
                  </span>
                </Row>
                {a.bot.outcomes && gateShare(a.bot.outcomes) !== null ? (
                  <Row label="Merged by the gate">
                    <span className="tabular-nums">
                      {percent(gateShare(a.bot.outcomes))}
                      <span className="text-muted-foreground">
                        {' '}
                        · {a.bot.outcomes.gate} by the gate · {a.bot.outcomes.parked} parked for a
                        person · {a.bot.outcomes.person} merged by hand
                      </span>
                    </span>
                  </Row>
                ) : null}
                {a.bot.added && a.bot.added.pullRequests > 0 ? (
                  <Row label="What those pull requests added">
                    <span className="tabular-nums">
                      +{a.bot.added.codeLines} code · +{a.bot.added.commentLines} comment (
                      {percent(addedDensity(a.bot.added))}) · +{a.bot.added.testLines} test
                    </span>
                  </Row>
                ) : null}
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Workers
                </p>
                {a.workflows.workers.map((w) => (
                  <Row key={w.name} label={`agent-${w.name}`}>
                    <Mark ok={w.present} label={w.present ? 'Installed' : 'Missing'} />
                  </Row>
                ))}
                {a.workflows.retired.map((name) => (
                  <Row key={name} label={`${name} (retired)`}>
                    <span className="text-sm text-warning-foreground dark:text-warning">
                      Still installed
                    </span>
                  </Row>
                ))}
                {a.workflows.custom.length > 0 ? (
                  <>
                    <p className="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Own agent workflows
                    </p>
                    <ul className="space-y-1 font-mono text-xs text-muted-foreground">
                      {a.workflows.custom.map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </div>
            </div>
          )
        }}
      </Metric>
    </Panel>
  )
}
