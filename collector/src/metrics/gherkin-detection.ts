import { posix } from 'node:path'
import { type ToolHit, commandText, inferMode, segmentWorkflow } from './workflow-detection.ts'

/**
 * Finds Gherkin suites from repository content rather than tool names. A Reqnroll or SpecFlow suite
 * runs through a plain `dotnet test <project>` line that names no BDD tool, so the spec practice
 * would read as absent. Feature files alone prove nothing, so a suite counts only when a workflow
 * step runs a test command that reaches the project holding them.
 */

export const SPEC_PRACTICE = 'spec'
export const GHERKIN_TOOL = 'Gherkin (.feature files)'
export const GHERKIN_NOT_RUN = 'Gherkin files exist but no workflow runs them.'

export interface FeatureSuite {
  /** The directory of the nearest project file above the feature files, '' for the repo root. */
  root: string
  projectFile: string | null
  featureDirs: string[]
}

const PROJECT_FILE =
  /^(?:[^/]+\.(?:csproj|fsproj|vbproj)|package\.json|pom\.xml|build\.gradle(?:\.kts)?|pyproject\.toml|go\.mod)$/i

const dirOf = (path: string) => {
  const dir = posix.dirname(path)
  return dir === '.' ? '' : dir
}

/** True when `path` is `dir` itself or lies below it. '' is the repository root. */
const within = (path: string, dir: string) =>
  dir === '' || path === dir || path.startsWith(`${dir}/`)

/** Groups the repository's feature files by the project that holds them. */
export function featureSuites(paths: string[]): FeatureSuite[] {
  const projects = new Map<string, string>()
  for (const path of paths) {
    const name = path.split('/').at(-1) ?? path
    const dir = dirOf(path)
    if (PROJECT_FILE.test(name) && !projects.has(dir)) projects.set(dir, path)
  }

  const suites = new Map<string, FeatureSuite>()
  for (const path of paths) {
    if (!/\.feature$/i.test(path) || path.split('/').includes('node_modules')) continue
    const featureDir = dirOf(path)
    let root: string | null = featureDir
    while (root !== null && !projects.has(root)) root = root === '' ? null : dirOf(root)
    const key = root ?? featureDir
    const suite = suites.get(key) ?? {
      root: key,
      projectFile: root === null ? null : (projects.get(root) ?? null),
      featureDirs: [],
    }
    if (!suite.featureDirs.includes(featureDir)) suite.featureDirs.push(featureDir)
    suites.set(key, suite)
  }
  return [...suites.values()]
}

/**
 * Test commands and whether they discover tests below their working directory. npm, pnpm and yarn
 * run the test script of the package in that directory only, so they reach a suite only from its
 * own package root.
 */
const TEST_COMMANDS: { pattern: RegExp; recursive: boolean }[] = [
  { pattern: /\bdotnet\s+test\b/, recursive: true },
  { pattern: /\b(?:npm|pnpm)\s+(?:run\s+)?test\b|\byarn\s+test\b/, recursive: false },
  {
    pattern:
      /\bplaywright\s+test\b|\bbddgen\b|\bcucumber(?:-js)?\b|\bbehave\b|\bpytest\b|\bgo\s+test\b|\bmvnw?\b[^\n]*\b(?:verify|test)\b|\bgradlew?\s+test\b/,
    recursive: true,
  },
]

/** Joins backslash continuations and folded (`>`) scalars so one command sits on one line. */
function commandLines(command: string): string[] {
  const lines: string[] = []
  let folding: number | null = null
  for (const raw of command.replace(/\\\r?\n\s*/g, ' ').split('\n')) {
    const indent = raw.length - raw.trimStart().length
    if (folding !== null && raw.trim() !== '' && indent > folding) {
      lines[lines.length - 1] = `${lines.at(-1) ?? ''} ${raw.trim()}`
      continue
    }
    folding = null
    const folded = raw.match(/^(\s*)(-\s+)?run:\s*>[-+]?\s*$/)
    if (folded) folding = (folded[1]?.length ?? 0) + (folded[2]?.length ?? 0)
    lines.push(raw.replace(/^\s*(-\s+)?run:\s*[>|]?[-+]?/, '').trim())
  }
  return lines.filter((line) => line !== '')
}

