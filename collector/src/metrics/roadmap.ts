import {
  type Actor,
  type Issue,
  type IssueComment,
  type PullRequestDetail,
  type TimelineEvent,
  get,
  paginate,
} from '../github.ts'
import {
  type AgentRun,
  type EvidenceWaypoint,
  type IssueJourney,
  type IssueSource,
  type JourneyEvent,
  type JourneyEvidence,
  type JourneyMark,
  type JourneyOutcome,
  type JourneySegment,
  type JourneyState,
  type LinkedPullRequest,
  type MetricBlock,
  type ProjectConfig,
  type Roadmap,
  type RoadmapLabels,
  type Warning,
  ok,
  skip,
} from '../types.ts'
import { mapLimit } from './agents.ts'

/**
 * The labels the Platform agent workflows hand issues over with. A repository using other names
 * overrides them per project rather than the roadmap guessing.
 */
export const DEFAULT_LABELS: RoadmapLabels = {
  working: 'bot-working',
  waiting: ['review', 'stalled', 'owner-review'],
  stalled: 'stalled',
  merge: 'pr-pending',
  triggers: ['triage', 'refine', 'implement'],
}

const ESTIMATE = /^sp-(\d+)$/
/** Written by the housekeeping job and rewritten in place: a digest, not a piece of work. */
const DIGEST_MARKER = '<!-- housekeeping-digest -->'
/** The marker an agent workflow leaves when one attempt of a run ended before an answer. */
const FAILED_ATTEMPT = /<!--\s*agent-[a-z-]+-attempt\s*-->/
const MERGE_GATE_MARKER = '<!-- agent-merge-gate -->'
const MERGE_GATE_VERDICT = /\*\*Verdict:\*\*\s*`?([a-z-]+)`?/i
const MAX_PULL_REQUESTS = 3
const MAX_EVENTS = 60
const CONCURRENCY = 6
/** A trigger label nobody picks up for this long was most likely set by a workflow token. */
const UNTRIGGERED_MINUTES = 60
const MINUTE = 60_000

export const isBot = (actor: Actor | string | null | undefined): boolean => {
  if (!actor) return false
  const login = typeof actor === 'string' ? actor : actor.login
  const type = typeof actor === 'string' ? undefined : actor.type
  return type === 'Bot' || /\[bot\]$/.test(login) || /-bot$/.test(login)
}

const loginOf = (actor: Actor | null | undefined): string | null => actor?.login ?? null

export function labelsFor(project: ProjectConfig): RoadmapLabels {
  return { ...DEFAULT_LABELS, ...project.roadmap?.labels }
}

/** Where an issue came from, so automation can be told apart from work a person asked for. */
export function classifySource(issue: Issue): IssueSource | null {
  if (issue.body?.includes(DIGEST_MARKER)) return null
  const labels = issue.labels.map((l) => l.name)
  if (labels.includes('app-error')) return 'app-error'
  if (labels.includes('audit') || /^audit:/i.test(issue.title)) return 'audit'
  if (labels.includes('nightly-e2e') || /nightly e2e/i.test(issue.title)) return 'nightly'
  if (isBot(issue.user)) return 'automation'
  return 'person'
}

const at = (event: TimelineEvent): number => Date.parse(event.created_at ?? '')

function stateOf(labels: Set<string>, config: RoadmapLabels): JourneyState {
  if (labels.has(config.working)) return 'agent'
  if (config.waiting.some((l) => labels.has(l))) return 'person'
  if (labels.has(config.merge)) return 'merge'
  return 'queued'
}

/**
 * Splits an issue's open time into who had it, from its label history. Closed stretches between a
 * close and a reopen are left out, so a reopened issue shows a gap rather than invented work.
 *
 * An issue that never carried an agent label was worked by hand from start to end: calling that
 * time "queued" would blame a queue for work a person was doing.
 */
