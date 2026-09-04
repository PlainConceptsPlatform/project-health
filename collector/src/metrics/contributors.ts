import { type Issue, paginate } from '../github.ts'
import { type MetricBlock, type ProjectConfig, type Release, ok, skip } from '../types.ts'

export interface Contributor {
  login: string
  count: number
  bot: boolean
}

export interface Contributors {
  /** Who opened the work, from issues labelled implement. */
  requesters: Contributor[]
  /** Who released to production, from the deployment creator. */
  deployers: Contributor[]
}

const isBot = (login: string) => login.endsWith('[bot]') || login.endsWith('-bot')

const tally = (logins: (string | null | undefined)[]): Contributor[] => {
  const counts = new Map<string, number>()
  for (const login of logins) {
    if (!login) continue
    counts.set(login, (counts.get(login) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([login, count]) => ({ login, count, bot: isBot(login) }))
    .sort((a, b) => b.count - a.count || a.login.localeCompare(b.login))
}

/**
 * Who is involved, as far as GitHub can say.
 *
 * Deliberately not included: the actor on an agent run. Every agent run is triggered by the bot
 * App, so a chart of it would have exactly one bar and say nothing. The two signals that carry
 * information are who opened the work and who released it.
 */
export async function collectContributors(
  project: ProjectConfig,
  releases: Release[],
  from: Date,
  to: Date,
): Promise<MetricBlock<Contributors>> {
  const label = project.workItemLabel === undefined ? 'implement' : project.workItemLabel
  const since = new Date(from.getTime() - 30 * 24 * 3_600_000).toISOString()
  const issues = label
    ? await paginate<Issue & { user?: { login: string } }>(
        `/repos/${project.repo}/issues?labels=${encodeURIComponent(label)}&state=all&since=${since}&per_page=100`,
      )
    : []

  const requesters = tally(
    issues
      .filter((i) => !i.pull_request)
      .filter((i) => {
        const at = new Date(i.created_at)
        return at >= from && at < to
      })
      .map((i) => i.user?.login),
  )

  const deployers = tally(releases.map((r) => r.deployedBy))

  if (requesters.length === 0 && deployers.length === 0) {
    return skip(
      label
        ? 'No issues were opened and no releases were cut in this period.'
        : `${project.name} has no work item label configured, and no releases were cut in this period.`,
    )
  }
  return ok({ requesters, deployers })
}
