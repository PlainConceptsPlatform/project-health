import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProjectConfig } from './types.ts'

const packageRoot = join(import.meta.dirname, '..', '..')

/**
 * Where projects.json and config/ live, and where data/ is written.
 *
 * Both default to this repository, which is how it runs when the code and the data share a repo.
 * They are overridable so the code can be published as a template while an organisation keeps its
 * project list and its collected data somewhere private.
 */
export const configRoot = process.env.PROJECT_HEALTH_CONFIG_DIR ?? packageRoot
export const dataRoot = process.env.PROJECT_HEALTH_DATA_DIR ?? packageRoot

/** Kept for callers that only need the data location. */
export const repoRoot = dataRoot

const read = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(join(configRoot, relativePath), 'utf8')) as T

export interface DoraConfig {
  reference: string
  windowDays: number
  minimumSampleSize: number
  throughput: {
    deploymentsPerWeek: { high: number; medium: number; low: number }
    leadTimeHoursP50: { high: number; medium: number; low: number }
  }
  stability: { reworkRate: { high: number; medium: number; low: number } }
  profiles: {
    id: string
    name: string
    throughput: string
    stability: string
    wellbeing: string
  }[]
}

interface ProjectsFile {
  organization: string
  projects: ProjectConfig[]
}

const EXAMPLE_ORGANIZATION = 'your-org'

/**
 * Reads the project list, falling back to the example that ships with the template.
 *
 * The template deliberately does not commit a projects.json, because every fork changes that one
 * file and shipping one guarantees a merge conflict on each sync. Falling back means the template
 * still runs, and it is also what lets a fresh clone build before anyone configures it.
 */
const readProjectsFile = (): ProjectsFile => {
  try {
    return read<ProjectsFile>('projects.json')
  } catch {
    return read<ProjectsFile>('projects.example.json')
  }
}

/**
 * True when nothing has been configured and the example is in use.
 *
 * The example points at repositories that do not exist, so collecting it would fail preflight on
 * every project. A scheduled run in an unconfigured template should therefore do nothing and say so,
 * rather than turning the repository permanently red.
 */
export const isExampleConfig = (): boolean => {
  try {
    return readProjectsFile().organization === EXAMPLE_ORGANIZATION
  } catch {
    return false
  }
}

/** Every enabled project, including planned ones, so the site can show what is coming. */
export const loadProjects = (): ProjectConfig[] =>
  readProjectsFile().projects.filter((p) => p.enabled)

/**
 * The projects worth spending API calls on. A planned project has nothing to measure yet, and its
 * repository may not even exist, so collecting it would only produce preflight failures.
 */
export const collectableProjects = (): ProjectConfig[] =>
  loadProjects().filter((p) => p.status !== 'planned')

export const loadDora = (): DoraConfig => read<DoraConfig>('config/dora.json')
