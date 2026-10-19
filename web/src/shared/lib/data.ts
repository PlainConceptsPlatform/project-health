import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type ActionsEntry, entryOf } from './actions'
import { type ExcellenceKpis, kpisOf } from './excellence'
import { type DailyScore, groupOf } from './scorecard'
import type {
  ComplexityData,
  CoverageData,
  DataIndex,
  FacetSample,
  HygieneData,
  MonthlyReport,
  MutationData,
} from './types'

/**
 * Reads the collected JSON at build time. The site is exported as static files, so nothing here
 * runs in the browser and no API or database is involved.
 *
 * The project list comes from projects.json rather than from collected data, so every configured
 * project has a page from the first build, before any collection has run. Months come from the
 * collector's index and are simply empty until it has.
 */
/**
 * Both default to a sibling of the web package, which is the layout when the code and the data share
 * a repository. They are overridable so this app can be built from a published template against a
 * project list and collected data checked out from somewhere private.
 */
const configRoot = process.env.PROJECT_HEALTH_CONFIG_DIR ?? join(process.cwd(), '..')
const dataDir = process.env.PROJECT_HEALTH_DATA_DIR ?? join(configRoot, 'data')
const repoRoot = configRoot

interface ProjectsFile {
  projects: {
    id: string
    name: string
    repo: string
    enabled: boolean
    status: string
    type?: string
    group?: string
  }[]
}

/**
 * The configured projects, falling back to the example file.
 *
 * A fresh clone has no projects.json, and a static export refuses a dynamic route with zero
 * parameters, so without a fallback the template simply cannot be built until somebody configures
 * it. Falling back to the example also means the first build shows a working dashboard with empty
 * metrics, which is a better introduction than a build error.
 */
function readConfiguredProjects(): ProjectsFile['projects'] {
  for (const name of ['projects.json', 'projects.example.json']) {
    try {
      const file = JSON.parse(readFileSync(join(repoRoot, name), 'utf8')) as ProjectsFile
      const projects = file.projects.filter((p) => p.enabled)
      if (projects.length > 0) return projects
    } catch {
      // Try the next candidate.
    }
  }
  return []
}

function readCollectedMonths(): Record<string, string[]> {
  try {
    const index = JSON.parse(readFileSync(join(dataDir, 'index.json'), 'utf8')) as DataIndex
    return Object.fromEntries(index.projects.map((p) => [p.id, p.months]))
  } catch {
    return {}
  }
}

export function readIndex(): DataIndex {
  const collected = readCollectedMonths()
  return {
    generatedAt: new Date().toISOString(),
    projects: readConfiguredProjects().map((project) => {
      const months = collected[project.id] ?? []
      return {
        id: project.id,
        name: project.name,
        repo: project.repo,
        status: project.status,
        group: groupOf(project),
        months,
        latest: months.at(-1) ?? null,
      }
    }),
  }
}

/** One point per collected day, oldest first; empty until the collector has written daily.json. */
export function readDailyScores(projectId: string): DailyScore[] {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, projectId, 'daily.json'), 'utf8')) as {
      days?: DailyScore[]
    }
    return Array.isArray(raw.days)
      ? raw.days.map(({ date, score, commentDensity, testRatio }) => ({
          date,
          score,
          commentDensity,
          testRatio,
        }))
      : []
  } catch {
    return []
  }
}

/** Returns null when a month was never collected, so a caller can render an empty state. */
export function readReport(projectId: string, month: string): MonthlyReport | null {
  try {
    const raw = readFileSync(join(dataDir, projectId, `${month}.json`), 'utf8')
    return JSON.parse(raw) as MonthlyReport
  } catch {
    return null
  }
}

/** Whether a month actually recorded anything, rather than merely existing. */
function hasActivity(report: MonthlyReport): boolean {
  const frequency = report.delivery.deploymentFrequency
  if (frequency.available && frequency.data.count > 0) return true
  if (report.agents.available && report.agents.data.runs.length > 0) return true
  return false
}

/**
 * The most recent month that recorded something, falling back to the newest month collected.
 *
 * The newest month is the wrong default on its own. On the first of a month it is hours old and
 * empty, so a healthy project reads as "n/a" everywhere and the dashboard looks broken. Every card
 * names the month it is showing, so stepping back to the last month with activity stays honest.
 */
