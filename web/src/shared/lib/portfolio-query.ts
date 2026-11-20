import { type PortfolioEnv, type PortfolioRow, type PortfolioSort, SORTS } from './portfolio'
import type { ProjectFamily, ProjectGroup } from './types'

/**
 * What the overview shows: a search, a set of filters and a sort. It lives in the query string, so
 * a link copied from the address bar opens the same view for whoever receives it.
 *
 * Inside a group the values are alternatives (L0 or L1); across groups they all have to hold (L0
 * and in production).
 */
export interface PortfolioQuery {
  q: string
  level: Set<Level>
  alert: Set<AlertFilter>
  env: Set<EnvFilter>
  group: ProjectGroup | null
  family: FamilyFilter | null
  sort: PortfolioSort
}

export type Level = 0 | 1 | 2 | 3
/** Critical and attention are risk bands (attention includes critical); declining is one rule. */
export type AlertFilter = 'critical' | 'attention' | 'declining'
/** Tooling reads na and is never filtered by environment, so na is not a choice here. */
export type EnvFilter = Exclude<PortfolioEnv, 'na'>
export type FamilyFilter = ProjectFamily | 'none'

/** The chip groups, in the order the filter bar shows them. */
export type ChipGroup = 'level' | 'alert' | 'env'

export const LEVELS: Level[] = [0, 1, 2, 3]

export const ALERT_FILTERS: { key: AlertFilter; label: string }[] = [
  { key: 'critical', label: 'Critical' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'declining', label: 'Declining' },
]

export const ENV_FILTERS: { key: EnvFilter; label: string }[] = [
  { key: 'pro', label: 'PRO' },
  { key: 'pre', label: 'PRE' },
  { key: 'none', label: 'Not deployed' },
]

export const FAMILY_FILTERS: { key: FamilyFilter; label: string }[] = [
  { key: 'member', label: 'Family member' },
  { key: 'own-design', label: 'Own design' },
  { key: 'none', label: 'No family' },
]

export const emptyQuery = (): PortfolioQuery => ({
  q: '',
  level: new Set(),
  alert: new Set(),
  env: new Set(),
  group: null,
  family: null,
  sort: 'risk',
})

/** Extra facts a row does not carry itself: its type label for search, and its family. */
export interface RowContext {
  typeLabel?: string
  family?: ProjectFamily | null
}

function matchesAlert(row: PortfolioRow, key: AlertFilter): boolean {
  if (key === 'critical') return row.risk === 0
  if (key === 'attention') return row.risk < 2
  return row.alert?.kind === 'declining'
}

/**
 * Whether a row passes the query. `skip` leaves one chip group out, which is how a chip counts the
 * rows it would show if it were the only choice in its group: the count never promises rows the
 * other filters already hide.
 */
export function matchesQuery(
  row: PortfolioRow,
  query: PortfolioQuery,
  context: RowContext = {},
  skip?: ChipGroup,
): boolean {
  const q = query.q.trim().toLowerCase()
  if (q) {
    const haystack = [row.name, row.repo, context.typeLabel ?? ''].join(' ').toLowerCase()
    if (!haystack.includes(q)) return false
  }
  if (skip !== 'level' && query.level.size > 0) {
    const level = row.card?.level
    if (level === undefined || !query.level.has(level as Level)) return false
  }
  if (skip !== 'alert' && query.alert.size > 0) {
    if (![...query.alert].some((k) => matchesAlert(row, k))) return false
  }
  if (skip !== 'env' && query.env.size > 0) {
    if (row.env === 'na' || !query.env.has(row.env)) return false
  }
  if (query.group && row.group !== query.group) return false
  if (query.family) {
    const family = context.family ?? 'none'
    if (family !== query.family) return false
  }
  return true
}

/** The rows one chip would show, with every other active filter still applied. */
export function chipCount(
  rows: PortfolioRow[],
  query: PortfolioQuery,
  group: ChipGroup,
  value: Level | AlertFilter | EnvFilter,
  contextOf: (row: PortfolioRow) => RowContext = () => ({}),
): number {
  return rows.filter((row) => {
    if (!matchesQuery(row, query, contextOf(row), group)) return false
    if (group === 'level') return row.card?.level === value
    if (group === 'alert') return matchesAlert(row, value as AlertFilter)
    return row.env === value
  }).length
}

/** Active filters, not counting search and sort: the number the phone's Filters button shows. */
export const activeFilterCount = (query: PortfolioQuery) =>
  query.level.size +
  query.alert.size +
  query.env.size +
  (query.group ? 1 : 0) +
  (query.family ? 1 : 0)

export const isEmptyQuery = (query: PortfolioQuery) =>
  !query.q && activeFilterCount(query) === 0 && query.sort === 'risk'

const SORT_KEYS = new Set(SORTS.map((s) => s.key))

function setOf<T extends string | number>(raw: string | null, allowed: readonly T[]): Set<T> {
  const valid = new Map(allowed.map((v) => [String(v), v]))
  return new Set(
    (raw ?? '')
      .split(',')
      .map((v) => valid.get(v.trim()))
      .filter((v): v is T => v !== undefined),
  )
}

/**
 * Reads the query string. Unknown values are dropped rather than failing, so a link made before an
 * option was renamed still opens, showing whatever of it still applies.
 */
export function parseQuery(search: string): PortfolioQuery {
  const p = new URLSearchParams(search)
  const group = p.get('group')
  const family = p.get('family')
  const sort = p.get('sort')
  return {
    q: p.get('q') ?? '',
    level: setOf(p.get('level'), LEVELS),
    alert: setOf(
      p.get('alert'),
      ALERT_FILTERS.map((f) => f.key),
    ),
    env: setOf(
      p.get('env'),
      ENV_FILTERS.map((f) => f.key),
    ),
    group: group === 'applications' || group === 'tooling' ? group : null,
    family: FAMILY_FILTERS.some((f) => f.key === family) ? (family as FamilyFilter) : null,
    sort: sort && SORT_KEYS.has(sort as PortfolioSort) ? (sort as PortfolioSort) : 'risk',
  }
}

/** The query string for a view, without the leading "?"; defaults are left out to keep links short. */
export function formatQuery(query: PortfolioQuery, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams()
  if (query.q.trim()) p.set('q', query.q.trim())
  const list = <T>(name: string, values: Set<T>, order: readonly T[]) => {
    const sorted = order.filter((v) => values.has(v))
    if (sorted.length > 0) p.set(name, sorted.join(','))
  }
  list('level', query.level, LEVELS)
  list(
    'alert',
    query.alert,
    ALERT_FILTERS.map((f) => f.key),
  )
  list(
    'env',
    query.env,
    ENV_FILTERS.map((f) => f.key),
  )
  if (query.group) p.set('group', query.group)
  if (query.family) p.set('family', query.family)
  if (query.sort !== 'risk') p.set('sort', query.sort)
  for (const [k, v] of Object.entries(extra)) p.set(k, v)
  // Commas are safe in a query string and far easier to read in a shared link than %2C.
  return p.toString().replaceAll('%2C', ',')
}

/** A copy with one value added or removed from a chip group. */
export function toggle<K extends ChipGroup>(
  query: PortfolioQuery,
  group: K,
  value: PortfolioQuery[K] extends Set<infer V> ? V : never,
): PortfolioQuery {
  const next = new Set(query[group] as Set<typeof value>)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return { ...query, [group]: next }
}
