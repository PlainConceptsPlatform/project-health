import { type Issue, paginate } from '../github.ts'
import {
  type MetricBlock,
  type ProjectConfig,
  type Release,
  type ReworkRate,
  ok,
  skip,
} from '../types.ts'

type Labelled = Issue & { pull_request?: { merged_at?: string | null } }

/**
 * Deployment rework rate: the share of production releases that shipped in reaction to a problem
 * rather than as planned work.
 *
 * The marker is a configurable label, read from both sides of the workflow because teams put it in
 * different places. Some label the pull request that carries the fix, where the moment that matters
 * is when it merged. Others label the issue that reported the problem and let the bot open the pull
 * request, where the moment that matters is when the issue closed. The second is easy to miss: a
 * repository can have dozens of labelled issues and not one labelled pull request, and reading only
 * pull requests would then report zero rework forever.
 *
 * Either way the marker is attributed to the first production release that shipped after it, and a
 * single release absorbs every marker that landed before it rather than being counted repeatedly.
 *
 * Releases that reached production from a non-tag ref are reported separately rather than folded in
 * here. Being out of process is suggestive but is not the same as reacting to an incident.
 */
export async function collectRework(
  project: ProjectConfig,
  windowReleases: Release[],
  from: Date,
  to: Date,
): Promise<MetricBlock<ReworkRate>> {
  if (windowReleases.length === 0) {
    return skip('No production releases in this period, so there is nothing to classify.')
  }

  const label = project.reworkLabel ?? 'hotfix'
  const labelled = await paginate<Labelled>(
    `/repos/${project.repo}/issues?labels=${encodeURIComponent(label)}&state=closed&per_page=100`,
  )

  // A closed pull request is not necessarily a merged one, and an unclosed issue is not yet fixed.
  // Markers are scoped to the period. Without this, every marker ever closed attributes to the
  // first release in the window, so a repository with a long bug history reports its first release
  // of every month as unplanned and nothing else.
  const moments = labelled
    .map((item) =>
      item.pull_request ? (item.pull_request.merged_at ?? null) : (item.closed_at ?? null),
    )
    .filter((at): at is string => at !== null)
    .map((at) => new Date(at).getTime())
    .filter((at) => at >= from.getTime() && at < to.getTime())

  if (moments.length === 0) {
    return ok({ label, unplanned: 0, total: windowReleases.length, rate: 0, confidence: 'none' })
  }

  const marked = attributeMarkers(moments, windowReleases)

  for (const release of windowReleases) {
    if (marked.has(release.sha)) {
      release.unplanned = true
      release.unplannedSource = 'label'
    }
  }

  return ok({
    label,
    unplanned: marked.size,
    total: windowReleases.length,
    rate: Math.round((marked.size / windowReleases.length) * 1000) / 1000,
    confidence: 'marked',
  })
}

/**
 * Attributes each marker to the first release that shipped after it, returning the set of release
 * commits that carried at least one. Pure, because the first version of this quietly gave every
 * marker in history to the first release in the window.
 */
export function attributeMarkers(moments: number[], releases: Release[]): Set<string> {
  const marked = new Set<string>()
  for (const at of moments) {
    const carrier = releases.find((r) => new Date(r.deployedAt).getTime() >= at)
    if (carrier) marked.add(carrier.sha)
  }
  return marked
}
