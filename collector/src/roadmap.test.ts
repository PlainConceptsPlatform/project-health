import { describe, expect, it } from 'vitest'
import type { Issue, PullRequestDetail, TimelineEvent } from './github.ts'
import {
  DEFAULT_LABELS,
  type RoadmapSource,
  classifySource,
  collectRoadmap,
  evidenceOf,
  mergeGateOf,
  outcomeOf,
  segmentsOf,
  untriggered,
} from './metrics/roadmap.ts'
import type { AgentRun, LinkedPullRequest, ProjectConfig, Roadmap } from './types.ts'

const OPENED = '2026-10-06T12:00:00Z'
const t = (minutes: number) => new Date(Date.parse(OPENED) + minutes * 60_000).toISOString()
const end = (minutes: number) => Date.parse(OPENED) + minutes * 60_000

const person = { login: 'ana', type: 'User' }
const app = { login: 'platform-devbox[bot]', type: 'Bot' }
const workflow = { login: 'github-actions[bot]', type: 'Bot' }

const labeled = (minutes: number, name: string, actor = app): TimelineEvent => ({
  event: 'labeled',
  created_at: t(minutes),
  actor,
  label: { name },
})
const unlabeled = (minutes: number, name: string, actor = app): TimelineEvent => ({
  event: 'unlabeled',
  created_at: t(minutes),
  actor,
  label: { name },
})
const closed = (minutes: number, actor = person): TimelineEvent => ({
  event: 'closed',
  created_at: t(minutes),
  actor,
})
const linked = (minutes: number, pr: number): TimelineEvent => ({
  event: 'cross-referenced',
  created_at: t(minutes),
  actor: app,
  source: { issue: { number: pr, pull_request: { merged_at: null } } },
})

const issue = (over: Partial<Issue> = {}): Issue => ({
  number: 212,
  title: 'Cost centres per growth map type',
  state: 'closed',
  created_at: OPENED,
  closed_at: t(104),
  updated_at: t(105),
  labels: [{ name: 'sp-8' }],
  body: 'Scope',
  user: person,
  ...over,
})

const pr = (over: Partial<LinkedPullRequest> = {}): LinkedPullRequest => ({
  number: 219,
  title: '[bot] cost centres',
  author: 'github-actions[bot]',
  byAgent: true,
  closes: true,
  createdAt: t(100),
  mergedAt: t(104),
  mergedBy: 'ana',
  additions: 10,
  deletions: 2,
  changedFiles: 3,
  mergeGate: null,
  ...over,
})

describe('segmentsOf', () => {
  it('splits an issue by who had it, and counts each stall once', () => {
    // A stalled run used to look like agent time, which hid every hour a person kept it waiting.
    const events = [
      labeled(0, 'refine', person),
      labeled(2, 'bot-working'),
      unlabeled(25, 'bot-working'),
      labeled(39, 'bot-working'),
      unlabeled(68, 'bot-working'),
      labeled(68, 'review'),
      labeled(68, 'stalled'),
      unlabeled(111, 'review', person),
      unlabeled(111, 'stalled', person),
      labeled(111, 'bot-working'),
      unlabeled(146, 'bot-working'),
      labeled(146, 'pr-pending'),
      closed(160),
    ]
    const { segments, marks } = segmentsOf(OPENED, end(160), events, DEFAULT_LABELS)
    expect(segments).toEqual([
      { state: 'queued', from: 0, to: 2 },
      { state: 'agent', from: 2, to: 25 },
      { state: 'queued', from: 25, to: 39 },
      { state: 'agent', from: 39, to: 68 },
      { state: 'person', from: 68, to: 111 },
      { state: 'agent', from: 111, to: 146 },
      { state: 'merge', from: 146, to: 160 },
    ])
    expect(marks).toEqual([{ at: 68, kind: 'stalled' }])
  })

  it('treats an issue that never had an agent label as worked by hand, not as queued', () => {
    const { segments } = segmentsOf(OPENED, end(422), [closed(422)], DEFAULT_LABELS)
    expect(segments).toEqual([{ state: 'manual', from: 0, to: 422 }])
  })

  it('leaves a gap while an issue was closed, rather than counting it as waiting', () => {
    const events = [
      labeled(0, 'refine', person),
      closed(58),
      { event: 'reopened', created_at: t(104), actor: person },
      labeled(104, 'bot-working'),
      closed(128),
    ]
    const { segments } = segmentsOf(OPENED, end(128), events, DEFAULT_LABELS)
    expect(segments).toEqual([
      { state: 'queued', from: 0, to: 58 },
      { state: 'agent', from: 104, to: 128 },
    ])
  })

  it('marks an attempt the workflow reported as failed', () => {
    const events: TimelineEvent[] = [
      labeled(3, 'bot-working'),
      {
        event: 'commented',
        created_at: t(18),
        user: app,
        body: '<!-- agent-refine-attempt -->\nAttempt 1 of 5 ended after 8 minutes.',
      },
    ]
    const { marks } = segmentsOf(OPENED, end(20), events, DEFAULT_LABELS)
    expect(marks).toEqual([{ at: 18, kind: 'failed-run' }])
  })

  it('does not draw a merge gate retry that came after the issue closed', () => {
    // It was drawn at the closing moment, as if the issue had failed just before merging.
    const events: TimelineEvent[] = [
      labeled(0, 'implement'),
      closed(653),
      {
        event: 'commented',
        created_at: t(1017),
        user: app,
        body: '<!-- agent-merge-gate-attempt -->\nAttempt 0 of 6 ended without an outcome.',
      },
    ]
    expect(segmentsOf(OPENED, end(653), events, DEFAULT_LABELS).marks).toEqual([])
  })
})

