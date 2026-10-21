import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectAgents, missingUsageWarning, summarizeAgentRuns } from './metrics/agents.ts'
import {
  type AgentRun,
  type AgentSummary,
  type MetricBlock,
  type ProjectConfig,
  type Warning,
  ok,
  skip,
} from './types.ts'

/**
 * Agent runs stored per day (Project-Health#68).
 *
 * Recomputing a month lists every run of the router since the first of the month, every day, and
 * nearly all of them were listed the day before. Here each collection lists only the window since
 * the last one, keeps every settled agent run in the file of the day it started, and rebuilds the
 * month from its days without calling the API.
 *
 * Files live in state/<project>/agents/, beside data/ but outside what the site publishes.
 */

const HOUR = 3_600_000
/** Each window starts this far before the previous one ended, so a run created at the edge is seen. */
export const OVERLAP_MS = 6 * HOUR
/** How far back a run still in progress can pull a window. Older ones are given up on. */
export const MAX_REACH_BACK_MS = 3 * 24 * HOUR

export interface AgentCursor {
  /** When the last successful window ended. */
  collectedThrough: string
  /** Finished runs of that window without an agent, so the overlap does not read their jobs again. */
  notAgentRunIds: number[]
  /** Runs still in progress at that collection, read again until they finish. */
  unsettled: { runId: number; startedAt: string }[]
}

/** The UTC day a run belongs to, the same day a monthly listing would put it in. */
export const dayOf = (startedAt: string): string => new Date(startedAt).toISOString().slice(0, 10)

/**
 * Where the next window starts: the overlap before the last one ended, or the oldest run still in
 * progress, whichever is earlier, but never more than MAX_REACH_BACK_MS before now.
 */
export function windowStart(cursor: AgentCursor, now: Date): Date {
  const floor = now.getTime() - MAX_REACH_BACK_MS
  const starts = [
    Date.parse(cursor.collectedThrough) - OVERLAP_MS,
    ...cursor.unsettled.map((run) => Date.parse(run.startedAt)),
  ].filter((at) => Number.isFinite(at) && at >= floor)
  return new Date(starts.length > 0 ? Math.min(...starts) : floor)
}

const byStart = (a: AgentRun, b: AgentRun) =>
  a.startedAt.localeCompare(b.startedAt) || a.runId - b.runId

export class AgentDayStore {
  constructor(private readonly dir: string) {}

  private file(name: string): string {
    return join(this.dir, name)
  }

  private read<T>(name: string): T | null {
    const file = this.file(name)
    if (!existsSync(file)) return null
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as T
    } catch {
      return null
    }
  }

  private write(name: string, value: unknown): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.file(name), `${JSON.stringify(value, null, 2)}\n`)
  }

  readCursor(): AgentCursor | null {
    return this.read<AgentCursor>('cursor.json')
  }

  writeCursor(cursor: AgentCursor): void {
    this.write('cursor.json', cursor)
  }

  readDay(day: string): AgentRun[] {
    return this.read<{ runs: AgentRun[] }>(`${day}.json`)?.runs ?? []
  }

  /** Stores finished runs in their day, replacing any stored copy. A run still in progress waits. */
  add(runs: AgentRun[]): void {
    const days = new Map<string, AgentRun[]>()
    for (const run of runs) {
      if (run.conclusion === null) continue
      const day = dayOf(run.startedAt)
      days.set(day, [...(days.get(day) ?? []), run])
    }
    for (const [day, fresh] of days) {
      const merged = new Map(this.readDay(day).map((run) => [run.runId, run]))
      for (const run of fresh) merged.set(run.runId, run)
      this.write(`${day}.json`, { runs: [...merged.values()].sort(byStart) })
    }
  }

  /** Stored runs that started in [from, to). */
  between(from: Date, to: Date): AgentRun[] {
    if (!existsSync(this.dir)) return []
    const first = dayOf(from.toISOString())
    const last = dayOf(new Date(to.getTime() - 1).toISOString())
    return readdirSync(this.dir)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .map((name) => name.slice(0, 10))
      .filter((day) => day >= first && day <= last)
      .flatMap((day) => this.readDay(day))
      .filter((run) => {
        const at = Date.parse(run.startedAt)
        return at >= from.getTime() && at < to.getTime()
      })
      .sort(byStart)
  }
}

