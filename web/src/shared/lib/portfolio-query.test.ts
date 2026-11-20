import { describe, expect, it } from 'vitest'
import { type PortfolioRow, portfolioRows, sortRows } from './portfolio'
import {
  activeFilterCount,
  chipCount,
  emptyQuery,
  formatQuery,
  matchesQuery,
  parseQuery,
  toggle,
} from './portfolio-query'
import type { ScorecardRow } from './scorecard'
import type { ProjectGroup, Scorecard } from './types'

/**
 * The overview's search, filters and sort live in the query string so a link opens the same view.
 * These pin the mistakes that would make a shared link or a filter chip lie.
 */

const card = (over: Partial<Scorecard> = {}): Scorecard => ({
  projectType: 'back-front',
  defaultBranch: 'main',
  facetsPublished: true,
  workflowsScanned: 1,
  practices: [],
  level: 2,
  score: 70,
  gates: { present: 8, applicable: 10 },
  aiUsage: { available: false, reason: 'no commits' },
  alerts: [],
  ...over,
})

const scorecardRow = (
  id: string,
  over: {
    group?: ProjectGroup
    final?: 'PRO' | 'PRE' | null
    card?: Partial<Scorecard> | null
    trend?: number[]
  } = {},
): ScorecardRow => ({
  id,
  name: id[0].toUpperCase() + id.slice(1),
  repo: `your-org/${id}`,
  status: 'production',
  group: over.group ?? 'applications',
  month: '2026-11',
  card: over.card === null ? null : card(over.card),
  reason: over.card === null ? 'No workflow on the default branch yet' : null,
  trend: (over.trend ?? []).map((score, i) => ({ month: `2026-0${i + 1}`, score })),
  daily: [],
  environment: {
    available: true,
    data: { final: over.final ?? null, environments: [] },
  } as unknown as ScorecardRow['environment'],
})

const rows: PortfolioRow[] = portfolioRows([
  scorecardRow('alder', { final: 'PRO', card: { level: 3, score: 90 } }),
  scorecardRow('birch', { final: 'PRO', card: { level: 0, score: 20 } }),
  scorecardRow('cedar', { final: 'PRE', card: { level: 2, score: 70 }, trend: [80, 74] }),
  scorecardRow('dune', { final: null, card: { level: 1, score: 40 } }),
  scorecardRow('isle', { card: null }),
  scorecardRow('ui-kit', {
    group: 'tooling',
    card: { level: 3, score: 88, projectType: 'library' },
  }),
])

const ids = (query = emptyQuery()) => rows.filter((r) => matchesQuery(r, query)).map((r) => r.id)

describe('matchesQuery', () => {
  it('shows every project with no query', () => {
    expect(ids()).toHaveLength(rows.length)
  })

  it('searches the name, the repository and the type label, ignoring case', () => {
    expect(ids({ ...emptyQuery(), q: 'BIRCH' })).toEqual(['birch'])
    expect(ids({ ...emptyQuery(), q: 'your-org/ced' })).toEqual(['cedar'])
    const byType = rows.filter((r) =>
      matchesQuery(r, { ...emptyQuery(), q: 'library' }, { typeLabel: r.card?.projectType }),
    )
    expect(byType.map((r) => r.id)).toEqual(['ui-kit'])
  })

  it('treats values in one group as alternatives and groups as all required', () => {
    const query = {
      ...emptyQuery(),
      level: new Set([0, 3] as const),
      env: new Set(['pro'] as const),
    }
    expect(ids(query)).toEqual(['alder', 'birch'])
  })

  it('never lets a level filter match a project without a scorecard', () => {
    // A row with no card has no level; reading it as L0 would list it among the worst projects.
    expect(ids({ ...emptyQuery(), level: new Set([0] as const) })).toEqual(['birch'])
  })

  it('leaves tooling out of an environment filter, whose environment does not apply', () => {
    expect(ids({ ...emptyQuery(), env: new Set(['none'] as const) })).toEqual(['dune', 'isle'])
  })

  it('reads critical, attention and declining from the risk and the alert kind', () => {
    expect(ids({ ...emptyQuery(), alert: new Set(['critical'] as const) })).toEqual(['birch'])
    expect(ids({ ...emptyQuery(), alert: new Set(['declining'] as const) })).toEqual(['cedar'])
    // Attention includes critical: "show only these" from the strip must keep the red ones.
    expect(ids({ ...emptyQuery(), alert: new Set(['attention'] as const) })).toEqual([
      'birch',
      'cedar',
    ])
  })

  it('filters by family, with no family as a choice of its own', () => {
    const family = { alder: 'member', dune: 'own-design' } as const
    const pick = (f: 'member' | 'own-design' | 'none') =>
      rows
        .filter((r) =>
          matchesQuery(
            r,
            { ...emptyQuery(), family: f },
            {
              family: family[r.id as keyof typeof family] ?? null,
            },
          ),
        )
        .map((r) => r.id)
    expect(pick('member')).toEqual(['alder'])
    expect(pick('own-design')).toEqual(['dune'])
    expect(pick('none')).toEqual(['birch', 'cedar', 'isle', 'ui-kit'])
  })
})

