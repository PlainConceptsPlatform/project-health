'use client'

import { monthName } from '../lib/format'
import { cn } from '../lib/utils'

export interface MonthLink {
  month: string
  href: string
  current: boolean
}

/**
 * The month on show, as one select instead of a pill per collected month, which grew without end.
 * Picking a month opens its page and keeps the open tab (`hash`), so stepping back a month stays on
 * the roadmap.
 */
export function PeriodSelect({
  months,
  hash,
  className,
}: {
  months: MonthLink[]
  /** The open tab, without the #; empty for the first tab. */
  hash: string
  className?: string
}) {
  const current = months.find((m) => m.current)?.month ?? ''
  return (
    <label
      className={cn('inline-flex items-center gap-1.5 text-sm text-muted-foreground', className)}
    >
      <span className="hidden sm:inline">Month</span>
      <select
        value={current}
        aria-label="Month"
        onChange={(e) => {
          const next = months.find((m) => m.month === e.target.value)
          if (next) window.location.assign(`${next.href}${hash ? `#${hash}` : ''}`)
        }}
        className="h-11 rounded-md border bg-background px-3 text-sm text-foreground md:h-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {[...months].reverse().map((m) => (
          <option key={m.month} value={m.month}>
            {monthName(m.month)}
          </option>
        ))}
      </select>
    </label>
  )
}
