import type { ExcellenceHistory } from '@/shared/lib/data'
import {
  ARCHITECTURE_LIBRARIES,
  EXPORT_TYPES,
  type ExcellenceKpis,
  PATTERN_ANALYZERS,
  architectureRules,
  architectureTools,
  baselineOf,
  checkModeLabel,
  debtTrend,
  duplicationDebtTrend,
  duplicationTrends,
  kilobytes,
  kpisOf,
  moduleRows,
  patternRules,
  patternsTools,
  scopeTrends,
  topDuplication,
  topHotspots,
  worstModulesFirst,
} from '@/shared/lib/excellence'
import { monthName, percent } from '@/shared/lib/format'
import { NOT_COLLECTED, type SectionMeta, gateStatus, practiceStatus } from '@/shared/lib/sections'
import {
  type ArchitectureDotnet,
  type ArchitectureWeb,
  type CheckGate,
  type ComplexityGate,
  type DeadCodeWeb,
  type EngineeringExcellence,
  FACETS,
  type HygieneData,
  type MonthlyReport,
  type PatternsDotnet,
  type PatternsSemgrep,
  type Severities,
} from '@/shared/lib/types'
import { Badge, DataTable, Metric, Stat, TableCell, TableRow, Unavailable } from '@/shared/ui'
import { ScopeTrend } from '@/shared/ui/charts'
import { ResponsiveTable } from '@/shared/ui/responsive-table'
import type { ReactNode } from 'react'

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

