import type { ExcellenceHistory } from '@/shared/lib/data'
import {
  type ExcellenceKpis,
  debtTrend,
  kpisOf,
  moduleRows,
  scopeTrends,
  topHotspots,
} from '@/shared/lib/excellence'
import { monthName, percent } from '@/shared/lib/format'
import type {
  ComplexityGate,
  EngineeringExcellence,
  MonthlyReport,
  Severities,
} from '@/shared/lib/types'
import {
  Badge,
  DataTable,
  Metric,
  Panel,
  Stat,
  TableCell,
  TableRow,
  Unavailable,
} from '@/shared/ui'
import { ScopeTrend } from '@/shared/ui/charts'

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const

const rate = (v: number | null) => (v === null ? 'n/a' : percent(v))

/**
 * The change against the previous month, worded so its direction is never left to colour alone.
 * A rate moves in percentage points, a count in units.
 */
function delta(
  current: number | null,
  previous: number | null | undefined,
  kind: 'rate' | 'count',
  month: string | undefined,
): string | undefined {
  if (current === null || previous === null || previous === undefined || !month) return undefined
  const diff = current - previous
  const short = monthName(month).split(' ')[0]?.slice(0, 3)
  if (Math.abs(diff) < 1e-9) return `unchanged vs ${short}`
  const sign = diff > 0 ? '+' : '−'
  const amount =
    kind === 'rate' ? `${Math.round(Math.abs(diff) * 1000) / 10} pp` : String(Math.abs(diff))
  return `${sign}${amount} vs ${short}`
}

/**
 * The change in a backlog that should only shrink. An arrow and the words carry the direction, and
 * the value turns red only when the backlog grew, so a fall never reads as a warning.
 */
function debtDelta(current: number, previous: number | null | undefined, month?: string) {
  if (previous === null || previous === undefined || !month) return { text: undefined, grew: false }
  const diff = current - previous
  const short = monthName(month).split(' ')[0]?.slice(0, 3)
  if (diff === 0) return { text: `unchanged vs ${short}`, grew: false }
  return diff < 0
    ? { text: `▼ ${-diff} fewer vs ${short}`, grew: false }
    : { text: `▲ ${diff} more vs ${short}`, grew: true }
}

function DebtStat({
  debt,
  gate,
  previous,
  month,
}: {
  debt: number
  gate: ComplexityGate | null | undefined
  previous: number | null | undefined
  month?: string
}) {
  const change = debtDelta(debt, previous, month)
  const detail = gate ? `${gate.violations} new, ${gate.justified} justified` : undefined
  return (
    <Stat
      label="Complexity debt"
      explain="complexityDebt"
      value={debt}
      tone={change.grew ? 'bad' : undefined}
      hint={[change.text, detail].filter(Boolean).join(' · ') || 'baselined methods'}
    />
  )
}

function Kpis({
  kpis,
  previous,
  gate,
}: {
  kpis: ExcellenceKpis
  previous: ExcellenceHistory['previous']
  gate: ComplexityGate | null | undefined
}) {
  const p = previous?.kpis
  const m = previous?.month
  const hasDebt = kpis.complexityDebt !== null
  return (
    <div
      className={`grid grid-cols-2 gap-5 rounded-md border bg-muted/30 p-4 sm:grid-cols-3 ${hasDebt ? 'lg:grid-cols-6' : 'lg:grid-cols-5'}`}
    >
      <Stat
        label="Coverage"
        explain="coverage"
        value={rate(kpis.coverage)}
        hint={delta(kpis.coverage, p?.coverage, 'rate', m) ?? 'lines, all scopes'}
      />
      <Stat
        label="Mutation"
        explain="mutationScore"
        value={rate(kpis.mutation)}
        hint={delta(kpis.mutation, p?.mutation, 'rate', m) ?? 'covered score'}
      />
      <Stat
        label="CRAP > 30"
        explain="crap"
        value={kpis.crapOver30 ?? 'n/a'}
        hint={delta(kpis.crapOver30, p?.crapOver30, 'count', m) ?? 'methods'}
      />
      <Stat
        label="Critical + high"
        explain="vulnerabilities"
        value={kpis.criticalHigh ?? 'n/a'}
        tone={kpis.criticalHigh !== null && kpis.criticalHigh > 0 ? 'bad' : undefined}
        hint={delta(kpis.criticalHigh, p?.criticalHigh, 'count', m) ?? 'vulnerabilities'}
      />
      <Stat
        label="Components"
        explain="sbomComponents"
        value={kpis.components ?? 'n/a'}
        hint={delta(kpis.components, p?.components, 'count', m) ?? 'in the SBOM'}
      />
      {kpis.complexityDebt !== null ? (
        <DebtStat debt={kpis.complexityDebt} gate={gate} previous={p?.complexityDebt} month={m} />
      ) : null}
    </div>
  )
}

