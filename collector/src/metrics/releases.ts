import { type Deployment, paginate } from '../github.ts'
import type { ProjectConfig, Release } from '../types.ts'

export interface ReleaseHistory {
  releases: Release[]
  rawObjectCount: number
}

/**
 * Builds the full ordered release history for an environment.
 *
 * A release is a distinct commit SHA, not a deployment record. Repositories that fan a single
 * release out into several deployment objects would otherwise inflate every count derived from
 * this list. The earliest record for a SHA is treated as the moment it reached the environment.
 */
export async function fetchReleaseHistory(
  project: ProjectConfig,
  environment: string,
): Promise<ReleaseHistory> {
  const records = await paginate<Deployment>(
    `/repos/${project.repo}/deployments?environment=${encodeURIComponent(environment)}&per_page=100`,
  )
  return groupIntoReleases(records, new RegExp(project.productionRefPattern))
}

/**
 * Collapses deployment records into releases. Pure, so the two behaviours that were wrong at first
 * can be tested directly: one release per commit rather than per record, and the tag preferred over
 * a branch name when the same commit arrived under both.
 */
export function groupIntoReleases(records: Deployment[], pattern: RegExp): ReleaseHistory {
  const bySha = new Map<string, Deployment[]>()
  for (const record of records) {
    const list = bySha.get(record.sha) ?? []
    list.push(record)
    bySha.set(record.sha, list)
  }

  const releases = [...bySha.entries()]
    .map(([sha, group]) => {
      const sorted = [...group].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      )
      const first = sorted[0] as Deployment

      // A commit can reach the environment more than once under different refs, for example when
      // main is deployed and the same commit is then tagged. The earliest record is when it
      // arrived, but the tag is the better name for it, so the two are chosen separately.
      const tagged = sorted.find((r) => pattern.test(r.ref))
      const ref = tagged?.ref ?? first.ref

      return {
        ref,
        sha,
        deployedAt: first.created_at,
        deployedBy: first.creator?.login ?? null,
        deploymentIds: sorted.map((r) => r.id),
        outOfProcess: !pattern.test(ref),
        unplanned: false,
        unplannedSource: null,
      } satisfies Release
    })
    .sort((a, b) => new Date(a.deployedAt).getTime() - new Date(b.deployedAt).getTime())

  return { releases, rawObjectCount: records.length }
}

export const withinWindow = (releases: Release[], from: Date, to: Date): Release[] =>
  releases.filter((r) => {
    const at = new Date(r.deployedAt)
    return at >= from && at < to
  })
