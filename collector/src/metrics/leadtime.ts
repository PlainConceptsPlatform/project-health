import { type CompareResult, type Deployment, type Issue, get, paginate } from '../github.ts'
import { distribution, hoursBetween } from '../stats.ts'
import {
  type LeadTime,
  type MetricBlock,
  type ProjectConfig,
  type Release,
  ok,
  skip,
} from '../types.ts'

const MAX_COMPARES = 40

/**
 * Change lead time in the DORA sense: how long a commit waits between being written and running
 * in production. Commits are attributed to the release that first carried them, found by
 * comparing each production release against the one before it.
 */
async function commitToProduction(
  project: ProjectConfig,
  history: Release[],
  windowReleases: Release[],
): Promise<MetricBlock<ReturnType<typeof distribution>>> {
  if (windowReleases.length === 0) {
    return skip('No production releases in this period.')
  }

  const hours: number[] = []
  const targets = windowReleases.slice(-MAX_COMPARES)

  for (const release of targets) {
    const index = history.findIndex((r) => r.sha === release.sha)
    const previous = index > 0 ? history[index - 1] : undefined
    if (!previous) continue

    const comparison = await get<CompareResult>(
      `/repos/${project.repo}/compare/${previous.sha}...${release.sha}`,
    )
    if (!comparison?.commits) continue

    for (const commit of comparison.commits) {
      const authored = commit.commit?.author?.date ?? commit.commit?.committer?.date
      if (!authored) continue
      const delta = hoursBetween(authored, release.deployedAt)
      if (delta >= 0) hours.push(delta)
    }
  }

  if (hours.length === 0) {
    return skip('No commits could be attributed to a production release in this period.')
  }
  return ok(distribution(hours))
}

/**
 * The internal flow measure the team asked for: how long an issue labelled "implement" takes to
 * reach the staging environment. This starts earlier and ends earlier than DORA change lead time,
 * so the two are reported separately and never mixed.
 */
async function issueToStaging(
  project: ProjectConfig,
  from: Date,
  to: Date,
): Promise<MetricBlock<ReturnType<typeof distribution>>> {
  const staging = project.environments.staging
  if (!staging) return skip('No staging environment configured.')

  // The label that marks shippable work differs per repository, so it is configuration. A project
  // without the convention reports that, rather than looking like it has no work.
  const label = project.workItemLabel === undefined ? 'implement' : project.workItemLabel
  if (!label) {
    return skip(
      `${project.name} has no work item label configured, so issue to staging is not measured.`,
    )
  }

  const since = new Date(from.getTime() - 90 * 24 * 3_600_000).toISOString()
  const issues = await paginate<Issue>(
    `/repos/${project.repo}/issues?labels=${encodeURIComponent(label)}&state=closed&since=${since}&per_page=100`,
  )
  const real = issues.filter((i) => !i.pull_request && i.closed_at)
  if (real.length === 0) return skip(`No closed issues labelled "${label}" in this period.`)

  const deployments = await paginate<Deployment>(
    `/repos/${project.repo}/deployments?environment=${encodeURIComponent(staging)}&per_page=100`,
  )
  const staged = deployments.map((d) => new Date(d.created_at).getTime()).sort((a, b) => a - b)
  if (staged.length === 0) return skip(`No ${staging} deployments to measure against.`)

  const hours: number[] = []
  for (const issue of real) {
    const closed = new Date(issue.closed_at as string).getTime()
    const reached = staged.find((t) => t >= closed)
    if (!reached) continue
    if (reached < from.getTime() || reached >= to.getTime()) continue
    hours.push((reached - new Date(issue.created_at).getTime()) / 3_600_000)
  }

  if (hours.length === 0) {
    return skip('No "implement" issue reached staging inside this period.')
  }
  return ok(distribution(hours))
}

export async function collectLeadTime(
  project: ProjectConfig,
  history: Release[],
  windowReleases: Release[],
  from: Date,
  to: Date,
): Promise<MetricBlock<LeadTime>> {
  const [commit, issue] = await Promise.all([
    commitToProduction(project, history, windowReleases),
    issueToStaging(project, from, to),
  ])

  if (!commit.available && !issue.available) {
    return skip(`${commit.reason} ${issue.reason}`)
  }
  return ok({ commitToProduction: commit, issueToStaging: issue })
}
