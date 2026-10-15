import { get, paginate } from '../github.ts'
import {
  type AgenticAdoption,
  type AgenticSetup,
  type AgenticWorker,
  type BotAdditions,
  type MetricBlock,
  ok,
  skip,
} from '../types.ts'
import { type PatchFile, patchAdditions } from './codebase.ts'
import { type WorkflowFile, githubScorecardSource } from './scorecard.ts'

export const HARNESS_PACKAGE = '@plainconceptsplatform/agent-harness'
export const WORKFLOWS_PACKAGE = '@plainconceptsplatform/workflows'

/** The workers the standard router dispatches to, in the order work flows through them. */
export const STANDARD_WORKERS = [
  'triage',
  'refine',
  'implement',
  'merge-gate',
  'apply-review',
  'audit',
  'release',
] as const

/** Workers the package once installed and has since retired; still present means an old install. */
export const RETIRED_WORKERS = ['visual-verify'] as const

const ROUTER = '.github/workflows/work-router.yml'
const EVIDENCE = '.github/workflows/evidence.yml'
const HARNESS_JSON = '.opencode/harness.json'
/** Written by opencode-onboard, the harness before it was renamed agent-harness. */
const LEGACY_HARNESS_JSON = '.opencode/opencode-onboard.json'
const VERIFY_SKILL = '.agents/skills/pc-repo-verify/SKILL.md'

const MANAGED = /Managed by @plainconceptsplatform\/workflows@(\d+\.\d+\.\d+)/

/**
 * The installed workflows version. Every managed file carries it in its header; the router is read
 * first because it is the one file every installation has.
 */
export function managedVersion(files: WorkflowFile[]): string | null {
  const ordered = [...files].sort((a, b) => Number(b.path === ROUTER) - Number(a.path === ROUTER))
  for (const file of ordered) {
    const match = file.text.match(MANAGED)
    if (match) return match[1] as string
  }
  return null
}

/**
 * Workflow files that look like agent automation built by hand: gh-aw sources (`.md`) and anything
 * named after agent work. Only consulted when the standard router is absent, so the standard
 * package's own files never count here.
 */
export function customAgentWorkflows(paths: string[]): string[] {
  return paths
    .filter((p) => p.startsWith('.github/workflows/') && !p.slice(18).includes('/'))
    .map((p) => p.slice(18))
    .filter((name) => !name.endsWith('.lock.yml') && name.toLowerCase() !== 'readme.md')
    .filter(
      (name) =>
        name.endsWith('.md') ||
        /(^|[-_])(agents?|agentics|implement|refine|triage|work-router)([-_.]|$)/i.test(name),
    )
    .sort()
}

/**
 * Whether the repository told the verify skill how to start its app. The harness ships the slot
 * with generic defaults; until a project replaces them, the evidence replay is guessing.
 */
export function verifyEnvironmentRecorded(skill: string | null): boolean | null {
  if (skill === null) return null
  const slot = skill.match(
    /<!-- PC-PROJECT-ENVIRONMENT-START -->([\s\S]*?)<!-- PC-PROJECT-ENVIRONMENT-END -->/,
  )?.[1]
  if (!slot?.trim()) return false
  const shippedDefault =
    slot.includes('Sign-in: none recorded yet') && slot.includes('Seeded data: none recorded yet')
  return !shippedDefault
}

/** Standard when the package's router is installed, custom when agent workflows exist without it. */
export function setupOf(input: {
  router: boolean
  managed: string | null
  harness: string | null
  legacyHarness: boolean
  custom: string[]
}): AgenticSetup {
  if (input.router && input.managed) return 'standard'
  if (
    input.router ||
    input.managed ||
    input.harness ||
    input.legacyHarness ||
    input.custom.length > 0
  ) {
    return 'custom'
  }
  return 'none'
}

/** Pull requests the implement worker opened; it titles every one of them "[bot] ...". */
export const BOT_TITLE_PREFIX = '[bot]'

export interface BotPullRequests {
  merged: number
  lastMergedAt: string | null
  added?: BotAdditions
}

/** Everything adoption reads from GitHub and npm, behind one seam so tests need no network. */
export interface AgenticSource {
  defaultBranch: () => Promise<string | null>
  workflows: (branch: string) => Promise<WorkflowFile[]>
  files: (branch: string) => Promise<string[] | null>
  file: (path: string, branch: string) => Promise<string | null>
  botPullRequests: (from: Date, to: Date) => Promise<BotPullRequests>
  latest: (pkg: string) => Promise<string | null>
}

