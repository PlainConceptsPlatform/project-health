import type {
  AgentRun,
  IssueJourney,
  IssueSource,
  JourneyEvent,
  JourneyOutcome,
  JourneyState,
  Roadmap,
} from './types'

/**
 * Five states cannot be told apart by colour alone, so the palette follows charts.tsx: the two
 * chart slots that pass the colour vision checks carry the two states that matter most, queued is
 * hatched rather than coloured, and every segment wide enough to hold text is labelled.
 */
export const STATES: Record<
  JourneyState,
  { label: string; short: string; swatch: string; segment: string }
> = {
  agent: {
    label: 'Agent working',
    short: 'agent',
    swatch: 'bg-chart-1',
    segment: 'bg-chart-1 text-white',
  },
  person: {
    label: 'Waiting on a person',
    short: 'waiting',
    swatch: 'bg-chart-2',
    segment: 'bg-chart-2 text-background',
  },
  queued: {
    label: 'Queued, nobody on it',
    short: 'queued',
    swatch: 'roadmap-hatch',
    segment: 'roadmap-hatch text-muted-foreground',
  },
  merge: {
    label: 'PR waiting to merge',
    short: 'to merge',
    swatch: 'bg-chart-5',
    segment: 'bg-chart-5 text-background',
  },
  manual: {
    label: 'Person, by hand',
    short: 'by hand',
    swatch: 'bg-foreground/70',
    segment: 'bg-foreground/70 text-background',
  },
}

export const STATE_ORDER: JourneyState[] = ['agent', 'person', 'queued', 'merge', 'manual']

export const SOURCE_LABEL: Record<IssueSource, string> = {
  person: 'Person',
  'app-error': 'App error',
  audit: 'Audit',
  nightly: 'Nightly',
  automation: 'Automation',
}

