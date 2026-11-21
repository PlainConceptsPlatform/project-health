import { describe, expect, it } from 'vitest'
import {
  type FilterGroupDef,
  type ListQuery,
  filterRows,
  optionCounts,
  sinkMissing,
  toggle,
} from './list-filter'

interface Row {
  id: string
  name: string
  level: number | null
  env: 'pro' | 'pre'
}

const rows: Row[] = [
  { id: 'a', name: 'Alder', level: 0, env: 'pro' },
  { id: 'b', name: 'Birch', level: 1, env: 'pre' },
  { id: 'c', name: 'Cedar', level: 1, env: 'pro' },
  { id: 'd', name: 'Dune', level: 3, env: 'pro' },
  { id: 'e', name: 'Elm', level: null, env: 'pre' },
]

const groups: FilterGroupDef<Row>[] = [
  {
    key: 'level',
    label: 'Level',
    options: [0, 1, 2, 3].map((l) => ({
      value: String(l),
      label: `L${l}`,
      match: (r: Row) => r.level === l,
    })),
  },
  {
    key: 'env',
    label: 'Env',
    options: (['pro', 'pre'] as const).map((e) => ({
      value: e,
      label: e,
      match: (r: Row) => r.env === e,
    })),
  },
]

const query = (selection: Record<string, string[]>, q = ''): ListQuery<Row> => ({
  groups,
  selection,
  query: q,
  text: (r) => r.name,
})

const ids = (list: Row[]) => list.map((r) => r.id)

describe('filterRows', () => {
  it('widens inside a group: L0 or L1', () => {
    expect(ids(filterRows(rows, query({ level: ['0', '1'] })))).toEqual(['a', 'b', 'c'])
  })

  it('narrows across groups: L0 or L1, and in PRO', () => {
    expect(ids(filterRows(rows, query({ level: ['0', '1'], env: ['pro'] })))).toEqual(['a', 'c'])
  })

  it('does not filter on a group with nothing picked', () => {
    expect(filterRows(rows, query({ level: [] }))).toHaveLength(rows.length)
  })

  it('never matches a row without a level to a level chip', () => {
    expect(ids(filterRows(rows, query({ level: ['0', '1', '2', '3'] })))).not.toContain('e')
  })

  it('needs every search word, in any case', () => {
    expect(ids(filterRows(rows, query({}, 'CED')))).toEqual(['c'])
    expect(filterRows(rows, query({}, 'cedar alder'))).toHaveLength(0)
  })
})

describe('optionCounts', () => {
  it('counts each option with the other groups applied but not its own', () => {
    const counts = optionCounts(rows, query({ level: ['1'], env: ['pro'] }))
    // Level counts apply env=pro only: Alder L0, Cedar L1, Dune L3.
    expect(counts.level).toEqual({ '0': 1, '1': 1, '2': 0, '3': 1 })
    // Env counts apply level=1 only: Birch pre, Cedar pro.
    expect(counts.env).toEqual({ pro: 1, pre: 1 })
  })

  it('applies the search to every count', () => {
    expect(optionCounts(rows, query({}, 'birch')).env).toEqual({ pro: 0, pre: 1 })
  })
})

describe('sorting helpers', () => {
  it('sinks rows without a value to the bottom in both directions', () => {
    const has = (r: Row) => r.level !== null
    const asc = [...rows].sort(sinkMissing(has, (a, b) => (a.level ?? 0) - (b.level ?? 0)))
    const desc = [...rows].sort(sinkMissing(has, (a, b) => (b.level ?? 0) - (a.level ?? 0)))
    expect(asc.at(-1)?.id).toBe('e')
    expect(desc.at(-1)?.id).toBe('e')
  })

  it('toggles one value in one group', () => {
    expect(toggle({ level: ['1'] }, 'level', '1')).toEqual({ level: [] })
    expect(toggle({}, 'env', 'pro')).toEqual({ env: ['pro'] })
  })
})
