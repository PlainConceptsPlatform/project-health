'use client'

import { seconds } from '@/shared/lib/format'
import {
  type KindTiming,
  type LogTone,
  SOURCE_LABEL,
  STATES,
  STATE_ORDER,
  TONE_DOT,
  byHand,
  clock,
  dayName,
  duration,
  failedRun,
  logOf,
  minutesIn,
  openFor,
  outcomeOf,
  stamp,
  summarise,
  timingByKind,
} from '@/shared/lib/roadmap'
import type {
  AgentRun,
  AgentSummary,
  IssueJourney,
  JourneyState,
  MetricBlock,
  Roadmap,
} from '@/shared/lib/types'
import { withBase } from '@/shared/lib/utils'
import { Panel, Stat, Unavailable, cn } from '@/shared/ui'
import { ChevronLeftIcon, ChevronRightIcon, MinusIcon, PlusIcon } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { TAB_PARAM, adoptSharedTab } from './tabs'

const MINUTE = 60_000
const DAY = 1440
const LABEL_W = 280
const TOTAL_W = 112
/** Visible spans the zoom steps through, in minutes. The widest is always the whole period. */
const SPANS = [7 * DAY, 3 * DAY, DAY, 12 * 60, 6 * 60, 2 * 60]
/** A tick every this many minutes for a given visible span, so labels stay about 60px apart. */
const TICK_STEPS = [15, 30, 60, 120, 180, 360, 720, DAY]

type Filter = 'all' | 'open' | 'stalled' | 'hand' | 'automation'
type View = 'calendar' | 'aligned'

const FILTERS: { id: Filter; label: string; test: (i: IssueJourney) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'open', label: 'Open', test: (i) => i.outcome === 'open' },
  { id: 'stalled', label: 'Stalled', test: (i) => i.marks.length > 0 },
  {
    id: 'hand',
    label: 'By hand',
    test: (i) => byHand(i) || i.outcome === 'merged-by-hand',
  },
  { id: 'automation', label: 'From automation', test: (i) => i.source !== 'person' },
]

const pct = (value: number, span: number) =>
  `${(Math.max(0, Math.min(1, value / span)) * 100).toFixed(4)}%`

function Swatch({ state }: { state: JourneyState }) {
  return <span aria-hidden className={cn('inline-block size-3 rounded-sm', STATES[state].swatch)} />
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'border-foreground bg-foreground text-background' : 'hover:bg-accent',
      )}
    >
      {children}
    </button>
  )
}

const iconButton =
  'inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40'

