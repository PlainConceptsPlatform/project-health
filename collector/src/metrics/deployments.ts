import { hoursBetween, median } from '../stats.ts'
import {
  type DeploymentFrequency,
  type MetricBlock,
  type ProjectConfig,
  type Release,
  type Warning,
  ok,
  skip,
} from '../types.ts'
import type { ReleaseHistory } from './releases.ts'

const semver = (ref: string): [number, number, number] | null => {
  const m = ref.match(/^v?(\d+)\.(\d+)\.(\d+)$/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

const compareSemver = (a: [number, number, number], b: [number, number, number]): number =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

export interface FrequencyResult {
  block: MetricBlock<DeploymentFrequency>
  warnings: Warning[]
}

export function computeDeploymentFrequency(
  project: ProjectConfig,
  history: ReleaseHistory,
  windowReleases: Release[],
  from: Date,
  to: Date,
  /** Injectable so the partial period behaviour is testable. */
  now: number = Date.now(),
): FrequencyResult {
  const warnings: Warning[] = []
  const environment = project.environments.production as string

  if (windowReleases.length === 0) {
    return {
      block: skip(`No releases reached ${environment} in this period.`),
      warnings: [
        {
          code: 'NO_PRODUCTION_DEPLOYMENTS',
          message: `${project.name} recorded no ${environment} releases in this period.`,
        },
      ],
    }
  }

  const shas = new Set(windowReleases.map((r) => r.sha))
  const rawInWindow = history.releases
    .filter((r) => shas.has(r.sha))
    .reduce((total, r) => total + r.deploymentIds.length, 0)

  if (rawInWindow > windowReleases.length * 1.5) {
    warnings.push({
      code: 'DUPLICATE_DEPLOYMENT_OBJECTS',
      message: `${project.name} created ${rawInWindow} deployment records for ${windowReleases.length} distinct releases. Frequency counts releases, so the extra records do not inflate it.`,
      context: { records: rawInWindow, releases: windowReleases.length },
    })
  }

  const outOfProcess = windowReleases.filter((r) => r.outOfProcess)
  if (outOfProcess.length > 0) {
    warnings.push({
      code: 'NON_TAG_PRODUCTION_REF',
      message: `${outOfProcess.length} release(s) reached ${environment} from a ref that is not a tag (${[...new Set(outOfProcess.map((r) => r.ref))].join(', ')}), bypassing the normal release path.`,
      context: { count: outOfProcess.length },
    })
  }

  const versions = windowReleases
    .map((r) => semver(r.ref))
    .filter((v): v is [number, number, number] => v !== null)

  for (let i = 1; i < versions.length; i += 1) {
    const previous = versions[i - 1] as [number, number, number]
    const current = versions[i] as [number, number, number]
    if (compareSemver(current, previous) < 0) {
      warnings.push({
        code: 'ROLLBACK_DETECTED',
        message: `Version ${previous.join('.')} was followed by the older ${current.join('.')} on ${environment}. Redeploying an earlier version is a direct signal of a failed deployment.`,
        context: { previous: previous.join('.'), current: current.join('.') },
      })
    } else if (
      current[0] === previous[0] &&
      current[1] === previous[1] &&
      current[2] > previous[2] + 1
    ) {
      warnings.push({
        code: 'SKIPPED_TAG',
        message: `Version ${current.join('.')} followed ${previous.join('.')} without the versions between them reaching ${environment}.`,
        context: { previous: previous.join('.'), current: current.join('.') },
      })
    }
  }

  const intervals: number[] = []
  for (let i = 1; i < windowReleases.length; i += 1) {
    intervals.push(
      hoursBetween(
        (windowReleases[i - 1] as Release).deployedAt,
        (windowReleases[i] as Release).deployedAt,
      ),
    )
  }

  // A month in progress must not be divided by days that have not happened. Dividing nine releases
  // in twenty elapsed days by a full thirty one day month reports 2.03 a week instead of 3.15.
  const effectiveEnd = Math.min(to.getTime(), now)
  const elapsedMs = Math.max(effectiveEnd - from.getTime(), 24 * 3_600_000)
  const weeks = elapsedMs / (7 * 24 * 3_600_000)
  const partialMonth = now < to.getTime()

  return {
    block: ok({
      partialMonth,
      elapsedDays: Math.round(elapsedMs / (24 * 3_600_000)),
      releases: windowReleases,
      count: windowReleases.length,
      rawObjectCount: rawInWindow,
      perWeek: Math.round((windowReleases.length / weeks) * 100) / 100,
      medianIntervalHours: median(intervals),
    }),
    warnings,
  }
}
