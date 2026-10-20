import {
  type AgenticRow,
  type AgenticVerdict,
  VERDICT_LABEL,
  gateShare,
  verdictCounts,
} from '@/shared/lib/agentic'
import { percent } from '@/shared/lib/code'
import { shortDate } from '@/shared/lib/format'
import type { AgenticAdoption } from '@/shared/lib/types'
import { withBase } from '@/shared/lib/utils'
import { cn } from '@/shared/ui'
import { Mark, Partial, VerdictBadge, VersionCell } from '@/shared/ui/agentic'

const COLUMNS = [
  'Project',
  'Agent harness',
  'Agentic workflows',
  'Router and workers',
  'Evidence',
  'Verify plan',
  'Bot pull requests',
  'Merged by the gate',
]

/** The router and the standard workers, or what the repository runs instead. */
export function WorkersCell({ adoption }: { adoption: AgenticAdoption }) {
  const w = adoption.workflows
  if (adoption.setup !== 'standard') {
    if (w.custom.length === 0) return <Mark ok={false} label="No agent workflows" />
    return (
      <Partial title={w.custom.join('\n')}>
        Own: {w.custom.slice(0, 3).join(', ')}
        {w.custom.length > 3 ? ` and ${w.custom.length - 3} more` : ''}
      </Partial>
    )
  }
  const present = w.workers.filter((x) => x.present).length
  const missing = w.workers.filter((x) => !x.present).map((x) => x.name)
  if (missing.length === 0 && w.retired.length === 0) {
    return <Mark ok label={`Router and all ${present} workers`} />
  }
  return (
    <Partial
      title={[
        missing.length ? `Missing: ${missing.join(', ')}` : '',
        w.retired.length ? `Retired, still installed: ${w.retired.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n')}
    >
      {present} of {w.workers.length} workers
      {w.retired.length ? `, with ${w.retired.join(', ')} (retired)` : ''}
    </Partial>
  )
}

export function BotCell({ adoption, month }: { adoption: AgenticAdoption; month?: string }) {
  const { merged, lastMergedAt } = adoption.bot
  if (!lastMergedAt) return <span className="text-sm text-muted-foreground">None</span>
  return (
    <span className="flex flex-col">
      <span className="tabular-nums">
        {merged}{' '}
        <span className="text-xs text-muted-foreground">{month ? 'in the month' : ''}</span>
      </span>
      <span className="text-xs text-muted-foreground">last {shortDate(lastMergedAt)}</span>
    </span>
  )
}

/** How the month's bot pull requests got merged: by the gate, or by a person (parked or not). */
export function GateCell({ adoption }: { adoption: AgenticAdoption }) {
  const o = adoption.bot.outcomes
  const share = gateShare(o)
  if (!o || share === null) {
    return (
      <span className="text-sm text-muted-foreground">{o ? 'None merged' : 'Not counted'}</span>
    )
  }
  return (
    <span className="flex flex-col">
      <span className="tabular-nums">{percent(share)}</span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {o.gate} gate · {o.parked} parked · {o.person} by hand
      </span>
    </span>
  )
}

const SUMMARY: AgenticVerdict[] = ['aligned', 'behind', 'custom', 'none']

/**
 * Every project against the platform's way of running agents: the harness that runs them, the
 * workflows that route work to them, and whether the bot is shipping. Read from each default branch.
 */
export function AgenticTable({ rows }: { rows: AgenticRow[] }) {
  const counts = verdictCounts(rows)
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {SUMMARY.map((v, i) => (
          <span key={v}>
            {i > 0 ? ' · ' : ''}
            <span className="font-semibold text-foreground tabular-nums">{counts[v]}</span>{' '}
            {VERDICT_LABEL[v].toLowerCase()}
          </span>
        ))}
      </p>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[1080px] text-sm">
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
              const a = row.adoption
              return (
                <tr key={row.id} className="border-t align-middle">
                  <td className="px-4 py-3.5">
                    <div className="flex flex-col gap-1">
                      <a
                        href={withBase(`/projects/${row.id}/#agentic`)}
                        className="text-[15px] font-semibold hover:underline"
                      >
                        {row.name}
                      </a>
                      {row.verdict ? <VerdictBadge verdict={row.verdict} /> : null}
                    </div>
                  </td>
                  {a ? (
                    <>
                      <td className="px-4 py-3.5">
                        <VersionCell
                          version={a.harness.version}
                          latest={a.harness.latest}
                          fallback={
                            a.harness.legacy
                              ? `opencode-onboard ${a.harness.legacyVersion ?? ''}`.trim()
                              : null
                          }
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <VersionCell version={a.workflows.version} latest={a.workflows.latest} />
                      </td>
                      <td className={cn('px-4 py-3.5', 'max-w-[260px]')}>
                        <WorkersCell adoption={a} />
                      </td>
                      <td className="px-4 py-3.5">
                        <Mark
                          ok={a.workflows.evidence}
                          label={
                            a.workflows.evidence
                              ? 'Evidence screenshots on merge'
                              : 'No evidence workflow'
                          }
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <Mark
                          ok={a.verifyEnvironment}
                          label={
                            a.verifyEnvironment === null
                              ? 'No verify skill'
                              : a.verifyEnvironment
                                ? 'Records how to start the app'
                                : 'Still the shipped defaults'
                          }
                        />
                      </td>
                      <td className="px-4 py-3.5">
                        <BotCell adoption={a} month={row.month ?? undefined} />
                      </td>
                      <td className="px-4 py-3.5">
                        <GateCell adoption={a} />
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
        Versions are the installed ones, read from <code>.opencode/harness.json</code> and the
        workflows' own headers, against the newest on npm. Bot pull requests are the merged ones
        titled “[bot]”, which the implement worker opens. Merged by the gate is the share of them
        the merge gate's App merged itself; parked ones got a review verdict and a person merged
        them, by hand ones a person merged without the gate parking them.
      </p>
    </div>
  )
}