/** The share of open time spent in each state, as one bar and a legend that says it in numbers. */
function TimeSplit({ totals, total }: { totals: Record<JourneyState, number>; total: number }) {
  return (
    <div className="space-y-3 rounded-md border p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        Where the time went · {duration(total)} open in total
      </p>
      <div aria-hidden className="flex h-3.5 gap-0.5 overflow-hidden rounded-full">
        {STATE_ORDER.filter((s) => totals[s] > 0).map((s) => (
          <span
            key={s}
            className={STATES[s].swatch}
            style={{ width: `${(totals[s] / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
        {STATE_ORDER.map((s) => (
          <div key={s} className="flex items-baseline gap-2 text-sm">
            <Swatch state={s} />
            <span>
              <span className="font-semibold tabular-nums">
                {total > 0 ? Math.round((totals[s] / total) * 100) : 0}%
              </span>{' '}
              {STATES[s].label.toLowerCase()}
              <span className="block text-xs text-muted-foreground">{duration(totals[s])}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Waiting({ issues, repo, asOf }: { issues: IssueJourney[]; repo: string; asOf: string }) {
  return (
    <div className="space-y-3 rounded-md border border-warning/50 bg-warning/10 p-4">
      <p className="text-xs uppercase tracking-wide text-warning-foreground dark:text-warning">
        Waiting on a person now
      </p>
      {issues.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing is waiting for a person.</p>
      ) : (
        <ul className="space-y-2">
          {issues.map((i) => {
            const since = i.segments.at(-1)
            const waited = since ? since.to - since.from : 0
            return (
              <li key={i.number} className="text-sm">
                <a
                  href={`https://github.com/${repo}/issues/${i.number}`}
                  className="hover:underline"
                >
                  <span className="font-mono text-xs text-muted-foreground">#{i.number}</span>{' '}
                  {i.title}
                </a>
                <span className="block text-xs text-muted-foreground">
                  waiting {duration(waited)} as of {stamp(Date.parse(asOf))}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Measures the scroll box so the timeline can be sized in pixels and zoomed around its centre. */
function useScroller() {
  const ref = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ width: 720, scroll: 0 })
  const frame = useRef<number | null>(null)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    setBox({ width: Math.max(240, el.clientWidth - LABEL_W - TOTAL_W), scroll: el.scrollLeft })
  }, [])

  useEffect(() => {
    measure()
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure])

  const onScroll = useCallback(() => {
    // A hidden page runs no animation frames, so measure directly rather than never.
    if (document.visibilityState === 'hidden') return measure()
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      measure()
    })
  }, [measure])

  return { ref, box, onScroll, measure }
}

function Timeline({
  issues,
  view,
  start,
  end,
  selected,
  onSelect,
}: {
  issues: IssueJourney[]
  view: View
  /** Calendar: epoch ms of the period start. Aligned: 0. */
  start: number
  /** Calendar: epoch ms where the axis ends. Aligned: minutes. */
  end: number
  selected: number | null
  onSelect: (n: number) => void
}) {
  const calendar = view === 'calendar'
  // Everything below is in minutes from the start of the axis.
  const domain = calendar ? Math.max(60, (end - start) / MINUTE) : end
  const spans = useMemo(() => [domain, ...SPANS.filter((s) => s < domain)], [domain])
  const [zoom, setZoom] = useState(0)
  const { ref, box, onScroll, measure } = useScroller()
  // The scroll to apply once the zoom it was computed for has rendered. Checking the zoom matters:
  // React may run the layout effect again before the new zoom renders, and scrolling then would
  // clamp to the old, narrower track.
  const pending = useRef<{ minute: number; smooth: boolean; zoom: number } | null>(null)

  const span = calendar ? (spans[zoom] ?? domain) : domain
  const trackPx = Math.round((box.width * domain) / span)
  const visibleFrom = calendar ? (box.scroll / trackPx) * domain : 0

  // Open on the most recent week of a long month, scrolled to its end, rather than squeezing a
  // month of issues that last hours into slivers.
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current || !calendar) return
    opened.current = true
    const week = spans.indexOf(7 * DAY)
    if (week > 0) {
      pending.current = { minute: domain - 7 * DAY, smooth: false, zoom: week }
      setZoom(week)
    }
  }, [calendar, spans, domain])

  // A resize changes the track's width, not what the reader was looking at: keep the same minute
  // at the left edge instead of the same pixel.
  const lastTrack = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const previous = lastTrack.current
    lastTrack.current = trackPx
    if (!el || previous === null || previous === trackPx || pending.current !== null) return
    el.scrollLeft = (el.scrollLeft / previous) * trackPx
  }, [trackPx, ref])

  useLayoutEffect(() => {
    const el = ref.current
    if (pending.current === null || !el || pending.current.zoom !== zoom) return
    // A box not laid out yet (a hidden tab or window) would clamp the scroll to zero; keep it for
    // the render that follows the first real measurement.
    if (el.clientWidth === 0) return
    const { minute, smooth } = pending.current
    el.scrollTo({ left: (minute / domain) * trackPx, behavior: smooth ? 'smooth' : 'auto' })
    pending.current = null
    // An instant scroll is done now; reading it back keeps the labels right even where no scroll
    // event follows, as on a page that is not being shown.
    if (!smooth) measure()
  })

  const zoomTo = (next: number, leftMinute: number) => {
    const clamped = Math.max(0, Math.min(spans.length - 1, next))
    const nextSpan = spans[clamped] ?? domain
    const left = Math.max(0, Math.min(domain - nextSpan, leftMinute))
    if (clamped === zoom) {
      // Same zoom renders nothing new, so the layout effect would never pick the scroll up.
      ref.current?.scrollTo({ left: (left / domain) * trackPx, behavior: 'smooth' })
      return
    }
    // Instant: a zoom is a jump anyway, and a smooth scroll still running when the next click
    // comes would leave a stale position to zoom around.
    pending.current = { minute: left, smooth: false, zoom: clamped }
    setZoom(clamped)
  }
  // Read live rather than from the last scroll event, which lags behind an animation in flight.
  const centre = () => ((ref.current?.scrollLeft ?? box.scroll) / trackPx) * domain + span / 2
  const pan = (direction: number) =>
    ref.current?.scrollBy({ left: direction * box.width * 0.6, behavior: 'smooth' })

  const ticks = useMemo(() => {
    const step = TICK_STEPS.find((s) => (s / span) * box.width >= 56) ?? DAY
    const out: { at: number; label: string; day: boolean }[] = []
    const from = Math.max(0, visibleFrom - span)
    const to = Math.min(domain, visibleFrom + 2 * span)
    for (let m = Math.ceil(from / step) * step; m <= to; m += step) {
      if (calendar) {
        const ms = start + m * MINUTE
        out.push({
          at: m,
          label: clock(ms),
          day: new Date(ms).getUTCHours() === 0 && new Date(ms).getUTCMinutes() === 0,
        })
      } else {
        out.push({ at: m, label: duration(m), day: false })
      }
    }
    return out
  }, [span, box.width, visibleFrom, domain, calendar, start])

  const days = useMemo(() => {
    if (!calendar) return []
    const out: { at: number; ms: number; weekend: boolean }[] = []
    for (let m = 0; m < domain; m += DAY) {
      const ms = start + m * MINUTE
      const weekday = new Date(ms).getUTCDay()
      out.push({ at: m, ms, weekend: weekday === 0 || weekday === 6 })
    }
    return out
  }, [calendar, domain, start])

  // A day narrower than its full name gets a shorter one, so labels never run into each other.
  const dayPx = (trackPx * DAY) / domain
  const dayLabel = (ms: number) => {
    const name = dayName(ms)
    if (dayPx >= 100) return name
    return dayPx >= 56 ? name.split(' ').slice(0, 2).join(' ') : String(new Date(ms).getUTCDate())
  }
  const offset = (issue: IssueJourney) =>
    calendar ? (Date.parse(issue.createdAt) - start) / MINUTE : 0
  // One thin line per issue, squeezed so a busy month still fits in a short strip.
  const miniGap = Math.max(2, Math.min(5, 110 / Math.max(1, issues.length)))

  // Scroll positions land between minutes; the label reads better on a quarter hour.
  const shownFrom = Math.round(visibleFrom / 15) * 15
  const rangeLabel = calendar
    ? zoom === 0
      ? `${dayName(start)} to ${dayName(end - MINUTE)}`
      : `${stamp(start + shownFrom * MINUTE)} to ${stamp(start + (shownFrom + span) * MINUTE)}`
    : `First ${duration(domain)} of each issue`
  const zoomLabel =
    zoom === 0 ? 'Whole period' : duration(span).replace(' 0 m', '').replace(' 0 h', '')

  return (
    <div className="space-y-3">
      {calendar ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-md border">
            <button
              type="button"
              className={iconButton}
              aria-label="Zoom out"
              disabled={zoom === 0}
              onClick={() => zoomTo(zoom - 1, centre() - (spans[zoom - 1] ?? domain) / 2)}
            >
              <MinusIcon className="size-4" />
            </button>
            <span className="min-w-24 px-1 text-center text-sm font-medium">{zoomLabel}</span>
            <button
              type="button"
              className={iconButton}
              aria-label="Zoom in"
              disabled={zoom === spans.length - 1}
              onClick={() => zoomTo(zoom + 1, centre() - (spans[zoom + 1] ?? span) / 2)}
            >
              <PlusIcon className="size-4" />
            </button>
          </div>
          <div className="inline-flex items-center rounded-md border">
            <button
              type="button"
              className={iconButton}
              aria-label="Earlier"
              onClick={() => pan(-1)}
            >
              <ChevronLeftIcon className="size-4" />
            </button>
            <span className="px-1 text-sm text-muted-foreground">{rangeLabel}</span>
            <button type="button" className={iconButton} aria-label="Later" onClick={() => pan(1)}>
              <ChevronRightIcon className="size-4" />
            </button>
          </div>
          {zoom > 0 ? (
            <button
              type="button"
              onClick={() => zoomTo(0, 0)}
              className="rounded-md border px-3 py-1.5 text-sm text-primary hover:bg-accent"
            >
              Show whole period
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {rangeLabel}, so durations compare directly.
        </p>
      )}

      {calendar ? (
        <button
          type="button"
          aria-label="Overview of the whole period. Select a point to jump there."
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const minute = ((e.clientX - rect.left) / rect.width) * domain
            const next = zoom === 0 ? Math.max(1, spans.indexOf(3 * DAY)) : zoom
            zoomTo(next, minute - (spans[next] ?? span) / 2)
          }}
          className="relative block w-full overflow-hidden rounded-md border bg-muted/40 hover:border-primary/50"
          style={{ height: 14 + issues.length * miniGap }}
        >
          {days.map((d) => (
            <span
              key={d.at}
              aria-hidden
              className={cn('absolute inset-y-0 border-l border-border', d.weekend && 'bg-muted')}
              style={{ left: pct(d.at, domain), width: pct(DAY, domain) }}
            />
          ))}
          {issues.map((issue, i) => (
            <span
              key={issue.number}
              aria-hidden
              className={cn(
                'absolute h-[2px] min-w-[3px] rounded-full',
                issue.number === selected ? 'bg-primary' : 'bg-muted-foreground/70',
              )}
              style={{
                top: 7 + i * miniGap,
                left: pct(Math.max(0, offset(issue)), domain),
                width: pct(Math.min(openFor(issue) + Math.min(0, offset(issue)), domain), domain),
              }}
            />
          ))}
          <span
            aria-hidden
            className="absolute inset-y-0 rounded-sm border-2 border-primary bg-primary/10"
            style={{ left: pct(visibleFrom, domain), width: pct(span, domain) }}
          />
        </button>
      ) : null}

      <div
        ref={ref}
        onScroll={onScroll}
        className="roadmap-scroll overflow-x-auto overflow-y-hidden rounded-md border"
      >
        <div className="relative" style={{ width: LABEL_W + trackPx + TOTAL_W }}>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0"
            style={{ left: LABEL_W, width: trackPx }}
          >
            {days
              .filter((d) => d.weekend)
              .map((d) => (
                <span
                  key={d.at}
                  className="absolute inset-y-0 bg-muted/60"
                  style={{ left: pct(d.at, domain), width: pct(DAY, domain) }}
                />
              ))}
            {ticks.map((t) => (
              <span
                key={t.at}
                className={cn(
                  'absolute inset-y-0 border-l',
                  t.day ? 'border-muted-foreground/40' : 'border-border/60',
                )}
                style={{ left: pct(t.at, domain) }}
              />
            ))}
          </div>

          <div className="relative flex h-14 border-b">
            <div
              className="sticky left-0 z-20 flex shrink-0 items-center border-r bg-muted px-3 text-xs uppercase tracking-wide text-muted-foreground"
              style={{ width: LABEL_W }}
            >
              Issue · opened {calendar ? '(UTC)' : ''}
            </div>
            <div className="relative shrink-0" style={{ width: trackPx }}>
              {days.map((d) => (
                <div
                  key={d.at}
                  className="absolute top-0 h-7"
                  style={{ left: pct(d.at, domain), width: pct(DAY, domain) }}
                >
                  <button
                    type="button"
                    onClick={() => zoomTo(Math.max(0, spans.indexOf(DAY)), d.at)}
                    className="sticky mt-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold hover:bg-accent"
                    style={{ left: LABEL_W + 6 }}
                    aria-label={`Zoom to ${dayName(d.ms)}`}
                  >
                    {dayLabel(d.ms)}
                  </button>
                </div>
              ))}
              {ticks
                .filter((t) => !t.day)
                .map((t) => (
                  <span
                    key={t.at}
                    className="absolute bottom-1.5 -translate-x-1/2 whitespace-nowrap text-[11px] text-muted-foreground"
                    style={{ left: pct(t.at, domain) }}
                  >
                    {t.label}
                  </span>
                ))}
            </div>
            <div
              className="sticky right-0 z-20 flex shrink-0 items-center justify-end border-l bg-muted px-3 text-xs uppercase tracking-wide text-muted-foreground"
              style={{ width: TOTAL_W }}
            >
              Open for
            </div>
          </div>

          {issues.map((issue) => {
            const off = offset(issue)
            const isSelected = issue.number === selected
            const total = openFor(issue)
            const outcome = outcomeOf(issue)
            const merged = issue.outcome !== 'open' && issue.outcome !== 'closed'
            return (
              <div key={issue.number} className="relative flex h-14 border-b last:border-b-0">
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelect(issue.number)}
                  className={cn(
                    'sticky left-0 z-20 flex shrink-0 flex-col justify-center gap-1 border-r px-3 text-left',
                    isSelected ? 'bg-accent' : 'bg-card hover:bg-muted',
                  )}
                  style={{ width: LABEL_W }}
                >
                  <span className="flex w-full items-baseline gap-2">
                    <span className="font-mono text-xs text-muted-foreground">#{issue.number}</span>
                    <span className="truncate text-sm">{issue.title}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="font-medium">{stamp(Date.parse(issue.createdAt))}</span>
                    {issue.source !== 'person' ? (
                      <span className="rounded bg-muted px-1.5 text-muted-foreground">
                        {SOURCE_LABEL[issue.source]}
                      </span>
                    ) : null}
                    {issue.estimate !== null ? (
                      <span className="rounded bg-muted px-1.5 text-muted-foreground">
                        sp-{issue.estimate}
                      </span>
                    ) : null}
                    <span className={cn('rounded px-1.5 font-semibold', outcome.className)}>
                      {outcome.label}
                    </span>
                  </span>
                </button>

                <div
                  className={cn('relative shrink-0 overflow-hidden', isSelected && 'bg-primary/5')}
                  style={{ width: trackPx }}
                >
                  {issue.segments.map((s) => {
                    const from = off + s.from
                    const to = off + s.to
                    if (to <= 0 || from >= domain) return null
                    const px = ((Math.min(to, domain) - Math.max(0, from)) / domain) * trackPx
                    const minutes = s.to - s.from
                    const meta = STATES[s.state]
                    return (
                      <span
                        key={`${s.state}-${s.from}`}
                        title={`${meta.label}, ${calendar ? `${clock(Date.parse(issue.createdAt) + s.from * MINUTE)} to ${clock(Date.parse(issue.createdAt) + s.to * MINUTE)}, ` : ''}${duration(minutes)}`}
                        className={cn(
                          'absolute top-[18px] h-5 min-w-0.5 overflow-hidden whitespace-nowrap pl-1.5 text-[11px] leading-5',
                          meta.segment,
                        )}
                        style={{
                          left: pct(Math.max(0, from), domain),
                          width: pct(Math.min(to, domain) - Math.max(0, from), domain),
                        }}
                      >
                        {px > 110
                          ? `${meta.short} ${duration(minutes)}`
                          : px > 48
                            ? duration(minutes)
                            : ''}
                      </span>
                    )
                  })}
                  {issue.marks.map((m) => (
                    <span
                      key={`${m.kind}-${m.at}`}
                      aria-hidden
                      className={cn(
                        'absolute top-2 size-2.5 -translate-x-1/2 rounded-full border-2',
                        m.kind === 'stalled'
                          ? 'border-card bg-destructive'
                          : 'border-destructive bg-card',
                      )}
                      style={{ left: pct(off + m.at, domain) }}
                    />
                  ))}
                  {merged && off + total <= domain ? (
                    <span
                      aria-hidden
                      className="absolute top-[19px] size-[18px] -translate-x-1/3 bg-foreground [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]"
                      style={{ left: pct(off + total, domain) }}
                    />
                  ) : null}
                  {calendar && issue.closedAt && off + total <= domain ? (
                    <span
                      className="absolute top-[20px] ml-4 whitespace-nowrap text-xs text-muted-foreground"
                      style={{ left: pct(off + total, domain) }}
                    >
                      {issue.outcome === 'closed' ? 'closed' : 'merged'}{' '}
                      {clock(Date.parse(issue.closedAt))}
                    </span>
                  ) : null}
                  {calendar && off < 0 ? (
                    <span className="absolute left-2 top-[20px] whitespace-nowrap rounded bg-card/90 px-1 text-xs text-muted-foreground">
                      ‹ opened {dayName(Date.parse(issue.createdAt))}
                    </span>
                  ) : null}
                  {!calendar && total > domain ? (
                    <span className="absolute right-2 top-[20px] rounded bg-card/90 px-1 text-xs text-muted-foreground">
                      {duration(total)} ›
                    </span>
                  ) : null}
                </div>

                <div
                  className={cn(
                    'sticky right-0 z-20 flex shrink-0 flex-col items-end justify-center border-l px-3',
                    isSelected ? 'bg-accent' : 'bg-card',
                  )}
                  style={{ width: TOTAL_W }}
                >
                  <span className="text-sm font-semibold tabular-nums">{duration(total)}</span>
                  <span className="text-xs tabular-nums text-chart-1">
                    agent {duration(minutesIn(issue, 'agent'))}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * The copy the collector stored in the site when there is one: a private repository's own link
 * needs a GitHub session the browser does not send for an image on another site.
 */
const shotOf = (w: { image: string | null; copy?: string | null }): string | null =>
  w.copy ? withBase(`/${w.copy}`) : w.image ? withBase(w.image) : null

function Evidence({ issue }: { issue: IssueJourney }) {
  const [index, setIndex] = useState(0)
  const [broken, setBroken] = useState<Set<number>>(new Set())
  const evidence = issue.evidence
  const mergedPr = issue.pullRequests.filter((p) => p.mergedAt).at(-1)

  if (!evidence || evidence.waypoints.every((w) => w.image === null)) {
    const reason = evidence?.note
      ? evidence.note
      : !mergedPr
        ? 'No merged pull request, so there is no evidence to show.'
        : !mergedPr.byAgent
          ? `PR #${mergedPr.number} was opened by hand. Evidence is replayed from the verification plan an agent writes with its pull request.`
          : `No evidence was recorded for PR #${mergedPr.number}. The evidence workflow writes it when a pull request with a verification plan merges.`
    return <Unavailable reason={reason} />
  }

  const shots = evidence.waypoints
  const current = shots[Math.min(index, shots.length - 1)]
  if (!current) return null
  const position = Math.min(index, shots.length - 1)
  const failed = current.image === null || broken.has(position)
  // A pull request with several verification plans numbers each from 1, so name the plan.
  const plans = new Set(shots.map((w) => w.plan ?? null)).size > 1
  const title = (w: (typeof shots)[number]) =>
    `${plans && w.plan ? `${w.plan} · ` : ''}${w.n}. ${w.capture}`

  return (
    <div className="space-y-3">
      <figure className="overflow-hidden rounded-md border">
        {failed ? (
          <div className="flex aspect-video items-center justify-center bg-muted/40 p-6 text-center text-sm text-muted-foreground">
            {current.image === null ? (
              'This waypoint produced no screenshot.'
            ) : (
              <a href={withBase(current.image)} className="text-primary hover:underline">
                The screenshot needs a GitHub sign-in with access to the repository. Open it on
                GitHub.
              </a>
            )}
          </div>
        ) : (
          <a href={shotOf(current) ?? undefined}>
            <img
              src={shotOf(current) ?? undefined}
              alt={current.expect ?? current.capture}
              loading="lazy"
              className="aspect-video w-full bg-muted object-contain object-top"
              onError={() => setBroken((b) => new Set(b).add(position))}
            />
          </a>
        )}
        <figcaption className="flex items-start justify-between gap-3 border-t px-3 py-2 text-sm">
          <span>
            <span className="font-medium">{title(current)}</span>
            {current.expect ? (
              <span className="block text-xs text-muted-foreground">{current.expect}</span>
            ) : null}
            {!current.reached ? (
              <span className="block text-xs text-destructive">Did not reach this state</span>
            ) : null}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {position + 1} of {shots.length}
          </span>
        </figcaption>
      </figure>
      {shots.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {shots.map((w, i) => (
            <button
              key={`${w.plan ?? ''}-${w.n}-${i}`}
              type="button"
              aria-pressed={i === index}
              onClick={() => setIndex(i)}
              className={cn(
                'w-32 rounded-md border-2 p-1 text-left text-xs',
                i === index ? 'border-primary' : 'border-transparent hover:border-border',
              )}
            >
              {w.image && !broken.has(i) ? (
                <img
                  src={shotOf(w) ?? undefined}
                  alt=""
                  loading="lazy"
                  className="aspect-video w-full rounded bg-muted object-cover object-top"
                  onError={() => setBroken((b) => new Set(b).add(i))}
                />
              ) : (
                <span className="flex aspect-video w-full items-center justify-center rounded bg-muted text-muted-foreground">
                  {w.n}
                </span>
              )}
              <span className="mt-1 line-clamp-2 block">{title(w)}</span>
            </button>
          ))}
        </div>
      ) : null}
      <a href={evidence.url} className="text-xs text-primary hover:underline">
        All evidence for PR #{evidence.pullRequest} on GitHub
      </a>
    </div>
  )
}

/** The selected issue rides in the hash after the tab, so a link opens straight on it. */
const ISSUE_HASH = /^#roadmap\/(\d+)$/

const issueUrl = (issue: number): string =>
  `${window.location.origin}${window.location.pathname}${window.location.search}#roadmap/${issue}`

/** The link to copy goes in the query, which survives the GitHub sign-in that the hash does not. */
const sharedIssueUrl = (issue: number): string =>
  `${window.location.origin}${window.location.pathname}?${TAB_PARAM}=roadmap/${issue}`

function CopyLink({ issue }: { issue: number }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          ?.writeText(sharedIssueUrl(issue))
          .then(() => setCopied(true))
          .catch(() => window.history.replaceState(null, '', issueUrl(issue)))
      }}
      className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
    >
      {copied ? 'Link copied' : 'Copy link'}
    </button>
  )
}

