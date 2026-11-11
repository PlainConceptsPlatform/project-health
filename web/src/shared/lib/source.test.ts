import { describe, expect, it } from 'vitest'
import { FACET_ONLY_REASON, isFacetOnly, siteSource, withFacetOnlyReasons } from './source'
import type { MonthlyReport } from './types'

/**
 * A month facet-store wrote has no scorecard, codebase or Actions block, and never will on that
 * host. Read as a GitHub month, the page promised they would "appear after the next collection" and
 * the footer said every number came from the GitHub API.
 */

const off = (reason: string) => ({ available: false as const, reason })

const month = (over: Partial<MonthlyReport> = {}): MonthlyReport =>
  ({
    schemaVersion: 1,
    project: 'checkout',
    name: 'Checkout',
    repo: 'contoso/checkout',
    status: 'production',
    period: { year: 2026, month: 10, from: '', to: '' },
    generatedAt: '2026-10-11T00:00:00.000Z',
    delivery: {
      productionEnvironment: null,
      stagingEnvironment: null,
      deploymentFrequency: off('No production environment is configured.'),
      leadTime: off('x'),
      reworkRate: off('x'),
    },
    agents: off('x'),
    contributors: off('x'),
    placement: off('x'),
    warnings: [],
    ...over,
  }) as MonthlyReport

const facets = (over: Partial<MonthlyReport> = {}) => month({ source: 'facets', ...over })

describe('facet-only months', () => {
  it('fills the blocks facet-store never writes with a reason true for that host', () => {
    const report = withFacetOnlyReasons(facets())
    expect(report.scorecard).toEqual(off(FACET_ONLY_REASON))
    expect(report.codebase).toEqual(off(FACET_ONLY_REASON))
    expect(report.actions?.minutes).toEqual(off(FACET_ONLY_REASON))
  })

  it('keeps a block that is there', () => {
    const scorecard = off('kept')
    expect(withFacetOnlyReasons(facets({ scorecard })).scorecard).toBe(scorecard)
  })

  it('leaves a GitHub month alone, so an older file still reads as not yet collected', () => {
    const report = month()
    expect(withFacetOnlyReasons(report)).toBe(report)
  })

  it('recognises a month facet-store wrote before it carried the marker', () => {
    const legacy = month({
      delivery: {
        ...month().delivery,
        deploymentFrequency: off(
          'This month was written from engineering facets alone, so this host publishes no deployment, agent or pull request data.',
        ),
      },
    })
    expect(isFacetOnly(legacy)).toBe(true)
  })
})

describe('siteSource', () => {
  it('claims GitHub only when no month came from facets', () => {
    expect(siteSource([month(), month()])).toBe('github')
    expect(siteSource([])).toBe('github')
  })

  it('says facets when every month did, and mixed otherwise', () => {
    expect(siteSource([facets(), facets()])).toBe('facets')
    expect(siteSource([facets(), month()])).toBe('mixed')
  })
})
