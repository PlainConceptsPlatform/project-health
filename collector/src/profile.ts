import type { DoraConfig } from './config.ts'
import {
  type DeploymentFrequency,
  type LeadTime,
  type MetricBlock,
  type Placement,
  type ProjectConfig,
  type ReworkRate,
  ok,
  skip,
} from './types.ts'

type Band = 'high' | 'medium' | 'low' | 'unknown'

const worst = (a: Band, b: Band): Band => {
  const order: Band[] = ['low', 'medium', 'high']
  if (a === 'unknown') return b
  if (b === 'unknown') return a
  return order.indexOf(a) <= order.indexOf(b) ? a : b
}

const bandByDescending = (value: number, edges: { high: number; medium: number }): Band =>
  value >= edges.high ? 'high' : value >= edges.medium ? 'medium' : 'low'

const bandByAscending = (value: number, edges: { high: number; medium: number }): Band =>
  value <= edges.high ? 'high' : value <= edges.medium ? 'medium' : 'low'

/**
 * Places a project on the axes the 2025 DORA profiles are built from.
 *
 * Only two of the three axes can come from GitHub. Team well being is measured by survey, so it
 * stays unknown and the result is the set of profiles consistent with what is known rather than a
 * single label. Reporting one profile would imply evidence that does not exist.
 *
 * Profiles are scored rather than filtered. The seven archetypes do not cover every combination of
 * throughput and stability, so requiring an exact match on both silently returns nothing for real
 * measurements such as high throughput with low stability. Scoring always returns the closest
 * profiles and says whether the match was exact.
 */
export function placeProject(
  dora: DoraConfig,
  project: ProjectConfig,
  frequency: MetricBlock<DeploymentFrequency>,
  leadTime: MetricBlock<LeadTime>,
  rework: MetricBlock<ReworkRate>,
): MetricBlock<Placement> {
  let throughput: Band = 'unknown'

  if (frequency.available) {
    if (frequency.data.count < dora.minimumSampleSize) {
      return skip(
        `Only ${frequency.data.count} release(s) in this period, below the minimum sample of ${dora.minimumSampleSize}. A placement on this little data would be noise.`,
      )
    }
    throughput = bandByDescending(frequency.data.perWeek, dora.throughput.deploymentsPerWeek)
  }

  if (leadTime.available && leadTime.data.commitToProduction.available) {
    const p50 = leadTime.data.commitToProduction.data.p50Hours
    throughput = worst(throughput, bandByAscending(p50, dora.throughput.leadTimeHoursP50))
  }

  // A broad rework marker measures "releases that carried a bug fix", which is not the same thing
  // as DORA instability. Letting it drive the stability axis would classify a busy, well maintained
  // application as unstable purely because it tickets its bugs, so a broad marker is reported but
  // not used for placement.
  const precise = (project.reworkLabelPrecision ?? 'broad') === 'incident'
  let stability: Band = 'unknown'
  let stabilityNote = ''

  if (!rework.available || rework.data.confidence === 'none') {
    stabilityNote = 'Stability is unmeasured because no release carries a rework marker yet.'
  } else if (!precise) {
    stabilityNote = `Rework rate is measured from the ${rework.data.label ?? 'configured'} label, which covers planned fixes as well as reactions to incidents. It is reported but not used to place the project, because a broad marker would read as instability. Set reworkLabelPrecision to "incident" once a marker means only unplanned production fixes.`
  } else {
    stability = bandByAscending(rework.data.rate, {
      high: dora.stability.reworkRate.high,
      medium: dora.stability.reworkRate.medium,
    })
  }

  if (throughput === 'unknown' && stability === 'unknown') {
    return skip(`Throughput could not be measured for this period. ${stabilityNote}`.trim())
  }

  const known = (throughput === 'unknown' ? 0 : 1) + (stability === 'unknown' ? 0 : 1)
  const scored = dora.profiles.map((p) => ({
    profile: p,
    score:
      (throughput !== 'unknown' && p.throughput === throughput ? 1 : 0) +
      (stability !== 'unknown' && p.stability === stability ? 1 : 0),
  }))
  const best = Math.max(...scored.map((s) => s.score))
  const candidates = scored
    .filter((s) => s.score === best && best > 0)
    .map((s) => ({ id: s.profile.id, name: s.profile.name }))

  const exact = best === known && candidates.length > 0

  const note = [
    exact
      ? 'Well being is measured by survey and cannot come from GitHub, so the result is the set of profiles consistent with the measured axes.'
      : candidates.length > 0
        ? 'No archetype matches this combination of throughput and stability exactly, so these are the closest.'
        : 'No archetype is close to this combination.',
    stabilityNote,
  ]
    .filter(Boolean)
    .join(' ')

  return ok({
    throughput,
    stability,
    wellbeing: 'unknown',
    exact,
    candidateProfiles: candidates,
    note,
  })
}
