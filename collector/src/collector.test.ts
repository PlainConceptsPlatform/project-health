import { describe, expect, it } from 'vitest'
import type { Deployment, Job } from './github.ts'
import { shapeFromJobs } from './metrics/agents.ts'
import { computeDeploymentFrequency } from './metrics/deployments.ts'
import { groupIntoReleases } from './metrics/releases.ts'
import { attributeMarkers } from './metrics/rework.ts'
import { placeProject } from './profile.ts'
import { distribution, median, percentiles } from './stats.ts'
import type { DeploymentFrequency, LeadTime, ProjectConfig, Release, ReworkRate } from './types.ts'
import { ok, skip } from './types.ts'

/**
 * These cover the places that were actually wrong during development, not the easy paths. Each
 * test names the mistake it prevents, because the point is to stop a regression rather than to
 * reach a coverage number.
 */

const TAG = /^v[0-9]+[.][0-9]+[.][0-9]+$/

const deployment = (over: Partial<Deployment> & { sha: string; ref: string; created_at: string }) =>
  ({
    id: Math.floor(Math.random() * 1e9),
    task: 'deploy',
    environment: 'pro',
    ...over,
  }) as Deployment

describe('groupIntoReleases', () => {
  it('counts one release per commit, not per deployment record', () => {
    // Some repositories emit several records per release. Counting records rather than commits
    // reported one such project at four times its real frequency.
    const records = [
      deployment({ sha: 'aaa', ref: 'v1.0.1', created_at: '2026-08-01T10:00:00Z', id: 1 }),
      deployment({ sha: 'aaa', ref: 'v1.0.1', created_at: '2026-08-01T10:05:00Z', id: 2 }),
      deployment({ sha: 'aaa', ref: 'v1.0.1', created_at: '2026-08-01T10:05:00Z', id: 3 }),
      deployment({ sha: 'aaa', ref: 'v1.0.1', created_at: '2026-08-01T10:20:00Z', id: 4 }),
    ]
    const { releases, rawObjectCount } = groupIntoReleases(records, TAG)

    expect(releases).toHaveLength(1)
    expect(rawObjectCount).toBe(4)
    expect(releases[0]?.deploymentIds).toHaveLength(4)
  })

  it('takes arrival time from the earliest record', () => {
    const records = [
      deployment({ sha: 'aaa', ref: 'v1.0.1', created_at: '2026-08-01T10:20:00Z' }),
      deployment({ sha: 'aaa', ref: 'v1.0.1', created_at: '2026-08-01T10:00:00Z' }),
    ]
    expect(groupIntoReleases(records, TAG).releases[0]?.deployedAt).toBe('2026-08-01T10:00:00Z')
  })

  it('prefers the tag over a branch when one commit arrived under both', () => {
    // A branch was deployed, then the same commit was tagged and deployed again. Naming the
    // release from the earliest record called it after the branch and flagged it out of process.
    const records = [
      deployment({ sha: 'fd59', ref: 'main', created_at: '2026-08-18T17:33:00Z' }),
      deployment({ sha: 'fd59', ref: 'v1.0.2', created_at: '2026-08-18T17:39:00Z' }),
    ]
    const release = groupIntoReleases(records, TAG).releases[0]

    expect(release?.ref).toBe('v1.0.2')
    expect(release?.deployedAt).toBe('2026-08-18T17:33:00Z')
    expect(release?.outOfProcess).toBe(false)
  })

  it('flags a genuine branch deploy as out of process', () => {
    const records = [deployment({ sha: 'bbb', ref: 'main', created_at: '2026-08-04T13:35:00Z' })]
    expect(groupIntoReleases(records, TAG).releases[0]?.outOfProcess).toBe(true)
  })

  it('orders releases oldest first', () => {
    const records = [
      deployment({ sha: 'ccc', ref: 'v1.0.2', created_at: '2026-08-02T00:00:00Z' }),
      deployment({ sha: 'bbb', ref: 'v1.0.1', created_at: '2026-08-01T00:00:00Z' }),
    ]
    expect(groupIntoReleases(records, TAG).releases.map((r) => r.ref)).toEqual(['v1.0.1', 'v1.0.2'])
  })
})

