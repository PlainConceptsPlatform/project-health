import type { DailyScore } from './scorecard'
import type { BotAdditions, Codebase, DataIndex, MonthlyReport } from './types'

/** The ceiling pc-guardrails-generic sets for comment lines per line of code. */
export const COMMENT_CEILING = 0.1

export type Tone = 'good' | 'warn' | 'bad'

export function densityTone(density: number | null | undefined): Tone | null {
  if (density === null || density === undefined) return null
  if (density <= COMMENT_CEILING) return 'good'
  return density <= COMMENT_CEILING * 2 ? 'warn' : 'bad'
}

export const TONE_TEXT: Record<Tone, string> = {
  good: 'text-foreground',
  warn: 'text-warning-foreground dark:text-warning',
  bad: 'text-destructive',
}

export const TONE_BAR: Record<Tone, string> = {
  good: 'bg-primary/60',
  warn: 'bg-warning',
  bad: 'bg-destructive',
}

export const percent = (value: number | null | undefined) =>
  value === null || value === undefined ? 'n/a' : `${Math.round(value * 1000) / 10}%`

export const addedDensity = (added: BotAdditions) =>
  added.codeLines > 0 ? added.commentLines / added.codeLines : null

export const narrativeBlocks = (code: Codebase) =>
  code.comments.heuristics.history + code.comments.heuristics.essay

export const suspiciousTests = (code: Codebase) =>
  Object.values(code.tests.suspicious).reduce((a, b) => a + b, 0)

export const SLOP_LABEL: Record<string, string> = {
  banner: 'Decorative banners',
  region: '#region labels',
  'untracked-todo': 'TODO without an issue',
  'restating-summary': 'C# summary repeating the name',
  'restating-jsdoc': 'JSDoc repeating the name',
  'restating-param': 'Param doc repeating the name',
  'filler-returns': 'Filler returns doc',
  'commented-out-code': 'Commented-out code',
  apologetic: 'Apologetic notes',
}

export const SUSPICIOUS_LABEL: Record<keyof Codebase['tests']['suspicious'], string> = {
  noAssertion: 'No assertion in the test body',
  mockOnly: 'Only checks that a mock was called',
  snapshot: 'Snapshot',
  skipped: 'Skipped',
  focused: 'Focused (.only)',
}

export interface CodeRow {
  id: string
  name: string
  repo: string
  month: string | null
  code: Codebase | null
  /** What this month's merged bot pull requests added. */
  added: BotAdditions | null
  reason: string | null
  trend: { month: string; score: number | null }[]
}

export function densityTrend(daily: DailyScore[]) {
  return daily
    .filter((d) => d.commentDensity !== undefined)
    .slice(-30)
    .map((d) => ({
      month: d.date,
      score:
        d.commentDensity === null || d.commentDensity === undefined ? null : d.commentDensity * 100,
    }))
}

export function codeRows(
  index: DataIndex,
  months: Record<string, Record<string, MonthlyReport | null>>,
  daily: Record<string, DailyScore[]> = {},
): CodeRow[] {
  return index.projects
    .map((entry) => {
      const reports = [...entry.months]
        .sort()
        .map((month) => ({ month, report: months[month]?.[entry.id] }))
      const scanned = reports.findLast((r) => r.report?.codebase?.available)
      const newest = reports.at(-1)?.report
      const code = scanned?.report?.codebase?.available ? scanned.report.codebase.data : null
      const agentic = newest?.agentic?.available ? newest.agentic.data : null
      return {
        id: entry.id,
        name: entry.name,
        repo: entry.repo,
        month: scanned?.month ?? null,
        code,
        added: agentic?.bot.added ?? null,
        reason: code
          ? null
          : newest?.codebase && !newest.codebase.available
            ? newest.codebase.reason
            : 'Not scanned yet; it appears after the next collection.',
        trend: densityTrend(daily[entry.id] ?? []),
      }
    })
    .sort(
      (a, b) =>
        (b.code?.comments.density ?? -1) - (a.code?.comments.density ?? -1) ||
        a.name.localeCompare(b.name),
    )
}
