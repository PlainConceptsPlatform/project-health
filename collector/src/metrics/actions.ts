import { get, paginate } from '../github.ts'
import {
  type ActionsMinutes,
  type ActionsStorage,
  type ActionsUsage,
  type MetricBlock,
  ok,
  skip,
} from '../types.ts'

export interface CacheUsage {
  active_caches_size_in_bytes: number
  active_caches_count: number
}

export interface StoredArtifact {
  id: number
  size_in_bytes: number
  expired: boolean
}

export interface RunListing {
  id: number
  status: string
  created_at: string
}

/** GET /actions/runs/{id}/timing. `billable` is empty for public repositories and self-hosted runners. */
export interface RunTiming {
  billable?: Record<
    string,
    { total_ms?: number; jobs?: number; job_runs?: { job_id: number; duration_ms: number }[] }
  >
  run_duration_ms?: number
}

/** One line of the enhanced billing usage report, per day, product, SKU and repository. */
export interface BillingUsageItem {
  product: string
  sku: string
  unitType: string
  quantity: number
  repositoryName?: string | null
  organizationName?: string | null
}

export interface ActionsSource {
  /**
   * The billing usage report lines of this repository for one month (1 to 12), or null when the
   * report is not readable with this token. Optional: without it minutes are timed run by run.
   */
  billingUsage?: (year: number, month: number) => Promise<BillingUsageItem[] | null>
  /** null when the endpoint answers 404. */
  cacheUsage: () => Promise<CacheUsage | null>
  /** Every artifact the repository keeps, expired ones included. */
  artifacts: () => Promise<{ artifacts: StoredArtifact[]; truncated: boolean }>
  /** Runs created on one UTC day, given as YYYY-MM-DD. */
  runsOn: (day: string) => Promise<{ runs: RunListing[]; truncated: boolean }>
  /** null when the run is gone or its timing is not readable. */
  timing: (runId: number) => Promise<RunTiming | null>
}

/** The list endpoints return at most 1,000 results for a date filter, which is ten pages of 100. */
const RUNS_PAGES_PER_DAY = 10
const ARTIFACT_PAGES = 50
const PER_PAGE = 100

/**
 * The report covers a whole organization, so it is read once per organization and month and shared
 * by every project in it. A failure is remembered too, so a token without billing access is refused
 * once per organization rather than once per project.
 */
const billingReports = new Map<string, Promise<BillingUsageItem[] | null>>()

function billingReport(org: string, year: number, month: number) {
  const key = `${org.toLowerCase()}:${year}-${month}`
  let report = billingReports.get(key)
  if (!report) {
    report = get<{ usageItems?: BillingUsageItem[] }>(
      `/organizations/${org}/settings/billing/usage?year=${year}&month=${month}`,
    ).then((body) => (body ? (body.usageItems ?? []) : null))
    billingReports.set(key, report)
  }
  return report
}

