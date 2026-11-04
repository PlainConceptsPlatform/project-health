import {
  CONTRACT,
  LEGACY_ANSWERS,
  LEGACY_MANIFEST,
  githubRepo,
  readContract,
  topLevel,
} from '../contract.ts'
import { get, paginate } from '../github.ts'
import {
  type Baseline,
  type Family,
  type FamilyBlock,
  type FamilyException,
  type FamilyFile,
  type MetricBlock,
  type ProjectConfig,
  ok,
  skip,
} from '../types.ts'
import { downloadArchive, unzipEntries } from './codebase.ts'

const EXCEPTIONS = '.platform/exceptions.yml'

/** At or above this share of shared lines, a baseline file counts as similar rather than divergent. */
export const SIMILAR = 0.9

/** Paths listed per state; the counts always cover every file. */
const LISTED = 300

/**
 * The default platform paths of an app without a contract, for a .NET API and React web layout:
 * the session, permission, audit, feature flag, error and security plumbing of the API, the web
 * shell, the scripts, the app workflows and the root configuration. `family.paths` replaces it.
 */
export const BASELINE_PATHS = [
  'apps/api/src/*.Api/{Security,Authorization,Errors,RateLimiting,Features}/**',
  'apps/api/src/*.Infrastructure/{Iam,Hosting,Features,Auditing,Notifications}/**',
  'apps/api/src/*.Application/{Iam,Features,Auditing,Notifications,Settings}/**',
  'apps/api/src/*.SharedKernel/**',
  'apps/api/src/*.ServiceDefaults/**',
  'apps/api/src/*.AppHost/**',
  'apps/api/*',
  'apps/web/src/shared/{ui,auth,lib,theme}/**',
  'apps/web/src/widgets/app-shell/**',
  'apps/web/src/app/{providers,styles}/**',
  'apps/web/src/pages/{login,not-found,settings,users,audit}/**',
  'scripts/**',
  '.github/workflows/app-*',
]

/** Root files that are documentation, lock files, or owned by the agent harness and workflows. */
const NOT_ROOT_CONFIG =
  /^(.*\.(md|png|jpe?g|gif|svg|ico)|pnpm-lock\.yaml|package-lock\.json|opencode\.jsonc|opencode\.ci\.json|skills-lock\.json|\.copier-answers\.yml)$/i

/** A glob as gitwildmatch reads it, plus `{a,b}` alternatives. Matches whole repository paths. */
export function globToRegExp(glob: string): RegExp {
  let pattern = ''
  let braces = 0
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i] as string
    if (glob.startsWith('**/', i)) {
      pattern += '(?:.*/)?'
      i += 2
    } else if (glob.startsWith('**', i)) {
      pattern += '.*'
      i += 1
    } else if (char === '*') pattern += '[^/]*'
    else if (char === '?') pattern += '[^/]'
    else if (char === '{') {
      braces += 1
      pattern += '(?:'
    } else if (char === '}' && braces > 0) {
      braces -= 1
      pattern += ')'
    } else if (char === ',' && braces > 0) pattern += '|'
    else pattern += char.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${pattern}$`)
}

/**
 * Owned paths as gitwildmatch globs, with `#` comments and `!` negations. As in gitignore, a
 * pattern without a slash matches at any depth and a directory takes its files.
 */
export function pathMatcher(globs: string[]): (path: string) => boolean {
  const rules = globs
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const negated = line.startsWith('!')
      let glob = negated ? line.slice(1) : line
      const anchored = glob.replace(/\/$/, '').includes('/')
      glob = glob.replace(/^\//, '').replace(/\/$/, '')
      const regex = globToRegExp(anchored ? glob : `**/${glob}`)
      const inside = new RegExp(`${regex.source.slice(0, -1)}/.*$`)
      return { negated, test: (path: string) => regex.test(path) || inside.test(path) }
    })
  return (path) => {
    let platform = false
    for (const rule of rules) if (rule.test(path)) platform = !rule.negated
    return platform
  }
}

export function baselineMatcher(paths: string[] = BASELINE_PATHS): (path: string) => boolean {
  const globs = paths.map(globToRegExp)
  return (path) =>
    globs.some((r) => r.test(path)) || (!path.includes('/') && !NOT_ROOT_CONFIG.test(path))
}