export function segmentsOf(
  createdAt: string,
  end: number,
  events: TimelineEvent[],
  config: RoadmapLabels,
): { segments: JourneySegment[]; marks: JourneyMark[] } {
  const start = Date.parse(createdAt)
  const sorted = events
    .filter((e) => e.created_at && Number.isFinite(at(e)))
    .sort((a, b) => at(a) - at(b))

  const agentic = new Set([config.working, config.merge, ...config.triggers])
  const manual = !sorted.some((e) => e.event === 'labeled' && agentic.has(e.label?.name ?? ''))

  const labels = new Set<string>()
  const raw: JourneySegment[] = []
  const marks: JourneyMark[] = []
  let open = true
  let cursor = start
  const minutes = (ms: number) => Math.round((ms - start) / MINUTE)

  for (const event of sorted) {
    const time = Math.min(Math.max(at(event), start), end)
    if (open && time > cursor) {
      raw.push({ state: stateOf(labels, config), from: minutes(cursor), to: minutes(time) })
    }
    cursor = Math.max(cursor, time)
    // A merge gate retry can comment hours after the issue closed; it belongs in the log, not on
    // the bar, where it would be drawn at the closing moment as if the issue had stalled there.
    const markable = open && at(event) <= end

    if (event.event === 'labeled' && event.label) {
      labels.add(event.label.name)
      if (markable && event.label.name === config.stalled) {
        marks.push({ at: minutes(time), kind: 'stalled' })
      }
    } else if (event.event === 'unlabeled' && event.label) {
      labels.delete(event.label.name)
    } else if (event.event === 'closed') {
      open = false
    } else if (event.event === 'reopened') {
      open = true
    } else if (event.event === 'commented' && isBot(event.user ?? event.actor)) {
      if (markable && FAILED_ATTEMPT.test(event.body ?? '')) {
        marks.push({ at: minutes(time), kind: 'failed-run' })
      }
    }
  }
  if (open && end > cursor) {
    raw.push({ state: stateOf(labels, config), from: minutes(cursor), to: minutes(end) })
  }

  const segments: JourneySegment[] = []
  for (const segment of raw) {
    const state: JourneyState = manual ? 'manual' : segment.state
    if (segment.to <= segment.from) continue
    const last = segments.at(-1)
    if (last && last.state === state && last.to === segment.from) last.to = segment.to
    else segments.push({ ...segment, state })
  }
  return { segments, marks }
}

/** The log of an issue, in the words of the labels and links that moved it. */
export function eventsOf(
  issue: Issue,
  timeline: TimelineEvent[],
  pullRequests: LinkedPullRequest[],
  config: RoadmapLabels,
): JourneyEvent[] {
  const events: JourneyEvent[] = [
    { at: issue.created_at, kind: 'opened', actor: loginOf(issue.user), detail: null },
  ]
  let estimated = false
  for (const e of timeline) {
    if (!e.created_at) continue
    const actor = loginOf(e.actor ?? e.user)
    const name = e.label?.name ?? ''
    if (e.event === 'labeled') {
      if (name === config.working) {
        events.push({ at: e.created_at, kind: 'agent-started', actor, detail: null })
      } else if (config.triggers.includes(name)) {
        events.push({ at: e.created_at, kind: 'requested', actor, detail: name })
      } else if (name === config.stalled) {
        events.push({ at: e.created_at, kind: 'stalled', actor, detail: null })
      } else if (config.waiting.includes(name)) {
        events.push({ at: e.created_at, kind: 'review', actor, detail: name })
      } else if (!estimated && ESTIMATE.test(name)) {
        estimated = true
        events.push({ at: e.created_at, kind: 'estimated', actor, detail: name })
      }
    } else if (e.event === 'unlabeled' && name === config.working) {
      events.push({ at: e.created_at, kind: 'agent-stopped', actor, detail: null })
    } else if (e.event === 'commented' && FAILED_ATTEMPT.test(e.body ?? '')) {
      events.push({ at: e.created_at, kind: 'failed-run', actor, detail: null })
    } else if (e.event === 'closed' || e.event === 'reopened') {
      events.push({ at: e.created_at, kind: e.event, actor, detail: null })
    }
  }
  for (const pr of pullRequests) {
    events.push({
      at: pr.createdAt,
      kind: 'pr-linked',
      actor: pr.author,
      detail: String(pr.number),
    })
    if (pr.mergedAt) {
      events.push({
        at: pr.mergedAt,
        kind: 'merged',
        actor: pr.mergedBy,
        detail: String(pr.number),
      })
    }
  }
  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).slice(0, MAX_EVENTS)
}

