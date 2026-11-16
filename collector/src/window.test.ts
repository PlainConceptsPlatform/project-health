import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ScorecardConfig } from './config.ts'
import type { CommitLike } from './metrics/ai-usage.ts'
import { computeDeploymentFrequency } from './metrics/deployments.ts'
import { withinWindow } from './metrics/releases.ts'
import { type ScorecardSource, collectScorecard } from './metrics/scorecard.ts'
import type { EngineeringExcellence, ProjectConfig, Release } from './types.ts'
import { ok, skip } from './types.ts'
import { carryFacets, measurementWindow } from './window.ts'

/**
 * Every period-based number restarted on the 1st: on the 2nd a healthy project had a release or
 * two, a commit and no facet sample yet, so deploy frequency collapsed, AI usage swung to an
 * extreme and the scorecard fell back to workflow detection. These pin the trailing window that
 * replaces the calendar month while it is in progress, and that finished months are untouched.
 */

const DAY = 24 * 3_600_000
const NOVEMBER = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-12-01T00:00:00Z') }
const OCTOBER = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') }
const SECOND = new Date('2026-11-02T03:15:00Z')

describe('measurementWindow', () => {
  it('looks back 30 days from the collection while the month is in progress', () => {
    const window = measurementWindow(NOVEMBER, SECOND)
    expect(window).toEqual({
      from: new Date(SECOND.getTime() - 30 * DAY),
      to: SECOND,
      days: 30,
      rolling: true,
    })
    // The 2nd of November reaches back into October rather than starting on the 1st.
    expect(window.from.toISOString()).toBe('2026-10-03T03:15:00.000Z')
  })

  it('keeps a finished month as its calendar month, so history does not move', () => {
    expect(measurementWindow(OCTOBER, SECOND)).toEqual({
      from: OCTOBER.from,
      to: OCTOBER.to,
      days: 31,
      rolling: false,
    })
  })
})

const project: ProjectConfig = {
  id: 'checkout',
  name: 'Checkout',
  repo: 'your-org/checkout',
  enabled: true,
  status: 'production',
  environments: { production: 'pro', staging: 'pre' },
  productionRefPattern: '^v[0-9]+[.][0-9]+[.][0-9]+$',
  agents: { enabled: false, workflow: null },
}

const release = (n: number, at: string): Release => ({
  ref: `v1.0.${n}`,
  sha: `sha${n}`,
  deployedAt: at,
  deployedBy: 'someone',
  deploymentIds: [n],
  outOfProcess: false,
  unplanned: false,
  unplannedSource: null,
})

describe('Delivery over the window', () => {
  // Two releases a week through October, then one on the 1st of November.
  const history = [
    ...Array.from({ length: 9 }, (_, i) =>
      release(i + 1, new Date(OCTOBER.from.getTime() + (i * 3.5 + 1) * DAY).toISOString()),
    ),
    release(10, '2026-11-01T10:00:00Z'),
  ]

  it('does not drop deploy frequency to one release on the 2nd', () => {
    const window = measurementWindow(NOVEMBER, SECOND)
    const releases = withinWindow(history, window.from, window.to)
    const result = computeDeploymentFrequency(
      project,
      { releases: history, rawObjectCount: history.length },
      releases,
      window.from,
      window.to,
      SECOND.getTime(),
    )
    if (!result.block.available) throw new Error('expected a frequency')
    // October's releases from the 4th on still count, so the rate stays at about two a week.
    expect(result.block.data.count).toBe(9)
    expect(result.block.data.perWeek).toBeCloseTo(2.1, 1)
    // A rolling window is complete: it is divided by its own 30 days, not by elapsed days.
    expect(result.block.data.partialMonth).toBe(false)
    expect(result.block.data.elapsedDays).toBe(30)

    // What the calendar month reported on the same day: one release over one day.
    const calendar = computeDeploymentFrequency(
      project,
      { releases: history, rawObjectCount: history.length },
      withinWindow(history, NOVEMBER.from, NOVEMBER.to),
      NOVEMBER.from,
      NOVEMBER.to,
      SECOND.getTime(),
    )
    if (!calendar.block.available) throw new Error('expected a frequency')
    expect(calendar.block.data.count).toBe(1)
    expect(calendar.block.data.partialMonth).toBe(true)
  })
})

const config = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', 'config', 'scorecard.json'), 'utf8'),
) as ScorecardConfig

const series = <T>(latest: T, at: string) =>
  ok({
    samples: [
      { commitSha: 'abc', runId: 42, runAttempt: 1, artifactId: 1, generatedAt: at, data: latest },
    ],
    latest,
    latestGeneratedAt: at,
  })

