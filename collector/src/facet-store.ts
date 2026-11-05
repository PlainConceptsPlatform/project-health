import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { loadProjects, repoRoot } from './config.ts'
import {
  DEFAULT_BRANCH,
  mergeSamples,
  readFacet,
  unavailableExcellence,
} from './metrics/engineering-excellence.ts'
import { emptyMonth, monthLabel, periodOf, readMonth, writeIndex, writeMonth } from './store.ts'
import {
  type EngineeringExcellence,
  FACETS,
  type Facet,
  type FacetDataMap,
  type FacetSample,
  type FacetSeries,
  type MonthlyReport,
  type ProjectConfig,
  ok,
} from './types.ts'

/**
 * Writes one engineering facet into the stored month, using the same merge rules as the collector.
 *
 * The collector can only read artifacts from GitHub Actions. A repository on another host produces
 * the same facets and has nowhere to put them, so this is that missing step: the pipeline runs it
 * after the facet is written, and the month file becomes the durable record exactly as it is for
 * GitHub.
 */

export interface AddFacetOptions {
  project: ProjectConfig
  facet: Facet
  /** The `<facet>.json` the producer wrote, not a zip. */
  file: string
  dataDir: string
  /** Overrides the envelope's commit, for a host whose CI checks out a different revision. */
  commit?: string
  /** `yyyy-mm`. Defaults to the month of the envelope's `generatedAt`. */
  month?: string
  now?: Date
}

export interface AddFacetResult {
  month: string
  samples: number
  latestGeneratedAt: string
  created: boolean
}

export class FacetRejected extends Error {}

const monthOf = (generatedAt: string): string => {
  const date = new Date(generatedAt)
  if (Number.isNaN(date.getTime())) {
    throw new FacetRejected(`generatedAt is not a date: ${generatedAt}`)
  }
  return monthLabel({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 })
}

export function addFacet(options: AddFacetOptions): AddFacetResult {
  const { project, facet, dataDir } = options
  const now = options.now ?? new Date()
  const branch = project.engineeringExcellence?.branch ?? DEFAULT_BRANCH

  const bytes = new Uint8Array(readFileSync(options.file))
  const read = readFacet(
    { [`${facet}.json`]: bytes },
    facet,
    project.repo,
    branch,
    project.formerRepos,
  )
  if (!read.ok) throw new FacetRejected(`${options.file}: ${read.reason}`)

  const envelope = read.envelope
  const month = options.month ?? monthOf(envelope.generatedAt)
  const period = periodOf(month)

  const existing = readMonth(dataDir, project.id, month)
  const report: MonthlyReport = existing ?? emptyMonth(project, period, now)
  const blocks: EngineeringExcellence =
    report.engineeringExcellence ??
    unavailableExcellence('No facet has been stored for this month yet.')
  const previous = blocks[facet]

  // `facet` is a union here, so the generic has to be widened once; every branch keeps its own data.
  const sample = {
    commitSha: options.commit ?? envelope.commitSha,
    runId: envelope.runId,
    runAttempt: envelope.runAttempt ?? null,
    artifactId: null,
    generatedAt: envelope.generatedAt,
    data: envelope.data,
  } as FacetSample<FacetDataMap[Facet]>

  const series = mergeSamples(
    facet,
    (previous.available ? previous.data : null) as FacetSeries<FacetDataMap[Facet]> | null,
    [sample],
  )
  if (!series) throw new FacetRejected(`${facet}: the sample could not be placed in ${month}`)

  const next: MonthlyReport = {
    ...report,
    generatedAt: now.toISOString(),
    engineeringExcellence: { ...blocks, [facet]: ok(series) } as EngineeringExcellence,
  }
  writeMonth(dataDir, project.id, month, next)
  writeIndex(dataDir, loadProjects())

  return {
    month,
    samples: series.samples.length,
    latestGeneratedAt: series.latestGeneratedAt,
    created: existing === null,
  }
}

const USAGE = `Usage: facet-store add --project <id> --facet <name> --file <path>
                         [--commit <sha>] [--month <yyyy-mm>]

Writes one facet sample into data/<id>/<yyyy-mm>.json and merges it with what is already there.
The project must already be in projects.json; the file is the <facet>.json the producer wrote.
Facets: ${FACETS.join(', ')}.`

function main(): void {
  const args = process.argv.slice(2)
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(name)
    return index > -1 ? args[index + 1] : undefined
  }

  if (args[0] !== 'add') {
    console.error(USAGE)
    process.exitCode = 1
    return
  }

  const projectId = flag('--project')
  const facet = flag('--facet') as Facet | undefined
  const file = flag('--file')

  if (!projectId || !facet || !file) {
    console.error(USAGE)
    process.exitCode = 1
    return
  }
  if (!FACETS.includes(facet)) {
    console.error(`Unknown facet "${facet}". Facets: ${FACETS.join(', ')}.`)
    process.exitCode = 1
    return
  }

  const project = loadProjects().find((entry) => entry.id === projectId)
  if (!project) {
    const ids = loadProjects().map((entry) => entry.id)
    console.error(`No project "${projectId}" in projects.json. Known: ${ids.join(', ') || 'none'}.`)
    process.exitCode = 1
    return
  }

  try {
    const result = addFacet({
      project,
      facet,
      // `pnpm --filter` runs the script from the package directory, so a path typed at the
      // repository root would resolve one level too deep. INIT_CWD is where the command was typed.
      file: resolve(process.env.INIT_CWD ?? process.cwd(), file),
      dataDir: join(repoRoot, 'data'),
      commit: flag('--commit'),
      month: flag('--month'),
    })
    const created = result.created ? ', created the month' : ''
    console.log(
      `${project.id} ${result.month} ${facet}: ${result.samples} sample(s), newest ${result.latestGeneratedAt}${created}`,
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

main()
