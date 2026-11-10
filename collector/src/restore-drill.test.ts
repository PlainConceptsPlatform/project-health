import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PracticeDefinition, RestoreDrillSource, ScorecardConfig } from './config.ts'
import {
  type HubJob,
  type HubRun,
  type RestoreDrillHub,
  drillJobFor,
  productOf,
  restoreDrillEvidence,
} from './metrics/restore-drill.ts'
import {
  type ScorecardSource,
  applicability,
  collectScorecard,
  ratePractice,
} from './metrics/scorecard.ts'
import type { ProjectConfig } from './types.ts'

const config = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', 'config', 'scorecard.json'), 'utf8'),
) as ScorecardConfig

const drill = config.practices.find((p) => p.id === 'restoredrill') as PracticeDefinition
const SOURCE: RestoreDrillSource = {
  repo: 'hub/acme',
  workflow: 'ops-backup-drill.yml',
  branch: 'main',
  maxRuns: 5,
}
const NOW = new Date('2026-11-04T00:00:00Z')
const BEFORE = new Date('2026-11-30T00:00:00Z')

const project = (over: Partial<ProjectConfig> = {}): ProjectConfig => ({
  id: 'bots',
  name: 'Bots',
  repo: 'org/Bots',
  enabled: true,
  status: 'production',
  environments: { production: 'pro', staging: 'pre' },
  productionRefPattern: '^v',
  agents: { enabled: false, workflow: null },
  scorecard: { restoredrill: true },
  ...over,
})

const run = (id: number, at: string): HubRun => ({
  id,
  url: `https://github.com/hub/acme/actions/runs/${id}`,
  conclusion: 'failure',
  at,
})

const hubOf = (
  runs: HubRun[],
  jobs: Record<number, HubJob[]>,
): RestoreDrillHub & { jobCalls: number[] } => {
  const jobCalls: number[] = []
  return {
    jobCalls,
    runs: async () => runs,
    jobs: async (id) => {
      jobCalls.push(id)
      return jobs[id] ?? []
    },
  }
}

describe('productOf', () => {
  it('is the repository name in lower case unless the project says otherwise', () => {
    expect(productOf(project())).toBe('bots')
    expect(productOf(project({ repo: 'org/DeliveryMetrics' }))).toBe('deliverymetrics')
    expect(productOf(project({ scorecard: { restoreDrillProduct: 'plinybot' } }))).toBe('plinybot')
  })
})

describe('drillJobFor', () => {
  const jobs: HubJob[] = [
    { name: 'Plan the drill', conclusion: 'success' },
    { name: 'Posture bots/plinybot', conclusion: 'success' },
    { name: 'Drill acme/acme', conclusion: 'failure' },
    { name: 'Drill bots/plinybot', conclusion: 'success' },
  ]

  it('finds the restore job of the product, case-insensitively', () => {
    expect(drillJobFor(jobs, 'BOTS')?.conclusion).toBe('success')
    expect(drillJobFor(jobs, 'acme')?.conclusion).toBe('failure')
  })

  it('never takes a posture-only job for a restore', () => {
    expect(
      drillJobFor([{ name: 'Posture bots/plinybot', conclusion: 'success' }], 'bots'),
    ).toBeNull()
  })

  it('does not match a product that merely starts with the same letters', () => {
    expect(drillJobFor([{ name: 'Drill botsy/db', conclusion: 'success' }], 'bots')).toBeNull()
  })

  it('reads through a reusable-workflow prefix and a matrix suffix', () => {
    expect(
      drillJobFor([{ name: 'caller / Drill bots/plinybot', conclusion: 'success' }], 'bots'),
    ).not.toBeNull()
    expect(
      drillJobFor([{ name: 'Drill bots/plinybot (1)', conclusion: 'success' }], 'bots'),
    ).not.toBeNull()
  })
})