const release = (ref: string, sha: string, deployedAt: string): Release => ({
  ref,
  sha,
  deployedAt,
  deployedBy: 'someone',
  deploymentIds: [1],
  outOfProcess: false,
  unplanned: false,
  unplannedSource: null,
})

const project: ProjectConfig = {
  id: 'test',
  name: 'Test',
  repo: 'org/test',
  enabled: true,
  status: 'production',
  environments: { production: 'pro', staging: 'pre' },
  productionRefPattern: '^v[0-9]+[.][0-9]+[.][0-9]+$',
  agents: { enabled: false, workflow: null },
}

describe('computeDeploymentFrequency', () => {
  const from = new Date('2026-08-01T00:00:00Z')
  const to = new Date('2026-09-01T00:00:00Z')
  const releases = [
    release('v1.0.1', 'a', '2026-08-17T00:00:00Z'),
    release('v1.0.2', 'b', '2026-08-18T00:00:00Z'),
  ]

  it('divides by elapsed days while the period is still running', () => {
    // Nine releases over nineteen elapsed days were reported as 2.03 a week instead of 3.26,
    // because the divisor was the whole month including days that had not happened.
    const now = new Date('2026-08-20T00:00:00Z').getTime()
    const result = computeDeploymentFrequency(
      project,
      { releases, rawObjectCount: 2 },
      releases,
      from,
      to,
      now,
    )
    if (!result.block.available) throw new Error('expected a frequency')

    expect(result.block.data.partialMonth).toBe(true)
    expect(result.block.data.elapsedDays).toBe(19)
    expect(result.block.data.perWeek).toBeCloseTo(0.74, 1)
  })

  it('divides by the whole period once it has finished', () => {
    const now = new Date('2026-10-01T00:00:00Z').getTime()
    const result = computeDeploymentFrequency(
      project,
      { releases, rawObjectCount: 2 },
      releases,
      from,
      to,
      now,
    )
    if (!result.block.available) throw new Error('expected a frequency')

    expect(result.block.data.partialMonth).toBe(false)
    expect(result.block.data.elapsedDays).toBe(31)
  })

  it('warns when a version goes backwards, which means a rollback', () => {
    const rolled = [
      release('v1.0.5', 'a', '2026-08-10T00:00:00Z'),
      release('v1.0.3', 'b', '2026-08-11T00:00:00Z'),
    ]
    const result = computeDeploymentFrequency(
      project,
      { releases: rolled, rawObjectCount: 2 },
      rolled,
      from,
      to,
      new Date('2026-10-01T00:00:00Z').getTime(),
    )
    expect(result.warnings.map((w) => w.code)).toContain('ROLLBACK_DETECTED')
  })

  it('warns when a version never reached production', () => {
    const skipped = [
      release('v1.0.3', 'a', '2026-08-10T00:00:00Z'),
      release('v1.0.5', 'b', '2026-08-11T00:00:00Z'),
    ]
    const result = computeDeploymentFrequency(
      project,
      { releases: skipped, rawObjectCount: 2 },
      skipped,
      from,
      to,
      new Date('2026-10-01T00:00:00Z').getTime(),
    )
    expect(result.warnings.map((w) => w.code)).toContain('SKIPPED_TAG')
  })

  it('reports no releases as unavailable rather than as a rate of zero', () => {
    const result = computeDeploymentFrequency(
      project,
      { releases: [], rawObjectCount: 0 },
      [],
      from,
      to,
    )
    expect(result.block.available).toBe(false)
  })
})