export function githubActionsSource(repo: string): ActionsSource {
  const [org = '', name = ''] = repo.split('/')
  return {
    billingUsage: async (year, month) => {
      const items = await billingReport(org, year, month)
      if (!items) return null
      return items.filter(
        (item) =>
          item.repositoryName?.toLowerCase() === name.toLowerCase() &&
          (!item.organizationName || item.organizationName.toLowerCase() === org.toLowerCase()),
      )
    },
    cacheUsage: () => get<CacheUsage>(`/repos/${repo}/actions/cache/usage`),
    artifacts: async () => {
      const artifacts = await paginate<StoredArtifact>(
        `/repos/${repo}/actions/artifacts?per_page=${PER_PAGE}`,
        ARTIFACT_PAGES,
      )
      return { artifacts, truncated: artifacts.length >= ARTIFACT_PAGES * PER_PAGE }
    },
    runsOn: async (day) => {
      const runs = await paginate<RunListing>(
        `/repos/${repo}/actions/runs?created=${day}&per_page=${PER_PAGE}`,
        RUNS_PAGES_PER_DAY,
      )
      return { runs, truncated: runs.length >= RUNS_PAGES_PER_DAY * PER_PAGE }
    },
    timing: (runId) => get<RunTiming>(`/repos/${repo}/actions/runs/${runId}/timing`),
  }
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Cache and artifact bytes as they are now. Either half may fail on its own and is then null, so a
 * token that can list artifacts but not caches still shows the artifacts.
 */
export async function collectStorage(
  source: ActionsSource,
  now: Date,
): Promise<MetricBlock<ActionsStorage>> {
  const problems: string[] = []

  let cache: ActionsStorage['cache'] = null
  try {
    const usage = await source.cacheUsage()
    if (usage) {
      cache = { bytes: usage.active_caches_size_in_bytes, count: usage.active_caches_count }
    } else {
      problems.push('cache usage answered 404 (needs Actions read)')
    }
  } catch (error) {
    problems.push(`cache usage failed: ${reasonOf(error)}`)
  }

  let artifacts: ActionsStorage['artifacts'] = null
  try {
    const listed = await source.artifacts()
    const live = listed.artifacts.filter((a) => !a.expired)
    artifacts = {
      bytes: live.reduce((sum, a) => sum + (a.size_in_bytes ?? 0), 0),
      count: live.length,
      truncated: listed.truncated,
    }
  } catch (error) {
    problems.push(`artifact list failed: ${reasonOf(error)}`)
  }

  if (!cache && !artifacts) {
    return skip(`Actions storage could not be read: ${problems.join('; ')}.`)
  }
  return ok({
    measuredAt: now.toISOString(),
    cache,
    artifacts,
    totalBytes: (cache?.bytes ?? 0) + (artifacts?.bytes ?? 0),
  })
}

/**
 * Billable minutes of one run, by runner OS. GitHub rounds every job up to the whole minute, so the
 * job durations are rounded one by one; a timing without job detail falls back to its total.
 */
export function billableMinutes(timing: RunTiming): Record<string, number> {
  const byOs: Record<string, number> = {}
  for (const [os, usage] of Object.entries(timing.billable ?? {})) {
    const jobs = usage.job_runs ?? []
    const minutes =
      jobs.length > 0
        ? jobs.reduce((sum, job) => sum + Math.ceil((job.duration_ms ?? 0) / 60_000), 0)
        : Math.ceil((usage.total_ms ?? 0) / 60_000)
    if (minutes > 0) byOs[os] = (byOs[os] ?? 0) + minutes
  }
  return byOs
}

/** Each UTC day of [from, to) that has started by `now`, as YYYY-MM-DD. */
export function daysBetween(from: Date, to: Date, now: Date): string[] {
  const days: string[] = []
  const end = Math.min(to.getTime(), now.getTime())
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  for (let t = start; t < end; t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10))
  return days
}

/**
 * The runner OS a billing SKU is charged for, named as the timing endpoint names it, so both sources
 * fill the same split. "Actions Linux", "Actions Linux Advanced 2-core" and "Actions Linux Slim" are
 * all UBUNTU; a SKU that names no known OS is kept under its own name rather than dropped.
 */
export function osOfSku(sku: string): string {
  const s = sku.toLowerCase()
  if (s.includes('linux') || s.includes('ubuntu')) return 'UBUNTU'
  if (s.includes('windows')) return 'WINDOWS'
  if (s.includes('macos') || s.includes('mac os')) return 'MACOS'
  return sku
}

/** Actions minutes of the report lines, by runner OS. Storage and other products are left out. */
export function billedMinutesByOs(items: BillingUsageItem[]): Record<string, number> {
  const byOs: Record<string, number> = {}
  for (const item of items) {
    if (item.product.toLowerCase() !== 'actions') continue
    if (item.unitType.toLowerCase() !== 'minutes') continue
    const os = osOfSku(item.sku)
    byOs[os] = (byOs[os] ?? 0) + (item.quantity ?? 0)
  }
  const rounded: Record<string, number> = {}
  for (const [os, minutes] of Object.entries(byOs)) {
    if (Math.round(minutes) > 0) rounded[os] = Math.round(minutes)
  }
  return rounded
}

/**
 * Billable minutes for the month from the organization's billing usage report: one call for every
 * repository of the organization, against one call per run for the timing path. null when the report
 * cannot be read (a token without billing access answers 403 or 404), so the caller falls back.
 */
export async function collectBilledMinutes(
  source: ActionsSource,
  period: { from: Date; now: Date },
): Promise<ActionsMinutes | null> {
  if (!source.billingUsage) return null
  let items: BillingUsageItem[] | null
  try {
    items = await source.billingUsage(period.from.getUTCFullYear(), period.from.getUTCMonth() + 1)
  } catch {
    return null
  }
  if (!items) return null
  const byOs = billedMinutesByOs(items)
  return {
    source: 'billing',
    total: Object.values(byOs).reduce((sum, m) => sum + m, 0),
    byOs,
    runs: 0,
    timed: 0,
    pending: 0,
    truncated: false,
    measuredAt: period.now.toISOString(),
    countedBefore: null,
    countedIds: [],
  }
}

/** How many run timings one collection reads per project and month. The rest wait for the next. */
export const TIMING_BUDGET = 1500

