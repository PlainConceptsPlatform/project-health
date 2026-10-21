import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AgentDayStore,
  MAX_REACH_BACK_MS,
  OVERLAP_MS,
  collectWindow,
  compareMonths,
  dayOf,
  monthFromDays,
  seed,
  windowStart,
} from './agent-days.ts'
import { resetAppToken } from './github.ts'
import { summarizeAgentRuns } from './metrics/agents.ts'
import type { AgentRun, ProjectConfig } from './types.ts'

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const project: ProjectConfig = {
  id: 'test',
  name: 'Test',
  repo: 'org/test',
  enabled: true,
  status: 'production',
  environments: { production: 'pro', staging: 'pre' },
  productionRefPattern: '^v[0-9]+[.][0-9]+[.][0-9]+$',
  agents: { enabled: true, workflow: 'router.yml' },
}

const usage = {
  inputTokens: 100,
  outputTokens: 10,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ambientContext: 0,
  aiCredits: 1,
  primaryModel: 'model',
}

const agentRun = (runId: number, startedAt: string, over: Partial<AgentRun> = {}): AgentRun => ({
  runId,
  workflow: 'Router',
  kind: 'implement',
  conclusion: 'success',
  startedAt,
  actor: 'bot',
  issueNumber: null,
  executionSeconds: 120,
  usage,
  ...over,
})