describe('attributeMarkers', () => {
  const releases = [
    release('v1.0.0', 'a', '2026-08-17T17:33:00Z'),
    release('v1.0.1', 'b', '2026-08-17T19:13:00Z'),
    release('v1.0.2', 'c', '2026-08-18T17:33:00Z'),
  ]
  const at = (iso: string) => new Date(iso).getTime()

  it('gives a marker to the first release after it', () => {
    expect([...attributeMarkers([at('2026-08-17T18:00:00Z')], releases)]).toEqual(['b'])
  })

  it('collapses several markers that shipped in the same release', () => {
    const marks = [
      at('2026-08-17T10:00:00Z'),
      at('2026-08-17T11:00:00Z'),
      at('2026-08-17T12:00:00Z'),
    ]
    expect(attributeMarkers(marks, releases).size).toBe(1)
  })

  it('ignores a marker with no release after it', () => {
    expect(attributeMarkers([at('2026-08-30T00:00:00Z')], releases).size).toBe(0)
  })

  it('spreads markers across the releases that carried them', () => {
    const marks = [at('2026-08-17T18:00:00Z'), at('2026-08-18T09:00:00Z')]
    expect([...attributeMarkers(marks, releases)].sort()).toEqual(['b', 'c'])
  })
})

describe('stats', () => {
  it('interpolates percentiles rather than picking a nearest value', () => {
    const d = distribution([1, 2, 3, 4])
    expect(d.p50Hours).toBe(2.5)
    expect(d.count).toBe(4)
  })

  it('keeps the unit of the input for series that are not hours', () => {
    // Agent durations are seconds. The field names once said hours while holding seconds.
    expect(percentiles([10, 20, 30]).p50).toBe(20)
  })

  it('handles a single value without dividing by zero', () => {
    expect(distribution([7]).p50Hours).toBe(7)
    expect(percentiles([7]).p90).toBe(7)
  })

  it('returns null for an empty median rather than zero', () => {
    expect(median([])).toBeNull()
  })
})

describe('placeProject', () => {
  const dora = {
    reference: 'test',
    windowDays: 90,
    minimumSampleSize: 5,
    throughput: {
      deploymentsPerWeek: { high: 7, medium: 1, low: 0 },
      leadTimeHoursP50: { high: 24, medium: 168, low: 720 },
    },
    stability: { reworkRate: { high: 0.05, medium: 0.15, low: 0.3 } },
    profiles: [
      {
        id: 'hha',
        name: 'Harmonious High-Achievers',
        throughput: 'high',
        stability: 'high',
        wellbeing: 'high',
      },
      {
        id: 'pp',
        name: 'Pragmatic Performers',
        throughput: 'high',
        stability: 'high',
        wellbeing: 'medium',
      },
      {
        id: 'sm',
        name: 'Stable and Methodical',
        throughput: 'medium',
        stability: 'high',
        wellbeing: 'medium',
      },
      {
        id: 'lb',
        name: 'Legacy Bottleneck',
        throughput: 'medium',
        stability: 'low',
        wellbeing: 'low',
      },
      {
        id: 'fc',
        name: 'Foundational Challenges',
        throughput: 'low',
        stability: 'low',
        wellbeing: 'low',
      },
    ],
  }

  const frequency = (perWeek: number, count = 10) =>
    ok<DeploymentFrequency>({
      releases: [],
      count,
      rawObjectCount: count,
      perWeek,
      medianIntervalHours: 1,
    })
  const noLead = skip<LeadTime>('none')

  it('never returns an empty candidate list for a measured combination', () => {
    // The seven archetypes do not cover every throughput and stability pair, and filtering for an
    // exact match on both silently produced an empty badge row.
    const rework = ok<ReworkRate>({
      label: 'incident',
      unplanned: 9,
      total: 10,
      rate: 0.9,
      confidence: 'marked',
    })
    const placed = placeProject(
      dora,
      { ...project, reworkLabelPrecision: 'incident' },
      frequency(20),
      noLead,
      rework,
    )
    if (!placed.available) throw new Error('expected a placement')

    expect(placed.data.throughput).toBe('high')
    expect(placed.data.stability).toBe('low')
    expect(placed.data.candidateProfiles.length).toBeGreaterThan(0)
    expect(placed.data.exact).toBe(false)
  })

  it('keeps a broad rework label out of the stability axis', () => {
    // A broad bug label put one project at 63% rework, classifying a healthy repository as a
    // Legacy Bottleneck on the strength of a ticketing convention.
    const rework = ok<ReworkRate>({
      label: 'bug',
      unplanned: 8,
      total: 13,
      rate: 0.615,
      confidence: 'marked',
    })
    const placed = placeProject(
      dora,
      { ...project, reworkLabel: 'bug', reworkLabelPrecision: 'broad' },
      frequency(4),
      noLead,
      rework,
    )
    if (!placed.available) throw new Error('expected a placement')

    expect(placed.data.stability).toBe('unknown')
    expect(placed.data.candidateProfiles.map((p) => p.name)).not.toContain(
      'Foundational Challenges',
    )
    expect(placed.data.note).toContain('bug')
  })

  it('uses the stability axis when the marker is precise', () => {
    const rework = ok<ReworkRate>({
      label: 'incident',
      unplanned: 0,
      total: 20,
      rate: 0,
      confidence: 'marked',
    })
    const placed = placeProject(
      dora,
      { ...project, reworkLabelPrecision: 'incident' },
      frequency(10),
      noLead,
      rework,
    )
    if (!placed.available) throw new Error('expected a placement')
    expect(placed.data.stability).toBe('high')
  })

  it('refuses to place a project on too few releases', () => {
    const placed = placeProject(dora, project, frequency(1, 2), noLead, skip<ReworkRate>('none'))
    expect(placed.available).toBe(false)
  })

  it('always leaves well being unknown, because GitHub cannot measure it', () => {
    const placed = placeProject(dora, project, frequency(10), noLead, skip<ReworkRate>('none'))
    if (!placed.available) throw new Error('expected a placement')
    expect(placed.data.wellbeing).toBe('unknown')
  })
})

