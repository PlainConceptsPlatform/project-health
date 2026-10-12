import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ScorecardConfig } from './config.ts'
import type { ScorecardSource } from './metrics/scorecard.ts'
import {
  PLANNED_REASON,
  collectPlannedProject,
  partitionPlanned,
  repositoryExists,
} from './planned.ts'
import type { ProjectConfig } from './types.ts'

/**
 * A planned project used to be skipped outright, which hid the scorecard of a repository that
 * already has code. These pin both halves of the change: the scorecard is collected while nothing
 * claims the project deploys, and a repository that does not exist yet never fails the run.
 */

const config = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', 'config', 'scorecard.json'), 'utf8'),
) as ScorecardConfig

const workflow = (name: string) =>
  readFileSync(join(import.meta.dirname, 'fixtures', 'scorecard', name), 'utf8')

const planned = (over: Partial<ProjectConfig> = {}): ProjectConfig => ({
  id: 'ledger',
  name: 'Ledger',
  repo: 'your-org/ledger',
  enabled: true,
  status: 'planned',
  environments: { production: null, staging: null },
  productionRefPattern: '^v',
  agents: { enabled: false, workflow: null },
  type: 'back-front',
  ...over,
})

const period = {
  year: 2026,
  month: 10,
  from: new Date('2026-10-01T00:00:00Z'),
  to: new Date('2026-11-01T00:00:00Z'),
}
const NOW = new Date('2026-10-20T00:00:00Z')

const source: ScorecardSource = {
  defaultBranch: async () => 'main',
  workflows: async () => [{ path: '.github/workflows/ci.yml', text: workflow('ci-blocking.yml') }],
  latestRun: async () => ({
    id: 1,
    url: 'https://github.com/o/r/actions/runs/1',
    conclusion: 'success',
    at: '2026-10-14T00:00:00Z',
    jobs: [
      { name: 'Unit tests', conclusion: 'success' },
      { name: 'acceptance', conclusion: 'success' },
      { name: 'Security', conclusion: 'success' },
    ],
  }),
  commits: async () => [
    { sha: 'a', commit: { message: 'feat: x\n\nCo-authored-by: Claude <noreply@anthropic.com>' } },
    { sha: 'b', commit: { message: 'fix: y' } },
  ],
}

describe('collectPlannedProject', () => {
  it('collects the scorecard and its AI usage for a planned project with a readable repository', async () => {
    const report = await collectPlannedProject({
      project: planned(),
      period,
      config,
      previousScores: [],
      source,
      now: NOW,
    })

    expect(report.status).toBe('planned')
    if (!report.scorecard?.available) throw new Error('scorecard should be collected')
    expect(report.scorecard.data.workflowsScanned).toBe(1)
    expect(report.scorecard.data.practices.find((p) => p.id === 'tests')?.rag).toBe('green')
    expect(report.scorecard.data.aiUsage).toMatchObject({
      available: true,
      data: { aiCommits: 1, totalCommits: 2, byAssistant: { Claude: 1 } },
    })
  })

  it('marks every delivery-dependent block unavailable with the planned reason', async () => {
    const report = await collectPlannedProject({
      project: planned({ engineeringExcellence: { enabled: true } }),
      period,
      config,
      previousScores: [],
      source,
      now: NOW,
    })

    const unavailable = { available: false, reason: PLANNED_REASON }
    expect(report.delivery.deploymentFrequency).toEqual(unavailable)
    expect(report.delivery.leadTime).toEqual(unavailable)
    expect(report.delivery.reworkRate).toEqual(unavailable)
    expect(report.agents).toEqual(unavailable)
    expect(report.contributors).toEqual(unavailable)
    expect(report.placement).toEqual(unavailable)
    expect(Object.values(report.engineeringExcellence ?? {})).toEqual(Array(6).fill(unavailable))
    expect(report.warnings).toEqual([])
  })

  it('turns a scorecard that throws into an unavailable block and a warning rather than a crash', async () => {
    const report = await collectPlannedProject({
      project: planned(),
      period,
      config,
      previousScores: [],
      source: { ...source, workflows: async () => Promise.reject(new Error('boom')) },
      now: NOW,
    })

    expect(report.scorecard).toEqual({
      available: false,
      reason: 'engineering scorecard could not be collected. boom',
    })
    expect(report.warnings.map((w) => w.code)).toEqual(['COLLECTION_ERROR'])
  })
})

describe('planned repositories that do not exist yet', () => {
  it('treats a 404, a 403 or an unreachable API as missing rather than failing', async () => {
    expect(await repositoryExists('o/r', async () => ({ id: 1 }))).toBe(true)
    expect(await repositoryExists('o/r', async () => null)).toBe(false)
    expect(await repositoryExists('o/r', async () => Promise.reject(new Error('GitHub 403')))).toBe(
      false,
    )
  })

  it('splits planned projects by whether their repository exists, and ignores delivered ones', async () => {
    const exists = new Set(['your-org/ledger'])
    const { readable, missing } = await partitionPlanned(
      [
        planned(),
        planned({ id: 'vault', repo: 'your-org/vault' }),
        planned({ id: 'shop', repo: 'your-org/shop', status: 'production' }),
      ],
      async (repo) => exists.has(repo),
    )

    expect(readable.map((p) => p.id)).toEqual(['ledger'])
    expect(missing.map((p) => p.id)).toEqual(['vault'])
  })
})