export const inBaseline = baselineMatcher()

/**
 * Every spelling an app name takes in code: OrderDesk, Order-Desk, orderdesk, order-desk
 * and ORDER_DESK. Longest first, so a longer spelling is replaced before a shorter one inside it.
 */
export function appTokens(names: string[]): string[] {
  const tokens = new Set<string>()
  for (const name of names) {
    const words = name.split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean)
    if (words.length === 0) continue
    const title = words.map((w) => `${w[0]?.toUpperCase()}${w.slice(1).toLowerCase()}`)
    const lower = words.map((w) => w.toLowerCase())
    for (const token of [
      name,
      title.join(''),
      title.join('-'),
      lower.join(''),
      lower.join('-'),
      lower.join('_').toUpperCase(),
    ]) {
      if (token.length >= 3) tokens.add(token)
    }
  }
  return [...tokens].sort((a, b) => b.length - a.length || a.localeCompare(b))
}

/** Replaces every app name with APP, so two apps' copies of the same file read the same. */
export function normaliser(tokens: string[]): (text: string) => string {
  if (tokens.length === 0) return (text) => text
  const regex = new RegExp(
    tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|'),
    'g',
  )
  return (text) => text.replace(regex, 'APP')
}

const isBinary = (bytes: Uint8Array) => bytes.subarray(0, 8000).includes(0)

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i])

const decoder = new TextDecoder('utf-8')
const textOf = (bytes: Uint8Array) => decoder.decode(bytes).replace(/^﻿/, '').replace(/\r\n/g, '\n')

/** Lines both files share, counted with repeats, over the lines of both: 1 is the same content. */
export function similarity(a: string, b: string): number {
  const lines = (text: string) =>
    text
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trim() !== '')
  const left = lines(a)
  const right = lines(b)
  if (left.length + right.length === 0) return 1
  const counts = new Map<string, number>()
  for (const line of left) counts.set(line, (counts.get(line) ?? 0) + 1)
  let shared = 0
  for (const line of right) {
    const n = counts.get(line) ?? 0
    if (n > 0) {
      shared += 1
      counts.set(line, n - 1)
    }
  }
  return Math.round(((2 * shared) / (left.length + right.length)) * 1000) / 1000
}