let dir: string
let store: AgentDayStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-days-'))
  store = new AgentDayStore(join(dir, 'agents'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('dayOf', () => {
  it('puts a run in its UTC day, as a monthly listing does', () => {
    expect(dayOf('2026-10-31T23:59:59Z')).toBe('2026-10-31')
    expect(dayOf('2026-11-01T00:30:00+02:00')).toBe('2026-10-31')
  })
})

describe('windowStart', () => {
  const now = new Date('2026-10-21T03:00:00Z')

  it('starts the overlap before the last window ended', () => {
    const cursor = { collectedThrough: '2026-10-20T03:00:00Z', notAgentRunIds: [], unsettled: [] }
    expect(windowStart(cursor, now).getTime()).toBe(Date.parse('2026-10-20T03:00:00Z') - OVERLAP_MS)
  })

  it('reaches back to a run still in progress, but not past the limit', () => {
    const cursor = {
      collectedThrough: '2026-10-20T03:00:00Z',
      notAgentRunIds: [],
      unsettled: [
        { runId: 1, startedAt: '2026-10-19T10:00:00Z' },
        { runId: 2, startedAt: '2026-10-01T10:00:00Z' },
      ],
    }
    expect(windowStart(cursor, now).toISOString()).toBe('2026-10-19T10:00:00.000Z')
  })

  it('does not reach past the limit after a long gap', () => {
    const cursor = { collectedThrough: '2026-09-01T00:00:00Z', notAgentRunIds: [], unsettled: [] }
    expect(windowStart(cursor, now).getTime()).toBe(now.getTime() - MAX_REACH_BACK_MS)
  })
})

describe('AgentDayStore', () => {
  it('keeps finished runs in the file of their day and replaces a stored copy', () => {
    store.add([
      agentRun(1, '2026-10-20T10:00:00Z'),
      agentRun(2, '2026-10-21T01:00:00Z'),
      agentRun(3, '2026-10-21T02:00:00Z', { conclusion: null }),
    ])
    store.add([agentRun(1, '2026-10-20T10:00:00Z', { conclusion: 'failure' })])

    expect(readdirSync(join(dir, 'agents')).sort()).toEqual(['2026-10-20.json', '2026-10-21.json'])
    expect(store.readDay('2026-10-20')).toEqual([
      agentRun(1, '2026-10-20T10:00:00Z', { conclusion: 'failure' }),
    ])
    expect(store.readDay('2026-10-21').map((r) => r.runId)).toEqual([2])
  })

  it('returns the runs that started inside a range', () => {
    store.add([
      agentRun(1, '2026-09-30T23:00:00Z'),
      agentRun(2, '2026-10-01T00:00:00Z'),
      agentRun(3, '2026-10-31T23:59:00Z'),
      agentRun(4, '2026-11-01T00:00:00Z'),
    ])
    const october = store.between(
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-11-01T00:00:00Z'),
    )
    expect(october.map((r) => r.runId)).toEqual([2, 3])
  })
})

describe('seed', () => {
  it('stores the monthly runs and starts the cursor when they were listed', () => {
    const at = new Date('2026-10-20T03:15:00Z')
    seed(
      store,
      [
        agentRun(1, '2026-10-02T10:00:00Z'),
        agentRun(2, '2026-10-20T03:00:00Z', { conclusion: null }),
      ],
      [9],
      at,
    )
    expect(store.readCursor()).toEqual({
      collectedThrough: at.toISOString(),
      notAgentRunIds: [9],
      unsettled: [{ runId: 2, startedAt: '2026-10-20T03:00:00Z' }],
    })
    expect(store.readDay('2026-10-02').map((r) => r.runId)).toEqual([1])
  })
})

describe('monthFromDays', () => {
  it('gives the same totals as summarizing the same runs', () => {
    const runs = [
      agentRun(1, '2026-10-02T10:00:00Z'),
      agentRun(2, '2026-10-03T10:00:00Z', { kind: 'triage', usage: null, usageMissing: true }),
    ]
    store.add(runs)
    const month = monthFromDays(store, new Date('2026-10-01Z'), new Date('2026-11-01Z'))
    expect(month.block.available && month.block.data.byKind).toEqual(
      summarizeAgentRuns(runs).byKind,
    )
    expect(month.warnings.map((w) => w.code)).toEqual(['USAGE_ARTIFACT_MISSING'])
  })

  it('says so when the month has no runs', () => {
    const month = monthFromDays(store, new Date('2026-10-01Z'), new Date('2026-11-01Z'))
    expect(month.block.available).toBe(false)
  })
})

describe('compareMonths', () => {
  it('ignores runs still in progress and reports any other difference', () => {
    const listed = [
      agentRun(1, '2026-10-02T10:00:00Z'),
      agentRun(2, '2026-10-02T11:00:00Z', { conclusion: null }),
      agentRun(3, '2026-10-02T12:00:00Z'),
    ]
    expect(compareMonths(listed, [listed[0] as AgentRun, listed[2] as AgentRun])).toEqual([])

    const differences = compareMonths(listed, [
      agentRun(1, '2026-10-02T10:00:00Z', { executionSeconds: 90 }),
      agentRun(4, '2026-10-02T13:00:00Z'),
    ])
    expect(differences).toEqual([
      'run 1 executionSeconds: 120 listed, 90 from days',
      'run 3 (implement) is only in the monthly listing',
      'run 4 (implement) is only in the day files',
    ])
  })
})

describe('collectWindow', () => {
  beforeEach(() => {
    resetAppToken()
    vi.stubEnv('GITHUB_TOKEN', 'given')
  })

  const now = new Date('2026-10-21T03:00:00Z')
  const listedRun = (id: number, conclusion: string | null) => ({
    id,
    name: 'Router',
    display_title: `Working #${id}`,
    conclusion,
    status: conclusion ? 'completed' : 'in_progress',
    run_started_at: '2026-10-20T20:00:00Z',
    created_at: '2026-10-20T20:00:00Z',
  })
  const agentJobs = [
    {
      id: 1,
      name: 'call-implement / agent',
      conclusion: 'success',
      steps: [
        {
          name: 'Execute OpenCode',
          started_at: '2026-10-20T20:01:00Z',
          completed_at: '2026-10-20T20:03:00Z',
        },
      ],
    },
  ]

  function fakeApi(workflows = [{ id: 1, name: 'Router', path: '.github/workflows/router.yml' }]) {
    const listings: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/actions/workflows?')) return json({ workflows })
      if (url.includes('/actions/workflows/1/runs')) {
        listings.push(decodeURIComponent(url))
        return json({ workflow_runs: [listedRun(10, 'success'), listedRun(11, null)] })
      }
      if (url.includes('/actions/runs/10/jobs')) return json({ jobs: agentJobs })
      if (url.includes('/jobs')) return json({ jobs: [] })
      if (url.includes('/artifacts')) return json({ artifacts: [] })
      return new Response('{}', { status: 404 })
    })
    return { fetchMock, listings }
  }

  it('lists only the window since the last collection and moves the cursor', async () => {
    seed(store, [], [], new Date('2026-10-20T03:00:00Z'))
    const api = fakeApi()
    vi.stubGlobal('fetch', api.fetchMock)

    const result = await collectWindow(project, store, now)

    expect(result).toMatchObject({ ok: true, runs: 1 })
    expect(api.listings.every((url) => url.includes('created=2026-10-19T21:00:00Z..'))).toBe(true)
    expect(store.readDay('2026-10-20').map((r) => [r.runId, r.kind, r.executionSeconds])).toEqual([
      [10, 'implement', 120],
    ])
    expect(store.readCursor()).toEqual({
      collectedThrough: now.toISOString(),
      notAgentRunIds: [],
      unsettled: [{ runId: 11, startedAt: '2026-10-20T20:00:00Z' }],
    })
  })

  it('leaves the cursor where it was when the listing fails, so the gap is collected later', async () => {
    seed(store, [], [], new Date('2026-10-20T03:00:00Z'))
    vi.stubGlobal('fetch', fakeApi([]).fetchMock)

    const result = await collectWindow(project, store, now)

    expect(result.ok).toBe(false)
    expect(store.readCursor()?.collectedThrough).toBe('2026-10-20T03:00:00.000Z')
  })

  it('does nothing before the day files are seeded', async () => {
    expect(await collectWindow(project, store, now)).toMatchObject({ ok: false })
  })
})