describe('outcomeOf', () => {
  it('tells an auto-merge, a person merging a bot PR and a PR written by hand apart', () => {
    expect(outcomeOf(issue(), [pr({ mergedBy: 'platform-devbox[bot]' })])).toBe('auto-merged')
    expect(outcomeOf(issue(), [pr()])).toBe('merged')
    expect(outcomeOf(issue(), [pr({ byAgent: false, author: 'ana' })])).toBe('merged-by-hand')
  })

  it('prefers the pull request that closes the issue over one that only mentions it', () => {
    const mention = pr({ number: 300, byAgent: false, closes: false })
    expect(outcomeOf(issue(), [mention, pr()])).toBe('merged')
  })

  it('reports a closed issue without a merged pull request, and an open one, as such', () => {
    expect(outcomeOf(issue(), [pr({ mergedAt: null })])).toBe('closed')
    expect(outcomeOf(issue({ state: 'open', closed_at: null }), [])).toBe('open')
  })
})

describe('untriggered', () => {
  it('flags a trigger label set with the workflow token that nobody picked up', () => {
    // A label set with GITHUB_TOKEN starts no workflow, so the issue waited four hours unseen.
    const events = [labeled(0, 'refine', workflow), labeled(246, 'refine', person)]
    expect(untriggered(events, DEFAULT_LABELS, end(300))).toBe(true)
  })

  it('does not flag an App label, which does start workflows, nor a quick pick up', () => {
    expect(untriggered([labeled(0, 'implement', app)], DEFAULT_LABELS, end(300))).toBe(false)
    const quick = [labeled(0, 'refine', workflow), labeled(10, 'bot-working')]
    expect(untriggered(quick, DEFAULT_LABELS, end(300))).toBe(false)
  })
})

describe('classifySource', () => {
  it('drops the housekeeping digest and names automation by its labels', () => {
    expect(classifySource(issue({ body: '<!-- housekeeping-digest -->\n...' }))).toBeNull()
    expect(classifySource(issue({ labels: [{ name: 'app-error' }] }))).toBe('app-error')
    expect(classifySource(issue({ title: 'Audit: 2026-10-12' }))).toBe('audit')
    expect(classifySource(issue({ title: 'Nightly E2E is failing' }))).toBe('nightly')
    expect(classifySource(issue({ user: app }))).toBe('automation')
    expect(classifySource(issue())).toBe('person')
  })
})

describe('evidenceOf', () => {
  it('points each waypoint at its screenshot on the evidence branch', () => {
    const evidence = evidenceOf(
      {
        plans: [
          {
            status: 'captured',
            waypoints: [
              { n: 1, capture: 'configurator', expect: 'Cost centres listed', file: '01-a.jpg' },
              { n: 2, capture: 'banner', reached: false, file: null },
            ],
          },
        ],
      },
      'acme/app',
      219,
      'evidence',
    )
    expect(evidence.waypoints).toEqual([
      {
        n: 1,
        capture: 'configurator',
        expect: 'Cost centres listed',
        reached: true,
        image: 'https://github.com/acme/app/raw/evidence/pr-219/01-a.jpg',
      },
      { n: 2, capture: 'banner', expect: null, reached: false, image: null },
    ])
    expect(evidence.note).toBeNull()
  })

  it('says why there are no screenshots when the app never answered', () => {
    const evidence = evidenceOf(
      { app: { started: false, url: 'http://localhost:3000' }, plans: [] },
      'acme/app',
      5,
      'evidence',
    )
    expect(evidence.note).toContain('did not answer at http://localhost:3000')
  })
})

describe('mergeGateOf', () => {
  it('reads the verdict from the merge gate comment only', () => {
    expect(
      mergeGateOf([
        { body: 'Looks good', created_at: t(0) },
        { body: '<!-- agent-merge-gate -->\n**Verdict:** auto-merge\n', created_at: t(1) },
      ]),
    ).toBe('auto-merge')
    expect(mergeGateOf([{ body: '**Verdict:** remediated', created_at: t(0) }])).toBeNull()
  })
})

