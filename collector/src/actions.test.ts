import { describe, expect, it } from 'vitest'
import {
  type ActionsSource,
  type BillingUsageItem,
  type RunListing,
  type RunTiming,
  billableMinutes,
  billedMinutesByOs,
  collectActions,
  collectBilledMinutes,
  collectMinutes,
  collectStorage,
  daysBetween,
} from './metrics/actions.ts'
import type { ActionsMinutes, ActionsUsage } from './types.ts'

const FROM = new Date('2026-10-01T00:00:00Z')
const TO = new Date('2026-11-01T00:00:00Z')
const NOW = new Date('2026-10-03T12:00:00Z')

const run = (id: number, created: string, status = 'completed'): RunListing => ({
  id,
  status,
  created_at: created,
})

const linux = (...durations: number[]): RunTiming => ({
  billable: {
    UBUNTU: {
      total_ms: durations.reduce((a, b) => a + b, 0),
      jobs: durations.length,
      job_runs: durations.map((duration_ms, i) => ({ job_id: i, duration_ms })),
    },
  },
})

function source(opts: {
  runs?: RunListing[]
  timings?: Record<number, RunTiming | null>
  cache?: { bytes: number; count: number } | null | Error
  artifacts?: { size: number; expired?: boolean }[] | Error
  truncatedDay?: string
  /** Leave out for a source without the billing report, as before it was used. */
  billing?: BillingUsageItem[] | null | Error
}): ActionsSource & { timed: number[]; listedDays: string[]; billedMonths: string[] } {
  const timed: number[] = []
  const listedDays: string[] = []
  const billedMonths: string[] = []
  const billing = opts.billing
  return {
    timed,
    listedDays,
    billedMonths,
    ...(billing === undefined
      ? {}
      : {
          billingUsage: async (year: number, month: number) => {
            billedMonths.push(`${year}-${month}`)
            if (billing instanceof Error) throw billing
            return billing
          },
        }),
    cacheUsage: async () => {
      if (opts.cache instanceof Error) throw opts.cache
      if (opts.cache === null) return null
      const c = opts.cache ?? { bytes: 0, count: 0 }
      return { active_caches_size_in_bytes: c.bytes, active_caches_count: c.count }
    },
    artifacts: async () => {
      if (opts.artifacts instanceof Error) throw opts.artifacts
      return {
        artifacts: (opts.artifacts ?? []).map((a, i) => ({
          id: i,
          size_in_bytes: a.size,
          expired: a.expired ?? false,
        })),
        truncated: false,
      }
    },
    runsOn: async (day) => {
      listedDays.push(day)
      return {
        runs: (opts.runs ?? []).filter((r) => r.created_at.startsWith(day)),
        truncated: day === opts.truncatedDay,
      }
    },
    timing: async (id) => {
      timed.push(id)
      const t = opts.timings?.[id]
      if (t === undefined) return linux(60_000)
      return t
    },
  }
}

const PERIOD = { from: FROM, to: TO, now: NOW }

const minutesLine = (sku: string, quantity: number, product = 'actions'): BillingUsageItem => ({
  product,
  sku,
  unitType: 'Minutes',
  quantity,
  organizationName: 'PlainConceptsPlatform',
  repositoryName: 'Atlas',
})

describe('billableMinutes', () => {
  it('rounds every job up to the minute, as GitHub bills it, not the run total', () => {
    // Two 10 second jobs bill two minutes, not one.
    expect(billableMinutes(linux(10_000, 10_000))).toEqual({ UBUNTU: 2 })
  })

  it('splits by runner OS and falls back to the total without job detail', () => {
    const timing: RunTiming = {
      billable: {
        UBUNTU: { total_ms: 90_000, jobs: 1 },
        MACOS: { total_ms: 0, jobs: 0 },
        WINDOWS: { total_ms: 61_000, jobs: 1, job_runs: [{ job_id: 1, duration_ms: 61_000 }] },
      },
    }
    expect(billableMinutes(timing)).toEqual({ UBUNTU: 2, WINDOWS: 2 })
  })

  it('reads nothing from a public repository, whose billable block is empty', () => {
    expect(billableMinutes({ billable: {}, run_duration_ms: 600_000 })).toEqual({})
  })
})

