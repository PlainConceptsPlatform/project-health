import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isExampleConfig, loadDora, loadProjects, loadScorecardConfig, repoRoot } from './config.ts'
import { discover } from './discover.ts'
import { get } from './github.ts'
import { collectAgents } from './metrics/agents.ts'
import { collectContributors } from './metrics/contributors.ts'
import { computeDeploymentFrequency } from './metrics/deployments.ts'
import {
  collectEngineeringExcellence,
  unavailableExcellence,
} from './metrics/engineering-excellence.ts'
import { collectLeadTime } from './metrics/leadtime.ts'
import { fetchReleaseHistory, withinWindow } from './metrics/releases.ts'
import { collectRework } from './metrics/rework.ts'
import { collectScorecard } from './metrics/scorecard.ts'
import { exportToOtlp, otlpConfigured } from './otel.ts'
import { collectPlannedProject, partitionPlanned } from './planned.ts'
import { placeProject } from './profile.ts'
import {
  type AgentRun,
  type AgentSummary,
  type Contributors,
  type EngineeringExcellence,
  type MetricBlock,
  type MonthlyReport,
  type ProjectConfig,
  type Scorecard,
  type Warning,
  skip,
} from './types.ts'

const dataDir = join(repoRoot, 'data')

/**
 * Not every note is a problem. A project with agents switched off, or without a production
 * environment, is configured that way on purpose, and a repository that emits several deployment
 * records per release is handled correctly rather than measured wrongly. Grouping those with a
 * skipped tag or a rollback would make a report look alarming when it is merely descriptive.
 */
const INFO_CODES = new Set([
  'AGENTS_DISABLED',
  'NO_PRODUCTION_ENVIRONMENT',
  'NO_PRODUCTION_DEPLOYMENTS',
  'DUPLICATE_DEPLOYMENT_OBJECTS',
  // A repository may produce only some facets, and mutation testing often runs weekly, so an
  // early month without one is expected rather than a data quality problem.
  'ENGINEERING_EXCELLENCE_ARTIFACT_MISSING',
])

const applySeverity = (warnings: Warning[]): Warning[] =>
  warnings.map((w) => ({ ...w, severity: INFO_CODES.has(w.code) ? 'info' : 'warn' }) as Warning)

interface Period {
  year: number
  month: number
  from: Date
  to: Date
}

const periodFor = (year: number, month: number): Period => ({
  year,
  month,
  from: new Date(Date.UTC(year, month - 1, 1)),
  to: new Date(Date.UTC(year, month, 1)),
})

const label = (p: Period) => `${p.year}-${String(p.month).padStart(2, '0')}`

/**
 * Runs one metric without letting a failure end the project or the run. A metric that cannot be
 * produced becomes an unavailable block plus a warning, which is what the site renders.
 */
async function attempt<T>(
  name: string,
  warnings: Warning[],
  fn: () => Promise<T>,
  fallback: (reason: string) => T,
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnings.push({
      code: 'COLLECTION_ERROR',
      message: `${name} could not be collected: ${message}`,
      context: { metric: name },
    })
    return fallback(`${name} could not be collected. ${message}`)
  }
}

/**
 * Confirms the token can actually read each project before anything is written.
 *
 * A fine grained token that lacks a permission answers 404 rather than 403, and this collector
 * treats 404 as "the thing is absent" so that a project without deployments degrades instead of
 * crashing. Those two behaviours combine badly: a wrongly scoped token looks exactly like a
 * project with no data, and the run would overwrite good history with empty metrics.
 *
 * A project that fails preflight is skipped entirely, so its existing files stay untouched.
 */
