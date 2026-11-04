import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { githubRepo } from './contract.ts'
import {
  type Baseline,
  PROJECT_FAMILIES,
  type PracticePhase,
  type ProjectConfig,
  type ProjectType,
  type StandardMode,
} from './types.ts'

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
  family?: Baseline
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

export const loadOrganization = (): string => readProjectsFile().organization

/** The template members without a contract are compared with; null when none is configured. */
export const loadBaseline = (): Baseline | null => readProjectsFile().family ?? null

export function baselineProblems(baseline: Baseline | null): string[] {
  if (!baseline || githubRepo(baseline.template)) return []
  return [`family.template "${baseline.template}" is not a GitHub repository`]
}

/**
 * The rules projects.schema.json states but the collector cannot rely on an editor to enforce: an
 * own-design project says why, and family is one of the known values.
 */
export function projectProblems(project: ProjectConfig): string[] {
  const problems: string[] = []
  const family = project.family as string | undefined
  if (family !== undefined && !(PROJECT_FAMILIES as readonly string[]).includes(family)) {
    problems.push(`${project.id}: family "${family}" is not one of ${PROJECT_FAMILIES.join(', ')}`)
  }
  if (family === 'own-design' && !project.familyReason?.trim()) {
    problems.push(`${project.id}: family own-design needs a familyReason`)
  }
  return problems
}

export const loadDora = (): DoraConfig => read<DoraConfig>('config/dora.json')

export interface ToolPattern {
  name: string
  /** Case-insensitive regular expression matched against a workflow step or job. */
  pattern: string
  /**
   * For tools that do not fail the build unless told to, such as Trivy, whose exit code is 0 by
   * default. The step only counts as blocking when this also matches.
   */
  blockingWhen?: string
  /**
   * Evidence that the practice is there, but below its standard: a plain test run where the
   * standard also asks for a coverage gate. A practice found only through weak tools is yellow,
   * never green. List weak tools after the strong ones, so a step that has both is named strong.
   */
  weak?: boolean
}

export interface PracticeDefinition {
  id: string
  number: number
  name: string
  phase: PracticePhase
  mode: StandardMode
  description: string
  tools: ToolPattern[]
  /** Only applicable to projects that ask for it in scorecard.<id> in projects.json. */
  optIn?: boolean
  /** false drops the practice from every scorecard, for a platform that does not want it. */
  enabled?: boolean
  /** Why the practice reads red when nothing was found, when the generic sentence would mislead. */
  absentReason?: string
  /** Days before a result reads as stale, for a practice whose cadence is not the global one. */
  staleDays?: number
}

/**
 * Where the restore drill runs. One workflow in a hub repository drills every project's database,
 * so the evidence is that workflow's jobs, named `Drill <product>/<database>`, not a workflow of
 * the project's own repository.
 */
export interface RestoreDrillSource {
  repo: string
  workflow: string
  branch?: string
  /** How many recent completed runs to look through for the project's job. Defaults to 10. */
  maxRuns?: number
}

export interface ScorecardConfig {
  staleDays: number
  practices: PracticeDefinition[]
  restoreDrill?: RestoreDrillSource
  types: Record<
    ProjectType,
    {
      label: string
      notApplicable: string[]
      /** Opt-in practice ids this type expects by default; scorecard.<id>: false opts out. */
      applicable?: string[]
    }
  >
  aiUsage: {
    /** Upper bounds of levels 1 to 4 as shares; anything at or above the last is level 5. */
    buckets: number[]
    assistants: { name: string; pattern: string }[]
    /** Bot logins that automate but are not AI, matched as a prefix of the login. */
    excludedBots: string[]
  }
  alerts: {
    highAiUsage: number
    lowLevel: number
    decliningPoints: number
    decliningMonths: number
  }
}

/** The template default lives in config/, which a platform mirror may override as a whole. */
export const loadScorecardConfig = (): ScorecardConfig =>
  read<ScorecardConfig>('config/scorecard.json')