/**
 * Billable minutes for the runs created in the period, summed from each run's timing.
 *
 * A month can hold thousands of runs and each needs its own call, so the count is incremental: the
 * stored month says which runs were already counted and only new, completed runs are timed. A run
 * still in progress is left for a later collection rather than counted short. A month that was
 * complete when it was last read is returned as stored, without listing anything.
 */
export async function collectMinutes(
  source: ActionsSource,
  period: { from: Date; to: Date; now: Date },
  previous: ActionsMinutes | null,
  budget = TIMING_BUDGET,
): Promise<MetricBlock<ActionsMinutes>> {
  if (previous && previous.pending === 0 && new Date(previous.measuredAt) >= period.to) {
    return ok(previous)
  }

  const since = previous?.countedBefore ? new Date(previous.countedBefore) : period.from
  const counted = new Set(previous?.countedIds ?? [])
  const byOs: Record<string, number> = { ...(previous?.byOs ?? {}) }
  let runs = previous?.runs ?? 0
  let timed = previous?.timed ?? 0
  let truncated = previous?.truncated ?? false

  const listed: RunListing[] = []
  for (const day of daysBetween(since, period.to, period.now)) {
    const page = await source.runsOn(day)
    listed.push(...page.runs)
    if (page.truncated) truncated = true
  }

  const fresh = listed
    .filter((run) => {
      const created = new Date(run.created_at)
      return created >= since && created >= period.from && created < period.to
    })
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)

  let remaining = budget
  const pending: RunListing[] = []
  const countedNow: RunListing[] = []
  for (const run of fresh) {
    if (counted.has(run.id)) {
      countedNow.push(run)
      continue
    }
    if (run.status !== 'completed' || remaining <= 0) {
      pending.push(run)
      continue
    }
    remaining -= 1
    let timing: RunTiming | null = null
    try {
      timing = await source.timing(run.id)
    } catch {
      // A run whose timing cannot be read is counted as seen without minutes, so it is not retried
      // forever; `timed` below `runs` says the total is a floor.
      timing = null
    }
    runs += 1
    if (timing) {
      timed += 1
      for (const [os, minutes] of Object.entries(billableMinutes(timing))) {
        byOs[os] = (byOs[os] ?? 0) + minutes
      }
    }
    countedNow.push(run)
  }

  // Everything created before the oldest uncounted run is done. Without one, the newest run seen
  // is the boundary, kept inclusive with its id so a run created in the same second is not lost.
  const boundary = pending[0]?.created_at ?? fresh.at(-1)?.created_at ?? previous?.countedBefore
  const countedBefore = boundary ?? null
  const countedIds = countedBefore
    ? countedNow.filter((r) => r.created_at >= countedBefore).map((r) => r.id)
    : []

  return ok({
    source: 'timing',
    total: Object.values(byOs).reduce((sum, m) => sum + m, 0),
    byOs,
    runs,
    timed,
    pending: pending.length,
    truncated,
    measuredAt: period.now.toISOString(),
    countedBefore,
    countedIds,
  })
}

/**
 * Minutes and storage for one project and month. Minutes come from the billing usage report when the
 * token can read it, and are otherwise timed run by run. Storage only exists as it is now, so a month that
 * is not current keeps what was stored while it was, and says so when nothing was.
 */
export async function collectActions(
  source: ActionsSource,
  period: { from: Date; to: Date; now: Date },
  previous: ActionsUsage | null,
): Promise<ActionsUsage> {
  const stored = previous?.minutes.available ? previous.minutes : null
  const billedBefore = stored?.data.source === 'billing'
  let minutes: MetricBlock<ActionsMinutes>
  const billed = await collectBilledMinutes(source, period)
  if (billed) {
    minutes = ok(billed)
  } else if (stored && billedBefore) {
    // The report was read before and cannot be now. Keep that total rather than start timing the
    // month from scratch, which is the slow path the report is there to avoid.
    minutes = stored
  } else {
    try {
      minutes = await collectMinutes(source, period, stored?.data ?? null)
    } catch (error) {
      minutes = stored ?? skip(`Actions minutes could not be read: ${reasonOf(error)}.`)
    }
  }

  const current = period.now >= period.from && period.now < period.to
  let storage: MetricBlock<ActionsStorage>
  if (current) {
    storage = await collectStorage(source, period.now)
    if (!storage.available && previous?.storage.available) storage = previous.storage
  } else {
    storage =
      previous?.storage ??
      skip(
        'Actions storage is read as it is now, and this month was not collected while it was current.',
      )
  }
  return { minutes, storage }
}