async function preflight(
  projects: ProjectConfig[],
): Promise<{ usable: ProjectConfig[]; failed: string[] }> {
  const usable: ProjectConfig[] = []
  const failed: string[] = []

  /** Resolves to a reason when the endpoint is unreachable, or null when it reads cleanly. */
  const check = async (path: string, permission: string): Promise<string | null> => {
    try {
      const result = await get<unknown>(path)
      return result === null ? `needs ${permission} (answered 404)` : null
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const forbidden = message.includes('403')
      return forbidden ? `needs ${permission} (answered 403)` : `unreachable: ${message}`
    }
  }

  for (const project of projects) {
    const problems: string[] = []

    const meta = await check(`/repos/${project.repo}`, 'Metadata read')
    if (meta) {
      failed.push(`${project.repo}: ${meta}`)
      continue
    }

    const deployments = await check(
      `/repos/${project.repo}/deployments?per_page=1`,
      'Deployments read',
    )
    if (deployments) problems.push(deployments)

    if (project.agents.enabled) {
      const actions = await check(
        `/repos/${project.repo}/actions/workflows?per_page=1`,
        'Actions read',
      )
      if (actions) problems.push(actions)
    }

    if (project.engineeringExcellence?.enabled) {
      const artifacts = await check(
        `/repos/${project.repo}/actions/artifacts?per_page=1`,
        'Actions read',
      )
      if (artifacts) problems.push(artifacts)
    }

    if (problems.length > 0) {
      failed.push(`${project.repo}: ${problems.join('; ')}`)
      continue
    }

    usable.push(project)
  }

  return { usable, failed }
}

function previousReport(projectId: string, month: string): MonthlyReport | null {
  const file = join(dataDir, projectId, `${month}.json`)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as MonthlyReport
  } catch {
    return null
  }
}

/** Agent runs already measured for this project and month, so finished runs are not refetched. */
function previousAgentRuns(projectId: string, month: string): AgentRun[] {
  const prior = previousReport(projectId, month)
  return prior?.agents.available ? prior.agents.data.runs : []
}

/** Facet samples already stored for this month, kept even after their artifacts expire. */
function previousExcellence(projectId: string, month: string): EngineeringExcellence | null {
  return previousReport(projectId, month)?.engineeringExcellence ?? null
}

/**
 * Scores of the months before this one inside the declining-alert window, oldest first. Reports
 * are written oldest first during a backfill, so the earlier months are already on disk.
 */
function previousScores(projectId: string, period: Period, months: number): (number | null)[] {
  const scores: (number | null)[] = []
  for (let back = months - 1; back >= 1; back -= 1) {
    const date = new Date(Date.UTC(period.year, period.month - 1 - back, 1))
    const prior = previousReport(
      projectId,
      label(periodFor(date.getUTCFullYear(), date.getUTCMonth() + 1)),
    )
    scores.push(prior?.scorecard?.available ? prior.scorecard.data.score : null)
  }
  return scores
}

