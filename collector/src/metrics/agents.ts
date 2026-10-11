import { unzipSync } from 'fflate'
import { type Artifact, type Job, type WorkflowRun, get, getBinary, paginate } from '../github.ts'
import { percentiles } from '../stats.ts'
import {
  type AgentKindSummary,
  type AgentRun,
  type AgentSummary,
  type MetricBlock,
  type ProjectConfig,
  type TokenUsage,
  type Warning,
  ok,
  skip,
} from '../types.ts'

const AGENT_STEP = /execute\s+opencode/i
const MAX_RUNS_PER_KIND = 400
const MAX_RUN_PAGES = 10
const CONCURRENCY = 8

/**
 * Runs fn over items with a bounded number in flight. Measuring a run costs three API calls and a
 * month can hold several hundred runs, so doing them strictly one at a time makes a backfill take
 * hours. The bound keeps it polite rather than opening one connection per run.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await fn(items[index] as T)
    }
  })
  await Promise.all(workers)
  return results
}

const emptyUsage = (): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ambientContext: 0,
  aiCredits: 0,
  primaryModel: null,
})

interface RawUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  cache_write_tokens?: number
  ambient_context?: number
  ai_credits?: number
  primary_model?: string
}

/**
 * Falls back to the per request log when the aggregate file is absent.
 *
 * The artifact ships both an aggregate (agent_usage.json) and a line per model request
 * (agent/token_usage.jsonl). They normally appear together, but a run can produce the log without
 * the aggregate, and summing the log gives the same totals. An empty log means the run made no
 * model requests, which is zero rather than unknown.
 */
function sumPerRequest(files: Record<string, Uint8Array>): TokenUsage | null {
  const entry = Object.entries(files).find(([name]) => name.endsWith('token_usage.jsonl'))
  if (!entry) return null

  const text = new TextDecoder().decode(entry[1]).trim()
  if (text.length === 0) return null

  const totals = emptyUsage()
  let seen = 0
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line) as RawUsage & { model?: string }
      totals.inputTokens += row.input_tokens ?? 0
      totals.outputTokens += row.output_tokens ?? 0
      totals.cacheReadTokens += row.cache_read_tokens ?? 0
      totals.cacheWriteTokens += row.cache_write_tokens ?? 0
      totals.primaryModel = row.primary_model ?? row.model ?? totals.primaryModel
      seen += 1
    } catch {
      // A truncated final line is ignored rather than discarding the whole run.
    }
  }
  return seen > 0 ? totals : null
}

/** Reads agent_usage.json out of the run's usage artifact. Returns null when it is gone. */
async function readUsage(repo: string, runId: number): Promise<TokenUsage | null> {
  const artifacts = await get<{ artifacts: Artifact[] }>(
    `/repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`,
  )
  const usageArtifact = artifacts?.artifacts?.find((a) => a.name.endsWith('-usage') && !a.expired)
  if (!usageArtifact) return null

  const zip = await getBinary(`/repos/${repo}/actions/artifacts/${usageArtifact.id}/zip`)
  if (!zip) return null

  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(zip)
  } catch {
    return null
  }

  const entry = Object.entries(files).find(([name]) => name.endsWith('agent_usage.json'))
  if (!entry) return sumPerRequest(files)

  try {
    const raw = JSON.parse(new TextDecoder().decode(entry[1])) as RawUsage
    return {
      inputTokens: raw.input_tokens ?? 0,
      outputTokens: raw.output_tokens ?? 0,
      cacheReadTokens: raw.cache_read_tokens ?? 0,
      cacheWriteTokens: raw.cache_write_tokens ?? 0,
      ambientContext: raw.ambient_context ?? 0,
      aiCredits: raw.ai_credits ?? 0,
      primaryModel: raw.primary_model ?? null,
    }
  } catch {
    return null
  }
}

/** Matches the job that actually runs an agent, for example "call-triage / agent". */
const AGENT_JOB = /^call-(.+?)\s*\/\s*agent$/

export interface RunShape {
  /** The kind of work, taken from the agent job name. null when no agent ran. */
  kind: string | null
  executionSeconds: number | null
}

/**
 * Reads the kind and the agent step duration from one run's jobs.
 *
 * Both come from the same request, which is why classifying by job rather than by title costs
 * nothing for a run that was going to be measured anyway.
 */