/** What became of an issue, judged by the pull request that closed it. */
export function outcomeOf(issue: Issue, pullRequests: LinkedPullRequest[]): JourneyOutcome {
  if (issue.state === 'open' || !issue.closed_at) return 'open'
  const merged = pullRequests.filter((pr) => pr.mergedAt)
  const pr = merged.find((p) => p.closes) ?? merged[0]
  if (!pr) return 'closed'
  if (!pr.byAgent) return 'merged-by-hand'
  return isBot(pr.mergedBy) ? 'auto-merged' : 'merged'
}

const closesIssue = (body: string | null, issue: number): boolean =>
  new RegExp(`\\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\\s+#${issue}\\b`, 'i').test(body ?? '')

export function mergeGateOf(comments: IssueComment[]): string | null {
  const gate = comments.find((c) => c.body?.includes(MERGE_GATE_MARKER))
  return gate?.body?.match(MERGE_GATE_VERDICT)?.[1]?.toLowerCase() ?? null
}

/** The manifest the evidence workflow commits next to the screenshots. */
export interface EvidenceManifest {
  version?: number
  app?: { started?: boolean; url?: string }
  plans?: {
    status?: string
    reason?: string
    waypoints?: {
      n: number
      capture: string
      expect?: string | null
      reached?: boolean
      file?: string | null
    }[]
  }[]
}

export function evidenceOf(
  manifest: EvidenceManifest,
  repo: string,
  pullRequest: number,
  branch: string,
): JourneyEvidence {
  const base = `https://github.com/${repo}/raw/${branch}/pr-${pullRequest}`
  const waypoints: EvidenceWaypoint[] = (manifest.plans ?? []).flatMap((plan) =>
    (plan.waypoints ?? []).map((w) => ({
      n: w.n,
      capture: w.capture,
      expect: w.expect ?? null,
      reached: w.reached !== false,
      image: w.file ? `${base}/${w.file}` : null,
    })),
  )
  const notes = (manifest.plans ?? [])
    .filter((p) => p.status && p.status !== 'captured')
    .map((p) => p.reason || p.status)
  const note =
    manifest.app?.started === false
      ? `The app did not answer${manifest.app.url ? ` at ${manifest.app.url}` : ''}, so nothing was captured.`
      : waypoints.length === 0 && notes.length > 0
        ? notes.join('; ')
        : null
  return {
    pullRequest,
    url: `https://github.com/${repo}/tree/${branch}/pr-${pullRequest}`,
    waypoints,
    note,
  }
}

/** The identity behind a workflow's own GITHUB_TOKEN. Its events start no other workflow. */
const WORKFLOW_TOKEN = 'github-actions[bot]'

/**
 * Issues whose trigger label was set with a workflow's own token and then sat untouched. Such a
 * label raises no event, so no agent ever starts; the issue waits for a person to set the label
 * again, and nothing on GitHub says why. An App token's label does start workflows, so only the
 * workflow token is suspect.
 */
export function untriggered(
  timeline: TimelineEvent[],
  config: RoadmapLabels,
  end: number,
): boolean {
  const sorted = timeline.filter((e) => e.created_at).sort((a, b) => at(a) - at(b))
  for (const [i, e] of sorted.entries()) {
    if (e.event !== 'labeled' || !config.triggers.includes(e.label?.name ?? '')) continue
    if (e.actor?.login !== WORKFLOW_TOKEN) continue
    const next = sorted
      .slice(i + 1)
      .find(
        (n) =>
          (n.event === 'labeled' && n.label?.name === config.working) ||
          (n.event === 'labeled' && n.label?.name === e.label?.name) ||
          n.event === 'closed',
      )
    const waited = (next ? at(next) : end) - at(e)
    if (waited > UNTRIGGERED_MINUTES * MINUTE && next?.label?.name !== config.working) return true
  }
  return false
}

function agentOf(runs: AgentRun[], issue: number): IssueJourney['agent'] {
  const mine = runs.filter((r) => r.issueNumber === issue)
  return {
    runs: mine.length,
    inputTokens: mine.reduce((t, r) => t + (r.usage?.inputTokens ?? 0), 0),
    outputTokens: mine.reduce((t, r) => t + (r.usage?.outputTokens ?? 0), 0),
    seconds: mine.reduce((t, r) => t + (r.executionSeconds ?? 0), 0),
  }
}