describe('daysBetween', () => {
  it('lists only the days that have started, so a month in progress does not query the future', () => {
    expect(daysBetween(FROM, TO, NOW)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
  })

  it('lists the whole month once it is over', () => {
    expect(daysBetween(FROM, TO, new Date('2026-12-01T00:00:00Z'))).toHaveLength(31)
  })
})

describe('collectMinutes', () => {
  it('sums billable minutes by OS over the completed runs of the month', async () => {
    const s = source({
      runs: [run(1, '2026-10-01T10:00:00Z'), run(2, '2026-10-02T10:00:00Z')],
      timings: {
        1: linux(120_000),
        2: { billable: { WINDOWS: { total_ms: 30_000, jobs: 1 } } },
      },
    })
    const block = await collectMinutes(s, PERIOD, null)
    expect(block.available && block.data).toMatchObject({
      total: 3,
      byOs: { UBUNTU: 2, WINDOWS: 1 },
      runs: 2,
      timed: 2,
      pending: 0,
    })
  })

  it('leaves a run in progress for later instead of counting it short', async () => {
    const s = source({
      runs: [
        run(1, '2026-10-01T10:00:00Z'),
        run(2, '2026-10-02T10:00:00Z', 'in_progress'),
        run(3, '2026-10-03T10:00:00Z'),
      ],
    })
    const block = await collectMinutes(s, PERIOD, null)
    if (!block.available) throw new Error('expected minutes')
    expect(block.data.pending).toBe(1)
    expect(block.data.runs).toBe(2)
    expect(s.timed).toEqual([1, 3])
    // Everything before the run in progress is done; run 3 after it is remembered by id.
    expect(block.data.countedBefore).toBe('2026-10-02T10:00:00Z')
    expect(block.data.countedIds).toEqual([3])
  })

  it('times only new runs on the next collection, so a daily run does not refetch the month', async () => {
    const runs = [
      run(1, '2026-10-01T10:00:00Z'),
      run(2, '2026-10-02T10:00:00Z', 'in_progress'),
      run(3, '2026-10-03T10:00:00Z'),
    ]
    const first = await collectMinutes(source({ runs }), PERIOD, null)
    if (!first.available) throw new Error('expected minutes')

    const later = source({
      runs: [
        run(1, '2026-10-01T10:00:00Z'),
        run(2, '2026-10-02T10:00:00Z'),
        run(3, '2026-10-03T10:00:00Z'),
        run(4, '2026-10-04T09:00:00Z'),
      ],
    })
    const second = await collectMinutes(
      later,
      { ...PERIOD, now: new Date('2026-10-04T12:00:00Z') },
      first.data,
    )
    if (!second.available) throw new Error('expected minutes')
    expect(later.timed).toEqual([2, 4])
    // Days before the boundary are not even listed again.
    expect(later.listedDays[0]).toBe('2026-10-02')
    expect(second.data).toMatchObject({ runs: 4, timed: 4, total: 4, pending: 0 })
  })

  it('keeps a run created in the same second as the boundary rather than losing it', async () => {
    const first = await collectMinutes(
      source({ runs: [run(1, '2026-10-01T10:00:00Z')] }),
      PERIOD,
      null,
    )
    if (!first.available) throw new Error('expected minutes')
    const later = source({ runs: [run(1, '2026-10-01T10:00:00Z'), run(2, '2026-10-01T10:00:00Z')] })
    const second = await collectMinutes(later, PERIOD, first.data)
    expect(later.timed).toEqual([2])
    expect(second.available && second.data.runs).toBe(2)
  })

  it('stops at the timing budget and leaves the rest pending for the next collection', async () => {
    const runs = [1, 2, 3].map((id) => run(id, `2026-10-01T1${id}:00:00Z`))
    const block = await collectMinutes(source({ runs }), PERIOD, null, 2)
    expect(block.available && block.data).toMatchObject({ runs: 2, pending: 1 })
  })

  it('counts a run whose timing cannot be read as seen but untimed, so the total reads as a floor', async () => {
    const s = source({
      runs: [run(1, '2026-10-01T10:00:00Z'), run(2, '2026-10-01T11:00:00Z')],
      timings: { 2: null },
    })
    const block = await collectMinutes(s, PERIOD, null)
    expect(block.available && block.data).toMatchObject({ runs: 2, timed: 1, total: 1 })
  })

  it('returns a month that was complete when last read without listing anything', async () => {
    const stored: ActionsMinutes = {
      total: 10,
      byOs: { UBUNTU: 10 },
      runs: 5,
      timed: 5,
      pending: 0,
      truncated: false,
      measuredAt: '2026-11-01T03:15:00Z',
      countedBefore: '2026-10-31T20:00:00Z',
      countedIds: [5],
    }
    const s = source({})
    const block = await collectMinutes(
      s,
      { ...PERIOD, now: new Date('2026-11-02T03:15:00Z') },
      stored,
    )
    expect(block).toEqual({ available: true, data: stored })
    expect(s.listedDays).toEqual([])
  })

  it('flags a day that hit the 1,000 run listing cap', async () => {
    const block = await collectMinutes(source({ truncatedDay: '2026-10-02' }), PERIOD, null)
    expect(block.available && block.data.truncated).toBe(true)
  })
})

describe('collectStorage', () => {
  it('adds active caches to the artifacts that have not expired', async () => {
    const block = await collectStorage(
      source({
        cache: { bytes: 3_000, count: 4 },
        artifacts: [{ size: 500 }, { size: 700, expired: true }, { size: 250 }],
      }),
      NOW,
    )
    expect(block.available && block.data).toMatchObject({
      cache: { bytes: 3_000, count: 4 },
      artifacts: { bytes: 750, count: 2 },
      totalBytes: 3_750,
    })
  })

  it('keeps the half that could be read when the other fails', async () => {
    const block = await collectStorage(
      source({ cache: new Error('GET failed with 500'), artifacts: [{ size: 100 }] }),
      NOW,
    )
    expect(block.available && block.data).toMatchObject({ cache: null, totalBytes: 100 })
  })

  it('is unavailable with the reasons when neither half can be read', async () => {
    const block = await collectStorage(
      source({ cache: null, artifacts: new Error('GET failed with 403') }),
      NOW,
    )
    expect(block.available).toBe(false)
    if (!block.available) {
      expect(block.reason).toContain('needs Actions read')
      expect(block.reason).toContain('403')
    }
  })
})

describe('collectActions', () => {
  it('turns a failing run listing into an unavailable block instead of failing the report', async () => {
    const s = source({})
    s.runsOn = async () => {
      throw new Error('GET failed with 502')
    }
    const usage = await collectActions(s, PERIOD, null)
    expect(usage.minutes.available).toBe(false)
    expect(usage.storage.available).toBe(true)
  })

  it('keeps the stored storage for a month that is no longer current', async () => {
    const stored: ActionsUsage = {
      minutes: { available: false, reason: 'x' },
      storage: {
        available: true,
        data: {
          measuredAt: '2026-10-31T03:15:00Z',
          cache: { bytes: 1, count: 1 },
          artifacts: null,
          totalBytes: 1,
        },
      },
    }
    const usage = await collectActions(
      source({ cache: { bytes: 999, count: 9 } }),
      { ...PERIOD, now: new Date('2026-11-02T00:00:00Z') },
      stored,
    )
    expect(usage.storage).toEqual(stored.storage)
  })

  it('says why a past month that was never collected while current has no storage', async () => {
    const usage = await collectActions(
      source({}),
      { ...PERIOD, now: new Date('2026-12-02T00:00:00Z') },
      null,
    )
    expect(usage.storage.available).toBe(false)
  })
})

describe('billedMinutesByOs', () => {
  it('maps every Linux, Windows and macOS SKU onto the split the timing endpoint uses', () => {
    expect(
      billedMinutesByOs([
        minutesLine('Actions Linux', 100),
        minutesLine('Actions Linux Advanced 2-core', 40),
        minutesLine('Actions Linux Slim', 3),
        minutesLine('Actions Windows', 12),
        minutesLine('Actions macOS 3-core', 7),
      ]),
    ).toEqual({ UBUNTU: 143, WINDOWS: 12, MACOS: 7 })
  })

  it('leaves out storage and other products, and keeps an unknown runner under its SKU', () => {
    expect(
      billedMinutesByOs([
        { ...minutesLine('Actions storage', 5), unitType: 'GigabyteHours' },
        minutesLine('Code Quality AI Credits', 9, 'code_quality'),
        minutesLine('Actions Linux', 0.4),
        minutesLine('Actions Linux', 0.4),
        minutesLine('Actions ARM Something', 2),
      ]),
    ).toEqual({ UBUNTU: 1, 'Actions ARM Something': 2 })
  })
})

describe('collectBilledMinutes', () => {
  it('reads the month of the period, numbered from 1, and sums it with no run counts', async () => {
    const s = source({
      billing: [minutesLine('Actions Linux', 20_000), minutesLine('Actions Windows', 171)],
    })
    const minutes = await collectBilledMinutes(s, PERIOD)
    expect(s.billedMonths).toEqual(['2026-10'])
    expect(minutes).toMatchObject({
      source: 'billing',
      total: 20_171,
      byOs: { UBUNTU: 20_000, WINDOWS: 171 },
      runs: 0,
      timed: 0,
      pending: 0,
      countedBefore: null,
      countedIds: [],
    })
  })

  it('is null when the report is refused or missing, so the caller can fall back', async () => {
    expect(
      await collectBilledMinutes(source({ billing: new Error('GET failed with 403') }), PERIOD),
    ).toBeNull()
    expect(await collectBilledMinutes(source({ billing: null }), PERIOD)).toBeNull()
    expect(await collectBilledMinutes(source({}), PERIOD)).toBeNull()
  })

  it('reads zero, not unavailable, for a repository with no billed minutes this month', async () => {
    const minutes = await collectBilledMinutes(source({ billing: [] }), PERIOD)
    expect(minutes).toMatchObject({ source: 'billing', total: 0, byOs: {} })
  })
})

describe('collectActions with the billing report', () => {
  const runs = [run(1, '2026-10-01T10:00:00Z'), run(2, '2026-10-02T10:00:00Z')]

  it('prefers the report and times no run at all', async () => {
    const s = source({ runs, billing: [minutesLine('Actions Linux', 500)] })
    const usage = await collectActions(s, PERIOD, null)
    expect(usage.minutes.available && usage.minutes.data).toMatchObject({
      source: 'billing',
      total: 500,
    })
    expect(s.listedDays).toEqual([])
    expect(s.timed).toEqual([])
  })

  it('falls back to timing each run when the report answers 403', async () => {
    const s = source({ runs, billing: new Error('GET failed with 403') })
    const usage = await collectActions(s, PERIOD, null)
    expect(usage.minutes.available && usage.minutes.data).toMatchObject({
      source: 'timing',
      total: 2,
      runs: 2,
    })
    expect(s.timed).toEqual([1, 2])
  })

  it('falls back to timing when the report answers 404', async () => {
    const s = source({ runs, billing: null })
    const usage = await collectActions(s, PERIOD, null)
    expect(usage.minutes.available && usage.minutes.data.source).toBe('timing')
  })

  it('keeps a billed total when the report stops answering, rather than retiming the month', async () => {
    const first = await collectActions(
      source({ billing: [minutesLine('Actions Linux', 800)] }),
      PERIOD,
      null,
    )
    const s = source({ runs, billing: new Error('GET failed with 502') })
    const second = await collectActions(s, PERIOD, first)
    expect(second.minutes).toEqual(first.minutes)
    expect(s.timed).toEqual([])
  })

  it('replaces a timed floor with the billed total once the report is readable', async () => {
    const timed = await collectActions(source({ runs }), PERIOD, null)
    const billed = await collectActions(
      source({ runs, billing: [minutesLine('Actions Linux', 900)] }),
      PERIOD,
      timed,
    )
    expect(billed.minutes.available && billed.minutes.data).toMatchObject({
      source: 'billing',
      total: 900,
      runs: 0,
    })
  })
})
