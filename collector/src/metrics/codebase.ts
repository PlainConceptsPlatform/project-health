import { unzipSync } from 'fflate'
import { get, getBinary } from '../github.ts'
import {
  type BotAdditions,
  type CodeHotspot,
  type Codebase,
  type MetricBlock,
  ok,
  skip,
} from '../types.ts'
import {
  SLOP_RULES,
  commentHeuristics,
  countLines,
  isGenerated,
  kindOf,
  scenarioCount,
  slopFindings,
  testStats,
} from './code-rules.ts'

export interface SourceFile {
  path: string
  text: string
}

const MAX_FILE_BYTES = 1_500_000
const HOTSPOTS = 10

const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null)

export function scanFiles(files: SourceFile[], branch: string, sha: string | null): Codebase {
  const byRule: Record<string, number> = Object.fromEntries(SLOP_RULES.map((r) => [r, 0]))
  const heuristics = { history: 0, essay: 0, internalDoc: 0 }
  const suspicious = { skipped: 0, focused: 0, snapshot: 0, noAssertion: 0, mockOnly: 0 }
  const counts = { source: 0, test: 0, generated: 0 }
  let codeLines = 0
  let commentLines = 0
  let slop = 0
  let testLines = 0
  let testComments = 0
  let cases = 0
  let features = 0
  let scenarios = 0
  const hotspots: CodeHotspot[] = []

  for (const file of files) {
    const kind = kindOf(file.path)
    if (!kind) continue
    if (kind === 'feature') {
      features += 1
      scenarios += scenarioCount(file.text)
      continue
    }
    if (isGenerated(file.text)) {
      counts.generated += 1
      continue
    }
    const lines = countLines(file.text)
    if (kind === 'test') {
      counts.test += 1
      testLines += lines.codeLines
      testComments += lines.commentLines
      const t = testStats(file.path, file.text)
      cases += t.cases
      suspicious.skipped += t.skipped
      suspicious.focused += t.focused
      suspicious.snapshot += t.snapshot
      suspicious.noAssertion += t.noAssertion
      suspicious.mockOnly += t.mockOnly
      continue
    }
    counts.source += 1
    codeLines += lines.codeLines
    commentLines += lines.commentLines
    const findings = slopFindings(file.text)
    for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1
    slop += findings.length
    const h = commentHeuristics(file.text)
    heuristics.history += h.history
    heuristics.essay += h.essay
    heuristics.internalDoc += h.internalDoc
    if (lines.commentLines > 0) {
      hotspots.push({ path: file.path, ...lines, slop: findings.length })
    }
  }

  return {
    branch,
    sha,
    files: counts,
    comments: {
      codeLines,
      commentLines,
      density: ratio(commentLines, codeLines),
      slop: { findings: slop, byRule },
      heuristics,
    },
    tests: {
      files: counts.test,
      lines: testLines,
      commentLines: testComments,
      cases,
      ratio: ratio(testLines, codeLines),
      casesPerKloc: codeLines > 0 ? Math.round((cases / codeLines) * 10_000) / 10 : null,
      features,
      scenarios,
      suspicious,
    },
    hotspots: hotspots.sort((a, b) => b.commentLines - a.commentLines).slice(0, HOTSPOTS),
  }
}

/**
 * The files of a zipball that `keep` accepts, by their path in the repository. A zipball nests
 * everything under `<owner>-<repo>-<short sha>/`, which is stripped here and read as the sha.
 */
export function unzipEntries(
  zip: Uint8Array,
  keep: (path: string) => boolean,
): { entries: Map<string, Uint8Array>; sha: string | null } {
  const strip = (name: string) => name.slice(name.indexOf('/') + 1)
  let root: string | null = null
  const unzipped = unzipSync(zip, {
    filter: (f) => {
      root ??= f.name.slice(0, f.name.indexOf('/'))
      const path = strip(f.name)
      return path !== '' && !path.endsWith('/') && f.originalSize <= MAX_FILE_BYTES && keep(path)
    },
  })
  const entries = new Map(Object.entries(unzipped).map(([name, bytes]) => [strip(name), bytes]))
  const sha = (root as string | null)?.split('-').at(-1) ?? null
  return { entries, sha }
}

export function unpackZipball(zip: Uint8Array): { files: SourceFile[]; sha: string | null } {
  const { entries, sha } = unzipEntries(zip, (path) => kindOf(path) !== null)
  const decoder = new TextDecoder('utf-8')
  const files = [...entries].map(([path, bytes]) => ({
    path,
    text: decoder.decode(bytes).replace(/^﻿/, '').replace(/\r\n/g, '\n'),
  }))
  return { files, sha }
}

export interface SourceArchive {
  branch: string
  zip: Uint8Array
}

/** Archives another scan compares against, kept for the run so each is downloaded only once. */
const sharedArchives = new Map<string, Promise<Uint8Array | null>>()

/**
 * The zipball of a ref. A shared one is kept for the rest of the run: the family reference is
 * compared against every member, and is itself scanned as a project.
 */
export function downloadArchive(
  repo: string,
  ref: string,
  share = false,
): Promise<Uint8Array | null> {
  const key = `${repo.toLowerCase()}@${ref}`
  const cached = sharedArchives.get(key)
  if (cached) return cached
  const load = getBinary(`/repos/${repo}/zipball/${encodeURIComponent(ref)}`)
  if (share) sharedArchives.set(key, load)
  return load
}

/** The default branch's source, downloaded once for every scan that reads it. */
export async function sourceArchive(
  repo: string,
  share = false,
): Promise<MetricBlock<SourceArchive>> {
  const branch = (await get<{ default_branch: string }>(`/repos/${repo}`))?.default_branch
  if (!branch) return skip('The repository could not be read, so its source was not scanned.')
  const zip = await downloadArchive(repo, branch, share)
  if (!zip) return skip('The source archive of the default branch could not be downloaded.')
  return ok({ branch, zip })
}

export function codebaseOf(archive: SourceArchive): Codebase {
  const { files, sha } = unpackZipball(archive.zip)
  return scanFiles(files, archive.branch, sha)
}

export interface PatchFile {
  filename: string
  patch?: string
}

export function patchAdditions(files: PatchFile[]): Omit<BotAdditions, 'pullRequests'> {
  const added = { codeLines: 0, commentLines: 0, testLines: 0, testCases: 0, slop: 0 }
  for (const file of files) {
    const kind = kindOf(file.filename)
    if (!file.patch || (kind !== 'source' && kind !== 'test')) continue
    const text = file.patch
      .split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      .map((l) => l.slice(1))
      .join('\n')
    const lines = countLines(text)
    if (kind === 'test') {
      added.testLines += lines.codeLines
      added.testCases += testStats(file.filename, text).cases
    } else {
      added.codeLines += lines.codeLines
      added.commentLines += lines.commentLines
      added.slop += slopFindings(text).length
    }
  }
  return added
}
