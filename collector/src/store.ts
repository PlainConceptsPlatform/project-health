import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type AgentSummary,
  type Contributors,
  type DeploymentFrequency,
  type LeadTime,
  type MonthlyReport,
  type Placement,
  type ProjectConfig,
  type ReworkRate,
  skip,
} from './types.ts'

/**
 * The stored month files, which are the durable record.
 *
 * GitHub expires workflow artifacts after about 90 days, so agent usage and engineering facets
 * cannot be refetched once they are gone. Every read of a previous month goes through here so the
 * merge rules are the same whether the collector or the `facet-store` CLI is writing.
 */

export interface MonthPeriod {
  year: number
  month: number
  from: string
  to: string
}

/** The month a file is named for: `2026-11`. */
export const monthLabel = (period: Pick<MonthPeriod, 'year' | 'month'>): string =>
  `${period.year}-${String(period.month).padStart(2, '0')}`

export const monthPath = (dataDir: string, projectId: string, month: string): string =>
  join(dataDir, projectId, `${month}.json`)

/** The reader both writers share. A month that cannot be parsed is treated as missing. */
export function readMonth(dataDir: string, projectId: string, month: string): MonthlyReport | null {
  const file = monthPath(dataDir, projectId, month)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as MonthlyReport
  } catch {
    return null
  }
}

export function writeMonth(
  dataDir: string,
  projectId: string,
  month: string,
  report: MonthlyReport,
): void {
  mkdirSync(join(dataDir, projectId), { recursive: true })
  writeFileSync(monthPath(dataDir, projectId, month), `${JSON.stringify(report, null, 2)}\n`)
}

/** Rebuilds `data/index.json` from the folders on disk, so it never names a month that is not there. */
export function writeIndex(dataDir: string, projects: ProjectConfig[]): void {
  const entries = projects.map((project) => {
    const dir = join(dataDir, project.id)
    let months: string[] = []
    try {
      months = readdirSync(dir)
        .filter((file) => /^\d{4}-\d{2}\.json$/.test(file))
        .map((file) => file.replace('.json', ''))
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

/** The period a `yyyy-mm` label covers, in UTC, from the first instant to the last. */
export function periodOf(month: string): MonthPeriod {
  const year = Number(month.slice(0, 4))
  const monthNumber = Number(month.slice(5, 7))
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error(`Expected a month as yyyy-mm, got "${month}".`)
  }
  const start = Date.UTC(year, monthNumber - 1, 1)
  const end = Date.UTC(year, monthNumber, 1) - 1
  return {
    year,
    month: monthNumber,
    from: new Date(start).toISOString(),
    to: new Date(end).toISOString(),
  }
}

/**
 * A month file written by a host that publishes nothing but engineering facets.
 *
 * Every metric that needs a deployment, an agent run or a pull request is absent with a reason.
 * The point is that the dashboard shows why it cannot answer, rather than a zero that reads like
 * a measured nothing.
 */
export function emptyMonth(project: ProjectConfig, period: MonthPeriod, now: Date): MonthlyReport {
  const reason =
    'This month was written from engineering facets alone, so this host publishes no deployment, agent or pull request data.'
  return {
    schemaVersion: 1,
    project: project.id,
    name: project.name,
    repo: project.repo,
    status: project.status,
    period,
    generatedAt: now.toISOString(),
    delivery: {
      productionEnvironment: project.environments.production,
      stagingEnvironment: project.environments.staging,
      deploymentFrequency: skip<DeploymentFrequency>(reason),
      leadTime: skip<LeadTime>(reason),
      reworkRate: skip<ReworkRate>(reason),
    },
    agents: skip<AgentSummary>(reason),
    contributors: skip<Contributors>(reason),
    placement: skip<Placement>(reason),
    warnings: [],
  }
}