describe('restoreDrillEvidence', () => {
  it('reads a passing drill of the project', async () => {
    const hub = hubOf([run(10, '2026-10-01T04:00:00Z')], {
      10: [{ name: 'Drill bots/plinybot', conclusion: 'success' }],
    })
    const ev = await restoreDrillEvidence(project(), SOURCE, hub, BEFORE)
    expect(ev).toMatchObject({
      source: 'detected',
      mode: 'blocking',
      result: 'passing',
      resultAt: '2026-10-01T04:00:00Z',
      lastRun: { workflow: 'ops-backup-drill.yml', conclusion: 'success' },
    })
    expect(ev?.lastRun?.url).toContain('/runs/10')
  })

  it('reads a failed drill as failing', async () => {
    const hub = hubOf([run(10, '2026-10-01T04:00:00Z')], {
      10: [{ name: 'Drill bots/plinybot', conclusion: 'failure' }],
    })
    expect((await restoreDrillEvidence(project(), SOURCE, hub, BEFORE))?.result).toBe('failing')
  })

  it('looks past a newer run that drilled only another product', async () => {
    const hub = hubOf([run(12, '2026-10-20T00:00:00Z'), run(10, '2026-10-01T00:00:00Z')], {
      12: [{ name: 'Drill acme/acme', conclusion: 'success' }],
      10: [{ name: 'Drill bots/plinybot', conclusion: 'success' }],
    })
    const ev = await restoreDrillEvidence(project(), SOURCE, hub, BEFORE)
    expect(ev?.resultAt).toBe('2026-10-01T00:00:00Z')
    expect(hub.jobCalls).toEqual([12, 10])
  })

  it('is not decided by a cancelled or skipped job', async () => {
    const hub = hubOf([run(12, '2026-10-20T00:00:00Z'), run(10, '2026-10-01T00:00:00Z')], {
      12: [{ name: 'Drill bots/plinybot', conclusion: 'cancelled' }],
      10: [{ name: 'Drill bots/plinybot', conclusion: 'success' }],
    })
    expect((await restoreDrillEvidence(project(), SOURCE, hub, BEFORE))?.resultAt).toBe(
      '2026-10-01T00:00:00Z',
    )
  })

  it('is null when no recent run drilled the product', async () => {
    const hub = hubOf([run(12, '2026-10-20T00:00:00Z')], {
      12: [{ name: 'Posture bots/plinybot', conclusion: 'success' }],
    })
    expect(await restoreDrillEvidence(project(), SOURCE, hub, BEFORE)).toBeNull()
    expect(await restoreDrillEvidence(project(), SOURCE, hubOf([], {}), BEFORE)).toBeNull()
  })

  it('reports an unreadable hub as a shortfall, never as a pass or a crash', async () => {
    const broken: RestoreDrillHub = {
      runs: async () => {
        throw new Error('404')
      },
      jobs: async () => [],
    }
    const ev = await restoreDrillEvidence(project(), SOURCE, broken, BEFORE)
    expect(ev?.result).toBe('unknown')
    expect(ev?.shortfall).toContain('hub/acme')
    expect(ev?.shortfall).toContain('404')

    const jobsBroken: RestoreDrillHub = {
      runs: async () => [run(1, '2026-10-01T00:00:00Z')],
      jobs: async () => {
        throw new Error('rate limited')
      },
    }
    expect(
      (await restoreDrillEvidence(project(), SOURCE, jobsBroken, BEFORE))?.shortfall,
    ).toContain('rate limited')
  })
})

