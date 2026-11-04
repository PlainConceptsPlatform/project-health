import type { RestoreDrillSource } from '../config.ts'
import { type WorkflowRun, get, paginate } from '../github.ts'
import type { PracticeResultState, ProjectConfig } from '../types.ts'
import type { PracticeEvidence } from './scorecard.ts'

/** One completed run of the hub's drill workflow. */
export interface HubRun {
  id: number
  url: string
  conclusion: string | null
  at: string
}

export interface HubJob {
  name: string
  conclusion: string | null
}

/** The seam to the hub repository, so the rules are testable without the network. */
export interface RestoreDrillHub {
  /** Completed runs of the workflow on the branch created before `before`, newest first. */
  runs: (workflow: string, branch: string, before: Date, limit: number) => Promise<HubRun[]>
  jobs: (runId: number) => Promise<HubJob[]>
}

export const DEFAULT_MAX_RUNS = 10

/** The hub's product id: set explicitly, or the repository name in lower case. */
export const productOf = (project: ProjectConfig): string =>
  (
    project.scorecard?.restoreDrillProduct ??
    project.repo.split('/').at(-1) ??
    project.id
  ).toLowerCase()

const DRILL_JOB = /^Drill ([^/\s]+)\/\S+/

/**
 * The hub names a restore job `Drill <product>/<database>` and a read-only posture check
 * `Posture <product>/<database>`, so only the former can speak for a restore. A reusable call
 * prefixes the caller's job (`caller / Drill ...`) and a matrix may append ` (...)`.
 */
export function drillJobFor(jobs: HubJob[], product: string): HubJob | null {
  const wanted = product.toLowerCase()
  return (
    jobs.find((job) => {
      const name = job.name.includes(' / ') ? job.name.split(' / ').slice(1).join(' / ') : job.name
      return DRILL_JOB.exec(name)?.[1]?.toLowerCase() === wanted
    }) ?? null
  )
}

const stateOf = (conclusion: string | null): PracticeResultState | null =>
  conclusion === 'success' ? 'passing' : conclusion === 'failure' ? 'failing' : null

/**
 * The newest decisive drill of this project's product. A job that was cancelled or skipped is not
 * a verdict, so the search goes on to an older run; a newer run for another product is passed over
 * for the same reason. null when none of the recent runs drilled the product.
 */
export async function restoreDrillEvidence(
  project: ProjectConfig,
  source: RestoreDrillSource,
  hub: RestoreDrillHub,
  before: Date,
): Promise<PracticeEvidence | null> {
  const branch = source.branch ?? 'main'
  const product = productOf(project)
  let runs: HubRun[]
  try {
    runs = await hub.runs(source.workflow, branch, before, source.maxRuns ?? DEFAULT_MAX_RUNS)
  } catch (error) {
    return unreadable(source, error)
  }
  for (const run of runs) {
    let jobs: HubJob[]
    try {
      jobs = await hub.jobs(run.id)
    } catch (error) {
      return unreadable(source, error)
    }
    const job = drillJobFor(jobs, product)
    const result = job ? stateOf(job.conclusion) : null
    if (!job || result === null) continue
    return {
      source: 'detected',
      tools: [`Restore drill (${source.repo})`],
      mode: 'blocking',
      result,
      resultAt: run.at,
      lastRun: { workflow: source.workflow, url: run.url, conclusion: job.conclusion, at: run.at },
    }
  }
  return null
}

function unreadable(source: RestoreDrillSource, error: unknown): PracticeEvidence {
  const message = error instanceof Error ? error.message : String(error)
  return {
    source: 'detected',
    tools: [`Restore drill (${source.repo})`],
    mode: 'blocking',
    result: 'unknown',
    resultAt: null,
    lastRun: null,
    shortfall: `The drill runs in ${source.repo}, which could not be read: ${message}`,
  }
}

const hubCache = new Map<string, Promise<HubJob[]>>()

export const githubRestoreDrillHub = (repo: string): RestoreDrillHub => ({
  runs: async (workflow, branch, before, limit) => {
    const file = workflow.split('/').at(-1) ?? workflow
    const found = await get<{
      workflow_runs: (WorkflowRun & { html_url: string; updated_at: string })[]
    }>(
      `/repos/${repo}/actions/workflows/${encodeURIComponent(file)}/runs?branch=${encodeURIComponent(branch)}&status=completed&per_page=${limit}&created=%3C${before.toISOString().slice(0, 10)}`,
    )
    if (!found) throw new Error(`workflow ${file} was not found on ${branch}`)
    return found.workflow_runs.map((run) => ({
      id: run.id,
      url: run.html_url,
      conclusion: run.conclusion,
      at: run.updated_at ?? run.run_started_at,
    }))
  },
  // Every opted-in project reads the same few runs, so a collection fetches each run's jobs once.
  jobs: (runId) => {
    const key = `${repo}#${runId}`
    const cached = hubCache.get(key)
    if (cached) return cached
    const load = paginate<HubJob>(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`, 3)
    hubCache.set(key, load)
    return load
  },
})