export function readLatestReport(projectId: string): MonthlyReport | null {
  const entry = readIndex().projects.find((p) => p.id === projectId)
  if (!entry?.latest) return null

  for (const month of [...entry.months].reverse()) {
    const report = readReport(projectId, month)
    if (report && hasActivity(report)) return report
  }
  return readReport(projectId, entry.latest)
}

/** The month a page should fall back to when a project has nothing collected yet. */
export function currentMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Releases and lead time per collected month, for the trend chart. */
export function readTrend(projectId: string): {
  month: string
  releases: number
  leadTimeHours: number | null
}[] {
  const entry = readIndex().projects.find((p) => p.id === projectId)
  if (!entry) return []
  return entry.months.flatMap((month) => {
    const report = readReport(projectId, month)
    if (!report) return []
    const frequency = report.delivery.deploymentFrequency
    const lead = report.delivery.leadTime
    return [
      {
        month,
        releases: frequency.available ? frequency.data.count : 0,
        leadTimeHours:
          lead.available && lead.data.commitToProduction.available
            ? lead.data.commitToProduction.data.p50Hours
            : null,
      },
    ]
  })
}

/** Actions minutes and storage of every collected month up to and including `month`, oldest first. */
export function readActionsHistory(projectId: string, month: string): ActionsEntry[] {
  const entry = readIndex().projects.find((p) => p.id === projectId)
  if (!entry) return []
  return entry.months
    .filter((m) => m <= month)
    .sort()
    .flatMap((m) => entryOf(m, readReport(projectId, m)) ?? [])
}

export interface ExcellenceHistory {
  coverage: FacetSample<CoverageData>[]
  mutation: FacetSample<MutationData>[]
  complexity: FacetSample<ComplexityData>[]
  hygiene: FacetSample<HygieneData>[]
  /** The month before the one shown, for deltas. null when it has no facets. */
  previous: { month: string; kpis: ExcellenceKpis } | null
}

/**
 * Coverage and mutation samples from every collected month up to and including `month`, so the
 * trend on an older month's page ends where that month ended rather than showing its future.
 */
export function readExcellenceHistory(projectId: string, month: string): ExcellenceHistory {
  const entry = readIndex().projects.find((p) => p.id === projectId)
  const history: ExcellenceHistory = {
    coverage: [],
    mutation: [],
    complexity: [],
    hygiene: [],
    previous: null,
  }
  if (!entry) return history

  const months = entry.months.filter((m) => m <= month)
  for (const m of months) {
    const excellence = readReport(projectId, m)?.engineeringExcellence
    if (!excellence) continue
    if (excellence.coverage.available) history.coverage.push(...excellence.coverage.data.samples)
    if (excellence.mutation.available) history.mutation.push(...excellence.mutation.data.samples)
    if (excellence.complexity.available) {
      history.complexity.push(...excellence.complexity.data.samples)
    }
    if (excellence.hygiene?.available) history.hygiene.push(...excellence.hygiene.data.samples)
  }

  const before = months.filter((m) => m < month).at(-1)
  const previous = before ? readReport(projectId, before)?.engineeringExcellence : undefined
  if (before && previous) history.previous = { month: before, kpis: kpisOf(previous) }
  return history
}

/**
 * When the data was actually collected, taken from the newest report rather than from build time.
 * A dashboard that refreshes on a schedule has to say how fresh it is, otherwise a stale build is
 * indistinguishable from a quiet week.
 */
export function readCollectedAt(): string | null {
  const index = readIndex()
  const stamps = index.projects
    .flatMap((p) => p.months.map((m) => readReport(p.id, m)?.generatedAt))
    .filter((s): s is string => Boolean(s))
    .sort()
  return stamps.at(-1) ?? null
}

/** True while any example data is still present, so the site can say the numbers are made up. */
export function hasSyntheticData(): boolean {
  return readIndex().projects.some((p) => {
    const month = p.latest
    if (!month) return false
    return readReport(p.id, month)?.synthetic === true
  })
}

/**
 * Display names for project types, from config/scorecard.json so a platform that renames or adds a
 * type sees it here too. Empty when the file is missing; the page then falls back to built-in names.
 */
export function readScorecardTypeLabels(): Record<string, string> {
  try {
    const config = JSON.parse(
      readFileSync(join(configRoot, 'config', 'scorecard.json'), 'utf8'),
    ) as { types?: Record<string, { label?: string }> }
    return Object.fromEntries(
      Object.entries(config.types ?? {}).flatMap(([type, value]) =>
        value.label ? [[type, value.label]] : [],
      ),
    )
  } catch {
    return {}
  }
}
