import { percent } from '@/shared/lib/code'
import { type FamilyRow, MODE_DESCRIPTION, MODE_LABEL, lagLabel } from '@/shared/lib/family'
import type { Family } from '@/shared/lib/types'
import { withBase } from '@/shared/lib/utils'
import { Badge, cn } from '@/shared/ui'
import { Sparkline } from '@/shared/ui/sparkline'

const COLUMNS = ['Project', 'Mode', 'Identical', 'Modified', 'Missing', 'Exceptions', 'Template']

function Identical({ family, row }: { family: Family; row: FamilyRow }) {
  const share = family.identicalShare
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-base font-semibold tabular-nums">{percent(share)}</span>
        <div className="h-[5px] w-28 overflow-hidden rounded-full bg-muted">
          <div
            className="h-[5px] rounded-full bg-primary/60"
            style={{ width: `${Math.round((share ?? 0) * 100)}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {family.counts.identical} of {family.counts.platform} files
        </span>
      </div>
      {row.trend.length > 1 ? (
        <Sparkline
          points={row.trend}
          max={100}
          width={72}
          label={`${row.name} identical files, last ${row.trend.length} days`}
        />
      ) : null}
    </div>
  )
}

function Exceptions({ family }: { family: Family }) {
  const { active, expired } = family.exceptions
  if (active.length + expired.length === 0) {
    return <span className="text-sm text-muted-foreground">None</span>
  }
  return (
    <span className="flex flex-col">
      <span className="tabular-nums">{active.length} active</span>
      <span
        className={cn(
          'text-xs tabular-nums',
          expired.length > 0 ? 'font-semibold text-destructive' : 'text-muted-foreground',
        )}
      >
        {expired.length} expired
      </span>
    </span>
  )
}

function Template({ family }: { family: Family }) {
  const t = family.template
  return (
    <span className="flex flex-col">
      <span className="font-mono text-xs">{t.tag ?? family.reference.ref}</span>
      <span
        className={cn(
          'text-xs',
          t.lag ? 'text-warning-foreground dark:text-warning' : 'text-muted-foreground',
        )}
      >
        {lagLabel(t)}
        {t.latest && t.lag !== 0 ? ` · newest ${t.latest}` : ''}
      </span>
    </span>
  )
}

/**
 * How alike the family's apps are: each member's platform files against the template. Projects
 * that keep their own design on purpose are listed with their reason, never as a failure.
 */
export function FamilyTable({ rows }: { rows: FamilyRow[] }) {
  const members = rows.filter((r) => r.family === 'kitchen-sink')
  const compared = members.filter((r) => r.drift && !r.drift.isReference)
  const identical = compared.reduce((n, r) => n + (r.drift?.counts.identical ?? 0), 0)
  const platform = compared.reduce((n, r) => n + (r.drift?.counts.platform ?? 0), 0)
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Platform code of each Kitchen-Sink family app against the template, read daily from the
        default branch.{' '}
        {platform > 0 ? (
          <>
            Across the apps,{' '}
            <span className="font-semibold text-foreground tabular-nums">
              {identical} of {platform}
            </span>{' '}
            platform files are identical to the template.
          </>
        ) : null}
      </p>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[1000px] text-sm">
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
              const f = row.drift
              const own = row.family === 'own-design'
              return (
                <tr
                  key={row.id}
                  className={cn('border-t align-middle', own && 'text-muted-foreground')}
                >
                  <td className="px-4 py-3.5">
                    <div className="flex flex-col gap-1">
                      <a
                        href={withBase(`/projects/${row.id}/${own ? '' : '#family'}`)}
                        className={cn(
                          'text-[15px] font-semibold hover:underline',
                          own && 'opacity-70',
                        )}
                      >
                        {row.name}
                      </a>
                      {f?.isReference ? <Badge variant="secondary">Template</Badge> : null}
                      {own ? <Badge variant="outline">Own design</Badge> : null}
                    </div>
                  </td>
                  {own ? (
                    <td colSpan={COLUMNS.length - 1} className="px-4 py-3.5 text-xs">
                      {row.familyReason}
                    </td>
                  ) : f ? (
                    <>
                      <td className="px-4 py-3.5" title={MODE_DESCRIPTION[f.mode]}>
                        {MODE_LABEL[f.mode]}
                      </td>
                      <td className="px-4 py-3.5">
                        <Identical family={f} row={row} />
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="font-semibold tabular-nums">{f.counts.modified}</span>
                        {f.mode === 'baseline' ? (
                          <div className="text-xs text-muted-foreground tabular-nums">
                            and {f.counts.similar} at least 90% alike
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="font-semibold tabular-nums">{f.counts.missing}</span>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {f.counts.extra} only in the app
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <Exceptions family={f} />
                      </td>
                      <td className="px-4 py-3.5">
                        <Template family={f} />
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
        Manifest mode reads <code>.platform/manifest</code> and compares byte for byte with the
        template tag in <code>.copier-answers.yml</code>. Baseline mode is for apps that have not
        adopted the template yet: a provisional list of platform paths, with app names normalised,
        compared with the template’s default branch. Modified files differ from the template;
        missing ones are in the template but not in the app. An exception in{' '}
        <code>.platform/exceptions.yml</code> lets a file differ until it expires.
      </p>
    </div>
  )
}