/**
 * Starts the day files from what the monthly reports already hold, so the first window is short
 * instead of a full month. The cursor is the moment those reports were written.
 */
export function seed(
  store: AgentDayStore,
  runs: AgentRun[],
  notAgentRunIds: number[],
  collectedAt: Date,
): void {
  store.add(runs)
  store.writeCursor({
    collectedThrough: collectedAt.toISOString(),
    notAgentRunIds,
    unsettled: runs
      .filter((run) => run.conclusion === null)
      .map((run) => ({ runId: run.runId, startedAt: run.startedAt })),
  })
}

export type WindowResult =
  | { ok: true; from: Date; to: Date; runs: number }
  | { ok: false; reason: string }

/**
 * Lists the window since the last collection and stores what it found. The cursor only moves when
 * the listing worked, so a failed collection leaves the gap for the next one.
 */
export async function collectWindow(
  project: ProjectConfig,
  store: AgentDayStore,
  now: Date,
): Promise<WindowResult> {
  const cursor = store.readCursor()
  if (!cursor) return { ok: false, reason: 'no cursor; the day files were never seeded' }

  const from = windowStart(cursor, now)
  const result = await collectAgents(
    project,
    from,
    now,
    store.between(from, now),
    cursor.notAgentRunIds,
  )
  if (!result.scan) {
    const reason = result.block.available ? 'the listing returned nothing' : result.block.reason
    return { ok: false, reason }
  }

  store.add(result.scan.runs)
  store.writeCursor({
    collectedThrough: now.toISOString(),
    notAgentRunIds: result.scan.notAgentRunIds,
    unsettled: result.scan.unsettled,
  })
  return { ok: true, from, to: now, runs: result.scan.runs.length }
}

/** The month rebuilt from its days. Runs still in progress are not in it until they finish. */
export function monthFromDays(
  store: AgentDayStore,
  from: Date,
  to: Date,
): { block: MetricBlock<AgentSummary>; warnings: Warning[] } {
  const runs = store.between(from, to)
  if (runs.length === 0) return { block: skip('No agent runs in this period.'), warnings: [] }
  const { byKind, missingUsage } = summarizeAgentRuns(runs)
  return {
    block: ok({ runs, byKind }),
    warnings: missingUsage > 0 ? [missingUsageWarning(missingUsage, runs.length)] : [],
  }
}

const tokensOf = (run: AgentRun) =>
  run.usage ? `${run.usage.inputTokens}/${run.usage.outputTokens}/${run.usage.aiCredits}` : 'none'

/**
 * Where the month rebuilt from days disagrees with the monthly listing, compared run by run on
 * finished runs only. Empty means the two give the same numbers.
 */
export function compareMonths(listed: AgentRun[], fromDays: AgentRun[]): string[] {
  const a = new Map(listed.filter((r) => r.conclusion !== null).map((r) => [r.runId, r]))
  const b = new Map(fromDays.map((r) => [r.runId, r]))
  const differences: string[] = []
  for (const [id, run] of a) {
    const other = b.get(id)
    if (!other) {
      differences.push(`run ${id} (${run.kind}) is only in the monthly listing`)
      continue
    }
    const fields: [string, unknown, unknown][] = [
      ['kind', run.kind, other.kind],
      ['conclusion', run.conclusion, other.conclusion],
      ['executionSeconds', run.executionSeconds, other.executionSeconds],
      ['tokens', tokensOf(run), tokensOf(other)],
    ]
    for (const [name, left, right] of fields) {
      if (left !== right) differences.push(`run ${id} ${name}: ${left} listed, ${right} from days`)
    }
  }
  for (const [id, run] of b) {
    if (!a.has(id)) differences.push(`run ${id} (${run.kind}) is only in the day files`)
  }
  return differences
}
