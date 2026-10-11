import type {
  ComplexityData,
  CoverageData,
  EngineeringExcellence,
  FacetSample,
  Hotspot,
  MutationData,
} from './types'

/** The headline numbers, each null when its facet was not collected. */
export interface ExcellenceKpis {
  coverage: number | null
  mutation: number | null
  crapOver30: number | null
  criticalHigh: number | null
  components: number | null
  /** Baselined complexity violations still in the code. null when the repository runs no gate. */
  complexityDebt: number | null
}

export function kpisOf(excellence: EngineeringExcellence | undefined | null): ExcellenceKpis {
  const coverage = excellence?.coverage
  const mutation = excellence?.mutation
  const complexity = excellence?.complexity
  const security = excellence?.security
  const sbom = excellence?.sbom
  const trivy = security?.available ? security.data.latest.trivy : null
  return {
    coverage: coverage?.available ? coverage.data.latest.global.lineRate : null,
    mutation: mutation?.available ? mutation.data.latest.global.coveredScore : null,
    crapOver30: complexity?.available ? complexity.data.latest.global.crapOver30 : null,
    criticalHigh: trivy ? trivy.vuln.CRITICAL + trivy.vuln.HIGH : null,
    components: sbom?.available ? sbom.data.latest.components : null,
    complexityDebt: complexity?.available ? (complexity.data.latest.gate?.baselined ?? null) : null,
  }
}

/**
 * Coverage and complexity name scopes after the assembly ("Atlas.Domain") while mutation testing
 * names them after the project it mutates ("domain"). Joining on the last dotted segment, lower
 * cased, lines the three up without the producer having to agree on one spelling.
 */
export const scopeKey = (scope: string): string => scope.toLowerCase().replace(/^.*\./, '')

export interface ModuleRow {
  scope: string
  module: string
  lineRate: number | null
  coveredScore: number | null
  over10: number | null
  crapOver30: number | null
}

/** One row per scope and module, joining whatever facets carry that module. */
export function moduleRows(excellence: EngineeringExcellence): ModuleRow[] {
  const rows = new Map<string, ModuleRow>()
  const row = (scope: string, module: string): ModuleRow => {
    const key = `${scopeKey(scope)}/${module}`
    const existing = rows.get(key)
    if (existing) return existing
    const created: ModuleRow = {
      scope,
      module,
      lineRate: null,
      coveredScore: null,
      over10: null,
      crapOver30: null,
    }
    rows.set(key, created)
    return created
  }

  if (excellence.coverage.available) {
    for (const [scope, s] of Object.entries(excellence.coverage.data.latest.scopes)) {
      for (const [module, m] of Object.entries(s.modules ?? {}))
        row(scope, module).lineRate = m.lineRate
    }
  }
  if (excellence.complexity.available) {
    for (const [scope, s] of Object.entries(excellence.complexity.data.latest.scopes)) {
      for (const [module, m] of Object.entries(s.modules ?? {})) {
        const r = row(scope, module)
        r.over10 = m.over10
        r.crapOver30 = m.crapOver30
      }
    }
  }
  if (excellence.mutation.available) {
    for (const [scope, s] of Object.entries(excellence.mutation.data.latest.scopes)) {
      for (const [module, m] of Object.entries(s.modules ?? {})) {
        row(scope, module).coveredScore = m.coveredScore
      }
    }
  }

  return [...rows.values()].sort(
    (a, b) =>
      scopeKey(a.scope).localeCompare(scopeKey(b.scope)) || a.module.localeCompare(b.module),
  )
}

export const topHotspots = (excellence: EngineeringExcellence, limit = 10): Hotspot[] =>
  excellence.complexity.available
    ? [...(excellence.complexity.data.latest.hotspots ?? [])]
        .sort((a, b) => b.crap - a.crap)
        .slice(0, limit)
    : []

export interface ScopeTrend {
  scope: string
  /** Percent, so the chart axis and tooltip read naturally. */
  floor: number | null
  points: { at: string; value: number }[]
}

const pct = (v: number) => Math.round(v * 1000) / 10

/** One series per scope across every sample, with the floor from the newest sample. */
export function scopeTrends<T extends CoverageData | MutationData>(
  samples: FacetSample<T>[],
  pick: (scope: T['scopes'][string]) => number | null,
): ScopeTrend[] {
  const byScope = new Map<string, ScopeTrend>()
  for (const sample of samples) {
    for (const [scope, data] of Object.entries(sample.data.scopes) as [
      string,
      T['scopes'][string],
    ][]) {
      const value = pick(data)
      const trend = byScope.get(scope) ?? { scope, floor: null, points: [] }
      trend.floor = data.floor === null ? null : pct(data.floor)
      if (value !== null) trend.points.push({ at: sample.generatedAt, value: pct(value) })
      byScope.set(scope, trend)
    }
  }
  return [...byScope.values()].sort((a, b) => a.scope.localeCompare(b.scope))
}

/** The gate backlog per complexity sample. Samples without a gate are left out, not drawn as zero. */
export const debtTrend = (
  samples: FacetSample<ComplexityData>[],
): { at: string; value: number }[] =>
  samples.flatMap((s) => (s.data.gate ? [{ at: s.generatedAt, value: s.data.gate.baselined }] : []))
