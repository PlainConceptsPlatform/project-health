import type { ScorecardConfig } from './config.ts'
import { get } from './github.ts'
import { unavailableExcellence } from './metrics/engineering-excellence.ts'
import {
  type ScorecardSource,
  collectScorecard,
  githubScorecardSource,
} from './metrics/scorecard.ts'
import {
  type EngineeringExcellence,
  type MetricBlock,
  type MonthlyReport,
  type ProjectConfig,
  type Scorecard,
  type Warning,
  skip,
} from './types.ts'

/**
 * A planned project is not deployed, so delivery, agents, contributors and facets would only ever
 * read as empty. Saying why keeps an empty block from looking like a broken collection.
 */
export const PLANNED_REASON = 'Planned project: not deployed yet.'

/**
 * Whether a planned project's repository can be read yet. A planned repository is often not
 * created, so a 404, a 403 or an unreachable API all mean "not yet" rather than a failed run.
 */
export async function repositoryExists(
  repo: string,
  fetch: (path: string) => Promise<unknown> = get,
): Promise<boolean> {
  try {
    return (await fetch(`/repos/${repo}`)) !== null
  } catch {
    return false
  }
}

/** Splits planned projects into those with a readable repository and those still waiting for one. */
export async function partitionPlanned(
  projects: ProjectConfig[],
  exists: (repo: string) => Promise<boolean> = (repo) => repositoryExists(repo),
): Promise<{ readable: ProjectConfig[]; missing: ProjectConfig[] }> {
  const readable: ProjectConfig[] = []
  const missing: ProjectConfig[] = []
  for (const project of projects) {
    if (project.status !== 'planned') continue
    ;((await exists(project.repo)) ? readable : missing).push(project)
  }
  return { readable, missing }
}

export interface PlannedInput {
  project: ProjectConfig
  period: { year: number; month: number; from: Date; to: Date }
  config: ScorecardConfig
  previousScores: (number | null)[]
  source?: ScorecardSource
  now?: Date
}

/**
 * One month's report for a planned project: the Engineering scorecard and its AI usage are read
 * from the repository as for any project, and every block that needs a deployed product is
 * unavailable rather than zero, so nothing suggests the project ships.
 */
export async function collectPlannedProject(input: PlannedInput): Promise<MonthlyReport> {
  const { project, period, config, previousScores } = input
  const now = input.now ?? new Date()

  const engineeringExcellence: EngineeringExcellence | undefined = project.engineeringExcellence
    ?.enabled
    ? unavailableExcellence(PLANNED_REASON)
    : undefined

  const warnings: Warning[] = []
  let scorecard: MetricBlock<Scorecard>
  try {
    scorecard = await collectScorecard(
      project,
      config,
      period,
      engineeringExcellence,
      previousScores,
      input.source ?? githubScorecardSource(project.repo),
      now,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnings.push({
      code: 'COLLECTION_ERROR',
      severity: 'warn',
      message: `engineering scorecard could not be collected: ${message}`,
      context: { metric: 'engineering scorecard' },
    })
    scorecard = skip(`engineering scorecard could not be collected. ${message}`)
  }

  return {
    schemaVersion: 1,
    project: project.id,
    name: project.name,
    repo: project.repo,
    status: project.status,
    period: {
      year: period.year,
      month: period.month,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
    },
    generatedAt: now.toISOString(),
    delivery: {
      productionEnvironment: project.environments.production,
      stagingEnvironment: project.environments.staging,
      deploymentFrequency: skip(PLANNED_REASON),
      leadTime: skip(PLANNED_REASON),
      reworkRate: skip(PLANNED_REASON),
    },
    agents: skip(PLANNED_REASON),
    contributors: skip(PLANNED_REASON),
    placement: skip(PLANNED_REASON),
    ...(engineeringExcellence ? { engineeringExcellence } : {}),
    scorecard,
    warnings,
  }
}