const normalizePath = (value: string): string | null => {
  const clean = value.trim().replace(/^['"]|['"]$/g, '')
  if (clean.includes('$')) return null
  const normal = posix.normalize(clean).replace(/\/+$/, '')
  if (normal.startsWith('..')) return null
  return normal === '.' ? '' : normal.replace(/^\.\//, '')
}

const workingDirectory = (unit: string, header: string): string | null => {
  const line =
    unit.match(/^\s*working-directory:\s*(.+)$/m) ?? header.match(/^\s*working-directory:\s*(.+)$/m)
  return line?.[1] ? normalizePath(line[1]) : ''
}

/** The explicit target of a test command: the first positional argument, or --project/--solution. */
const targetOf = (args: string): string | null | undefined => {
  const tokens = args.split(/\s+/).filter((t) => t !== '')
  const option = tokens.findIndex((t) => /^--(?:project|solution)$/.test(t))
  if (option >= 0) return tokens[option + 1] ? normalizePath(tokens[option + 1] as string) : null
  const first = tokens[0]
  if (!first || first.startsWith('-') || /^(?:&&|\|\||;|\|)$/.test(first)) return undefined
  return normalizePath(first)
}

const reaches = (suite: FeatureSuite, cwd: string, target: string, recursive: boolean) => {
  const resolved = posix.join(cwd, target).replace(/^\.$/, '')
  if (/\.slnx?$/i.test(resolved)) return within(suite.root, dirOf(resolved))
  if (suite.projectFile && resolved === suite.projectFile) return true
  if (!recursive) return resolved === suite.root
  return within(suite.root, resolved) || suite.featureDirs.some((dir) => within(dir, resolved))
}

/** Whether one step runs a test command that reaches the suite. */
function runsSuite(unit: string, header: string, suite: FeatureSuite): boolean {
  const command = commandText(unit)
  const lines = commandLines(command)
  const testLines = lines.filter((line) => TEST_COMMANDS.some((c) => c.pattern.test(line)))
  if (testLines.length === 0) return false

  // The step names the suite's directory or project, for example `cd tests/Acceptance` or
  // `--prefix web` next to its test command.
  if (suite.root !== '') {
    const escaped = suite.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(?:^|[\\s"'=:])(?:\\./)?${escaped}(?:[/\\s"']|$)`).test(command)) return true
  }

  const cwd = workingDirectory(unit, header)
  if (cwd === null) return false
  for (const line of testLines) {
    for (const { pattern, recursive } of TEST_COMMANDS) {
      const match = line.match(pattern)
      if (!match || match.index === undefined) continue
      const target = targetOf(line.slice(match.index + match[0].length))
      if (target === null) continue
      if (target === undefined) {
        // No target runs whatever the working directory holds: the solution or the whole tree.
        if (recursive ? within(suite.root, cwd) : cwd === suite.root) return true
        continue
      }
      if (reaches(suite, cwd, target, recursive)) return true
    }
  }
  return false
}

/** One spec hit per step whose test command reaches a feature suite. */
export function detectGherkinRuns(
  workflow: string,
  text: string,
  suites: FeatureSuite[],
): ToolHit[] {
  if (suites.length === 0) return []
  const hits: ToolHit[] = []
  for (const job of segmentWorkflow(text)) {
    for (const unit of job.steps) {
      if (!suites.some((suite) => runsSuite(unit, job.header, suite))) continue
      hits.push({
        practice: SPEC_PRACTICE,
        tool: GHERKIN_TOOL,
        workflow,
        job: job.key,
        jobName: job.name,
        mode: inferMode(unit, job.reportOnly),
        weak: false,
      })
    }
  }
  return hits
}