async function readRunShape(repo: string, runId: number): Promise<RunShape> {
  const jobs = await get<{ jobs: Job[] }>(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`)
  if (!jobs?.jobs) return { kind: null, executionSeconds: null }
  return shapeFromJobs(jobs.jobs)
}

/**
 * Derives the kind and the agent step duration from a run's jobs. Pure, so the rule that a declared
 * but skipped agent job does not count can be tested without the API.
 */
export function shapeFromJobs(jobs: Job[]): RunShape {
  for (const job of jobs) {
    const match = job.name.match(AGENT_JOB)
    if (!match?.[1]) continue

    // The job existing is not enough. Several kinds declare an agent job that is conditionally
    // skipped, and a skipped job reports no steps: merge-gate declares one on every run and skips
    // it every time, which counted 140 agent runs that never invoked an agent. Requiring the step
    // that actually runs OpenCode means the kind and the duration come from the same evidence.
    const step = (job.steps ?? []).find(
      (candidate) =>
        AGENT_STEP.test(candidate.name) && candidate.started_at && candidate.completed_at,
    )
    if (!step) continue

    const seconds =
      (new Date(step.completed_at as string).getTime() -
        new Date(step.started_at as string).getTime()) /
      1000

    return { kind: match[1].trim(), executionSeconds: seconds >= 0 ? Math.round(seconds) : null }
  }

  return { kind: null, executionSeconds: null }
}

export interface AgentResult {
  block: MetricBlock<AgentSummary>
  warnings: Warning[]
}

/**
 * Collects token usage and agent execution time.
 *
 * All agent work runs through one router workflow, and the kind is discovered from the job named
 * "call-<kind> / agent" rather than from the run title. Titles were the first approach and they
 * leak: an issue-triggered run is titled "Working (Implement)" while a dispatched one is titled
 * "dispatch: triage", so a per-kind title list silently missed merge-gate and triage entirely.
 * Reading the job name finds every kind, including ones added after this was written.
 *
 * The same workflow also fires on a schedule to poll for work and on every comment, and those never
 * reach an agent. They are excluded by title before any job is fetched, purely to avoid spending
 * three API calls on several hundred runs that cannot be agents. Everything surviving that filter
 * has its jobs read, which is needed anyway for the step duration.
 *
 * The workflow is matched on file path before display name, because the name differs between
 * repositories ("All Work Router" against "Work Router") while the path does not.
 */
export async function collectAgents(
  project: ProjectConfig,
  from: Date,
  to: Date,
  previous: AgentRun[] = [],
): Promise<AgentResult> {
  const warnings: Warning[] = []
  const config = project.agents

  if (!config.enabled || !config.workflow) {
    return {
      block: skip(`${project.name} does not run agent workflows.`),
      warnings: [
        { code: 'AGENTS_DISABLED', message: `Agent collection is off for ${project.name}.` },
      ],
    }
  }

  // Records already collected for this month. Artifacts expire and downloading them again on every
  // daily run is the slowest part of collection, so a finished run is measured once and kept.
  const cached = new Map<number, AgentRun>()
  for (const run of previous) {
    if (run.conclusion !== null && run.usage !== null) cached.set(run.runId, run)
  }
  let reused = 0

  const catalog = await get<{ workflows: { id: number; name: string; path: string }[] }>(
    `/repos/${project.repo}/actions/workflows?per_page=100`,
  )
  if (!catalog?.workflows) {
    return { block: skip('The workflow list could not be read.'), warnings }
  }

  const wanted = config.workflow
  const workflow = catalog.workflows.find(
    (w) => w.path === wanted || w.path.endsWith(`/${wanted}`) || w.name === wanted,
  )
  if (!workflow) {
    return {
      block: skip(`No workflow matching "${wanted}" exists in ${project.repo}.`),
      warnings: [
        {
          code: 'COLLECTION_ERROR',
          message: `No workflow matching "${wanted}" exists in ${project.repo}, so agent metrics were skipped.`,
          context: { workflow: wanted },
        },
      ],
    }
  }

  const day = (d: Date) => d.toISOString().slice(0, 10)
  const found = await paginate<WorkflowRun>(
    `/repos/${project.repo}/actions/workflows/${workflow.id}/runs?created=${day(from)}..${day(to)}&per_page=100`,
    MAX_RUN_PAGES,
  )

  const inWindow = found.filter((r) => {
    const at = new Date(r.run_started_at ?? r.created_at)
    return at >= from && at < to
  })

  // Titles that cannot be an agent run. This is only a cost saving: the router fires on a schedule
  // and on every comment, which in one busy month can be six hundred runs that never reach
  // an agent. Anything not excluded here is decided by its jobs, not by its title.
  const ignore = config.ignoreTitlePatterns ?? ['schedule ', 'comment on ']
  const candidates = inWindow
    .filter((r) => r.conclusion !== 'cancelled' && r.conclusion !== 'skipped')
    .filter((r) => {
      const title = (r.display_title ?? '').toLowerCase()
      return !ignore.some((pattern) => title.startsWith(pattern.toLowerCase()))
    })

  // The kind comes from the jobs, so every candidate is shaped before anything is grouped. A
  // cached run keeps its kind rather than paying for the request again.
  const shaped = await mapLimit(candidates, CONCURRENCY, async (run) => {
    const hit = cached.get(run.id)
    if (hit) return { run, kind: hit.kind, executionSeconds: hit.executionSeconds, cached: true }
    const shape = await readRunShape(project.repo, run.id)
    return { run, kind: shape.kind, executionSeconds: shape.executionSeconds, cached: false }
  })

  const agentRuns = shaped.filter(
    (
      e,
    ): e is { run: WorkflowRun; kind: string; executionSeconds: number | null; cached: boolean } =>
      e.kind !== null,
  )

  if (agentRuns.length === 0) {
    return {
      block: skip(
        `No agent runs in this period. ${inWindow.length} run(s) of ${workflow.path} were found, ${candidates.length} could have been agents, and none had a "call-<kind> / agent" job.`,
      ),
      warnings,
    }
  }

  // Cap per kind rather than overall, so a busy kind cannot starve a quiet one.
  const perKind = new Map<string, typeof agentRuns>()
  const capped: Record<string, number> = {}
  for (const entry of agentRuns) {
    const list = perKind.get(entry.kind) ?? []
    if (list.length < MAX_RUNS_PER_KIND) list.push(entry)
    else capped[entry.kind] = (capped[entry.kind] ?? 0) + 1
    perKind.set(entry.kind, list)
  }
  for (const [kind, dropped] of Object.entries(capped)) {
    warnings.push({
      code: 'COLLECTION_ERROR',
      message: `${kind} had more than the cap of ${MAX_RUNS_PER_KIND} runs, so ${dropped} were not measured.`,
      context: { kind, dropped },
    })
  }

  const selected = [...perKind.values()].flat()
  const measured = await mapLimit(selected, CONCURRENCY, async (entry) => {
    const hit = cached.get(entry.run.id)
    if (hit) {
      reused += 1
      return { ...entry, usage: hit.usage }
    }
    return { ...entry, usage: await readUsage(project.repo, entry.run.id) }
  })

  const runs: AgentRun[] = []
  const byKind: Record<string, AgentKindSummary> = {}
  let missingUsage = 0

  for (const kind of perKind.keys()) {
    const totals = emptyUsage()
    const durations: number[] = []
    let successful = 0
    let count = 0
    let withUsage = 0

    for (const { run, usage, executionSeconds } of measured.filter((m) => m.kind === kind)) {
      count += 1
      if (usage) withUsage += 1
      else missingUsage += 1

      if (run.conclusion === 'success') successful += 1
      if (executionSeconds !== null) durations.push(executionSeconds)

      if (usage) {
        totals.inputTokens += usage.inputTokens
        totals.outputTokens += usage.outputTokens
        totals.cacheReadTokens += usage.cacheReadTokens
        totals.cacheWriteTokens += usage.cacheWriteTokens
        totals.ambientContext += usage.ambientContext
        totals.aiCredits += usage.aiCredits
        totals.primaryModel = usage.primaryModel ?? totals.primaryModel
      }

      runs.push({
        runId: run.id,
        workflow: workflow.name,
        kind,
        conclusion: run.conclusion,
        startedAt: run.run_started_at ?? run.created_at,
        actor: run.triggering_actor?.login ?? run.actor?.login ?? null,
        issueNumber: Number(run.display_title?.match(/#(\d+)/)?.[1] ?? '') || null,
        executionSeconds,
        usage,
      })
    }

    byKind[kind] = {
      runs: count,
      runsWithUsage: withUsage,
      successful,
      tokens: totals,
      executionSeconds:
        durations.length > 0
          ? ok(percentiles(durations))
          : skip('No agent step durations were recorded.'),
      totalExecutionSeconds: durations.reduce((a, b) => a + b, 0),
    }
  }

  if (missingUsage > 0) {
    warnings.push({
      code: 'USAGE_ARTIFACT_MISSING',
      message: `${missingUsage} of ${selected.length} agent run(s) had no readable usage artifact. Artifacts expire after about 90 days, and a run still in progress has not uploaded one yet.`,
      context: { runs: missingUsage, of: selected.length },
    })
  }
  if (reused > 0) {
    console.log(`    reused ${reused} previously measured agent run(s) for ${project.id}`)
  }

  return { block: ok({ runs, byKind }), warnings }
}