/** `exceptions: [{ path, reason, issue, expires }]`, read without a YAML dependency. */
export function parseExceptions(text: string): FamilyException[] {
  const items: Record<string, string>[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^(\s*)(-\s+)?([A-Za-z_]+):\s*(.*)$/)
    if (!match || (!match[2] && match[1] === '')) continue
    if (match[2]) items.push({})
    const raw = (match[4] as string).trim()
    const quoted = raw.match(/^(['"])(.*?)\1/)
    const item = items.at(-1)
    if (item) item[match[3] as string] = quoted ? (quoted[2] as string) : raw.replace(/\s+#.*$/, '')
  }
  return items
    .filter((item) => item.path)
    .map((item) => ({
      path: item.path as string,
      reason: item.reason || null,
      issue: item.issue || null,
      expires: item.expires || null,
    }))
}

/** Release parts first, then any pre-release suffix, which sorts before its release (PEP 440). */
export function compareTags(a: string, b: string): number {
  const parse = (tag: string) => {
    const match = tag.replace(/^v/i, '').match(/^(\d+(?:\.\d+)*)(.*)$/)
    return {
      release: (match?.[1] ?? '').split('.').map(Number),
      pre: (match?.[2] ?? '').replace(/^[-.]/, ''),
    }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.release.length, y.release.length); i += 1) {
    const diff = (x.release[i] ?? 0) - (y.release[i] ?? 0)
    if (diff !== 0) return diff
  }
  if (x.pre === y.pre) return 0
  if (!x.pre) return 1
  if (!y.pre) return -1
  return x.pre.localeCompare(y.pre, 'en', { numeric: true })
}

const VERSION_TAG = /^v?\d+(\.\d+)+/

/**
 * A recorded version is a tag, a commit, or `v1.2.0-3-gabc1234` when commits after a tag were
 * applied: the archive is read at that commit, and the lag is counted from the tag.
 */
export function templateRef(commit: string): { ref: string; tag: string | null } {
  const described = commit.match(/^(.+)-\d+-g([0-9a-f]+)$/)
  if (described) {
    const tag = described[1] as string
    return { ref: described[2] as string, tag: VERSION_TAG.test(tag) ? tag : null }
  }
  return { ref: commit, tag: VERSION_TAG.test(commit) ? commit : null }
}

export function templateLag(tag: string | null, tags: string[] | null) {
  const versions = (tags ?? []).filter((t) => VERSION_TAG.test(t)).sort(compareTags)
  const latest = versions.at(-1) ?? null
  if (tags === null) return { tag, latest: null, lag: null }
  return {
    tag,
    latest,
    lag: tag === null ? null : versions.filter((t) => compareTags(t, tag) > 0).length,
  }
}

export interface Comparison {
  identical: number
  similar: FamilyFile[]
  modified: FamilyFile[]
  missing: string[]
  extra: string[]
}

/**
 * Compares an app's platform files with the reference's, by path. Byte for byte with a contract;
 * in baseline mode the app names are normalised first and a near copy counts as similar.
 */
export function compareFiles(
  app: Map<string, Uint8Array>,
  reference: Map<string, Uint8Array>,
  mode: Family['mode'],
  normalise: (text: string) => string = (text) => text,
): Comparison {
  const byKey = (files: Map<string, Uint8Array>) =>
    new Map([...files].map(([path, bytes]) => [normalise(path), { path, bytes }]))
  const ours = byKey(app)
  const theirs = byKey(reference)
  const result: Comparison = { identical: 0, similar: [], modified: [], missing: [], extra: [] }

  for (const [key, ref] of theirs) {
    const own = ours.get(key)
    if (!own) {
      result.missing.push(ref.path)
      continue
    }
    if (mode !== 'baseline' || isBinary(own.bytes) || isBinary(ref.bytes)) {
      if (sameBytes(own.bytes, ref.bytes)) result.identical += 1
      else result.modified.push({ path: own.path, similarity: null })
      continue
    }
    const a = normalise(textOf(own.bytes))
    const b = normalise(textOf(ref.bytes))
    if (a === b) {
      result.identical += 1
      continue
    }
    const score = similarity(a, b)
    if (score >= SIMILAR) result.similar.push({ path: own.path, similarity: score })
    else result.modified.push({ path: own.path, similarity: score })
  }
  for (const [key, own] of ours) if (!theirs.has(key)) result.extra.push(own.path)

  const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path)
  result.similar.sort(byPath)
  result.modified.sort(byPath)
  result.missing.sort()
  result.extra.sort()
  return result
}

/** Where the comparison reads from GitHub, behind one seam so tests need no network. */
export interface FamilySource {
  defaultBranch: (repo: string) => Promise<string | null>
  archive: (repo: string, ref: string) => Promise<Uint8Array | null>
  tags: (repo: string) => Promise<string[] | null>
}

export interface FamilyInput {
  project: ProjectConfig
  /** The app's default branch zipball, the one the code scan already downloaded. */
  zip: Uint8Array
  baseline: Baseline | null
  /** Every family member's name, normalised away in baseline mode. */
  names: string[]
  today: Date
}

const tagCache = new Map<string, Promise<string[] | null>>()

export const githubFamilySource: FamilySource = {
  defaultBranch: async (repo) =>
    (await get<{ default_branch: string }>(`/repos/${repo}`))?.default_branch ?? null,
  archive: (repo, ref) => downloadArchive(repo, ref, true),
  tags: (repo) => {
    const cached = tagCache.get(repo)
    if (cached) return cached
    const load = paginate<{ name: string }>(`/repos/${repo}/tags?per_page=100`, 5)
      .then((tags) => tags.map((t) => t.name))
      .catch(() => null)
    tagCache.set(repo, load)
    return load
  },
}

const exceptionsOf = (text: string | null, today: Date) => {
  const day = today.toISOString().slice(0, 10)
  const all = text ? parseExceptions(text) : []
  return {
    active: all.filter((e) => !e.expires || e.expires >= day),
    expired: all.filter((e) => e.expires !== null && e.expires < day),
  }
}

const notCompared = (why: string): FamilyBlock => skip(`${why}, so nothing was compared.`)

/** Text files of the app's zipball, read once for the paths asked. */
function reader(zip: Uint8Array, paths: string[]) {
  const { entries } = unzipEntries(zip, (path) => paths.includes(path))
  return (path: string) => {
    const bytes = entries.get(path)
    return bytes ? textOf(bytes) : null
  }
}

/**
 * How far a family member has drifted from its template. With a contract, its owned paths are
 * compared byte for byte with the template at the version the app records; contract.yml wins over
 * the implicit `.platform/manifest` and `.copier-answers.yml` pair. Without one, the baseline paths
 * are compared with the configured baseline template's default branch, app names normalised.
 */
export async function collectFamily(
  input: FamilyInput,
  source: FamilySource = githubFamilySource,
): Promise<FamilyBlock> {
  const found = readContract(reader(input.zip, [CONTRACT, LEGACY_ANSWERS, LEGACY_MANIFEST]))
  if (found?.kind === 'invalid') {
    return { available: false, reason: `Invalid contract. ${found.error}.`, invalid: true }
  }
  const contract = found?.contract ?? null
  const url = contract?.source.url ?? input.baseline?.template
  if (!url) {
    return notCompared(
      `The app has no ${CONTRACT} and projects.json names no baseline template (family.template)`,
    )
  }
  const repo = githubRepo(url)
  if (!repo) return notCompared(`The template ${url} is not a GitHub repository`)
  const mode: Family['mode'] = found?.kind ?? 'baseline'
  const exceptionsPath = contract?.exceptions ?? EXCEPTIONS
  const version = contract?.version ?? null
  const read = reader(input.zip, [exceptionsPath, ...(version ? [version.file] : [])])
  const exceptions = exceptionsOf(read(exceptionsPath), input.today)
  const recordedText = version ? read(version.file) : null
  const recorded = version && recordedText ? topLevel(recordedText, version.key) : null
  const tags = await source.tags(repo)

  let ref: string
  let tag: string | null = null
  if (recorded) {
    const applied = templateRef(recorded)
    ref = applied.ref
    tag = applied.tag
  } else {
    const branch = await source.defaultBranch(repo)
    if (!branch) return notCompared(`The template ${repo} could not be read`)
    ref = branch
  }

  const zip = await source.archive(repo, ref)
  if (!zip) return notCompared(`The template ${repo} at ${ref} could not be downloaded`)
  const name = repo.split('/')[1] as string
  const platform = contract ? pathMatcher(contract.owned) : baselineMatcher(input.baseline?.paths)
  const normalise = contract ? undefined : normaliser(appTokens([...input.names, name]))
  const keep = (path: string) => platform(normalise ? normalise(path) : path)
  const reference = unzipEntries(zip, keep).entries
  const app = unzipEntries(input.zip, keep).entries
  const result = compareFiles(app, reference, mode, normalise)

  const covered = exceptions.active.map((e) => pathMatcher([e.path]))
  const mark = (file: FamilyFile): FamilyFile =>
    covered.some((test) => test(file.path)) ? { ...file, excepted: true } : file
  const counts = {
    platform:
      result.identical +
      result.similar.length +
      result.modified.length +
      result.missing.length +
      result.extra.length,
    identical: result.identical,
    similar: result.similar.length,
    modified: result.modified.length,
    missing: result.missing.length,
    extra: result.extra.length,
  }
  const lists = [result.similar, result.modified, result.missing, result.extra]
  return ok({
    mode,
    source: { name: contract?.source.name ?? name, url },
    reference: { repo, ref },
    isReference: input.project.repo.toLowerCase() === repo.toLowerCase(),
    counts,
    identicalShare:
      counts.platform > 0 ? Math.round((counts.identical / counts.platform) * 1000) / 1000 : null,
    files: {
      similar: result.similar.slice(0, LISTED).map(mark),
      modified: result.modified.slice(0, LISTED).map(mark),
      missing: result.missing.slice(0, LISTED),
      extra: result.extra.slice(0, LISTED),
    },
    truncated: lists.some((list) => list.length > LISTED),
    exceptions,
    template: templateLag(tag, tags),
  })
}