async function collectProject(project: ProjectConfig, period: Period): Promise<MonthlyReport> {
  const warnings: Warning[] = []
  const dora = loadDora()
  const production = project.environments.production

  const history = production
    ? await attempt(
        'release history',
        warnings,
        () => fetchReleaseHistory(project, production),
        () => ({ releases: [], rawObjectCount: 0 }),
      )
    : { releases: [], rawObjectCount: 0 }

  if (!production) {
    warnings.push({
      code: 'NO_PRODUCTION_ENVIRONMENT',
      message: `${project.name} has no production environment, so production metrics are skipped.`,
    })
  }

  const windowReleases = withinWindow(history.releases, period.from, period.to)

  const frequency = production
    ? computeDeploymentFrequency(project, history, windowReleases, period.from, period.to)
    : {
        block: skip<never>(
          `${project.name} has no production environment configured, so deployment frequency is not measured.`,
        ),
        warnings: [],
      }
  warnings.push(...frequency.warnings)

  const leadTime = await attempt(
    'lead time',
    warnings,
    () => collectLeadTime(project, history.releases, windowReleases, period.from, period.to),
    (reason) => skip(reason),
  )

  const rework = production
    ? await attempt(
        'rework rate',
        warnings,
        () => collectRework(project, windowReleases, period.from, period.to),
        (reason) => skip(reason),
      )
    : skip<never>(`${project.name} has no production environment, so rework rate is not measured.`)

  const agents = await attempt(
    'agent usage',
    warnings,
    () =>
      collectAgents(project, period.from, period.to, previousAgentRuns(project.id, label(period))),
    (reason) => ({ block: skip<AgentSummary>(reason), warnings: [] }),
  )
  warnings.push(...agents.warnings)

  const contributors = await attempt(
    'contributors',
    warnings,
    () => collectContributors(project, windowReleases, period.from, period.to),
    (reason) => skip<Contributors>(reason),
  )

  let engineeringExcellence: EngineeringExcellence | undefined
  if (project.engineeringExcellence?.enabled) {
    const stored = previousExcellence(project.id, label(period))
    const excellence = await attempt(
      'engineering excellence',
      warnings,
      () => collectEngineeringExcellence(project, period.from, period.to, stored),
      (reason) => ({ block: stored ?? unavailableExcellence(reason), warnings: [] }),
    )
    warnings.push(...excellence.warnings)
    engineeringExcellence = excellence.block
  }

  const scorecardConfig = loadScorecardConfig()
  const scorecard = await attempt<MetricBlock<Scorecard>>(
    'engineering scorecard',
    warnings,
    () =>
      collectScorecard(
        project,
        scorecardConfig,
        period,
        engineeringExcellence,
        previousScores(project.id, period, scorecardConfig.alerts.decliningMonths),
      ),
    (reason) => skip(reason),
  )

  const placement = placeProject(dora, project, frequency.block, leadTime, rework)

  if (frequency.block.available && frequency.block.data.count < dora.minimumSampleSize) {
    warnings.push({
      code: 'SMALL_SAMPLE',
      message: `Only ${frequency.block.data.count} release(s) in this period. Rates and percentiles on this little data move a lot from one release to the next.`,
      context: { releases: frequency.block.data.count },
    })
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
    generatedAt: new Date().toISOString(),
    delivery: {
      productionEnvironment: production,
      stagingEnvironment: project.environments.staging,
      deploymentFrequency: frequency.block,
      leadTime,
      reworkRate: rework,
    },
    agents: agents.block,
    contributors,
    placement,
    ...(engineeringExcellence ? { engineeringExcellence } : {}),
    scorecard,
    warnings: applySeverity(warnings),
  }
}

