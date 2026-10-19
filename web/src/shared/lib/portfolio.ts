import type { ScorecardRow } from './scorecard'
import type { ProjectGroup } from './types'

/**
 * Where an application has got to, from its deployed resource group. Tooling is never deployed to
 * PRE/PRO, so it reads na rather than "not deployed", which would look like a gap to close.
 */
export type PortfolioEnv = 'pro' | 'pre' | 'none' | 'na'

export const ENV_LABEL: Record<PortfolioEnv, string> = {
  pro: 'PRO',
  pre: 'PRE',
  none: 'Not deployed',
  na: 'Environment n/a',
}

/** 0 is critical, 1 needs attention, 2 is fine. Sorting by risk puts the worst first. */
export type Risk = 0 | 1 | 2

export interface PortfolioAlert {
  text: string
  detail: string
  severity: 'red' | 'amber'
}

export interface PortfolioRow extends ScorecardRow {
  env: PortfolioEnv
  /** Score now minus the score DELTA_DAYS earlier; null when either is missing. */
  delta: number | null
  /** What the delta compares: a day DELTA_DAYS back, or last month while the daily history is short. */
  deltaBasis: DeltaBasis
  risk: Risk
  alert: PortfolioAlert | null
  gatesPct: number | null
}

export const DELTA_DAYS = 30

export type DeltaBasis = 'days' | 'month'

export const DELTA_TITLE: Record<DeltaBasis, string> = {
  days: `Score change over the last ${DELTA_DAYS} days`,
  month: `Score change against last month: the daily history is not ${DELTA_DAYS} days old yet`,
}

export function envOf(row: ScorecardRow): PortfolioEnv {
  if (row.group === 'tooling') return 'na'
  const final = row.environment?.available ? row.environment.data.final : null
  return final === 'PRO' ? 'pro' : final === 'PRE' ? 'pre' : 'none'
}

const DAY_MS = 86_400_000

/**
 * Score now minus the score DELTA_DAYS earlier, from the daily history: the newest point against
 * the newest point at least DELTA_DAYS older. Until the history reaches that far back, it falls
 * back to this month's score against last month's, and says so in the basis.
 */
export function deltaOf(row: Pick<ScorecardRow, 'trend' | 'daily'>): {
  delta: number | null
  deltaBasis: DeltaBasis
} {
  const now = row.daily.at(-1)
  if (now && now.score !== null) {
    const cutoff = new Date(Date.parse(now.date) - DELTA_DAYS * DAY_MS).toISOString().slice(0, 10)
    const before = row.daily.findLast((d) => d.date <= cutoff)
    if (before) {
      return {
        delta: before.score === null ? null : now.score - before.score,
        deltaBasis: 'days',
      }
    }
  }
  const last = row.trend.at(-1)?.score ?? null
  const prior = row.trend.at(-2)?.score ?? null
  return { delta: last === null || prior === null ? null : last - prior, deltaBasis: 'month' }
}

const gatesText = (row: ScorecardRow) =>
  row.card
    ? `${row.card.gates.present} of ${row.card.gates.applicable} gates · score ${row.card.score ?? 'n/a'}`
    : ''

/**
 * The single most pressing reason to look at a project. Production below L1 is critical because
 * the product is live with almost no gates; production at L1, the collector's high-AI-low-engineering
 * alert and a falling score need attention.
 */
export function riskOf(
  row: ScorecardRow,
  env: PortfolioEnv,
  delta: number | null,
  basis: DeltaBasis = 'days',
) {
  const card = row.card
  if (!card) return { risk: 2 as Risk, alert: null }
  if (env === 'pro' && card.level === 0) {
    return {
      risk: 0 as Risk,
      alert: { text: 'In production below L1', detail: gatesText(row), severity: 'red' as const },
    }
  }
  if (env === 'pro' && card.level === 1) {
    return {
      risk: 1 as Risk,
      alert: { text: 'In production at L1', detail: gatesText(row), severity: 'amber' as const },
    }
  }
  const highAi = card.alerts.find((a) => a.code === 'HIGH_AI_LOW_ENGINEERING')
  if (highAi) {
    return {
      risk: 1 as Risk,
      alert: {
        text: 'High AI, low engineering',
        detail: highAi.message,
        severity: 'amber' as const,
      },
    }
  }
  if (delta !== null && delta < 0) {
    return {
      risk: 1 as Risk,
      alert: {
        text: 'Engineering declining',
        detail:
          basis === 'days'
            ? `${delta} points in ${DELTA_DAYS} days`
            : `${delta} points since last month`,
        severity: 'amber' as const,
      },
    }
  }
  return { risk: 2 as Risk, alert: null }
}