describe('chipCount', () => {
  it('counts what the chip would show with the other groups applied, not the whole fleet', () => {
    const query = { ...emptyQuery(), env: new Set(['pro'] as const) }
    expect(chipCount(rows, query, 'level', 0)).toBe(1)
    expect(chipCount(rows, query, 'level', 2)).toBe(0)
  })

  it('ignores its own group, so picking L0 does not drop the L3 count to zero', () => {
    const query = { ...emptyQuery(), level: new Set([0] as const) }
    expect(chipCount(rows, query, 'level', 3)).toBe(2)
  })
})

describe('parseQuery and formatQuery', () => {
  it('round-trips a view through the query string', () => {
    const query = {
      ...emptyQuery(),
      q: 'cedar',
      level: new Set([3, 0] as const),
      alert: new Set(['declining'] as const),
      env: new Set(['pre', 'pro'] as const),
      group: 'applications' as const,
      family: 'member' as const,
      sort: 'gates' as const,
    }
    const text = formatQuery(query)
    expect(text).toBe(
      'q=cedar&level=0,3&alert=declining&env=pro,pre&group=applications&family=member&sort=gates',
    )
    expect(parseQuery(`?${text}`)).toEqual(query)
  })

  it('writes nothing for the default view, so the plain address stays plain', () => {
    expect(formatQuery(emptyQuery())).toBe('')
    expect(formatQuery(emptyQuery(), { tab: 'code' })).toBe('tab=code')
  })

  it('drops values it does not know instead of failing, so an old link still opens', () => {
    const query = parseQuery('?level=2,9,x&env=pro,staging&sort=nope&group=other&family=?')
    expect([...query.level]).toEqual([2])
    expect([...query.env]).toEqual(['pro'])
    expect(query.sort).toBe('risk')
    expect(query.group).toBeNull()
    expect(query.family).toBeNull()
  })
})

describe('toggle and activeFilterCount', () => {
  it('adds and removes one value without touching the original query', () => {
    const base = emptyQuery()
    const on = toggle(base, 'env', 'pro')
    expect([...on.env]).toEqual(['pro'])
    expect(base.env.size).toBe(0)
    expect(toggle(on, 'env', 'pro').env.size).toBe(0)
  })

  it('counts filters but not the search or the sort', () => {
    const query = {
      ...emptyQuery(),
      q: 'x',
      sort: 'name' as const,
      level: new Set([1, 2] as const),
      group: 'tooling' as const,
    }
    expect(activeFilterCount(query)).toBe(3)
  })
})

describe('sortRows', () => {
  it('sorts by score in both directions and keeps rows without a scorecard last', () => {
    const apps = rows.filter((r) => r.group === 'applications')
    expect(sortRows(apps, 'engineering').map((r) => r.id)).toEqual([
      'alder',
      'cedar',
      'dune',
      'birch',
      'isle',
    ])
    expect(sortRows(apps, 'engineering-asc').map((r) => r.id)).toEqual([
      'birch',
      'dune',
      'cedar',
      'alder',
      'isle',
    ])
  })
})