function IssueDetail({
  issue,
  repo,
  runs,
}: {
  issue: IssueJourney
  repo: string
  runs: AgentRun[]
}) {
  const outcome = outcomeOf(issue)
  const log = logOf(issue)
  const tokens = issue.agent.inputTokens + issue.agent.outputTokens
  const facts: [string, string][] = [
    ['Source', SOURCE_LABEL[issue.source]],
    ...(issue.estimate !== null
      ? [
          [
            'Estimate',
            `sp-${issue.estimate}, about ${issue.estimate} human day${issue.estimate === 1 ? '' : 's'}`,
          ] as [string, string],
        ]
      : []),
    ['Open for', duration(openFor(issue))],
    ...(issue.agent.runs > 0
      ? [
          [
            'Agent runs',
            `${issue.agent.runs} run${issue.agent.runs === 1 ? '' : 's'}${
              tokens > 0 ? `, ${(tokens / 1_000_000).toFixed(2)}M tokens` : ''
            }`,
          ] as [string, string],
        ]
      : []),
    ...(runs.some((r) => r.executionSeconds !== null)
      ? [
          [
            'Agent time',
            [...runs]
              .filter((r) => r.executionSeconds !== null)
              .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
              .map((r) => `${r.kind} ${seconds(r.executionSeconds as number)}`)
              .join(', '),
          ] as [string, string],
        ]
      : []),
    ...issue.pullRequests.map(
      (p) =>
        [
          `PR #${p.number}`,
          `${p.byAgent ? 'by the agent' : `by ${p.author ?? 'someone'}`}, +${p.additions} and -${p.deletions} in ${p.changedFiles} files${
            p.mergedAt ? `, merged ${stamp(Date.parse(p.mergedAt))}` : ', not merged'
          }${p.mergeGate ? `, merge gate: ${p.mergeGate}` : ''}`,
        ] as [string, string],
    ),
  ]

  return (
    <div id="roadmap-issue" className="scroll-mt-4 space-y-5 rounded-md border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">#{issue.number}</span>
            <h3 className="text-lg font-semibold">{issue.title}</h3>
            <span
              className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', outcome.className)}
            >
              {outcome.label}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Opened {stamp(Date.parse(issue.createdAt))} by {issue.author ?? 'someone'}
          </p>
        </div>
        <div className="flex gap-2">
          <CopyLink issue={issue.number} />
          <a
            href={`https://github.com/${repo}/issues/${issue.number}`}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            Open on GitHub
          </a>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATE_ORDER.filter((s) => minutesIn(issue, s) > 0).map((s) => (
          <span
            key={s}
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
          >
            <Swatch state={s} />
            {STATES[s].label} <span className="font-semibold">{duration(minutesIn(issue, s))}</span>
          </span>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-6">
          <div>
            <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
              What happened (UTC)
            </p>
            <ol>
              {log.map((line, i) => (
                <li key={`${line.at}-${i}`} className="flex gap-3">
                  <span className="w-24 shrink-0 pt-px font-mono text-xs text-muted-foreground">
                    {stamp(Date.parse(line.at)).replace(/^\w+ /, '')}
                  </span>
                  <span className="flex w-3 shrink-0 flex-col items-center">
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1 size-2.5 shrink-0 rounded-full',
                        TONE_DOT[line.tone as LogTone],
                      )}
                    />
                    {i < log.length - 1 ? (
                      <span aria-hidden className="w-px grow bg-border" />
                    ) : null}
                  </span>
                  <span className="pb-3 text-sm leading-snug">{line.text}</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              From the issue and its pull requests
            </p>
            <dl className="divide-y text-sm">
              {facts.map(([k, v]) => (
                <div key={k} className="flex gap-3 py-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        <div>
          <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">
            Evidence from the merged pull request
          </p>
          <Evidence key={issue.number} issue={issue} />
        </div>
      </div>
    </div>
  )
}

/** Axis steps in seconds; the first that fits the longest run in six ticks or fewer wins. */
const AXIS_STEPS = [30, 60, 120, 300, 600, 900, 1800, 3600]

const tickLabel = (s: number) => (s < 60 ? `${s} s` : s < 3600 ? `${s / 60} min` : `${s / 3600} h`)

const kindLabel = (kind: string) =>
  `${kind.charAt(0).toUpperCase()}${kind.slice(1).replace(/-/g, ' ')}`

const runUrl = (repo: string, run: AgentRun) =>
  `https://github.com/${repo}/actions/runs/${run.runId}`

/**
 * One row per kind of job: the average, the middle and the longest agent step, and every run as
 * a dot on one shared axis, so a slow kind and a slow run both stand out without reading numbers.
 */
function AgentTime({ agents, repo }: { agents?: MetricBlock<AgentSummary>; repo: string }) {
  const kinds = useMemo(() => (agents?.available ? timingByKind(agents.data.runs) : []), [agents])
  const [open, setOpen] = useState<string | null>(null)

  const description =
    'How long the agent itself worked on each run: the Execute OpenCode CLI step, wall clock. The agent colour on the bars below counts from the bot-working label instead, so it also covers the runner setting up before the agent starts and is a few minutes longer.'

  if (!agents?.available || kinds.length === 0) {
    return (
      <Panel title="Agent time by job" description={description}>
        <Unavailable
          reason={
            agents && !agents.available
              ? agents.reason
              : 'No agent run recorded how long its agent step took in this period.'
          }
        />
      </Panel>
    )
  }

  const longest = Math.max(...kinds.map((k) => k.slowest))
  const step = AXIS_STEPS.find((s) => longest / s <= 6) ?? 3600
  const max = Math.max(step, Math.ceil(longest / step) * step)
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step)
  const runs = kinds.reduce((t, k) => t + k.runs.length, 0)
  const total = kinds.reduce((t, k) => t + k.total, 0)
  const row =
    'grid grid-cols-3 items-center gap-x-4 gap-y-2 sm:grid-cols-[10rem_repeat(3,5.5rem)_minmax(0,1fr)]'

  return (
    <Panel title="Agent time by job" description={description}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">{runs}</span> runs,{' '}
            <span className="font-semibold text-foreground">{seconds(total)}</span> of agent time
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-full bg-chart-1" />
            One run
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-full border-2 border-destructive bg-background"
            />
            Run failed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-0.5 bg-foreground" />
            Average
          </span>
          <span>Average, median and longest count successful runs only</span>
        </div>

        <div className="divide-y rounded-md border">
          <div
            className={cn(
              row,
              'hidden px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground sm:grid',
            )}
          >
            <span>Job</span>
            <span>Average</span>
            <span>Median</span>
            <span>Longest</span>
            <span>Each run</span>
          </div>
          {kinds.map((k) => {
            const expanded = open === k.kind
            return (
              <div key={k.kind}>
                <div className={cn(row, 'px-3 py-3')}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : k.kind)}
                    className="col-span-3 flex items-center gap-2 text-left sm:col-span-1"
                  >
                    <ChevronRightIcon
                      aria-hidden
                      className={cn(
                        'size-4 shrink-0 text-muted-foreground transition-transform',
                        expanded && 'rotate-90',
                      )}
                    />
                    <span>
                      <span className="font-medium hover:underline">{kindLabel(k.kind)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {k.runs.length} run{k.runs.length === 1 ? '' : 's'}
                        {k.failed > 0 ? `, ${k.failed} failed` : ''}
                        {k.allFailed ? ', none succeeded' : ''}
                      </span>
                    </span>
                  </button>
                  <span>
                    <span className="block text-xs text-muted-foreground sm:hidden">Average</span>
                    <span className="text-lg font-semibold tabular-nums">{seconds(k.average)}</span>
                  </span>
                  <span className="tabular-nums">
                    <span className="block text-xs text-muted-foreground sm:hidden">Median</span>
                    {seconds(k.median)}
                  </span>
                  <span className="tabular-nums">
                    <span className="block text-xs text-muted-foreground sm:hidden">Longest</span>
                    {seconds(k.longest)}
                  </span>
                  <div className="relative col-span-3 h-7 sm:col-span-1">
                    <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-border" />
                    <span
                      aria-hidden
                      className="absolute inset-y-0.5 w-0.5 -translate-x-1/2 bg-foreground"
                      style={{ left: pct(k.average, max) }}
                    />
                    {k.runs.map((r) => (
                      <a
                        key={r.runId}
                        href={runUrl(repo, r)}
                        title={`${seconds(r.executionSeconds)}${r.issueNumber ? ` on #${r.issueNumber}` : ''}, ${stamp(Date.parse(r.startedAt))}${failedRun(r) ? `, ${r.conclusion}` : ''}`}
                        className={cn(
                          'absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full hover:z-10 hover:scale-150',
                          failedRun(r)
                            ? 'border-2 border-destructive bg-background'
                            : 'bg-chart-1/70 ring-1 ring-background',
                        )}
                        style={{ left: pct(r.executionSeconds, max) }}
                      >
                        <span className="sr-only">
                          {kindLabel(k.kind)} run of {seconds(r.executionSeconds)}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
                {expanded ? <RunList runs={k.runs} repo={repo} longest={k.slowest} /> : null}
              </div>
            )
          })}
          <div className={cn(row, 'px-3 py-2')}>
            <div className="relative col-span-3 h-4 text-xs text-muted-foreground sm:col-span-1 sm:col-start-5">
              {ticks.map((t) => (
                <span
                  key={t}
                  className={cn(
                    'absolute top-0 whitespace-nowrap tabular-nums',
                    t === 0 ? '' : t === max ? '-translate-x-full' : '-translate-x-1/2',
                  )}
                  style={{ left: pct(t, max) }}
                >
                  {tickLabel(t)}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  )
}

/** Every run of one kind, newest first, with a bar scaled to that kind's longest run. */
function RunList({
  runs,
  repo,
  longest,
}: {
  runs: KindTiming['runs']
  repo: string
  longest: number
}) {
  return (
    <ol className="space-y-1 border-t bg-muted/30 px-3 py-3 text-sm">
      {[...runs].reverse().map((r) => (
        <li
          key={r.runId}
          className="grid grid-cols-[6.5rem_4rem_minmax(0,1fr)_4.5rem] items-center gap-3"
        >
          <a
            href={runUrl(repo, r)}
            className="font-mono text-xs text-muted-foreground hover:underline"
          >
            {stamp(Date.parse(r.startedAt)).replace(/^\w+ /, '')}
          </a>
          <span className="text-xs">
            {r.issueNumber ? (
              <a
                href={`https://github.com/${repo}/issues/${r.issueNumber}`}
                className="hover:underline"
              >
                #{r.issueNumber}
              </a>
            ) : (
              <span className="text-muted-foreground">no issue</span>
            )}
          </span>
          <span aria-hidden className="h-2 overflow-hidden rounded-full bg-border">
            <span
              className={cn('block h-full', failedRun(r) ? 'bg-destructive' : 'bg-chart-1')}
              style={{ width: pct(r.executionSeconds, longest) }}
            />
          </span>
          <span className={cn('text-right tabular-nums', failedRun(r) && 'text-destructive')}>
            {seconds(r.executionSeconds)}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function RoadmapView({
  roadmap,
  agents,
  repo,
  from,
  to,
}: {
  roadmap: Roadmap
  agents?: MetricBlock<AgentSummary>
  repo: string
  from: string
  to: string
}) {
  const summary = useMemo(() => summarise(roadmap, from, to), [roadmap, from, to])
  const [filter, setFilter] = useState<Filter>('all')
  const [view, setView] = useState<View>('calendar')
  const issues = useMemo(
    () => roadmap.issues.filter(FILTERS.find((f) => f.id === filter)?.test ?? (() => true)),
    [roadmap, filter],
  )
  const [selected, setSelected] = useState<number | null>(
    () =>
      roadmap.issues.findLast((i) => i.evidence?.waypoints.length)?.number ??
      roadmap.issues.findLast((i) => i.outcome !== 'open')?.number ??
      roadmap.issues.at(-1)?.number ??
      null,
  )
  const current = roadmap.issues.find((i) => i.number === selected) ?? null

  useEffect(() => {
    adoptSharedTab()
    const fromHash = () => {
      const wanted = Number(window.location.hash.match(ISSUE_HASH)?.[1])
      if (!roadmap.issues.some((i) => i.number === wanted)) return
      setSelected(wanted)
      // The tab switches in its own effect, so wait until the detail is laid out to scroll to it.
      let frames = 0
      const scroll = () => {
        const detail = document.getElementById('roadmap-issue')
        if (detail && detail.offsetParent !== null) detail.scrollIntoView({ block: 'start' })
        else if (++frames < 60) requestAnimationFrame(scroll)
      }
      requestAnimationFrame(scroll)
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [roadmap])

  const select = (issue: number) => {
    setSelected(issue)
    window.history.replaceState(null, '', issueUrl(issue))
  }

  const start = Date.parse(from)
  // The axis ends at the period end, or at the end of the day the data was collected.
  const asOf = Date.parse(roadmap.asOf)
  const end = Math.min(Date.parse(to), Math.ceil(asOf / (DAY * MINUTE)) * DAY * MINUTE)
  const alignedEnd = useMemo(() => {
    const lengths = issues.map(openFor).sort((a, b) => a - b)
    const p90 = lengths[Math.floor(lengths.length * 0.9)] ?? 60
    return Math.max(120, Math.ceil(p90 / 60) * 60)
  }, [issues])

  if (roadmap.issues.length === 0) {
    return (
      <Panel title="Roadmap">
        <Unavailable reason="No issue was open during this period." />
      </Panel>
    )
  }

  return (
    <div className="space-y-6">
      <Panel
        title="Roadmap"
        description="How every issue moved from opened to merged, and who had it at each moment. Read from issue labels and linked pull requests."
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-5 rounded-md border bg-muted/30 p-4 sm:grid-cols-5">
            <Stat label="Issues closed" value={summary.closed} hint="in this period" />
            <Stat
              label="Opened to merged"
              explain="roadmapOpenedToMerged"
              value={summary.medianToMerge === null ? 'n/a' : duration(summary.medianToMerge)}
              hint="median, wall clock"
            />
            <Stat
              label="Agent share"
              explain="roadmapAgentShare"
              value={
                summary.agentShare === null ? 'n/a' : `${Math.round(summary.agentShare * 100)}%`
              }
              hint="of the time issues were open"
            />
            <Stat
              label="Stalls"
              explain="roadmapStalls"
              value={summary.stalls}
              tone={summary.stalls > 0 ? 'bad' : undefined}
              hint={`in ${summary.stalledIssues} issue${summary.stalledIssues === 1 ? '' : 's'}${
                summary.failedRuns > 0 ? `, plus ${summary.failedRuns} failed runs` : ''
              }`}
            />
            <Stat
              label="Waiting on a person"
              explain="roadmapWaiting"
              value={summary.waiting.length}
              hint="right now"
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <TimeSplit totals={summary.totals} total={summary.total} />
            </div>
            <Waiting issues={summary.waiting} repo={repo} asOf={roadmap.asOf} />
          </div>
        </div>
      </Panel>

      <AgentTime agents={agents} repo={repo} />

      <Panel
        title="Issue by issue"
        description="Each bar is one issue, placed on the day and hour it was opened. Zoom in and scroll sideways; select an issue to see what happened."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <Chip key={f.id} active={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}
                  <span className="text-xs opacity-70">{roadmap.issues.filter(f.test).length}</span>
                </Chip>
              ))}
            </div>
            <div className="flex gap-2">
              <Chip active={view === 'calendar'} onClick={() => setView('calendar')}>
                Calendar
              </Chip>
              <Chip active={view === 'aligned'} onClick={() => setView('aligned')}>
                Aligned at open
              </Chip>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {STATE_ORDER.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <Swatch state={s} />
                {STATES[s].label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-full bg-destructive" />
              Stalled
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-full border-2 border-destructive" />
              Attempt failed and retried
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-3 bg-foreground [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]"
              />
              Merged
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-3 w-5 bg-muted" />
              Weekend
            </span>
          </div>

          {issues.length === 0 ? (
            <Unavailable reason="No issue matches this filter." />
          ) : (
            <Timeline
              key={view}
              issues={issues}
              view={view}
              start={view === 'calendar' ? start : 0}
              end={view === 'calendar' ? end : alignedEnd}
              selected={selected}
              onSelect={select}
            />
          )}

          {current ? (
            <IssueDetail
              issue={current}
              repo={repo}
              runs={
                agents?.available
                  ? agents.data.runs.filter((r) => r.issueNumber === current.number)
                  : []
              }
            />
          ) : null}
        </div>
      </Panel>
    </div>
  )
}
