import { describe, expect, it } from 'vitest'
import { filterReleases, filterRuns } from './delivery'
import type { AgentRun, Release } from './types'

const release = (ref: string, over: Partial<Release> = {}): Release => ({
  ref,
  sha: `${ref.replace(/\W/g, '')}0000000000`,
  deployedAt: '2026-11-02T10:00:00Z',
  deployedBy: 'alex',
  deploymentIds: [1],
  outOfProcess: false,
  unplanned: false,
  unplannedSource: null,
  ...over,
})

const releases = [
  release('v1.4.0'),
  release('v1.4.1', { unplanned: true, unplannedSource: 'label', deployedBy: 'sam' }),
  release('main', { outOfProcess: true }),
]

describe('releases filter', () => {
  it('shows only the unplanned releases when asked', () => {
    expect(filterReleases(releases, { query: '', unplannedOnly: true }).map((r) => r.ref)).toEqual([
      'v1.4.1',
    ])
  })

  it('searches the ref, the person and the signals', () => {
    expect(filterReleases(releases, { query: 'sam', unplannedOnly: false })).toHaveLength(1)
    expect(filterReleases(releases, { query: 'not a tag', unplannedOnly: false })[0]?.ref).toBe(
      'main',
    )
  })

  it('combines the search with the unplanned filter', () => {
    expect(filterReleases(releases, { query: 'v1.4.0', unplannedOnly: true })).toHaveLength(0)
  })
})

describe('runs search', () => {
  const run = (runId: number, kind: string, issueNumber: number | null): AgentRun => ({
    runId,
    workflow: '.github/workflows/agent.yml',
    kind,
    conclusion: 'success',
    startedAt: '2026-11-02T10:00:00Z',
    actor: 'bot',
    issueNumber,
    executionSeconds: 60,
    usage: null,
  })

  it('finds a run by its issue or its kind', () => {
    const runs = [run(1, 'implement', 12), run(2, 'review', 13)]
    expect(filterRuns(runs, '#13').map((r) => r.runId)).toEqual([2])
    expect(filterRuns(runs, 'IMPLEMENT').map((r) => r.runId)).toEqual([1])
  })
})