describe('the restore drill practice', () => {
  const rate = (evidence: Parameters<typeof ratePractice>[2], applies = true) =>
    ratePractice(
      drill,
      { applicable: applies, reason: applies ? null : 'opt in' },
      evidence,
      NOW,
      config.staleDays,
    )
  const evidence = (resultAt: string, result: 'passing' | 'failing' = 'passing') => ({
    source: 'detected' as const,
    tools: ['Restore drill'],
    mode: 'blocking' as const,
    result,
    resultAt,
    lastRun: null,
  })

  it('is a blocking, opt-in practice with its own quarterly staleness', () => {
    expect(drill).toMatchObject({ number: 12, phase: 'operate', mode: 'blocking', optIn: true })
    expect(drill.staleDays).toBe(100)
  })

  it('stays green for a drill 90 days old, where the 14 day default would not', () => {
    expect(rate(evidence('2026-08-06T00:00:00Z')).rag).toBe('green')
  })

  it('turns yellow just past 100 days and is still green on the 100th', () => {
    expect(rate(evidence('2026-07-27T00:00:00Z')).rag).toBe('green')
    const old = rate(evidence('2026-07-26T00:00:00Z'))
    expect(old.rag).toBe('yellow')
    expect(old.reason).toContain('100 day limit')
  })

  it('is red when the drill failed, whatever its age', () => {
    expect(rate(evidence('2026-11-01T00:00:00Z', 'failing')).rag).toBe('red')
  })

  it('is red with its own reason when no drill covers the project', () => {
    const rated = rate(null)
    expect(rated.rag).toBe('red')
    expect(rated.reason).toContain('drill inventory')
  })

  it('keeps the 14 day limit for every other practice', () => {
    const secrets = config.practices.find((p) => p.id === 'secrets') as PracticeDefinition
    const rated = ratePractice(
      secrets,
      { applicable: true, reason: null },
      evidence('2026-10-05T00:00:00Z'),
      NOW,
      config.staleDays,
    )
    expect(rated.rag).toBe('yellow')
  })

  it('applies only to a project that opts in', () => {
    expect(applicability(drill, project(), config).applicable).toBe(true)
    const off = applicability(drill, project({ scorecard: {} }), config)
    expect(off.applicable).toBe(false)
    expect(off.reason).toContain('scorecard.restoredrill')
    expect(
      applicability(
        drill,
        project({ scorecard: { restoredrill: true, notApplicable: ['restoredrill'] } }),
        config,
      ).applicable,
    ).toBe(false)
  })
})

describe('collectScorecard with the restore drill', () => {
  const source: ScorecardSource = {
    defaultBranch: async () => 'main',
    workflows: async () => [],
    latestRun: async () => null,
    commits: async () => [],
  }
  const period = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') }
  const withHub = { ...config, restoreDrill: SOURCE }

  const collect = async (p: ProjectConfig, cfg: ScorecardConfig, hub: RestoreDrillHub) => {
    const block = await collectScorecard(p, cfg, period, undefined, [], source, NOW, hub)
    if (!block.available) throw new Error('scorecard unavailable')
    return block.data.practices.find((x) => x.id === 'restoredrill')
  }

  it('rates an opted-in project from the hub', async () => {
    const hub = hubOf([run(10, '2026-10-20T04:00:00Z')], {
      10: [{ name: 'Drill bots/plinybot', conclusion: 'success' }],
    })
    const result = await collect(project(), withHub, hub)
    expect(result).toMatchObject({ applicable: true, rag: 'green', source: 'detected' })
    expect(result?.lastRun?.url).toContain('/runs/10')
  })

  it('does not touch the hub for a project that is not opted in', async () => {
    const hub = hubOf([run(10, '2026-10-20T04:00:00Z')], {
      10: [{ name: 'Drill bots/plinybot', conclusion: 'success' }],
    })
    const result = await collect(project({ scorecard: {} }), withHub, hub)
    expect(result).toMatchObject({ applicable: false, rag: 'grey' })
    expect(hub.jobCalls).toEqual([])
  })

  it('is red for an opted-in project the hub never drilled', async () => {
    const hub = hubOf([run(10, '2026-10-20T04:00:00Z')], {
      10: [{ name: 'Drill acme/acme', conclusion: 'success' }],
    })
    expect((await collect(project(), withHub, hub))?.rag).toBe('red')
  })

  it('is red when the platform names no hub, never a silent pass', async () => {
    const hub = hubOf([], {})
    expect((await collect(project(), config, hub))?.rag).toBe('red')
  })

  it('moves the score and the gate count but never the level', async () => {
    const scorecardWith = async (conclusion: string) => {
      const hub = hubOf([run(10, '2026-10-20T04:00:00Z')], {
        10: [{ name: 'Drill bots/plinybot', conclusion }],
      })
      const block = await collectScorecard(
        project(),
        withHub,
        period,
        undefined,
        [],
        source,
        NOW,
        hub,
      )
      if (!block.available) throw new Error('unavailable')
      return block.data
    }
    const passing = await scorecardWith('success')
    const failing = await scorecardWith('failure')
    expect(passing.level).toBe(failing.level)
    expect(passing.score).toBeGreaterThan(failing.score as number)
    expect(passing.gates.present).toBe(failing.gates.present + 1)
    expect(passing.gates.applicable).toBe(failing.gates.applicable)
  })
})
