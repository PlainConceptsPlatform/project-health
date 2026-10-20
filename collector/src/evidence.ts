import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getBinary } from './github.ts'
import type { MonthlyReport } from './types.ts'

/** A screenshot as the evidence workflow links it: a file in a repository at a commit. */
const RAW = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/raw\/([^/]+)\/(.+)$/

/**
 * The same file on raw.githubusercontent.com, which answers a token. The github.com link needs a
 * browser session, and a browser does not send it for an image another site embeds, so a private
 * repository's screenshot never loads on the dashboard, even for someone who can read it.
 */
export function rawSource(image: string): string | null {
  const match = image.match(RAW)
  return match ? `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}` : null
}

/**
 * Where the copy goes, relative to the project's data folder and to the site root. Two plans in
 * one pull request can both have a 01-home.jpg, so the name carries a hash of the source.
 */
export function copyOf(
  project: string,
  pullRequest: number,
  image: string,
): { file: string; site: string } {
  const name = (image.split('/').at(-1) ?? 'screenshot').replace(/[^A-Za-z0-9._-]/g, '_')
  const key = createHash('sha1').update(image).digest('hex').slice(0, 8)
  const path = `pr-${pullRequest}/${key}-${name}`
  return { file: `evidence/${path}`, site: `evidence/${project}/${path}` }
}

/**
 * Copies every evidence screenshot of a project's months into its data folder, once, and records
 * the copy on the waypoint. The site is private to the same people, so serving the copy from it
 * shows the screenshot to everyone who can open the dashboard. Every month is read, not only the
 * collected one, so months collected before copies existed get theirs on the next run.
 */
export async function copyEvidence(
  dir: string,
  project: string,
  fetchImage: (url: string) => Promise<Uint8Array | null> = getBinary,
): Promise<number> {
  let copied = 0
  const months = existsSync(dir)
    ? readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
    : []
  for (const month of months) {
    const path = join(dir, month)
    const report = JSON.parse(readFileSync(path, 'utf8')) as MonthlyReport
    if (!report.roadmap?.available) continue
    let changed = false
    for (const issue of report.roadmap.data.issues) {
      const evidence = issue.evidence
      if (!evidence) continue
      for (const waypoint of evidence.waypoints) {
        if (!waypoint.image) continue
        const source = rawSource(waypoint.image)
        if (!source) continue
        const target = copyOf(project, evidence.pullRequest, waypoint.image)
        const local = join(dir, target.file)
        if (!existsSync(local)) {
          const bytes = await fetchImage(source)
          if (!bytes) continue
          mkdirSync(dirname(local), { recursive: true })
          writeFileSync(local, bytes)
          copied += 1
        }
        if (waypoint.copy !== target.site) {
          waypoint.copy = target.site
          changed = true
        }
      }
    }
    if (changed) writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
  }
  return copied
}
