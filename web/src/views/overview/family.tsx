import { percent } from '@/shared/lib/code'
import {
  type FamilyRow,
  MODE_DESCRIPTION,
  MODE_LABEL,
  lagLabel,
  templateName,
} from '@/shared/lib/family'
import type { Family } from '@/shared/lib/types'
import { withBase } from '@/shared/lib/utils'
import { Badge, cn } from '@/shared/ui'
import { PROJECT_LINK } from '@/shared/ui/project-link'
import { type Column, ResponsiveTable } from '@/shared/ui/responsive-table'
import { Sparkline } from '@/shared/ui/sparkline'

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
      <span className="text-xs font-semibold">{templateName(family)}</span>
      <span className="font-mono text-xs">{t.tag ?? family.reference.ref}</span>
      <span
        className={cn(
          'text-xs',
          t.lag ? 'text-warning-foreground dark:text-warning' : 'text-muted-foreground',
        )}
      >
        {lagLabel(t, family.mode)}
        {t.latest && t.lag !== 0 ? ` · newest ${t.latest}` : ''}
      </span>
    </span>
  )
}

const drift = (row: FamilyRow) => row.drift as Family

const COLUMNS: Column<FamilyRow>[] = [
  {
    key: 'project',
    label: 'Project',
    cell: (row) => {
      const own = row.family === 'own-design'
      return (
        <div className="flex flex-col items-start gap-1">
          <a
            href={withBase(`/projects/${row.id}/${own ? '' : '#family'}`)}
            className={cn(PROJECT_LINK, own && 'opacity-70')}
          >
            {row.name}
          </a>
          {row.drift?.isReference ? <Badge variant="secondary">Template</Badge> : null}
          {own ? <Badge variant="outline">Own design</Badge> : null}
        </div>
      )
    },
  },
  {
    key: 'mode',
    label: 'Mode',
    cell: (row) => (
      <span title={MODE_DESCRIPTION[drift(row).mode]}>{MODE_LABEL[drift(row).mode]}</span>
    ),
  },
  {
    key: 'identical',
    label: 'Identical',
    cell: (row) => <Identical family={drift(row)} row={row} />,
  },
  {
    key: 'modified',
    label: 'Modified',
    cell: (row) => (
      <>
        <span className="font-semibold tabular-nums">{drift(row).counts.modified}</span>
        {drift(row).mode === 'baseline' ? (
          <div className="text-xs text-muted-foreground tabular-nums">
            and {drift(row).counts.similar} at least 90% alike
          </div>
        ) : null}
      </>
    ),
  },
  {
    key: 'missing',
    label: 'Missing',
    cell: (row) => (
      <>
        <span className="font-semibold tabular-nums">{drift(row).counts.missing}</span>
        <div className="text-xs text-muted-foreground tabular-nums">
          {drift(row).counts.extra} only in the app
        </div>
      </>
    ),
  },
  { key: 'exceptions', label: 'Exceptions', cell: (row) => <Exceptions family={drift(row)} /> },
  { key: 'template', label: 'Template', cell: (row) => <Template family={drift(row)} /> },
]

/**
 * How alike the family's apps are: each member's platform files against the template. Projects
 * that keep their own design on purpose are listed with their reason, never as a failure.
 */
export function FamilyTable({ rows }: { rows: FamilyRow[] }) {
  const members = rows.filter((r) => r.family === 'member')
  const compared = members.filter((r) => r.drift && !r.drift.isReference)
  const templates = [...new Set(members.flatMap((r) => (r.drift ? [templateName(r.drift)] : [])))]
  const identical = compared.reduce((n, r) => n + (r.drift?.counts.identical ?? 0), 0)
  const platform = compared.reduce((n, r) => n + (r.drift?.counts.platform ?? 0), 0)
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Platform code of each family app against its template
        {templates.length > 0 ? ` (${templates.join(', ')})` : ''}, read daily from the default
        branch.{' '}
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
      <ResponsiveTable
        label="Family drift by project"
        rows={rows}
        columns={COLUMNS}
        rowKey={(row) => row.id}
        rowClassName={(row) => row.family === 'own-design' && 'text-muted-foreground'}
        note={(row) =>
          row.family === 'own-design' ? (
            row.familyReason
          ) : row.drift ? null : (
            <span
              className={cn(
                row.invalid ? 'font-semibold text-destructive' : 'text-muted-foreground',
              )}
            >
              {row.reason}
            </span>
          )
        }
      />
      <p className="text-sm text-muted-foreground">
        Contract mode reads <code>.platform/contract.yml</code>: the paths it marks as owned by the
        template, byte for byte with the template version the app records. Apps that still carry{' '}
        <code>.platform/manifest</code> and <code>.copier-answers.yml</code> are read the same way
        as an implicit contract. Baseline mode is for apps without either: a provisional list of
        platform paths, with app names normalised, compared with the default branch of the template
        configured in <code>projects.json</code>. Modified files differ from the template; missing
        ones are in the template but not in the app. An exception in the contract’s exceptions file
        lets a file differ until it expires.
      </p>
    </div>
  )
}
