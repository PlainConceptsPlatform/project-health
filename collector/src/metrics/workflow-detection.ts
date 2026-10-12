import type { PracticeDefinition } from '../config.ts'
import type { DetectedMode } from '../types.ts'

/**
 * Finds engineering practices in a repository's GitHub Actions workflows by reading the YAML as
 * text. A YAML parser would be a new dependency for a heuristic that only needs to know which job
 * and step a tool appears in, and the indentation rules below are enough for that.
 */

export interface WorkflowJob {
  key: string
  /** The job's display name when it sets one, which is what the jobs API reports. */
  name: string | null
  /** continue-on-error: true at job level makes every step in it report-only. */
  reportOnly: boolean
  /** Job-level lines outside the steps, where a reusable workflow call lives. */
  header: string
  steps: string[]
}

const indentOf = (line: string) => line.length - line.trimStart().length

/** Drops comments, so a commented-out scanner is not detected and a commented flag is not read. */
const stripComments = (line: string) => {
  if (line.trimStart().startsWith('#')) return ''
  return line.replace(/\s+#.*$/, '')
}

const unquote = (value: string) => value.trim().replace(/^['"]|['"]$/g, '')

/** Splits a workflow into its jobs, and each job into its steps. */
export function segmentWorkflow(text: string): WorkflowJob[] {
  const lines = text.split(/\r?\n/).map(stripComments)
  const jobsAt = lines.findIndex((line) => /^jobs:\s*$/.test(line))
  if (jobsAt < 0) return []

  const body = lines.slice(jobsAt + 1)
  const first = body.find((line) => line.trim() !== '')
  if (!first) return []
  const jobIndent = indentOf(first)

  const jobs: { key: string; lines: string[] }[] = []
  for (const line of body) {
    if (line.trim() === '') continue
    const indent = indentOf(line)
    // Another top-level key after jobs ends the section.
    if (indent === 0) break
    if (indent === jobIndent) {
      const key = line.trim().match(/^['"]?([\w.-]+)['"]?:\s*$/)?.[1]
      if (key) jobs.push({ key, lines: [] })
      continue
    }
    jobs.at(-1)?.lines.push(line)
  }

  return jobs.map(({ key, lines: jobLines }) => {
    const header: string[] = []
    const steps: string[][] = []
    let stepsIndent: number | null = null
    let itemIndent: number | null = null

    for (const line of jobLines) {
      const indent = indentOf(line)
      if (stepsIndent !== null && indent <= stepsIndent) {
        stepsIndent = null
        itemIndent = null
      }
      if (stepsIndent === null) {
        if (/^\s*steps:\s*$/.test(line)) {
          stepsIndent = indent
          continue
        }
        header.push(line)
        continue
      }
      const isItem = line.trimStart().startsWith('- ') || line.trim() === '-'
      if (isItem && (itemIndent === null || indent === itemIndent)) {
        itemIndent = indent
        steps.push([line])
      } else {
        steps.at(-1)?.push(line)
      }
    }

    const headerText = header.join('\n')
    // The job's own name sits at the first indentation level under the key, not inside a with: block.
    const ownIndent = Math.min(...header.map(indentOf), Number.POSITIVE_INFINITY)
    const nameLine = header.find(
      (line) => indentOf(line) === ownIndent && /^\s*name:\s*\S/.test(line),
    )
    return {
      key,
      name: nameLine ? unquote(nameLine.replace(/^\s*name:/, '')) : null,
      reportOnly: header.some(
        (line) => indentOf(line) === ownIndent && /continue-on-error:\s*true\b/.test(line),
      ),
      header: headerText,
      steps: steps.map((step) => step.join('\n')),
    }
  })
}

/** Any of these marks a scanner that runs but cannot fail the build. */
const REPORT_ONLY = [
  /continue-on-error:\s*true\b/,
  /exit-code:\s*['"]?0['"]?(\s|$)/,
  /--exit-code[ =]['"]?0\b/,
  /\|\|\s*true\b/,
  /\|\|\s*exit\s+0\b/,
]

export function inferMode(
  unit: string,
  jobReportOnly: boolean,
  blockingWhen?: string,
): DetectedMode {
  if (jobReportOnly) return 'report-only'
  if (REPORT_ONLY.some((pattern) => pattern.test(unit))) return 'report-only'
  if (blockingWhen && !new RegExp(blockingWhen, 'i').test(unit)) return 'report-only'
  return 'blocking'
}

/**
 * The uses: and run: content of a step, which is where a tool is named. Matching the whole step
 * would also find a scanner's name in an upload step's file path, such as sarif_file:
 * semgrep.sarif, and that upload step carries none of the scanner's report-only flags.
 */
export function commandText(unit: string): string {
  const lines = unit.split('\n')
  const picked: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    const match = line.match(/^(\s*)(-\s+)?(uses|run):/)
    if (!match) continue
    const keyIndent = (match[1]?.length ?? 0) + (match[2]?.length ?? 0)
    picked.push(line)
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j] ?? ''
      if (next.trim() !== '' && indentOf(next) <= keyIndent) break
      picked.push(next)
      i = j
    }
  }
  return picked.join('\n')
}

export interface ToolHit {
  practice: string
  tool: string
  workflow: string
  job: string
  jobName: string | null
  mode: DetectedMode
  weak: boolean
}

/**
 * Every practice tool found in one workflow file, one hit per practice per step. The tool is looked for
 * in the step's commands, and the mode in the whole step, because the flags that make a scanner
 * report-only usually sit in its with: block or on the step itself.
 */
export function detectTools(
  workflow: string,
  text: string,
  practices: PracticeDefinition[],
): ToolHit[] {
  const hits: ToolHit[] = []
  for (const job of segmentWorkflow(text)) {
    // A job that calls a reusable workflow has no steps; its uses: line is the unit.
    const units = job.steps.length > 0 ? job.steps : [job.header]
    for (const unit of units) {
      const command = commandText(unit)
      if (command === '') continue
      for (const practice of practices) {
        // The first matching tool names the step. Tools are listed specific first, so a generic
        // pattern such as "complexity" does not add a second name for check-complexity.
        const tool = practice.tools.find((t) => new RegExp(t.pattern, 'i').test(command))
        if (!tool) continue
        hits.push({
          practice: practice.id,
          tool: tool.name,
          workflow,
          job: job.key,
          jobName: job.name,
          mode: inferMode(unit, job.reportOnly, tool.blockingWhen),
          weak: tool.weak === true,
        })
      }
    }
  }
  return hits
}

export interface PracticeDetection {
  tools: string[]
  /** The strongest mode found: one blocking step is enough for the practice to block. */
  mode: DetectedMode
  /** Where the strongest hit lives, whose latest run decides pass or fail. */
  workflow: string
  job: string
  jobName: string | null
  /** True when every hit came from a weak tool. One strong hit anywhere makes it false. */
  weak: boolean
  /**
   * Every place the practice was found. A practice often lives in more than one workflow (a
   * weekly DAST scan and a post-deploy one); the result is read from whichever of the strongest
   * locations ran most recently, not only from the one that happened to be found first.
   */
  locations?: DetectionLocation[]
}

export interface DetectionLocation {
  workflow: string
  job: string
  jobName: string | null
  mode: DetectedMode
  weak: boolean
}

const location = (hit: ToolHit): DetectionLocation => ({
  workflow: hit.workflow,
  job: hit.job,
  jobName: hit.jobName,
  mode: hit.mode,
  weak: hit.weak,
})

/**
 * Folds the hits for each practice into one detection. A strong tool wins over a weak one, and
 * then a blocking occurrence over a report-only one, so the job that decides pass or fail is the
 * one that runs the practice to standard.
 */
export function summarizeDetections(hits: ToolHit[]): Map<string, PracticeDetection> {
  const byPractice = new Map<string, PracticeDetection>()
  for (const hit of hits) {
    const current = byPractice.get(hit.practice)
    if (!current) {
      byPractice.set(hit.practice, {
        tools: [hit.tool],
        mode: hit.mode,
        workflow: hit.workflow,
        job: hit.job,
        jobName: hit.jobName,
        weak: hit.weak,
        locations: [location(hit)],
      })
      continue
    }
    current.locations ??= []
    if (!current.locations.some((l) => l.workflow === hit.workflow && l.job === hit.job)) {
      current.locations.push(location(hit))
    }
    if (!current.tools.includes(hit.tool)) current.tools.push(hit.tool)
    const stronger = current.weak && !hit.weak
    const sameStrength = current.weak === hit.weak
    if (stronger || (sameStrength && current.mode === 'report-only' && hit.mode === 'blocking')) {
      Object.assign(current, {
        mode: hit.mode,
        workflow: hit.workflow,
        job: hit.job,
        jobName: hit.jobName,
        weak: hit.weak,
      })
    }
  }
  return byPractice
}

/**
 * Workflows that call this one as a reusable workflow. A reusable workflow has no runs of its own,
 * so its result has to be read from the run of whichever workflow called it.
 */
export function callersOf(workflow: string, files: { path: string; text: string }[]): string[] {
  const file = workflow.split('/').at(-1) ?? workflow
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const call = new RegExp(`uses:\\s*['"]?\\./\\.github/workflows/${escaped}['"]?`)
  return files.filter((f) => f.path !== workflow && call.test(f.text)).map((f) => f.path)
}