export function portfolioRows(rows: ScorecardRow[]): PortfolioRow[] {
  return rows.map((row) => {
    const env = envOf(row)
    const { delta, deltaBasis } = deltaOf(row)
    const gates = row.card?.gates
    return {
      ...row,
      env,
      delta,
      deltaBasis,
      ...riskOf(row, env, delta, deltaBasis),
      gatesPct:
        gates && gates.applicable > 0 ? Math.round((gates.present / gates.applicable) * 100) : null,
    }
  })
}

export type PortfolioFilter = 'all' | 'attention' | PortfolioEnv
export type PortfolioSort = 'risk' | 'engineering' | 'gates' | 'trend' | 'name'

export const FILTERS: { key: PortfolioFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'pro', label: ENV_LABEL.pro },
  { key: 'pre', label: ENV_LABEL.pre },
  { key: 'none', label: ENV_LABEL.none },
]

export const SORTS: { key: PortfolioSort; label: string }[] = [
  { key: 'risk', label: 'Risk' },
  { key: 'engineering', label: 'Engineering' },
  { key: 'gates', label: 'Gates' },
  { key: 'trend', label: 'Trend' },
  { key: 'name', label: 'Name' },
]

export const matches = (row: PortfolioRow, filter: PortfolioFilter) =>
  filter === 'all' ? true : filter === 'attention' ? row.risk < 2 : row.env === filter

const byName = (a: PortfolioRow, b: PortfolioRow) => a.name.localeCompare(b.name)
const score = (r: PortfolioRow) => r.card?.score ?? -1

/** Rows without a scorecard always sink to the bottom, whatever the sort. */
export function sortRows(rows: PortfolioRow[], sort: PortfolioSort): PortfolioRow[] {
  return [...rows].sort((a, b) => {
    if (!a.card !== !b.card) return a.card ? -1 : 1
    if (sort === 'name') return byName(a, b)
    if (sort === 'engineering') return score(b) - score(a) || byName(a, b)
    // Worst first, like risk: the projects with the fewest gates are the ones to look at.
    if (sort === 'gates') return (a.gatesPct ?? -1) - (b.gatesPct ?? -1) || byName(a, b)
    if (sort === 'trend') return (a.delta ?? 0) - (b.delta ?? 0) || byName(a, b)
    return a.risk - b.risk || score(a) - score(b) || byName(a, b)
  })
}

/**
 * Rows split by dashboard section. Tooling is ranked and averaged on its own, so a library without
 * environments never drags the application numbers down or takes a place in their ranking.
 */
export function byGroup<T extends { group: ProjectGroup }>(rows: T[]): Record<ProjectGroup, T[]> {
  return {
    applications: rows.filter((r) => r.group === 'applications'),
    tooling: rows.filter((r) => r.group === 'tooling'),
  }
}

export function portfolioKpis(rows: PortfolioRow[]) {
  const scored = rows.filter((r) => r.card)
  const ai = scored.flatMap((r) => (r.card?.aiUsage.available ? [r.card.aiUsage.data.level] : []))
  const gates = scored.flatMap((r) => (r.gatesPct === null ? [] : [r.gatesPct]))
  const live = rows.filter((r) => r.env === 'pro')
  return {
    total: rows.length,
    n3: scored.filter((r) => r.card?.level === 3).length,
    critical: rows.filter((r) => r.risk === 0).length,
    attention: rows.filter((r) => r.risk < 2).length,
    aiAverage: ai.length > 0 ? ai.reduce((n, v) => n + v, 0) / ai.length : null,
    aiCount: ai.length,
    gatesAverage:
      gates.length > 0 ? Math.round(gates.reduce((n, v) => n + v, 0) / gates.length) : null,
    pro: live.length,
    proN3: live.filter((r) => r.card?.level === 3).length,
  }
}
