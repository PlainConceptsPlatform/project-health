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
import { Mark, Partial, VerdictBadge, VersionCell } from '@/shared/ui/agentic'
import { PROJECT_LINK } from '@/shared/ui/project-link'
import { type Column, ResponsiveTable } from '@/shared/ui/responsive-table'

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
  const of = (row: AgenticRow) => row.adoption as AgenticAdoption
  const columns: Column<AgenticRow>[] = [
    {
      key: 'project',
      label: 'Project',
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <a href={withBase(`/projects/${row.id}/#agentic`)} className={PROJECT_LINK}>
            {row.name}
          </a>
          {row.verdict ? <VerdictBadge verdict={row.verdict} /> : null}
        </div>
      ),
    },
    {
      key: 'harness',
      label: 'Agent harness',
      cell: (row) => {
        const a = of(row)
        return (
          <VersionCell
            version={a.harness.version}
            latest={a.harness.latest}
            fallback={
              a.harness.legacy ? `opencode-onboard ${a.harness.legacyVersion ?? ''}`.trim() : null
            }
          />
        )
      },
    },
    {
      key: 'workflows',
      label: 'Agentic workflows',
      cell: (row) => (
        <VersionCell version={of(row).workflows.version} latest={of(row).workflows.latest} />
      ),
    },
    {
      key: 'workers',
      label: 'Router and workers',
      className: 'max-w-[260px]',
      cell: (row) => <WorkersCell adoption={of(row)} />,
    },
    {
      key: 'evidence',
      label: 'Evidence',
      cell: (row) => (
        <Mark
          ok={of(row).workflows.evidence}
          label={
            of(row).workflows.evidence ? 'Evidence screenshots on merge' : 'No evidence workflow'
          }
        />
      ),
    },
    {
      key: 'verify',
      label: 'Verify plan',
      cell: (row) => {
        const v = of(row).verifyEnvironment
        return (
          <Mark
            ok={v}
            label={
              v === null
                ? 'No verify skill'
                : v
                  ? 'Records how to start the app'
                  : 'Still the shipped defaults'
            }
          />
        )
      },
    },
    {
      key: 'bot',
      label: 'Bot pull requests',
      cell: (row) => <BotCell adoption={of(row)} month={row.month ?? undefined} />,
    },
    { key: 'gate', label: 'Merged by the gate', cell: (row) => <GateCell adoption={of(row)} /> },
  ]
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
      <ResponsiveTable
        label="Agentic adoption by project"
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        note={(row) =>
          row.adoption ? null : <span className="text-muted-foreground">{row.reason}</span>
        }
      />
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