const project: ProjectConfig = {
  id: 'app',
  name: 'App',
  repo: 'acme/app',
  enabled: true,
  status: 'production',
  environments: { production: 'pro', staging: 'pre' },
  productionRefPattern: '^v',
  agents: { enabled: true, workflow: 'work-router.yml' },
  roadmap: { enabled: true },
}

const window = {
  from: new Date('2026-10-01T00:00:00Z'),
  to: new Date('2026-11-01T00:00:00Z'),
  now: new Date('2026-10-13T08:00:00Z'),
}

function fakeSource(
  issues: Issue[],
  timelines: Record<number, TimelineEvent[]>,
  pulls: Record<number, PullRequestDetail> = {},
  opts: { pullsReadable?: boolean; calls?: number[] } = {},
): RoadmapSource {
  return {
    issues: async () => issues,
    timeline: async (n) => {
      opts.calls?.push(n)
      return timelines[n] ?? []
    },
    pullRequest: async (n) => pulls[n] ?? null,
    comments: async () => [],
    evidence: async () => null,
    canReadPullRequests: async () => opts.pullsReadable ?? true,
  }
}

const detail = (number: number, over: Partial<PullRequestDetail> = {}): PullRequestDetail => ({
  number,
  title: 'fix',
  body: 'Closes #212',
  user: workflow,
  created_at: t(100),
  merged_at: t(104),
  merged_by: person,
  additions: 1,
  deletions: 1,
  changed_files: 1,
  ...over,
})

const run = (issueNumber: number): AgentRun => ({
  runId: issueNumber * 10,
  workflow: 'router',
  kind: 'implement',
  conclusion: 'success',
  startedAt: t(75),
  actor: 'platform-devbox[bot]',
  issueNumber,
  executionSeconds: 600,
  usage: {
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ambientContext: 0,
    aiCredits: 0,
    primaryModel: null,
  },
})

describe('collectRoadmap', () => {
  it('keeps only issues open during the period and drops pull requests and digests', async () => {
    const issues = [
      issue(),
      issue({ number: 1, created_at: '2026-08-01T00:00:00Z', closed_at: '2026-09-01T00:00:00Z' }),
      issue({ number: 2, pull_request: {} }),
      issue({ number: 3, body: '<!-- housekeeping-digest -->' }),
      issue({ number: 4, created_at: '2026-11-02T00:00:00Z', state: 'open', closed_at: null }),
    ]
    const source = fakeSource(
      issues,
      { 212: [linked(100, 219), closed(104)] },
      { 219: detail(219) },
    )
    const { block } = await collectRoadmap(project, source, window, [run(212)], null)
    expect(block.available).toBe(true)
    if (!block.available) return
    expect(block.data.issues.map((i) => i.number)).toEqual([212])
    const [journey] = block.data.issues
    expect(journey?.outcome).toBe('merged')
    expect(journey?.estimate).toBe(8)
    expect(journey?.pullRequests[0]?.byAgent).toBe(true)
    expect(journey?.agent).toEqual({ runs: 1, inputTokens: 1000, outputTokens: 200, seconds: 600 })
  })

  it('measures an open issue up to the collection, not to the end of the month', async () => {
    const open = issue({ state: 'open', closed_at: null, created_at: '2026-10-13T07:00:00Z' })
    const { block } = await collectRoadmap(project, fakeSource([open], {}), window, [], null)
    if (!block.available) throw new Error('expected data')
    expect(block.data.asOf).toBe('2026-10-13T08:00:00.000Z')
    expect(block.data.issues[0]?.segments.at(-1)?.to).toBe(60)
  })

  it('reuses a stored closed issue that has not changed instead of reading it again', async () => {
    const calls: number[] = []
    const first = await collectRoadmap(
      project,
      fakeSource([issue()], { 212: [closed(104)] }, {}, { calls }),
      window,
      [],
      null,
    )
    const stored = first.block.available ? first.block.data : null
    await collectRoadmap(
      project,
      fakeSource([issue()], {}, {}, { calls }),
      window,
      [run(212)],
      stored as Roadmap,
    )
    expect(calls).toEqual([212])
  })

  it('skips the block with a warning when pull requests cannot be read', async () => {
    const { block, warnings } = await collectRoadmap(
      project,
      fakeSource([issue()], {}, {}, { pullsReadable: false }),
      window,
      [],
      null,
    )
    expect(block.available).toBe(false)
    expect(warnings.map((w) => w.code)).toEqual(['ROADMAP_PERMISSION_MISSING'])
  })

  it('warns once, naming the issues, when a workflow label went unnoticed', async () => {
    const stuck = issue({ number: 226, labels: [{ name: 'app-error' }] })
    const source = fakeSource([stuck], {
      226: [labeled(0, 'refine', workflow), labeled(246, 'refine', person), closed(626)],
    })
    const { warnings } = await collectRoadmap(project, source, window, [], null)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.code).toBe('LABEL_SET_BY_WORKFLOW')
    expect(warnings[0]?.message).toContain('#226')
  })
})