export interface RoadmapSource {
  /** Issues updated since the date, plus every issue still open. Pull requests included. */
  issues: (since: Date) => Promise<Issue[]>
  timeline: (issue: number) => Promise<TimelineEvent[]>
  pullRequest: (number: number) => Promise<PullRequestDetail | null>
  comments: (number: number) => Promise<IssueComment[]>
  evidence: (pullRequest: number, branch: string) => Promise<EvidenceManifest | null>
  /** False when the token cannot read pull requests, which the roadmap needs for every outcome. */
  canReadPullRequests: () => Promise<boolean>
}

interface Window {
  from: Date
  to: Date
  /** When the collection runs. Open issues are measured up to this or the period end. */
  now: Date
}

async function linkedPullRequests(
  source: RoadmapSource,
  repo: string,
  issue: Issue,
  timeline: TimelineEvent[],
): Promise<LinkedPullRequest[]> {
  const numbers = [
    ...new Set(
      timeline
        .filter(
          (e) =>
            e.event === 'cross-referenced' &&
            e.source?.issue?.pull_request &&
            (!e.source.issue.repository || e.source.issue.repository.full_name === repo),
        )
        .map((e) => e.source?.issue?.number as number),
    ),
  ]
    .sort((a, b) => b - a)
    .slice(0, MAX_PULL_REQUESTS)

  const prs = await Promise.all(numbers.map((n) => source.pullRequest(n)))
  const linked: LinkedPullRequest[] = []
  for (const pr of prs) {
    if (!pr) continue
    const comments = pr.merged_at ? await source.comments(pr.number) : []
    linked.push({
      number: pr.number,
      title: pr.title,
      author: loginOf(pr.user),
      byAgent: isBot(pr.user),
      closes: closesIssue(pr.body, issue.number),
      createdAt: pr.created_at,
      mergedAt: pr.merged_at,
      mergedBy: loginOf(pr.merged_by),
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
      mergeGate: mergeGateOf(comments),
    })
  }
  return linked.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}

/** One issue's journey from its timeline, linked pull requests and evidence. */
async function journeyOf(
  source: RoadmapSource,
  project: ProjectConfig,
  issue: Issue,
  issueSource: IssueSource,
  end: number,
  config: RoadmapLabels,
  runs: AgentRun[],
): Promise<{ journey: IssueJourney; untriggered: boolean }> {
  const timeline = await source.timeline(issue.number)
  const pullRequests = await linkedPullRequests(source, project.repo, issue, timeline)
  const closedAt = issue.state === 'open' ? null : issue.closed_at
  const issueEnd = closedAt ? Math.min(Date.parse(closedAt), end) : end
  const { segments, marks } = segmentsOf(issue.created_at, issueEnd, timeline, config)

  const branch = project.roadmap?.evidenceBranch ?? 'evidence'
  const merged = pullRequests.filter((pr) => pr.mergedAt).at(-1)
  const manifest = merged ? await source.evidence(merged.number, branch) : null

  const estimate = issue.labels
    .map((l) => l.name.match(ESTIMATE)?.[1])
    .find((n): n is string => n !== undefined)

  return {
    journey: {
      number: issue.number,
      title: issue.title,
      author: loginOf(issue.user),
      source: issueSource,
      createdAt: issue.created_at,
      closedAt,
      updatedAt: issue.updated_at ?? issue.closed_at ?? issue.created_at,
      outcome: outcomeOf(issue, pullRequests),
      estimate: estimate ? Number(estimate) : null,
      segments,
      marks,
      events: eventsOf(issue, timeline, pullRequests, config),
      pullRequests,
      evidence:
        merged && manifest ? evidenceOf(manifest, project.repo, merged.number, branch) : null,
      agent: agentOf(runs, issue.number),
    },
    untriggered: untriggered(timeline, config, issueEnd),
  }
}

