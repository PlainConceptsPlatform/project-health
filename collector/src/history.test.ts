import { describe, expect, it } from 'vitest'
import {
  type DailyPoint,
  MAX_DAYS,
  emptyHistory,
  parseHistory,
  pointOf,
  withPoint,
} from './history.ts'
import type { MonthlyReport } from './types.ts'

const point = (date: string, score: number): DailyPoint => ({
  date,
  score,
  level: 1,
  gatesPresent: 5,
  gatesApplicable: 10,
})

describe('withPoint', () => {
  it('replaces a same-day point with the newer run and keeps the days sorted', () => {
    let history = withPoint(emptyHistory(), point('2026-10-13', 50))
    history = withPoint(history, point('2026-10-12', 40))
    history = withPoint(history, point('2026-10-13', 55))
    expect(history.days.map((d) => [d.date, d.score])).toEqual([
      ['2026-10-12', 40],
      ['2026-10-13', 55],
    ])
  })

  it('drops the oldest days past the cap', () => {
    let history = emptyHistory()
    const start = Date.UTC(2025, 0, 1)
    for (let i = 0; i < MAX_DAYS + 3; i += 1) {
      history = withPoint(
        history,
        point(new Date(start + i * 86_400_000).toISOString().slice(0, 10), i),
      )
    }
    expect(history.days).toHaveLength(MAX_DAYS)
    expect(history.days[0]?.score).toBe(3)
  })
})

describe('pointOf', () => {
  it('records score, level and gates for the UTC day, and nothing without a scorecard', () => {
    const report = {
      scorecard: {
        available: true,
        data: { score: 72, level: 2, gates: { present: 7, applicable: 9 } },
      },
    } as unknown as MonthlyReport
    expect(pointOf(report, new Date('2026-10-13T23:30:00Z'))).toEqual({
      date: '2026-10-13',
      score: 72,
      level: 2,
      gatesPresent: 7,
      gatesApplicable: 9,
    })
    const unscored = { scorecard: { available: false, reason: 'x' } } as unknown as MonthlyReport
    expect(pointOf(unscored, new Date())).toBeNull()
  })
})

describe('parseHistory', () => {
  it('starts fresh from a missing, corrupt or foreign file', () => {
    expect(parseHistory(null)).toEqual(emptyHistory())
    expect(parseHistory('{not json')).toEqual(emptyHistory())
    expect(parseHistory('{"months":[]}')).toEqual(emptyHistory())
    expect(
      parseHistory(JSON.stringify({ schemaVersion: 1, days: [point('2026-10-01', 1)] })).days,
    ).toHaveLength(1)
  })
})
