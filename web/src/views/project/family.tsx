import { percent } from '@/shared/lib/code'
import {
  MODE_DESCRIPTION,
  MODE_LABEL,
  identicalTrend,
  lagLabel,
  templateName,
} from '@/shared/lib/family'
import type { DailyScore } from '@/shared/lib/scorecard'
import type { Family, FamilyException, FamilyFile, MonthlyReport } from '@/shared/lib/types'
import { Badge, DataTable, Metric, Panel, Stat, TableCell, TableRow, cn } from '@/shared/ui'
import { Sparkline } from '@/shared/ui/sparkline'

const blob = (repo: string, ref: string, path: string) =>
  `https://github.com/${repo}/blob/${ref}/${path}`

function Paths({
  title,
  files,
  href,
}: {
  title: string
  files: (FamilyFile | string)[]
  href: (path: string) => string
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title} <span className="tabular-nums">({files.length})</span>
      </p>
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">None.</p>
      ) : (
        <ul className="max-h-80 space-y-1 overflow-y-auto pr-2 text-xs">
          {files.map((file) => {
            const f = typeof file === 'string' ? { path: file, similarity: null } : file
            return (
              <li key={f.path} className="flex items-center justify-between gap-3">
                <a href={href(f.path)} className="truncate font-mono hover:underline">
                  {f.path}
                </a>
                <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground tabular-nums">
                  {f.excepted ? <Badge variant="outline">Exception</Badge> : null}
                  {f.similarity !== null ? `${Math.round(f.similarity * 100)}% alike` : null}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function ExceptionRows({ rows, expired }: { rows: FamilyException[]; expired: boolean }) {
  return rows.map((e) => (
    <TableRow key={`${e.path}-${e.expires}`}>
      <TableCell className="max-w-[360px] truncate font-mono text-xs">{e.path}</TableCell>
      <TableCell className="min-w-[240px] whitespace-normal text-sm">
        {e.reason ?? 'No reason given'}
      </TableCell>
      <TableCell className="text-sm">
        {e.issue ? (
          <a href={e.issue} className="hover:underline">
            {e.issue.replace(/^https:\/\/github\.com\//, '')}
          </a>
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </TableCell>
      <TableCell
        className={cn('tabular-nums', expired ? 'font-semibold text-destructive' : undefined)}
      >
        {e.expires ?? 'No date'}
        {expired ? ' (expired)' : ''}
      </TableCell>
    </TableRow>
  ))
}

function Drift({ family, repo, daily }: { family: Family; repo: string; daily: DailyScore[] }) {
  const trend = identicalTrend(daily)
  const c = family.counts
  const { active, expired } = family.exceptions
  const ref = family.reference
  const own = (path: string) => blob(repo, 'HEAD', path)
  const template = (path: string) => blob(ref.repo, ref.ref, path)
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="secondary">{MODE_LABEL[family.mode]}</Badge>
        <span className="font-semibold text-foreground">{templateName(family)}</span>
        {family.isReference ? <Badge variant="outline">This is the template</Badge> : null}
        <span>{MODE_DESCRIPTION[family.mode]}</span>
      </div>

      <div className="grid grid-cols-2 gap-6 lg:grid-cols-5">
        <Stat
          label="Identical"
          value={percent(family.identicalShare)}
          hint={`${c.identical} of ${c.platform} platform files`}
        />
        <Stat
          label="Modified"
          value={c.modified}
          hint={family.mode === 'baseline' ? `and ${c.similar} at least 90% alike` : undefined}
        />
        <Stat label="Missing" value={c.missing} hint={`${c.extra} only in the app`} />
        <Stat
          label="Exceptions"
          value={active.length}
          tone={expired.length > 0 ? 'bad' : undefined}
          hint={`${expired.length} expired`}
        />
        <Stat
          label="Template"
          value={<span className="font-mono text-lg">{family.template.tag ?? ref.ref}</span>}
          hint={`${lagLabel(family.template, family.mode)}${family.template.latest ? ` · newest ${family.template.latest}` : ''}`}
        />
      </div>

      {trend.length > 1 ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Sparkline
            points={trend}
            max={100}
            width={180}
            height={36}
            label="Identical platform files by day"
          />
          Identical platform files, last {trend.length} days
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-2">
        <Paths title="Modified" files={family.files.modified} href={own} />
        <Paths title="Missing from the app" files={family.files.missing} href={template} />
        {family.mode === 'baseline' ? (
          <Paths title="At least 90% alike" files={family.files.similar} href={own} />
        ) : null}
        <Paths title="Only in the app" files={family.files.extra} href={own} />
      </div>
      {family.truncated ? (
        <p className="text-xs text-muted-foreground">
          Each list shows its first 300 paths; the counts above cover every file.
        </p>
      ) : null}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Exceptions
        </p>
        {active.length + expired.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <DataTable head={['Path', 'Reason', 'Issue', 'Expires']}>
            <ExceptionRows rows={expired} expired />
            <ExceptionRows rows={active} expired={false} />
          </DataTable>
        )}
      </div>
    </div>
  )
}

/** How far this app's platform code has drifted from the family template. */
export function FamilyPanel({
  report,
  daily = [],
}: {
  report: MonthlyReport
  daily?: DailyScore[]
}) {
  return (
    <Panel
      title="Family"
      description={`Platform code against ${
        report.family?.available ? templateName(report.family.data) : 'its template'
      }, read daily from the default branch.`}
    >
      <Metric block={report.family}>
        {(f) => <Drift family={f} repo={report.repo} daily={daily} />}
      </Metric>
    </Panel>
  )
}