/** A duration in minutes, in the largest units that keep it readable. */
export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  if (m < 48 * 60) return `${Math.floor(m / 60)} h ${m % 60} m`
  return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`
}

export const openFor = (issue: IssueJourney): number => issue.segments.at(-1)?.to ?? 0

export const minutesIn = (issue: IssueJourney, state: JourneyState): number =>
  issue.segments.filter((s) => s.state === state).reduce((t, s) => t + s.to - s.from, 0)

/** Only manual time means nobody ever handed it to an agent. */
export const byHand = (issue: IssueJourney): boolean =>
  issue.segments.length > 0 && issue.segments.every((s) => s.state === 'manual')

export function outcomeOf(issue: IssueJourney): { label: string; className: string } {
  const labels: Record<JourneyOutcome, { label: string; className: string }> = {
    open: { label: 'Open', className: 'bg-accent text-accent-foreground' },
    merged: { label: 'Merged', className: 'bg-primary/10 text-primary' },
    'auto-merged': { label: 'Auto-merged', className: 'bg-success/15 text-success' },
    'merged-by-hand': {
      label: byHand(issue) ? 'By hand' : 'Merged, PR by hand',
      className: 'bg-secondary text-secondary-foreground',
    },
    closed: { label: 'Closed, no PR', className: 'bg-muted text-muted-foreground' },
  }
  return labels[issue.outcome]
}

export const currentState = (issue: IssueJourney): JourneyState | null =>
  issue.outcome === 'open' ? (issue.segments.at(-1)?.state ?? null) : null

const median = (values: number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = (sorted.length - 1) / 2
  return ((sorted[Math.floor(mid)] as number) + (sorted[Math.ceil(mid)] as number)) / 2
}

export interface RoadmapSummary {
  closed: number
  medianToMerge: number | null
  agentShare: number | null
  stalls: number
  failedRuns: number
  stalledIssues: number
  waiting: IssueJourney[]
  totals: Record<JourneyState, number>
  total: number
}

/**
 * Closed means closed inside the period, and time and stalls are only those inside it, so an issue
 * opened weeks earlier counts its last days here rather than dominating the month with all of them.
 */
export function summarise(roadmap: Roadmap, from: string, to: string): RoadmapSummary {
  const start = Date.parse(from)
  const end = Date.parse(to)
  const inPeriod = (iso: string | null) =>
    iso !== null && Date.parse(iso) >= start && Date.parse(iso) < end
  const closed = roadmap.issues.filter((i) => inPeriod(i.closedAt))
  const merged = closed.filter((i) => i.outcome !== 'closed' && i.outcome !== 'open')

  const length = (end - start) / 60_000
  const offset = (issue: IssueJourney) => (Date.parse(issue.createdAt) - start) / 60_000
  const within = (issue: IssueJourney, state: JourneyState) =>
    issue.segments
      .filter((s) => s.state === state)
      .reduce((t, s) => {
        const a = Math.max(0, s.from + offset(issue))
        const b = Math.min(length, s.to + offset(issue))
        return t + Math.max(0, b - a)
      }, 0)

  const totals = Object.fromEntries(
    STATE_ORDER.map((state) => [state, roadmap.issues.reduce((t, i) => t + within(i, state), 0)]),
  ) as Record<JourneyState, number>
  const total = STATE_ORDER.reduce((t, s) => t + totals[s], 0)

  const marks = roadmap.issues.flatMap((i) =>
    i.marks.filter((m) => m.at + offset(i) >= 0 && m.at + offset(i) < length),
  )
  return {
    closed: closed.length,
    medianToMerge: median(merged.map(openFor)),
    agentShare: total > 0 ? totals.agent / total : null,
    stalls: marks.filter((m) => m.kind === 'stalled').length,
    failedRuns: marks.filter((m) => m.kind === 'failed-run').length,
    stalledIssues: new Set(
      roadmap.issues
        .filter((i) =>
          i.marks.some(
            (m) => m.kind === 'stalled' && m.at + offset(i) >= 0 && m.at + offset(i) < length,
          ),
        )
        .map((i) => i.number),
    ).size,
    waiting: roadmap.issues.filter((i) => currentState(i) === 'person'),
    totals,
    total,
  }
}

/** The order work flows through, so the rows read like the pipeline. Unknown kinds go last. */
const KIND_ORDER = ['triage', 'refine', 'implement', 'apply-review', 'merge-gate', 'evidence']

export interface KindTiming {
  kind: string
  /** Runs with a measured agent step, oldest first. */
  runs: (AgentRun & { executionSeconds: number })[]
  /** Average, median and longest of the successful runs, or of every run when none succeeded. */
  average: number
  median: number
  longest: number
  /** The longest run of any outcome, which sets the scale. */
  slowest: number
  total: number
  failed: number
  /** True when no run succeeded, so the figures describe failed runs. */
  allFailed: boolean
}

export const failedRun = (run: AgentRun): boolean =>
  run.conclusion !== null && run.conclusion !== 'success'

/**
 * How long the agent worked in each kind of job, from the step that runs it. The bars on the
 * roadmap count from the working label instead, which also covers the runner setting up before
 * the agent starts, so a run reads shorter here than the agent colour on its issue.
 *
 * The figures leave failed runs out: one that dies in its first seconds or runs into the timeout
 * says nothing about how long the work takes, and either would drag a kind's figures with it.
 * They still count in the total, which is time spent all the same.
 */
export function timingByKind(runs: AgentRun[]): KindTiming[] {
  const byKind = new Map<string, KindTiming['runs']>()
  for (const run of runs) {
    if (run.executionSeconds === null) continue
    byKind.set(run.kind, [
      ...(byKind.get(run.kind) ?? []),
      { ...run, executionSeconds: run.executionSeconds },
    ])
  }
  const rank = (kind: string) => {
    const i = KIND_ORDER.indexOf(kind)
    return i === -1 ? KIND_ORDER.length : i
  }
  return [...byKind.entries()]
    .map(([kind, list]) => {
      const sorted = [...list].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
      const succeeded = sorted.filter((r) => !failedRun(r))
      const counted = (succeeded.length > 0 ? succeeded : sorted).map((r) => r.executionSeconds)
      const all = sorted.map((r) => r.executionSeconds)
      return {
        kind,
        runs: sorted,
        average: counted.reduce((t, s) => t + s, 0) / counted.length,
        median: median(counted) ?? 0,
        longest: Math.max(...counted),
        slowest: Math.max(...all),
        total: all.reduce((t, s) => t + s, 0),
        failed: sorted.length - succeeded.length,
        allFailed: succeeded.length === 0,
      }
    })
    .sort((a, b) => rank(a.kind) - rank(b.kind) || b.runs.length - a.runs.length)
}

export type LogTone = JourneyState | 'neutral' | 'bad'

export interface LogLine {
  at: string
  text: string
  tone: LogTone
}

const who = (actor: string | null): string =>
  !actor
    ? 'someone'
    : actor === 'github-actions[bot]'
      ? 'a workflow'
      : actor.replace(/\[bot\]$/, '')

/**
 * The issue's events in sentences. An agent start and the stop after it read as one line with the
 * time between them, which is the question a reader actually has: how long did it work.
 */
export function logOf(issue: IssueJourney): LogLine[] {
  const lines: LogLine[] = []
  const events = issue.events
  const consumed = new Set<JourneyEvent>()
  for (const [i, e] of events.entries()) {
    if (consumed.has(e)) continue
    const pr = (n: string | null) => issue.pullRequests.find((p) => String(p.number) === n)
    switch (e.kind) {
      case 'opened':
        lines.push({ at: e.at, text: `Opened by ${who(e.actor)}`, tone: 'neutral' })
        break
      case 'requested':
        lines.push({ at: e.at, text: `${who(e.actor)} labelled it ${e.detail}`, tone: 'neutral' })
        break
      case 'agent-started': {
        const stop = events.slice(i + 1).find((n) => n.kind === 'agent-stopped')
        if (stop) consumed.add(stop)
        const worked = stop ? (Date.parse(stop.at) - Date.parse(e.at)) / 60_000 : null
        lines.push({
          at: e.at,
          text: worked === null ? 'Agent working' : `Agent worked for ${duration(worked)}`,
          tone: 'agent',
        })
        break
      }
      case 'agent-stopped':
        lines.push({ at: e.at, text: 'Agent stopped', tone: 'agent' })
        break
      case 'estimated':
        lines.push({ at: e.at, text: `Estimated ${e.detail}`, tone: 'neutral' })
        break
      case 'review':
        // A stall sets review and stalled together; the stall line already says it waits.
        if (events.some((n) => n.kind === 'stalled' && n.at === e.at)) break
        lines.push({ at: e.at, text: `Waiting for a person (${e.detail})`, tone: 'person' })
        break
      case 'stalled':
        lines.push({ at: e.at, text: 'The agent stalled and handed it to a person', tone: 'bad' })
        break
      case 'failed-run':
        lines.push({ at: e.at, text: 'An agent attempt ended early and was retried', tone: 'bad' })
        break
      case 'pr-linked': {
        const p = pr(e.detail)
        const size = p ? `, +${p.additions} and -${p.deletions} in ${p.changedFiles} files` : ''
        lines.push({
          at: e.at,
          text: `PR #${e.detail} opened by ${who(e.actor)}${size}`,
          tone: p?.byAgent ? 'merge' : 'manual',
        })
        break
      }
      case 'merged': {
        const p = pr(e.detail)
        const gate = p?.mergeGate ? `, merge gate: ${p.mergeGate}` : ''
        lines.push({
          at: e.at,
          text: `PR #${e.detail} merged by ${who(e.actor)}${gate}`,
          tone: 'merge',
        })
        break
      }
      case 'closed':
        lines.push({ at: e.at, text: `Closed by ${who(e.actor)}`, tone: 'neutral' })
        break
      case 'reopened':
        lines.push({ at: e.at, text: `Reopened by ${who(e.actor)}`, tone: 'neutral' })
        break
    }
  }
  return lines
}

export const TONE_DOT: Record<LogTone, string> = {
  agent: 'bg-chart-1',
  person: 'bg-chart-2',
  queued: 'bg-muted-foreground/40',
  merge: 'bg-chart-5',
  manual: 'bg-foreground/70',
  neutral: 'bg-muted-foreground/60',
  bad: 'bg-destructive',
}

const pad = (n: number) => String(n).padStart(2, '0')

/** UTC throughout, like the rest of the site, so a time reads the same for every viewer. */
export const clock = (ms: number): string => {
  const d = new Date(ms)
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

export const dayName = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })

export const stamp = (ms: number): string => `${dayName(ms)}, ${clock(ms)}`
