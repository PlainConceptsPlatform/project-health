import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAppToken } from './github.ts'
import { collectAgents } from './metrics/agents.ts'
import type { ProjectConfig } from './types.ts'

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

const FROM = new Date('2026-10-01T00:00:00Z')
const TO = new Date('2026-11-01T00:00:00Z')

const run = (id: number, conclusion: string | null) => ({
  id,
  name: 'Router',
  display_title: `Working #${id}`,
  conclusion,
  status: conclusion ? 'completed' : 'in_progress',
  run_started_at: '2026-10-10T10:00:00Z',
  created_at: '2026-10-10T10:00:00Z',
})

const agentJobs = [
  {
    id: 1,
    name: 'call-implement / agent',
    conclusion: 'success',
    steps: [
      {
        name: 'Execute OpenCode',
        started_at: '2026-10-10T10:01:00Z',
        completed_at: '2026-10-10T10:03:00Z',
      },
    ],
  },
]
const plainJobs = [{ id: 2, name: 'route', conclusion: 'success', steps: [] }]

/** Run 10 called an agent, run 11 finished without one, run 12 is still running. */
function fakeApi() {
  const jobsRead: number[] = []
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes('/actions/workflows?')) {
      return json({ workflows: [{ id: 1, name: 'Router', path: '.github/workflows/router.yml' }] })
    }
    if (url.includes('/actions/workflows/1/runs')) {
      return json({ workflow_runs: [run(10, 'success'), run(11, 'success'), run(12, null)] })
    }
    const jobs = url.match(/\/actions\/runs\/(\d+)\/jobs/)
    if (jobs) {
      const id = Number(jobs[1])
      jobsRead.push(id)
      return json({ jobs: id === 10 ? agentJobs : plainJobs })
    }
    if (url.includes('/artifacts')) return json({ artifacts: [] })
    return new Response('{}', { status: 404 })
  })
  return { fetchMock, jobsRead }
}

describe('collectAgents', () => {
  beforeEach(() => {
    resetAppToken()
    vi.stubEnv('GITHUB_TOKEN', 'given')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('remembers finished runs without an agent and does not read their jobs again', async () => {
    // A busy router logs hundreds of runs a month that never reach an agent. Their jobs were read
    // again on every daily collection, which took the whole collection past an hour.
    const first = fakeApi()
    vi.stubGlobal('fetch', first.fetchMock)
    const result = await collectAgents(project, FROM, TO)
    expect(result.block.available && result.block.data.notAgentRunIds).toEqual([11])
    expect(first.jobsRead.sort()).toEqual([10, 11, 12])

    const second = fakeApi()
    vi.stubGlobal('fetch', second.fetchMock)
    const runs = result.block.available ? result.block.data.runs : []
    const again = await collectAgents(project, FROM, TO, runs, [11])
    expect(second.jobsRead.sort()).toEqual([10, 12])
    expect(again.block.available && again.block.data.notAgentRunIds).toEqual([11])
    expect(again.block.available && again.block.data.runs.map((r) => r.runId)).toEqual([10])
  })
})