/**
 * Every issue open at some point in the period, and who had it at each moment.
 *
 * A closed issue whose stored journey is as recent as the issue itself is reused rather than read
 * again: its timeline cannot change, and re-reading every closed issue each day costs a timeline,
 * a pull request and an evidence call apiece.
 */
export async function collectRoadmap(
  project: ProjectConfig,
  source: RoadmapSource,
  window: Window,
  runs: AgentRun[],
  previous: Roadmap | null,
): Promise<{ block: MetricBlock<Roadmap>; warnings: Warning[] }> {
  if (!(await source.canReadPullRequests())) {
    const message = `${project.name}: the token cannot read pull requests, so the roadmap is not collected. Grant the App Pull requests read.`
    return {
      block: skip(message),
      warnings: [{ code: 'ROADMAP_PERMISSION_MISSING', message }],
    }
  }

  const config = labelsFor(project)
  const end = Math.min(window.now.getTime(), window.to.getTime())
  const asOf = new Date(end).toISOString()

  const candidates = (await source.issues(window.from)).filter(
    (issue) =>
      !issue.pull_request &&
      Date.parse(issue.created_at) < window.to.getTime() &&
      (issue.state === 'open' ||
        !issue.closed_at ||
        Date.parse(issue.closed_at) >= window.from.getTime()),
  )
  const unique = [...new Map(candidates.map((i) => [i.number, i])).values()]

  const stored = new Map((previous?.issues ?? []).map((j) => [j.number, j]))
  const flagged: number[] = []

  const journeys = await mapLimit(unique, CONCURRENCY, async (issue) => {
    const issueSource = classifySource(issue)
    if (!issueSource) return null
    const cached = stored.get(issue.number)
    if (cached?.closedAt && issue.state !== 'open' && cached.updatedAt === issue.updated_at) {
      return { ...cached, agent: agentOf(runs, issue.number) }
    }
    const { journey, untriggered: stuck } = await journeyOf(
      source,
      project,
      issue,
      issueSource,
      end,
      config,
      runs,
    )
    if (stuck) flagged.push(issue.number)
    return journey
  })

  const issues = journeys
    .filter((j): j is IssueJourney => j !== null)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))

  const warnings: Warning[] = []
  if (flagged.length > 0) {
    const list = flagged
      .sort((a, b) => a - b)
      .map((n) => `#${n}`)
      .join(', ')
    warnings.push({
      code: 'LABEL_SET_BY_WORKFLOW',
      message: `${list} sat for over an hour after a workflow set an agent label. Labels a workflow sets with its own token start no other workflow, so a person had to set the label again.`,
      context: { issues: flagged.length },
    })
  }
  return { block: ok({ asOf, issues }), warnings }
}

const decode = (content: string, encoding?: string): string =>
  encoding === 'base64' ? Buffer.from(content, 'base64').toString('utf8') : content

export const githubRoadmapSource = (repo: string): RoadmapSource => ({
  issues: async (since) => {
    const [updated, open] = await Promise.all([
      paginate<Issue>(
        `/repos/${repo}/issues?state=all&since=${since.toISOString()}&per_page=100`,
        10,
      ),
      paginate<Issue>(`/repos/${repo}/issues?state=open&per_page=100`, 5),
    ])
    return [...updated, ...open]
  },
  timeline: (issue) =>
    paginate<TimelineEvent>(`/repos/${repo}/issues/${issue}/timeline?per_page=100`, 5),
  pullRequest: (n) => get<PullRequestDetail>(`/repos/${repo}/pulls/${n}`),
  comments: (n) => paginate<IssueComment>(`/repos/${repo}/issues/${n}/comments?per_page=100`, 3),
  evidence: async (pr, branch) => {
    const file = await get<{ content?: string; encoding?: string }>(
      `/repos/${repo}/contents/pr-${pr}/manifest.json?ref=${encodeURIComponent(branch)}`,
    )
    if (!file?.content) return null
    try {
      return JSON.parse(decode(file.content, file.encoding)) as EvidenceManifest
    } catch {
      return null
    }
  },
  canReadPullRequests: async () => {
    try {
      await get<unknown>(`/repos/${repo}/pulls?per_page=1&state=all`)
      return true
    } catch (error) {
      if (error instanceof Error && error.message.includes('403')) return false
      throw error
    }
  },
})