function DuplicationDebtStat({
  gate,
  previous,
  month,
}: {
  gate: NonNullable<HygieneData['gate']>
  previous: number | null | undefined
  month?: string
}) {
  const change = debtDelta(gate.baselineLines, previous, month)
  const detail = `${gate.baselinedFiles} files, ${gate.violations} over, ${gate.fixed} improved`
  return (
    <Stat
      label="Duplication debt"
      explain="duplicationDebt"
      value={gate.baselineLines}
      tone={change.grew ? 'bad' : undefined}
      hint={[change.text, detail].filter(Boolean).join(' · ')}
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
  // The modules most in need of attention first; the rest wait behind "Show all".
  return (
    <ResponsiveTable
      label="Modules"
      rows={worstModulesFirst(rows)}
      rowKey={(r) => `${r.scope}/${r.module}`}
      breakpoint="md"
      limit={5}
      columns={[
        {
          key: 'module',
          label: 'Module',
          cell: (r) => (
            <span className="font-medium">
              {r.module} <span className="font-normal text-muted-foreground">{r.scope}</span>
            </span>
          ),
        },
        {
          key: 'coverage',
          label: 'Coverage',
          className: 'tabular-nums',
          cell: (r) => rate(r.lineRate),
        },
        {
          key: 'mutation',
          label: 'Mutation',
          className: 'tabular-nums',
          cell: (r) => rate(r.coveredScore),
        },
        { key: 'cc', label: 'CC > 10', className: 'tabular-nums', cell: (r) => r.over10 ?? 'n/a' },
        {
          key: 'crap',
          label: 'CRAP > 30',
          className: 'tabular-nums',
          cell: (r) => r.crapOver30 ?? 'n/a',
        },
      ]}
    />
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
    <ResponsiveTable
      label="CRAP hotspots"
      rows={hotspots}
      rowKey={(h) => `${h.file}:${h.line}:${h.method}`}
      breakpoint="md"
      columns={[
        {
          key: 'method',
          label: 'Method',
          className: 'max-w-xs break-all',
          cell: (h) =>
            sha ? (
              <a
                href={`https://github.com/${repo}/blob/${sha}/${h.file}${h.line ? `#L${h.line}` : ''}`}
                className="font-mono text-xs hover:underline"
              >
                {h.method}
              </a>
            ) : (
              <span className="font-mono text-xs">{h.method}</span>
            ),
        },
        {
          key: 'module',
          label: 'Module',
          className: 'text-muted-foreground',
          cell: (h) => `${h.scope} / ${h.module}`,
        },
        { key: 'cc', label: 'CC', className: 'tabular-nums', cell: (h) => h.cc },
        {
          key: 'coverage',
          label: 'Coverage',
          className: 'tabular-nums',
          cell: (h) => percent(h.coverage),
        },
        { key: 'crap', label: 'CRAP', className: 'tabular-nums', cell: (h) => Math.round(h.crap) },
      ]}
    />
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

const count = (v: number | null) => (v === null ? 'n/a' : v)

function DuplicationHotspots({
  hygiene,
  sha,
  repo,
}: {
  hygiene: HygieneData
  sha: string | null | undefined
  repo: string
}) {
  const hotspots = topDuplication(hygiene)
  if (hotspots.length === 0) {
    return <Unavailable reason="No file holds a clone above the detector's minimum size." />
  }
  return (
    <DataTable head={['File', 'Module', 'Duplicated', 'Lines', 'Share']}>
      {hotspots.map((h) => (
        <TableRow key={h.file}>
          <TableCell>
            {sha ? (
              <a
                href={`https://github.com/${repo}/blob/${sha}/${h.file}`}
                className="font-mono text-xs hover:underline"
              >
                {h.file}
              </a>
            ) : (
              <span className="font-mono text-xs">{h.file}</span>
            )}
          </TableCell>
          <TableCell className="text-muted-foreground">
            {h.scope} / {h.module}
          </TableCell>
          <TableCell className="tabular-nums">{h.duplicatedLines}</TableCell>
          <TableCell className="tabular-nums">{h.lines}</TableCell>
          <TableCell className="tabular-nums">{rate(h.duplicationRate)}</TableCell>
        </TableRow>
      ))}
    </DataTable>
  )
}

/** Report-only shows as an outline badge with its start date; a failing ratchet in red. */
function CheckModeBadge({ gate }: { gate: CheckGate }) {
  const variant = gate.mode === 'report' ? 'outline' : gate.failed ? 'destructive' : 'secondary'
  return (
    <Badge variant={variant}>
      {checkModeLabel(gate)}
      {gate.failed ? ', failing in CI' : ''}
    </Badge>
  )
}

/**
 * Knip's findings over the web workspace, against the baseline. Report-only, the counts are shown
 * for information and nothing is marked bad; once a ratchet, a count over its baseline is.
 */
export function DeadCodeWebPanel({ web }: { web: DeadCodeWeb }) {
  const held = web.gate.mode === 'ratchet'
  const allowedFiles = baselineOf(web.baseline, ['files'])
  const allowedExports = baselineOf(web.baseline, EXPORT_TYPES)
  const over = (value: number, allowed: number | null) =>
    held && allowed !== null && value > allowed ? 'bad' : undefined
  const baselineHint = (allowed: number | null) =>
    allowed === null ? 'no baseline yet' : `${allowed} baselined`
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">Dead code (web)</p>
        <CheckModeBadge gate={web.gate} />
      </div>
      <div className="grid grid-cols-2 gap-5 rounded-md border p-4 sm:grid-cols-4">
        <Stat
          label="Unused files"
          explain="deadCodeWeb"
          value={web.unusedFiles}
          tone={over(web.unusedFiles, allowedFiles)}
          hint={baselineHint(allowedFiles)}
        />
        <Stat
          label="Unused exports"
          value={web.unusedExports}
          tone={over(web.unusedExports, allowedExports)}
          hint={`${baselineHint(allowedExports)}, types included`}
        />
        <Stat
          label="Unused dependencies"
          value={web.unusedDependencies}
          tone={held && web.unusedDependencies > 0 ? 'bad' : undefined}
          hint="never baselined"
        />
        <Stat
          label="Unlisted dependencies"
          value={web.unlistedDependencies}
          tone={held && web.unlistedDependencies > 0 ? 'bad' : undefined}
          hint="imported, not in package.json"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {web.baseline === null
          ? 'No baseline committed yet.'
          : web.gate.violations === 0
            ? 'Within the baseline.'
            : `${web.gate.violations} over the baseline${held ? '' : ', not failing while report-only'}.`}{' '}
        {held
          ? 'Counts towards Code hygiene on the scorecard.'
          : 'Shown for information: a report-only check does not count on the scorecard.'}
      </p>
    </div>
  )
}

const LG_COLS: Record<number, string> = {
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
}

/**
 * Proxies for generated noise: copy-pasted blocks, swallowed exceptions, dead code, comment slop
 * and comment density, and Knip's web dead code where the repository runs it. Code hygiene on the
 * scorecard reads the gates; Knip counts there only once its gate is a ratchet.
 */
function HygieneSection({
  excellence,
  history,
  repo,
}: {
  excellence: EngineeringExcellence
  history: ExcellenceHistory | undefined
  repo: string
}) {
  return (
    <Metric block={excellence.hygiene}>
      {({ latest, samples }) => {
        const p = history?.previous?.kpis
        const m = history?.previous?.month
        const { global, deadCode, gate, thresholds, commentSlop } = latest
        const trends = duplicationTrends(history?.hygiene ?? [])
        const debt = gate ? duplicationDebtTrend(history?.hygiene ?? []) : []
        const scopes = Object.entries(latest.scopes).sort(([a], [b]) => a.localeCompare(b))
        return (
          <div className="space-y-6">
            <div
              className={`grid grid-cols-2 gap-5 rounded-md border bg-muted/30 p-4 sm:grid-cols-3 ${LG_COLS[4 + (gate ? 1 : 0) + (commentSlop ? 1 : 0)]}`}
            >
              <Stat
                label="Duplication"
                explain="duplication"
                value={rate(global.duplicationRate)}
                hint={
                  delta(global.duplicationRate, p?.duplication, 'rate', m) ??
                  `clones of ${thresholds.minLines}+ lines`
                }
              />
              <Stat
                label="Swallowed exceptions"
                explain="swallowedExceptions"
                value={count(global.swallowedExceptions)}
                tone={
                  global.swallowedExceptions !== null && global.swallowedExceptions > 0
                    ? 'bad'
                    : undefined
                }
                hint={`${global.justifiedSwallows} justified, not counted`}
              />
              <div>
                <Stat
                  label="Dead code"
                  explain="deadCode"
                  value={deadCode.warnings}
                  tone={deadCode.warnings > 0 ? 'bad' : undefined}
                />
                <Badge variant={deadCode.gated ? 'secondary' : 'outline'} className="mt-1">
                  {deadCode.gated ? 'gated in CI' : 'not gated'}
                </Badge>
              </div>
              <Stat
                label="Comment density"
                explain="commentDensity"
                value={global.commentDensity === null ? 'n/a' : global.commentDensity.toFixed(2)}
                hint="comment lines per code line"
              />
              {commentSlop ? (
                <Stat
                  label="Comment slop"
                  explain="commentSlop"
                  value={commentSlop.findings}
                  tone={(commentSlop.gate?.violations ?? 0) > 0 ? 'bad' : undefined}
                  hint={
                    commentSlop.gate
                      ? `${commentSlop.gate.baselineFindings} baselined, gated in CI`
                      : 'report-only'
                  }
                />
              ) : null}
              {gate ? (
                <DuplicationDebtStat gate={gate} previous={p?.duplicationDebt} month={m} />
              ) : null}
            </div>

            <DataTable
              head={[
                'Scope',
                'Files',
                'Duplication',
                'Swallowed',
                'Justified',
                'Dead code',
                'Comments',
              ]}
            >
              {scopes.map(([scope, s]) => (
                <TableRow key={scope}>
                  <TableCell className="font-medium">{scope}</TableCell>
                  <TableCell className="tabular-nums">{s.files}</TableCell>
                  <TableCell className="tabular-nums">
                    {rate(s.duplicationRate)}
                    <span className="text-muted-foreground"> · {s.duplicatedLines} lines</span>
                  </TableCell>
                  <TableCell className="tabular-nums">{count(s.swallowedExceptions)}</TableCell>
                  <TableCell className="tabular-nums">{s.justifiedSwallows}</TableCell>
                  <TableCell className="tabular-nums">{s.deadCodeWarnings}</TableCell>
                  <TableCell className="tabular-nums">
                    {s.commentDensity === null ? 'n/a' : s.commentDensity.toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </DataTable>

            <div className="grid gap-6 lg:grid-cols-2">
              <Trends title="Duplication by scope" trends={trends} />
              {debt.length > 1 ? (
                <div>
                  <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                    Duplication debt
                  </p>
                  <ScopeTrend label="Baselined lines" points={debt} floor={null} unit="count" />
                </div>
              ) : null}
            </div>

            {deadCode.web ? <DeadCodeWebPanel web={deadCode.web} /> : null}

            <div>
              <p className="mb-2 text-sm font-medium">Duplication hotspots</p>
              <DuplicationHotspots hygiene={latest} sha={samples.at(-1)?.commitSha} repo={repo} />
            </div>
          </div>
        )
      }}
    </Metric>
  )
}

/**
 * The web app's JavaScript as size-limit measures it, against the budget (baseline + 10%).
 * Report-only, an over-budget total is said in words but not marked bad.
 */
export function BundleSection({ excellence }: { excellence: EngineeringExcellence }) {
  if (!excellence.bundle) {
    return <Unavailable reason="Not collected for this month: the bundle facet is newer." />
  }
  return (
    <Metric block={excellence.bundle}>
      {({ latest }) => {
        const held = latest.gate.mode === 'ratchet'
        const unit = latest.compression === 'none' ? 'uncompressed' : latest.compression
        return (
          <div className="space-y-3">
            <CheckModeBadge gate={latest.gate} />
            <div className="grid grid-cols-2 gap-5 rounded-md border p-4 sm:grid-cols-3">
              <Stat
                label="Total JavaScript"
                explain="bundleSize"
                value={kilobytes(latest.totalJsBytes)}
                tone={held && latest.overBudget ? 'bad' : undefined}
                hint={`${unit}, ${latest.chunks} chunks`}
              />
              <Stat
                label="Budget"
                value={kilobytes(latest.limitBytes)}
                hint={
                  latest.baselineBytes === null
                    ? 'no baseline yet'
                    : `baseline ${kilobytes(latest.baselineBytes)} + 10%`
                }
              />
              <Stat
                label="Largest chunk"
                value={kilobytes(latest.largestChunkBytes)}
                hint={latest.largestChunk ?? undefined}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {latest.overBudget
                ? `Over budget${held ? '' : ', not failing while report-only'}.`
                : latest.limitBytes === null
                  ? 'No budget committed yet.'
                  : 'Within budget.'}{' '}
              {held
                ? 'Counts towards Performance on the scorecard, where that practice applies.'
                : 'Shown for information: a report-only check does not count on the scorecard.'}
            </p>
          </div>
        )
      }}
    </Metric>
  )
}

/**
 * Steiger's Feature-Sliced Design rules over the web app, errors and warnings by rule against the
 * warning baseline. Errors fail the repository's CI in every mode, so they are always marked bad;
 * warnings over the baseline only once the gate is a ratchet.
 */
export function ArchitectureWebPanel({ web }: { web: ArchitectureWeb }) {
  const held = web.gate.mode === 'ratchet'
  const allowed = web.baseline
    ? Object.values(web.baseline).reduce((n, count) => n + count, 0)
    : null
  const rules = architectureRules(web)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">Web, Steiger{web.version ? ` ${web.version}` : ''}</p>
        <CheckModeBadge gate={web.gate} />
      </div>
      <div className="grid grid-cols-2 gap-5 rounded-md border p-4 sm:grid-cols-3">
        <Stat
          label="Errors"
          explain="architectureWeb"
          value={web.errors}
          tone={web.errors > 0 ? 'bad' : undefined}
          hint="fail CI in every mode"
        />
        <Stat
          label="Warnings"
          value={web.warnings}
          tone={held && web.gate.violations > 0 ? 'bad' : undefined}
          hint={allowed === null ? 'no baseline yet' : `${allowed} baselined`}
        />
        <Stat label="Over the baseline" value={web.gate.violations} hint="warnings, by rule" />
      </div>
      {rules.length > 0 ? (
        <ResponsiveTable
          label="Steiger rules"
          rows={rules}
          rowKey={(r) => r.rule}
          breakpoint="md"
          columns={[
            {
              key: 'rule',
              label: 'Rule',
              className: 'font-mono text-xs break-all',
              cell: (r) => r.rule,
            },
            { key: 'errors', label: 'Errors', className: 'tabular-nums', cell: (r) => r.errors },
            {
              key: 'warnings',
              label: 'Warnings',
              className: 'tabular-nums',
              cell: (r) => (
                <>
                  {r.warnings}
                  {r.over ? (
                    <span className="text-muted-foreground">
                      {held ? ' (over the baseline)' : ' (over, report-only)'}
                    </span>
                  ) : null}
                </>
              ),
            },
            {
              key: 'allowed',
              label: 'Warnings allowed',
              className: 'tabular-nums',
              cell: (r) => (r.allowed === null ? 'n/a' : r.allowed),
            },
          ]}
        />
      ) : null}
      <p className="text-xs text-muted-foreground">
        {rules.length === 0
          ? 'No Steiger findings. '
          : web.baseline === null
            ? 'No warning baseline committed yet. '
            : web.gate.violations === 0
              ? 'Warnings within the baseline. '
              : `${web.gate.violations} warnings over the baseline${held ? '' : ', not failing while report-only'}. `}
        {held
          ? 'Warnings over the baseline count towards Code hygiene on the scorecard.'
          : 'Shown for information: a report-only check does not count on the scorecard.'}
      </p>
    </div>
  )
}

/** The .NET architecture tests from their test results: rules passed and the failing ones by name. */
export function ArchitectureDotnetPanel({ dotnet }: { dotnet: ArchitectureDotnet }) {
  const library = dotnet.tool ? ARCHITECTURE_LIBRARIES[dotnet.tool] : null
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">
        .NET{library ? `, ${library}` : ''}
        {dotnet.project ? (
          <span className="font-normal text-muted-foreground"> · {dotnet.project}</span>
        ) : null}
      </p>
      <div className="grid grid-cols-2 gap-5 rounded-md border p-4 sm:grid-cols-4">
        <Stat label="Rules" explain="architectureDotnet" value={dotnet.rules} />
        <Stat label="Passed" value={dotnet.passed} />
        <Stat
          label="Failed"
          value={dotnet.failed}
          tone={dotnet.failed > 0 ? 'bad' : undefined}
          hint="fail CI"
        />
        <Stat label="Skipped" value={dotnet.skipped} />
      </div>
      {dotnet.failing.length > 0 ? (
        <ul className="space-y-1 text-xs">
          {dotnet.failing.slice(0, 10).map((rule) => (
            <li key={rule} className="font-mono">
              {rule}
            </li>
          ))}
          {dotnet.failed > 10 ? (
            <li className="text-muted-foreground">and {dotnet.failed - 10} more</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * The architecture rules the repository's CI runs: Steiger over the web app and the .NET
 * architecture tests. Either part is absent when the repository does not run it.
 */
export function ArchitectureSection({ excellence }: { excellence: EngineeringExcellence }) {
  if (!excellence.architecture) {
    return <Unavailable reason="Not collected for this month: the architecture facet is newer." />
  }
  return (
    <Metric block={excellence.architecture}>
      {({ latest }) => (
        <div className="grid gap-6 lg:grid-cols-2">
          {latest.web ? (
            <ArchitectureWebPanel web={latest.web} />
          ) : (
            <Unavailable reason="No Steiger report: the web job ran no Steiger 0.10 or later, or the repository has no web app." />
          )}
          {latest.dotnet ? (
            <ArchitectureDotnetPanel dotnet={latest.dotnet} />
          ) : (
            <Unavailable reason="No architecture test results: the repository runs no .NET architecture tests in CI." />
          )}
        </div>
      )}
    </Metric>
  )
}

/** How many rules the patterns tables show before "and N more". */
const PATTERN_ROWS = 15

/**
 * The .NET build's analyzer diagnostics by rule against the baseline. The template never changes
 * the build's verdict, so nothing is marked bad until the gate is a ratchet.
 */
export function PatternsDotnetPanel({ dotnet }: { dotnet: PatternsDotnet }) {
  const held = dotnet.gate.mode === 'ratchet'
  const allowed = dotnet.baseline
    ? Object.values(dotnet.baseline).reduce((n, count) => n + count, 0)
    : null
  const rules = patternRules(dotnet)
  const analyzers = Object.entries(dotnet.byAnalyzer)
    .map(([key, c]) => ({ name: PATTERN_ANALYZERS[key] ?? key, findings: c.errors + c.warnings }))
    .filter((a) => a.findings > 0)
    .sort((a, b) => b.findings - a.findings)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">
          .NET analyzers
          <span className="font-normal text-muted-foreground">
            {' '}
            · {dotnet.logs} projects{dotnet.compiler ? ` · compiler ${dotnet.compiler}` : ''}
          </span>
        </p>
        <CheckModeBadge gate={dotnet.gate} />
      </div>
      <div className="grid grid-cols-2 gap-5 rounded-md border p-4 sm:grid-cols-4">
        <Stat
          label="Errors and warnings"
          explain="patternsDotnet"
          value={dotnet.errors + dotnet.warnings}
          tone={held && dotnet.gate.violations > 0 ? 'bad' : undefined}
          hint={allowed === null ? 'no baseline yet' : `${allowed} baselined`}
        />
        <Stat label="Over the baseline" value={dotnet.gate.violations} hint="by rule" />
        <Stat label="Notes" value={dotnet.notes} hint="never held" />
        <Stat label="Suppressed" value={dotnet.suppressed} hint="in source" />
      </div>
      {analyzers.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          By analyzer: {analyzers.map((a) => `${a.name} ${a.findings}`).join(' · ')}
        </p>
      ) : null}
      {rules.length > 0 ? (
        <DataTable head={['Rule', 'Analyzer', 'Errors', 'Warnings', 'Notes', 'Allowed']}>
          {rules.slice(0, PATTERN_ROWS).map((r) => (
            <TableRow key={r.rule}>
              <TableCell className="font-mono text-xs">{r.rule}</TableCell>
              <TableCell className="text-xs">{r.analyzer}</TableCell>
              <TableCell className="tabular-nums">{r.errors}</TableCell>
              <TableCell className="tabular-nums">
                {r.warnings}
                {r.over ? (
                  <span className="text-muted-foreground">
                    {held ? ' (over the baseline)' : ' (over, report-only)'}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="tabular-nums">{r.notes}</TableCell>
              <TableCell className="tabular-nums">
                {r.allowed === null ? 'n/a' : r.allowed}
              </TableCell>
            </TableRow>
          ))}
        </DataTable>
      ) : null}
      {rules.length > PATTERN_ROWS ? (
        <p className="text-xs text-muted-foreground">
          and {rules.length - PATTERN_ROWS} more rules
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {rules.length === 0
          ? 'No analyzer findings. '
          : dotnet.baseline === null
            ? 'No baseline committed yet. '
            : dotnet.gate.violations === 0
              ? 'Findings within the baseline. '
              : `${dotnet.gate.violations} findings over the baseline${held ? '' : ', not failing while report-only'}. `}
        {held
          ? 'Findings over the baseline count towards Code hygiene on the scorecard.'
          : 'Shown for information: a report-only check does not count on the scorecard.'}
      </p>
    </div>
  )
}

/** The repository's own Semgrep rules: the blocking scan already fails CI on any finding. */
export function PatternsSemgrepPanel({ semgrep }: { semgrep: PatternsSemgrep }) {
  const findings = semgrep.errors + semgrep.warnings + semgrep.notes
  const firing = Object.entries(semgrep.byRule)
    .map(([rule, c]) => ({ rule, findings: c.errors + c.warnings + c.notes }))
    .filter((r) => r.findings > 0)
    .sort((a, b) => b.findings - a.findings || a.rule.localeCompare(b.rule))
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">
        Semgrep, the repository&apos;s own rules
        {semgrep.version ? (
          <span className="font-normal text-muted-foreground"> · {semgrep.version}</span>
        ) : null}
      </p>
      <div className="grid grid-cols-2 gap-5 rounded-md border p-4">
        <Stat
          label="Rules"
          explain="patternsSemgrep"
          value={semgrep.rules ?? Object.keys(semgrep.byRule).length}
        />
        <Stat
          label="Findings"
          value={findings}
          tone={findings > 0 ? 'bad' : undefined}
          hint="fail CI"
        />
      </div>
      {firing.length > 0 ? (
        <ul className="space-y-1 text-xs">
          {firing.slice(0, 10).map((r) => (
            <li key={r.rule} className="font-mono">
              {r.rule}: {r.findings}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * The code-pattern findings the repository's CI records: the .NET analyzers from the build's SARIF
 * and the repository's own Semgrep rules. Either part is absent when the repository does not run it.
 */
export function PatternsSection({ excellence }: { excellence: EngineeringExcellence }) {
  if (!excellence.patterns) {
    return <Unavailable reason="Not collected for this month: the patterns facet is newer." />
  }
  return (
    <Metric block={excellence.patterns}>
      {({ latest }) => (
        <div className="grid gap-6 lg:grid-cols-2">
          {latest.dotnet ? (
            <PatternsDotnetPanel dotnet={latest.dotnet} />
          ) : (
            <Unavailable reason="No analyzer SARIF: the repository's .NET build wrote no error log, or it has no .NET app." />
          )}
          {latest.semgrep ? (
            <PatternsSemgrepPanel semgrep={latest.semgrep} />
          ) : (
            <Unavailable reason="No Semgrep report: the SAST scan left no JSON." />
          )}
        </div>
      )}
    </Metric>
  )
}

/** One panel of the Engineering tab: its nav entry and status, and what it shows. */
export interface EngineeringSection extends SectionMeta {
  description?: string
  tools?: string[]
  content: ReactNode
}

const scorecardOf = (report: MonthlyReport) =>
  report.scorecard?.available ? report.scorecard.data : null

/** Whether a facet has a sample this month; a section over facets that have none reads grey. */
const has = (block: { available: boolean } | undefined) => Boolean(block?.available)

/**
 * Numbers the repository's own CI produces about its code, one section per facet group: coverage,
 * mutation score, complexity, scanner findings, the SBOM, hygiene, bundle size, architecture and code
 * patterns. Each facet is shown as of the newest sample in the month, and the trends run across
 * every month collected so far.
 *
 * Every facet has to appear in one of these sections: the section nav is built from them, and
 * excellence.test.ts fails when a facet has no entry.
 */
export function excellenceSections(
  report: MonthlyReport,
  history: ExcellenceHistory | undefined,
): EngineeringSection[] {
  // A month in progress shows a facet it has no sample of yet from the previous month, as its
  // scorecard rates it, so the panels do not empty out on the 1st.
  const current = history?.current
  const excellence = current?.excellence ?? report.engineeringExcellence
  const carried =
    current && current.carried.length > 0
      ? ` ${current.carried.join(', ')}: no sample yet this month, so the newest from ${monthName(current.from)} within the last ${report.window?.days ?? 30} days.`
      : ''
  const description = `Reported by the repository’s own main branch CI, one sample per commit. These never gate anything here; the repository’s CI decides what fails.${carried}`
  const card = scorecardOf(report)
  const status = (ids: string[], present: boolean) =>
    present ? practiceStatus(card, ids) : NOT_COLLECTED

  if (!excellence) {
    return [
      {
        id: 'excellence',
        title: 'Engineering excellence',
        group: 'excellence',
        facets: [...FACETS],
        ...NOT_COLLECTED,
        description,
        content: (
          <Unavailable reason="Not collected for this month. A project opts in with engineeringExcellence.enabled in projects.json, and its CI uploads the engineering-excellence-<facet> artifacts described in the README." />
        ),
      },
    ]
  }

  const coverageTrends = scopeTrends(history?.coverage ?? [], (s) => s.lineRate)
  const mutationTrends = scopeTrends(history?.mutation ?? [], (s) => s.coveredScore)
  const gate = excellence.complexity.available ? excellence.complexity.data.latest.gate : null
  const debt = gate ? debtTrend(history?.complexity ?? []) : []
  const architecture = excellence.architecture?.available
    ? excellence.architecture.data.latest
    : null
  const patterns = excellence.patterns?.available ? excellence.patterns.data.latest : null
  const bundle = excellence.bundle?.available ? excellence.bundle.data.latest : null
  const semgrepFindings = patterns?.semgrep
    ? patterns.semgrep.errors + patterns.semgrep.warnings + patterns.semgrep.notes
    : 0
  const failingTests = architecture?.dotnet?.failed ?? 0

  return [
    {
      id: 'excellence',
      title: 'Summary and trends',
      group: 'excellence',
      facets: ['coverage', 'mutation', 'complexity'],
      ...status(
        ['tests', 'mutation', 'complexity'],
        has(excellence.coverage) || has(excellence.mutation) || has(excellence.complexity),
      ),
      description,
      content: (
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
        </div>
      ),
    },
    {
      id: 'modules',
      title: 'Modules',
      group: 'excellence',
      facets: ['coverage', 'mutation'],
      tools: ['coverage facet', 'mutation facet'],
      ...status(['tests', 'mutation'], has(excellence.coverage) || has(excellence.mutation)),
      content: <ModulesTable excellence={excellence} />,
    },
    {
      id: 'hotspots',
      title: 'CRAP hotspots',
      group: 'excellence',
      facets: ['complexity'],
      tools: ['complexity facet'],
      ...status(['complexity'], has(excellence.complexity)),
      content: <HotspotsTable excellence={excellence} repo={report.repo} />,
    },
    {
      id: 'security',
      title: 'Security',
      group: 'excellence',
      facets: ['security'],
      tools: ['security facet'],
      ...status(['secrets', 'vulnerabilities', 'sast'], has(excellence.security)),
      content: <SecuritySection excellence={excellence} />,
    },
    {
      id: 'sbom',
      title: 'Software bill of materials',
      group: 'excellence',
      facets: ['sbom'],
      tools: ['SBOM facet'],
      ...status(['sbom'], has(excellence.sbom)),
      content: <SbomSection excellence={excellence} />,
    },
    {
      id: 'hygiene',
      title: 'Hygiene',
      group: 'excellence',
      facets: ['hygiene'],
      tools: [
        'hygiene facet',
        ...(excellence.hygiene?.available && excellence.hygiene.data.latest.deadCode.web
          ? ['Knip']
          : []),
      ],
      ...status(['hygiene'], has(excellence.hygiene)),
      content: <HygieneSection excellence={excellence} history={history} repo={report.repo} />,
    },
    {
      id: 'bundle',
      title: 'Bundle size',
      group: 'excellence',
      facets: ['bundle'],
      tools: ['bundle facet'],
      ...(bundle
        ? bundle.overBudget
          ? { rag: bundle.gate.mode === 'ratchet' ? 'red' : 'yellow', text: 'Over budget' }
          : { rag: 'green' as const, text: 'Within budget' }
        : NOT_COLLECTED),
      content: <BundleSection excellence={excellence} />,
    },
    {
      id: 'architecture',
      title: 'Architecture',
      group: 'excellence',
      facets: ['architecture'],
      tools: architecture ? architectureTools(architecture) : ['architecture facet'],
      ...(architecture
        ? failingTests > 0
          ? {
              rag: 'red' as const,
              text: `${failingTests} architecture test${failingTests === 1 ? '' : 's'} failing`,
            }
          : architecture.web
            ? gateStatus([architecture.web.gate], 'warning')
            : { rag: 'green' as const, text: 'Architecture tests pass' }
        : NOT_COLLECTED),
      content: <ArchitectureSection excellence={excellence} />,
    },
    {
      id: 'patterns',
      title: 'Code patterns',
      group: 'excellence',
      facets: ['patterns'],
      tools: patterns ? patternsTools(patterns) : ['patterns facet'],
      ...(patterns
        ? semgrepFindings > 0
          ? {
              rag: 'red' as const,
              text: `${semgrepFindings} finding${semgrepFindings === 1 ? '' : 's'} of the repository's own rules`,
            }
          : patterns.dotnet
            ? gateStatus([patterns.dotnet.gate], 'finding')
            : { rag: 'green' as const, text: 'No findings' }
        : NOT_COLLECTED),
      content: <PatternsSection excellence={excellence} />,
    },
  ]
}