function writeIndex(projects: ProjectConfig[]): void {
  const entries = projects.map((project) => {
    const dir = join(dataDir, project.id)
    let months: string[] = []
    try {
      months = readdirSync(dir)
        .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
        .map((f) => f.replace('.json', ''))
        .sort()
    } catch {
      months = []
    }
    return {
      id: project.id,
      name: project.name,
      repo: project.repo,
      status: project.status,
      months,
      latest: months.at(-1) ?? null,
    }
  })

  writeFileSync(
    join(dataDir, 'index.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), projects: entries }, null, 2)}\n`,
  )
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  // Inspecting a repository is a read-only question, so it short circuits before any config is
  // loaded. It answers "what would this project's entry look like" without needing one to exist.
  const discoverIndex = args.indexOf('--discover')
  if (discoverIndex >= 0) {
    const target = args[discoverIndex + 1]
    if (!target || !target.includes('/')) {
      console.error('Usage: --discover <owner/repo>')
      process.exitCode = 1
      return
    }
    await discover(target)
    return
  }
  const monthArg = args[args.indexOf('--month') + 1]
  const backfill = Number(args[args.indexOf('--backfill') + 1] ?? '') || 1

  const now = new Date()
  const anchor =
    monthArg && /^\d{4}-\d{2}$/.test(monthArg)
      ? periodFor(Number(monthArg.slice(0, 4)), Number(monthArg.slice(5, 7)))
      : periodFor(now.getUTCFullYear(), now.getUTCMonth() + 1)

  const periods: Period[] = []
  for (let back = backfill - 1; back >= 0; back -= 1) {
    const date = new Date(Date.UTC(anchor.year, anchor.month - 1 - back, 1))
    periods.push(periodFor(date.getUTCFullYear(), date.getUTCMonth() + 1))
  }

  const onlyArg = args[args.indexOf('--project') + 1]
  const only = onlyArg && !onlyArg.startsWith('--') && onlyArg !== 'all' ? onlyArg : null

  // Every enabled project, so the index lists the roadmap. A planned project is not deployed, so
  // only its Engineering scorecard is collected, and only once its repository exists.
  const all = loadProjects()
  const projects = only ? all.filter((p) => p.id === only) : all
  const delivered = projects.filter((p) => p.status !== 'planned')

  // An unconfigured template points at repositories that do not exist. Collecting would fail every
  // preflight, so a scheduled run says what is missing and succeeds instead of going red daily.
  if (isExampleConfig()) {
    console.log(
      'Nothing is configured: the example project list is still in use, so no collection ran.',
    )
    console.log(
      'Copy projects.example.json to projects.json and point it at your own repositories.',
    )
    console.log('Ask a repository what its entry should look like with --discover <owner/repo>.')
    return
  }

  if (only && projects.length === 0) {
    console.error(
      `No enabled project with id "${only}". Known ids: ${all.map((p) => p.id).join(', ')}`,
    )
    process.exitCode = 1
    return
  }

  const { usable, failed } = await preflight(delivered)
  const planned = await partitionPlanned(projects)

  // A planned repository that does not exist yet is the normal state of a roadmap entry, so it is
  // named but never turns the run red.
  for (const project of planned.missing) {
    console.log(
      `  ${project.id}: planned, repository ${project.repo} is not readable yet; skipped.`,
    )
  }

  if (failed.length > 0) {
    console.error('Preflight failed for:')
    for (const problem of failed) console.error(`  ${problem}`)
    console.error(
      'These projects were skipped so their existing data is not overwritten with empty metrics.',
    )
    process.exitCode = 1
  }

  if (usable.length === 0 && planned.readable.length === 0) {
    if (delivered.length > 0) {
      console.error('No project is readable with this token. Nothing was written.')
      process.exitCode = 1
      return
    }
    console.log('Only planned projects without a readable repository; nothing to collect.')
    writeIndex(all)
    return
  }

  console.log(
    `Collecting ${usable.length + planned.readable.length} project(s), ${planned.readable.length} planned, over ${periods.length} month(s)${only ? ` for ${only}` : ''}.`,
  )

  for (const project of usable) {
    mkdirSync(join(dataDir, project.id), { recursive: true })

    for (const period of periods) {
      try {
        const report = await collectProject(project, period)
        const file = join(dataDir, project.id, `${label(period)}.json`)
        writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
        const releases = report.delivery.deploymentFrequency.available
          ? report.delivery.deploymentFrequency.data.count
          : 0
        const agentRuns = report.agents.available ? report.agents.data.runs.length : 0
        console.log(
          `  ${project.id} ${label(period)}: ${releases} release(s), ${agentRuns} agent run(s), ${report.warnings.length} warning(s)`,
        )
      } catch (error) {
        // A project that fails entirely must not stop the ones after it.
        const message = error instanceof Error ? error.message : String(error)
        console.error(`  ${project.id} ${label(period)} failed: ${message}`)
      }
    }
  }

  const scorecardConfig = loadScorecardConfig()
  for (const project of planned.readable) {
    mkdirSync(join(dataDir, project.id), { recursive: true })

    for (const period of periods) {
      try {
        const report = await collectPlannedProject({
          project,
          period,
          config: scorecardConfig,
          previousScores: previousScores(
            project.id,
            period,
            scorecardConfig.alerts.decliningMonths,
          ),
        })
        const file = join(dataDir, project.id, `${label(period)}.json`)
        writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
        console.log(
          `  ${project.id} ${label(period)}: planned, scorecard ${report.scorecard?.available ? 'collected' : 'unavailable'}`,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`  ${project.id} ${label(period)} failed: ${message}`)
      }
    }
  }

  // The index always lists every enabled project, even when this run collected only one, so a
  // scoped backfill never removes the others from the site.
  writeIndex(all)
  console.log('Wrote data/index.json')

  // Planned projects are left out: OTLP carries delivery and agent metrics, which they do not have.
  if (otlpConfigured()) {
    const all = delivered.flatMap((project) =>
      periods
        .map((period) => {
          const file = join(dataDir, project.id, `${label(period)}.json`)
          try {
            return JSON.parse(readFileSync(file, 'utf8')) as MonthlyReport
          } catch {
            return null
          }
        })
        .filter((r): r is MonthlyReport => r !== null),
    )
    await exportToOtlp(all)
  }
}

await main()
