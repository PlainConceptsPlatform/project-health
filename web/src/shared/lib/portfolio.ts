import type { ScorecardRow } from './scorecard'

/** Where an application has got to, from its deployed resource group. */
export type PortfolioEnv = 'pro' | 'pre' | 'none'

export const ENV_LABEL: Record<PortfolioEnv, string> = {
  pro: 'Production',
  pre: 'Pre-production',
  none: 'Not deployed',
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
  /** Score now minus the score three months earlier; null when either is missing. */
  delta: number | null
  risk: Risk
  alert: PortfolioAlert | null
  gatesPct: number | null
}

/** How far back the trend delta looks, in months. */
export const DELTA_MONTHS = 3

export function envOf(row: ScorecardRow): PortfolioEnv {
  const final = row.environment?.available ? row.environment.data.final : null
  return final === 'PRO' ? 'pro' : final === 'PRE' ? 'pre' : 'none'
}

export function deltaOf(trend: ScorecardRow['trend']): number | null {
  const last = trend.at(-1)?.score ?? null
  const before = trend.at(-1 - DELTA_MONTHS)?.score ?? null
  return last === null || before === null ? null : last - before
}

const gatesText = (row: ScorecardRow) =>
  row.card
    ? `${row.card.gates.present} of ${row.card.gates.applicable} gates · score ${row.card.score ?? 'n/a'}`
    : ''

/**
 * The single most pressing reason to look at a project. Production below N1 is critical because
 * the product is live with almost no gates; production at N1, the collector's high-AI-low-engineering
 * alert and a falling score need attention.
 */
export function riskOf(row: ScorecardRow, env: PortfolioEnv, delta: number | null) {
  const card = row.card
  if (!card) return { risk: 2 as Risk, alert: null }
  if (env === 'pro' && card.level === 0) {
    return {
      risk: 0 as Risk,
      alert: { text: 'In production below N1', detail: gatesText(row), severity: 'red' as const },
    }
  }
  if (env === 'pro' && card.level === 1) {
    return {
      risk: 1 as Risk,
      alert: { text: 'In production at N1', detail: gatesText(row), severity: 'amber' as const },
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
        detail: `${delta} points in ${DELTA_MONTHS} months`,
        severity: 'amber' as const,
      },
    }
  }
  return { risk: 2 as Risk, alert: null }
}

export function portfolioRows(rows: ScorecardRow[]): PortfolioRow[] {
  return rows.map((row) => {
    const env = envOf(row)
    const delta = deltaOf(row.trend)
    const gates = row.card?.gates
    return {
      ...row,
      env,
      delta,
      ...riskOf(row, env, delta),
      gatesPct:
        gates && gates.applicable > 0 ? Math.round((gates.present / gates.applicable) * 100) : null,
    }
  })
}

export type PortfolioFilter = 'all' | 'attention' | PortfolioEnv
export type PortfolioSort = 'risk' | 'engineering' | 'trend' | 'name'

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
    if (sort === 'trend') return (a.delta ?? 0) - (b.delta ?? 0) || byName(a, b)
    return a.risk - b.risk || score(a) - score(b) || byName(a, b)
  })
}

export function portfolioKpis(rows: PortfolioRow[]) {
  const scored = rows.filter((r) => r.card)
  const ai = scored.flatMap((r) => (r.card?.aiUsage.available ? [r.card.aiUsage.data.level] : []))
  const deltas = scored.flatMap((r) => (r.delta === null ? [] : [r.delta]))
  return {
    total: rows.length,
    n3: scored.filter((r) => r.card?.level === 3).length,
    critical: rows.filter((r) => r.risk === 0).length,
    attention: rows.filter((r) => r.risk < 2).length,
    aiAverage: ai.length > 0 ? ai.reduce((n, v) => n + v, 0) / ai.length : null,
    aiCount: ai.length,
    up: deltas.filter((d) => d > 0).length,
    flat: deltas.filter((d) => d === 0).length,
    down: deltas.filter((d) => d < 0).length,
  }
}
