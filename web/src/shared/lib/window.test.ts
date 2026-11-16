import { describe, expect, it } from 'vitest'
import { releasesInMonth } from './data'
import { carryFacets } from './excellence'
import { periodLabel } from './format'
import { portfolioRows } from './portfolio'
import { scorecardRows } from './scorecard'
import { summarise } from './summary'
import type { DataIndex, EngineeringExcellence, MonthlyReport, Scorecard } from './types'

/**
 * While a month is in progress the collector measures delivery, AI usage and the facets over the
 * last 30 days and says so in `window`. These pin how the site reads that: labelled as the last 30
 * days, never double counted in the monthly trend, and a healthy project that had two releases on
 * the 1st and 2nd does not fall onto the attention list because the month restarted.
 */

const WINDOW = {
  from: '2026-10-03T03:15:00.000Z',
  to: '2026-11-02T03:15:00.000Z',
  days: 30,
  rolling: true as const,
}

const release = (n: number, deployedAt: string) => ({
  ref: `v1.0.${n}`,
  sha: `sha${n}`,
  deployedAt,
  deployedBy: 'someone',
  deploymentIds: [n],
  outOfProcess: false,
  unplanned: false,
  unplannedSource: null,
})

// Eight releases in the last days of October, two on the 1st and 2nd of November.
const releases = [
  ...Array.from({ length: 8 }, (_, i) =>
    release(i + 1, `2026-10-${String(5 + i * 3).padStart(2, '0')}T10:00:00Z`),
  ),
  release(9, '2026-11-01T10:00:00Z'),
  release(10, '2026-11-02T01:00:00Z'),
]

const card = (over: Partial<Scorecard> = {}): Scorecard => ({
  projectType: 'back-front',
  defaultBranch: 'main',
  facetsPublished: true,
  workflowsScanned: 3,
  practices: [],
  level: 2,
  score: 70,
  gates: { present: 8, applicable: 10 },
  aiUsage: {
    available: true,
    data: { level: 2, share: 0.13, aiCommits: 3, totalCommits: 23, byAssistant: {} },
  },
  alerts: [],
  ...over,
})

const report = (month: number, over: Partial<MonthlyReport> = {}): MonthlyReport =>
  ({
    period: {
      year: 2026,
      month,
      from: `2026-${month}-01T00:00:00.000Z`,
      to: `2026-${month + 1}-01T00:00:00.000Z`,
    },
    delivery: {
      productionEnvironment: 'pro',
      stagingEnvironment: null,
      deploymentFrequency: {
        available: true,
        data: { releases, count: 10, rawObjectCount: 10, perWeek: 2.33, medianIntervalHours: 72 },
      },
      leadTime: { available: false, reason: 'not measured' },
      reworkRate: { available: false, reason: 'no marker' },
    },
    agents: { available: false, reason: 'agents disabled' },
    scorecard: { available: true, data: card() },
    ...over,
  }) as unknown as MonthlyReport

const november = report(11, {
  window: WINDOW,
  scorecard: { available: true, data: card({ window: WINDOW }) },
})

const entry = {
  id: 'checkout',
  name: 'Checkout',
  repo: 'your-org/checkout',
  status: 'production',
  group: 'applications' as const,
  months: ['2026-10', '2026-11'],
}

describe('the month in progress', () => {
  it('summarises delivery over the window and labels it as the last 30 days', () => {
    const summary = summarise(entry, november)
    expect(summary).toMatchObject({ releases: 10, perWeek: 2.33, windowDays: 30 })
    expect(periodLabel('2026-11', november.window)).toBe('last 30 days')
    expect(periodLabel('2026-10', undefined)).toBe('October 2026')
    expect(summarise(entry, report(10)).windowDays).toBeNull()
  })

  it('counts only its own releases in the monthly trend, so October is not counted twice', () => {
    expect(releasesInMonth(november, releases)).toBe(2)
    expect(releasesInMonth(report(10), releases)).toBe(10)
  })

  it('does not put a healthy project on the attention list on the 2nd of the month', () => {
    const index: DataIndex = {
      generatedAt: '2026-11-02T03:15:00Z',
      projects: [{ ...entry, latest: '2026-11' }],
    }
    const months = { '2026-10': { checkout: report(10) }, '2026-11': { checkout: november } }
    const environment = {
      available: true as const,
      data: {
        final: 'PRO' as const,
        environments: [
          {
            name: 'pro',
            resourceGroup: null,
            tier: 'PRO' as const,
            source: 'environment-name' as const,
            lastDeployedAt: '2026-11-02T01:00:00Z',
          },
        ],
      },
    }
    const withEnv = (r: MonthlyReport) => ({ ...r, environment }) as MonthlyReport
    const rows = (nov: MonthlyReport) =>
      portfolioRows(
        scorecardRows(index, {
          '2026-10': { checkout: withEnv(months['2026-10'].checkout) },
          '2026-11': { checkout: withEnv(nov) },
        }),
      )

    const [row] = rows(november)
    expect(row).toMatchObject({ month: '2026-11', env: 'pro', risk: 2, alert: null, delta: 0 })

    // The calendar month on the same day: no facet yet, one assisted commit of one. That card is
    // what used to put the project on the list.
    const calendar = report(11, {
      scorecard: {
        available: true,
        data: card({
          level: 1,
          score: 45,
          facetsPublished: false,
          aiUsage: {
            available: true,
            data: { level: 5, share: 1, aiCommits: 1, totalCommits: 1, byAssistant: {} },
          },
        }),
      },
    })
    expect(rows(calendar)[0]?.risk).toBe(1)
  })

  it('shows last month’s facet until this month has one, as the scorecard rates it', () => {
    const facet = {
      available: true as const,
      data: { samples: [], latest: {}, latestGeneratedAt: '2026-10-20T00:00:00Z' },
    }
    const none = { available: false as const, reason: 'No artifact this month.' }
    const current = {
      coverage: none,
      mutation: none,
      complexity: none,
      security: none,
      sbom: none,
    } as unknown as EngineeringExcellence
    const previous = { ...current, mutation: facet } as unknown as EngineeringExcellence

    const shown = carryFacets(current, previous, WINDOW.from)
    expect(shown.carried).toEqual(['mutation'])
    expect(shown.excellence.mutation).toBe(previous.mutation)
    // Older than the window: not carried.
    expect(carryFacets(current, previous, '2026-10-25T00:00:00Z').carried).toEqual([])
  })
})