describe('shapeFromJobs', () => {
  const agentStep = (started: string, completed: string) => ({
    name: 'Execute OpenCode CLI',
    started_at: started,
    completed_at: completed,
  })

  const job = (name: string, steps: Job['steps'] = []): Job => ({
    id: 1,
    name,
    conclusion: 'success',
    steps,
  })

  it('reads the kind from the agent job name', () => {
    // Titles leak: an issue-triggered run says "Working (Implement)" but a dispatched one says
    // "dispatch: triage", so triage and half the implement runs were invisible.
    const shape = shapeFromJobs([
      job('classify'),
      job('call-triage / agent', [agentStep('2026-08-20T08:00:00Z', '2026-08-20T08:02:05Z')]),
    ])
    expect(shape.kind).toBe('triage')
    expect(shape.executionSeconds).toBe(125)
  })

  it('finds any kind, including ones added later', () => {
    for (const kind of ['implement', 'refine', 'triage', 'something-new']) {
      const shape = shapeFromJobs([
        job(`call-${kind} / agent`, [agentStep('2026-08-20T08:00:00Z', '2026-08-20T08:00:10Z')]),
      ])
      expect(shape.kind).toBe(kind)
    }
  })

  it('ignores an agent job that was declared but skipped', () => {
    // merge-gate declares an agent job on every run and skips it every time. Counting the job
    // rather than the step reported 140 agent runs that never invoked an agent.
    expect(shapeFromJobs([job('call-merge-gate / agent', [])]).kind).toBeNull()
    expect(shapeFromJobs([job('call-merge-gate / agent')]).kind).toBeNull()
  })

  it('ignores a step that never finished', () => {
    const shape = shapeFromJobs([
      job('call-implement / agent', [
        { name: 'Execute OpenCode CLI', started_at: '2026-08-20T08:00:00Z', completed_at: null },
      ]),
    ])
    expect(shape.kind).toBeNull()
  })

  it('returns nothing for a run with no agent job at all', () => {
    expect(shapeFromJobs([job('classify'), job('authorize')]).kind).toBeNull()
  })
})