function Trends({
  title,
  trends,
}: {
  title: string
  trends: ReturnType<typeof scopeTrends>
}) {
  const drawable = trends.filter((t) => t.points.length > 1)
  return (
    <div>
      <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
      {drawable.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {drawable.map((t) => (
            <div key={t.scope}>
              <p className="mb-1 text-sm font-medium">{t.scope}</p>
              <ScopeTrend label={t.scope} points={t.points} floor={t.floor} />
            </div>
          ))}
        </div>
      ) : (
        <Unavailable reason="A trend needs at least two samples. One is added for every collected main branch run that uploaded this facet." />
      )}
    </div>
  )
}

function ModulesTable({ excellence }: { excellence: EngineeringExcellence }) {
  const rows = moduleRows(excellence)
  if (rows.length === 0) {
    return <Unavailable reason="No facet in this period carried a per-module breakdown." />
  }
  return (
    <DataTable head={['Scope', 'Module', 'Coverage', 'Mutation', 'CC > 10', 'CRAP > 30']}>
      {rows.map((r) => (
        <TableRow key={`${r.scope}/${r.module}`}>
          <TableCell className="text-muted-foreground">{r.scope}</TableCell>
          <TableCell className="font-medium">{r.module}</TableCell>
          <TableCell className="tabular-nums">{rate(r.lineRate)}</TableCell>
          <TableCell className="tabular-nums">{rate(r.coveredScore)}</TableCell>
          <TableCell className="tabular-nums">{r.over10 ?? 'n/a'}</TableCell>
          <TableCell className="tabular-nums">{r.crapOver30 ?? 'n/a'}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  )
}

function HotspotsTable({
  excellence,
  repo,
}: {
  excellence: EngineeringExcellence
  repo: string
}) {
  const hotspots = topHotspots(excellence)
  if (hotspots.length === 0) {
    return (
      <Unavailable reason="No method is above the CRAP threshold, or complexity was not collected." />
    )
  }
  const sha = excellence.complexity.available
    ? excellence.complexity.data.samples.at(-1)?.commitSha
    : null
  return (
    <DataTable head={['Method', 'Module', 'CC', 'Coverage', 'CRAP']}>
      {hotspots.map((h) => (
        <TableRow key={`${h.file}:${h.line}:${h.method}`}>
          <TableCell>
            {sha ? (
              <a
                href={`https://github.com/${repo}/blob/${sha}/${h.file}${h.line ? `#L${h.line}` : ''}`}
                className="font-mono text-xs hover:underline"
              >
                {h.method}
              </a>
            ) : (
              <span className="font-mono text-xs">{h.method}</span>
            )}
          </TableCell>
          <TableCell className="text-muted-foreground">
            {h.scope} / {h.module}
          </TableCell>
          <TableCell className="tabular-nums">{h.cc}</TableCell>
          <TableCell className="tabular-nums">{percent(h.coverage)}</TableCell>
          <TableCell className="tabular-nums">{Math.round(h.crap)}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  )
}

function SeverityRow({ label, counts }: { label: string; counts: Severities }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{label}</TableCell>
      {SEVERITIES.map((s) => (
        <TableCell key={s} className="tabular-nums">
          {counts[s]}
        </TableCell>
      ))}
    </TableRow>
  )
}

function SecuritySection({ excellence }: { excellence: EngineeringExcellence }) {
  return (
    <Metric block={excellence.security}>
      {({ latest }) => (
        <div className="space-y-4">
          {latest.trivy ? (
            <DataTable head={['Trivy', ...SEVERITIES.map((s) => s.toLowerCase())]}>
              <SeverityRow label="Vulnerabilities" counts={latest.trivy.vuln} />
              <SeverityRow label="Misconfigurations" counts={latest.trivy.misconfig} />
              <SeverityRow label="Secrets" counts={latest.trivy.secret} />
            </DataTable>
          ) : (
            <Unavailable reason="This run did not include a Trivy report." />
          )}
          <div className="grid grid-cols-3 gap-4">
            {latest.trivy ? (
              <Stat label="Fixable" value={latest.trivy.fixableVulns} hint="vulnerabilities" />
            ) : null}
            {latest.semgrep ? (
              <>
                <Stat
                  label="Semgrep errors"
                  value={latest.semgrep.ERROR}
                  tone={latest.semgrep.ERROR > 0 ? 'bad' : undefined}
                />
                <Stat
                  label="Semgrep warnings"
                  value={latest.semgrep.WARNING}
                  hint={`${latest.semgrep.INFO} info`}
                />
              </>
            ) : null}
          </div>
          {Object.keys(latest.jobs).length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(latest.jobs).map(([job, result]) => (
                <Badge key={job} variant={result === 'success' ? 'secondary' : 'destructive'}>
                  {job}: {result}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Metric>
  )
}

function SbomSection({ excellence }: { excellence: EngineeringExcellence }) {
  return (
    <Metric block={excellence.sbom}>
      {({ latest }) => {
        const ecosystems = Object.entries(latest.byEcosystem).sort(([, a], [, b]) => b - a)
        const licenses = Object.entries(latest.licenses ?? {})
          .sort(([, a], [, b]) => b - a)
          .slice(0, 8)
        return (
          <div className="grid gap-6 lg:grid-cols-2">
            <DataTable head={['Ecosystem', 'Components']}>
              {ecosystems.map(([ecosystem, count]) => (
                <TableRow key={ecosystem}>
                  <TableCell className="font-medium">{ecosystem}</TableCell>
                  <TableCell className="tabular-nums">{count}</TableCell>
                </TableRow>
              ))}
            </DataTable>
            <DataTable head={['Licence', 'Components']}>
              {licenses.map(([license, count]) => (
                <TableRow key={license}>
                  <TableCell className="font-medium">{license}</TableCell>
                  <TableCell className="tabular-nums">{count}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="text-muted-foreground">No licence declared</TableCell>
                <TableCell className="tabular-nums">{latest.unlicensed}</TableCell>
              </TableRow>
            </DataTable>
          </div>
        )
      }}
    </Metric>
  )
}

/**
 * Numbers the repository's own CI produces about its code: coverage, mutation score, complexity,
 * scanner findings and the SBOM. Each facet is shown as of the newest sample in the month, and the
 * trends run across every month collected so far.
 */
export function ExcellencePanel({
  report,
  history,
}: {
  report: MonthlyReport
  history: ExcellenceHistory | undefined
}) {
  const excellence = report.engineeringExcellence
  const description =
    'Reported by the repository’s own main branch CI, one sample per commit. These never gate anything here; the repository’s CI decides what fails.'

  if (!excellence) {
    return (
      <Panel title="Engineering excellence" description={description}>
        <Unavailable reason="Not collected for this month. A project opts in with engineeringExcellence.enabled in projects.json, and its CI uploads the engineering-excellence-<facet> artifacts described in the README." />
      </Panel>
    )
  }

  const coverageTrends = scopeTrends(history?.coverage ?? [], (s) => s.lineRate)
  const mutationTrends = scopeTrends(history?.mutation ?? [], (s) => s.coveredScore)
  const gate = excellence.complexity.available ? excellence.complexity.data.latest.gate : null
  const debt = gate ? debtTrend(history?.complexity ?? []) : []

  return (
    <Panel title="Engineering excellence" description={description}>
      <div className="space-y-6">
        <Kpis kpis={kpisOf(excellence)} previous={history?.previous ?? null} gate={gate} />

        <div className="grid gap-6 lg:grid-cols-2">
          <Trends title="Coverage by scope" trends={coverageTrends} />
          <Trends title="Mutation score by scope" trends={mutationTrends} />
        </div>

        {debt.length > 1 ? (
          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              Complexity debt
            </p>
            <div className="lg:w-1/2">
              <ScopeTrend label="Baselined" points={debt} floor={null} unit="count" />
            </div>
          </div>
        ) : null}

        <div>
          <p className="mb-2 text-sm font-medium">Modules</p>
          <ModulesTable excellence={excellence} />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">CRAP hotspots</p>
          <HotspotsTable excellence={excellence} repo={report.repo} />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium">Security</p>
            <SecuritySection excellence={excellence} />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Software bill of materials</p>
            <SbomSection excellence={excellence} />
          </div>
        </div>
      </div>
    </Panel>
  )
}
