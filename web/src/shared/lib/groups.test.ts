import { describe, expect, it } from 'vitest'
import { byGroup, portfolioKpis, portfolioRows } from './portfolio'
import { type ScorecardRow, groupOf } from './scorecard'
import { sortSummaries, summarise } from './summary'
import type { MonthlyReport, ProjectGroup, Scorecard } from './types'

/**
 * Libraries and sites used to sit in the application ranking with no environments, so they read as
 * "not deployed", sank to the bottom and pulled the averages down. These pin the split: how a
 * project gets its group, and that nothing environment based reaches a tooling row.
 */

const card = (over: Partial<Scorecard> = {}): Scorecard => ({
  projectType: 'back-front',
  defaultBranch: 'main',
  facetsPublished: true,
  workflowsScanned: 1,
  practices: [],
  level: 0,
  score: 20,
  gates: { present: 1, applicable: 10 },
  aiUsage: { available: false, reason: 'no commits' },
  alerts: [],
  ...over,
})

const row = (id: string, group: ProjectGroup, over: Partial<ScorecardRow> = {}): ScorecardRow => ({
  id,
  name: id,
  repo: `your-org/${id}`,
  status: 'production',
  group,
  month: '2026-10',
  card: card(),
  reason: null,
  trend: [],
  daily: [],
  environment: {
    available: true,
    data: {
      final: 'PRO',
      environments: [
        {
          name: 'pro',
          resourceGroup: null,
          tier: 'PRO',
          source: 'environment-name',
          lastDeployedAt: '2026-10-01T00:00:00Z',
        },
      ],
    },
  },
  ...over,
})

describe('groupOf', () => {
  it('defaults libraries and static sites to tooling, so an existing projects.json needs no edit', () => {
    expect(groupOf({ type: 'library' })).toBe('tooling')
    expect(groupOf({ type: 'static-site' })).toBe('tooling')
  })

  it('defaults every other type, and no type at all, to applications', () => {
    expect(groupOf({ type: 'back-front' })).toBe('applications')
    expect(groupOf({ type: 'browser-extension' })).toBe('applications')
    expect(groupOf({})).toBe('applications')
  })

  it('lets an explicit group override the type in both directions', () => {
    expect(groupOf({ type: 'library', group: 'applications' })).toBe('applications')
    expect(groupOf({ type: 'back-front', group: 'tooling' })).toBe('tooling')
  })

  it('ignores a group it does not know rather than inventing a section', () => {
    expect(groupOf({ type: 'library', group: 'pillars' })).toBe('tooling')
  })
})

describe('tooling in the portfolio', () => {
  it('reads the environment as not applicable, even when a deploy was recorded', () => {
    const [tooling] = portfolioRows([row('foundations', 'tooling')])
    expect(tooling?.env).toBe('na')
  })

  it('never raises the production alerts, which assume a PRO environment', () => {
    const [tooling] = portfolioRows([row('foundations', 'tooling')])
    expect(tooling?.alert).toBeNull()
    expect(tooling?.risk).toBe(2)
  })

  it('keeps the high AI, low engineering alert', () => {
    const alerts: Scorecard['alerts'] = [
      { code: 'HIGH_AI_LOW_ENGINEERING', severity: 'amber', message: 'AI 5 at L0' },
    ]
    const [tooling] = portfolioRows([row('foundations', 'tooling', { card: card({ alerts }) })])
    expect(tooling?.alert?.text).toBe('High AI, low engineering')
  })

  it('keeps tooling out of the application ranking and averages', () => {
    const rows = portfolioRows([
      row('numa', 'applications', {
        card: card({ level: 3, gates: { present: 9, applicable: 10 } }),
      }),
      row('foundations', 'tooling', { card: card({ gates: { present: 1, applicable: 10 } }) }),
    ])
    const { applications, tooling } = byGroup(rows)
    expect(applications.map((r) => r.id)).toEqual(['numa'])
    expect(tooling.map((r) => r.id)).toEqual(['foundations'])
    expect(portfolioKpis(applications)).toMatchObject({ total: 1, gatesAverage: 90, n3: 1 })
    expect(portfolioKpis(tooling)).toMatchObject({ total: 1, gatesAverage: 10, pro: 0 })
  })
})

describe('tooling in delivery', () => {
  const entry = (id: string, group: ProjectGroup) => ({
    id,
    name: id,
    repo: `your-org/${id}`,
    status: 'production',
    group,
    months: ['2026-10'],
  })

  const report = {
    period: { year: 2026, month: 10, from: '2026-10-01', to: '2026-10-31' },
    delivery: {
      productionEnvironment: 'github-pages',
      stagingEnvironment: null,
      deploymentFrequency: {
        available: true,
        data: { releases: [], count: 12, rawObjectCount: 12, perWeek: 3, medianIntervalHours: 4 },
      },
      leadTime: {
        available: true,
        data: {
          commitToProduction: {
            available: true,
            data: { count: 12, p50Hours: 1, p75Hours: 2, p90Hours: 3 },
          },
          issueToStaging: { available: false, reason: 'no label' },
        },
      },
      reworkRate: { available: false, reason: 'no marker' },
    },
    agents: { available: false, reason: 'agents disabled' },
  } as unknown as MonthlyReport

  it('reports no delivery numbers for tooling, whatever the collector found', () => {
    expect(summarise(entry('project-health', 'tooling'), report)).toMatchObject({
      hasData: true,
      releases: null,
      perWeek: null,
      leadTimeP50Hours: null,
      reworkRate: null,
      reasons: { agents: 'agents disabled' },
    })
  })

  it('sorts tooling after every application on a delivery key', () => {
    const items = [
      summarise(entry('project-health', 'tooling'), report),
      summarise(entry('numa', 'applications'), report),
    ]
    expect(sortSummaries(items, 'frequency').map((p) => p.id)).toEqual(['numa', 'project-health'])
  })
})