const parseJson = (text: string | null): Record<string, unknown> | null => {
  if (!text) return null
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * How far a repository has adopted the platform's agent tooling: the harness that runs the agents,
 * the workflows package that routes work to them, and whether the bot actually ships. Read from the
 * default branch as it is now, like the scorecard; only the merged pull requests are per period.
 */
export async function collectAgentic(
  repo: string,
  period: { from: Date; to: Date },
  source: AgenticSource = githubAgenticSource(repo),
): Promise<MetricBlock<AgenticAdoption>> {
  const branch = await source.defaultBranch()
  if (!branch) return skip('The repository could not be read, so adoption was not checked.')

  const [workflows, tree] = await Promise.all([source.workflows(branch), source.files(branch)])
  const paths = new Set(tree ?? workflows.map((f) => f.path))
  const has = (path: string) => paths.has(path)

  const [harnessText, legacyText, verifyText] = await Promise.all([
    has(HARNESS_JSON) || tree === null ? source.file(HARNESS_JSON, branch) : null,
    has(LEGACY_HARNESS_JSON) ? source.file(LEGACY_HARNESS_JSON, branch) : null,
    has(VERIFY_SKILL) ? source.file(VERIFY_SKILL, branch) : null,
  ])
  const harnessVersion = parseJson(harnessText)?.harnessVersion
  const legacy = parseJson(legacyText)
  const legacyVersion = legacy?.onboardVersion

  const managed = managedVersion(workflows)
  const router = has(ROUTER)
  const workers: AgenticWorker[] = STANDARD_WORKERS.map((name) => ({
    name,
    present: has(`.github/workflows/agent-${name}.md`),
  }))
  const retired = RETIRED_WORKERS.filter((name) => has(`.github/workflows/agent-${name}.md`))
  const custom = router && managed ? [] : customAgentWorkflows([...paths])

  const [bot, latestHarness, latestWorkflows] = await Promise.all([
    source.botPullRequests(period.from, period.to),
    source.latest(HARNESS_PACKAGE),
    source.latest(WORKFLOWS_PACKAGE),
  ])

  const harness = typeof harnessVersion === 'string' ? harnessVersion : null
  return ok({
    defaultBranch: branch,
    setup: setupOf({ router, managed, harness, legacyHarness: legacy !== null, custom }),
    harness: {
      version: harness,
      latest: latestHarness,
      legacy: legacy !== null,
      legacyVersion: typeof legacyVersion === 'string' ? legacyVersion : null,
    },
    workflows: {
      version: managed,
      latest: latestWorkflows,
      router,
      workers,
      evidence: has(EVIDENCE),
      retired: retired.map((name) => `agent-${name}`),
      custom,
    },
    verifyEnvironment: verifyEnvironmentRecorded(verifyText),
    bot: { prefix: BOT_TITLE_PREFIX, ...bot },
  })
}

const decode = (content: { content?: string; encoding?: string } | null) =>
  content?.content
    ? content.encoding === 'base64'
      ? Buffer.from(content.content, 'base64').toString('utf8')
      : content.content
    : null

/** A package's latest version is the same for every project, so it is asked once per run. */
const latestCache = new Map<string, Promise<string | null>>()

export function latestVersion(pkg: string): Promise<string | null> {
  const cached = latestCache.get(pkg)
  if (cached) return cached
  const load = (async () => {
    try {
      const response = await fetch(`https://registry.npmjs.org/${pkg}/latest`, {
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) return null
      const body = (await response.json()) as { version?: string }
      return body.version ?? null
    } catch {
      return null
    }
  })()
  latestCache.set(pkg, load)
  return load
}

interface SearchItem {
  number: number
  title: string
  pull_request?: { merged_at?: string | null }
}

const day = (date: Date) => date.toISOString().slice(0, 10)

/**
 * Merged pull requests titled "[bot] ...". Search treats the brackets as punctuation, so the query
 * only narrows the list and the title is checked here.
 */
async function searchBotPullRequests(repo: string, merged: string, sort: string) {
  const q = encodeURIComponent(`repo:${repo} is:pr is:merged merged:${merged} "bot" in:title`)
  const result = await get<{ items: SearchItem[] }>(`/search/issues?q=${q}&per_page=100&${sort}`)
  return (result?.items ?? []).filter((item) => item.title.startsWith(BOT_TITLE_PREFIX))
}

export const githubAgenticSource = (repo: string): AgenticSource => {
  // Shares the scorecard's cache, so the workflow files and the tree are read once per repository.
  const scorecard = githubScorecardSource(repo)
  return {
    defaultBranch: scorecard.defaultBranch,
    workflows: scorecard.workflows,
    files: async (branch) => (scorecard.files ? scorecard.files(branch) : null),
    file: async (path, branch) =>
      decode(
        await get<{ content?: string; encoding?: string }>(
          `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
        ),
      ),
    botPullRequests: async (from, to) => {
      const end = new Date(to.getTime() - 1)
      const inPeriod = await searchBotPullRequests(
        repo,
        `${day(from)}..${day(end)}`,
        'sort=created&order=desc',
      )
      const recent = await searchBotPullRequests(repo, `<=${day(end)}`, 'sort=created&order=desc')
      const last = recent
        .map((item) => item.pull_request?.merged_at ?? null)
        .filter((at): at is string => at !== null)
        .sort()
        .at(-1)
      const patches = await Promise.all(
        inPeriod.map((item) =>
          paginate<PatchFile>(`/repos/${repo}/pulls/${item.number}/files?per_page=100`, 5),
        ),
      )
      return {
        merged: inPeriod.length,
        lastMergedAt: last ?? null,
        added: { pullRequests: inPeriod.length, ...patchAdditions(patches.flat()) },
      }
    },
    latest: latestVersion,
  }
}