const passingFacets = (at: string): EngineeringExcellence => ({
  coverage: series(
    { scopes: {}, global: { lineRate: 0.8, linesCovered: 8, linesValid: 10 }, passed: true },
    at,
  ),
  mutation: series(
    {
      scopes: {},
      global: {
        coveredScore: 0.8,
        fullScore: 0.7,
        killed: 8,
        timeout: 0,
        survived: 2,
        noCoverage: 0,
        valid: 10,
      },
      passed: true,
    },
    at,
  ),
  complexity: skip('No complexity artifact this month.'),
  security: series(
    {
      trivy: null,
      semgrep: null,
      jobs: { secretScan: 'success', depsAndIac: 'success', sast: 'success' },
      passed: true,
    },
    at,
  ),
  sbom: skip('No sbom artifact this month.'),
  hygiene: skip('No hygiene artifact this month.'),
})

const noFacetsYet = (): EngineeringExcellence => ({
  coverage: skip('No coverage artifact this month.'),
  mutation: skip('No mutation artifact this month.'),
  complexity: skip('No complexity artifact this month.'),
  security: skip('No security artifact this month.'),
  sbom: skip('No sbom artifact this month.'),
  hygiene: skip('No hygiene artifact this month.'),
})

describe('carryFacets', () => {
  const october = passingFacets('2026-10-20T00:00:00Z')

  it('takes a facet with no sample this month from last month while it is inside the window', () => {
    const carried = carryFacets(noFacetsYet(), october, new Date('2026-10-03T00:00:00Z'))
    expect(carried?.mutation).toBe(october.mutation)
    expect(carried?.coverage).toBe(october.coverage)
    // Nothing to carry stays unavailable rather than becoming something else.
    expect(carried?.sbom.available).toBe(false)
  })

  it('never replaces a facet this month already has, and drops one older than the window', () => {
    const current = { ...noFacetsYet(), coverage: series({ x: 1 }, '2026-11-01T12:00:00Z') }
    const carried = carryFacets(
      current as unknown as EngineeringExcellence,
      october,
      new Date('2026-10-25T00:00:00Z'),
    )
    expect(carried?.coverage).toBe(current.coverage)
    expect(carried?.mutation.available).toBe(false)
  })

  it('leaves a project that does not publish facets without any', () => {
    expect(carryFacets(undefined, october, new Date('2026-10-03T00:00:00Z'))).toBeUndefined()
  })
})

describe('Engineering scorecard on the 2nd of the month', () => {
  // October: 20 human commits and 2 assisted ones; November so far: one assisted commit.
  const dated = (at: string, assisted: boolean): CommitLike & { at: string } => ({
    at,
    sha: Math.random().toString(16).slice(2),
    parents: [{ sha: 'p' }],
    commit: { message: assisted ? 'x\n\nCo-authored-by: Claude <noreply@anthropic.com>' : 'x' },
    author: { login: 'someone', type: 'User' },
  })
  const commits = [
    ...Array.from({ length: 22 }, (_, i) =>
      dated(new Date(OCTOBER.from.getTime() + (i + 4) * DAY).toISOString(), i < 2),
    ),
    dated('2026-11-01T09:00:00Z', true),
  ]
  const source: ScorecardSource = {
    defaultBranch: async () => 'main',
    workflows: async () => [],
    latestRun: async () => null,
    commits: async (_branch, from, to) =>
      commits.filter((c) => Date.parse(c.at) >= from.getTime() && Date.parse(c.at) < to.getTime()),
  }
  const october = passingFacets('2026-10-20T00:00:00Z')
  const card = async (
    period: Parameters<typeof collectScorecard>[2],
    ee: EngineeringExcellence,
    now: Date,
  ) => {
    const block = await collectScorecard(project, config, period, ee, [], source, now)
    if (!block.available) throw new Error(block.reason)
    return block.data
  }

  it('keeps the level, the facets and the AI usage it had at the end of last month', async () => {
    const endOfOctober = await card(OCTOBER, october, new Date('2026-10-31T23:00:00Z'))
    const window = measurementWindow(NOVEMBER, SECOND)
    const second = await card(
      { ...NOVEMBER, window },
      carryFacets(noFacetsYet(), october, window.from) as EngineeringExcellence,
      SECOND,
    )

    expect(second.level).toBe(endOfOctober.level)
    expect(second.score).toBe(endOfOctober.score)
    expect(second.facetsPublished).toBe(true)
    // 3 of 23 commits since 3 October, not 1 of 1.
    expect(second.aiUsage).toMatchObject({
      available: true,
      data: { aiCommits: 3, totalCommits: 23 },
    })
    expect(second.alerts).toEqual([])
    expect(second.window).toEqual({
      from: '2026-10-03T03:15:00.000Z',
      to: '2026-11-02T03:15:00.000Z',
      days: 30,
      rolling: true,
    })
    expect(endOfOctober.window).toBeUndefined()
  })

  it('is what the calendar month got wrong: no facets, one commit, and an alert', async () => {
    const calendar = await card(NOVEMBER, noFacetsYet(), SECOND)
    expect(calendar.facetsPublished).toBe(false)
    expect(calendar.aiUsage).toMatchObject({ available: true, data: { level: 5, totalCommits: 1 } })
    expect(calendar.alerts.map((a) => a.code)).toContain('HIGH_AI_LOW_ENGINEERING')
  })
})
