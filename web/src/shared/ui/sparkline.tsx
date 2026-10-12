import { cn } from '../lib/utils'

/**
 * A score trend small enough for a table cell. Plain SVG rather than a chart component, because a
 * table of them should render on the server with no client script. Gaps stay gaps: a month without
 * a score breaks the line instead of being drawn as zero.
 */
export function Sparkline({
  points,
  max = 100,
  width = 104,
  height = 28,
  label,
  className,
}: {
  points: { month: string; score: number | null }[]
  max?: number
  width?: number
  height?: number
  label: string
  className?: string
}) {
  const pad = 3
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0
  const x = (i: number) => (points.length > 1 ? pad + i * step : width / 2)
  const y = (v: number) => pad + (1 - v / max) * (height - pad * 2)

  const segments: string[] = []
  let current: string[] = []
  points.forEach((p, i) => {
    if (p.score === null) {
      if (current.length > 0) segments.push(current.join(' '))
      current = []
      return
    }
    current.push(`${current.length === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`)
  })
  if (current.length > 0) segments.push(current.join(' '))

  const lastIndex = points.findLastIndex((p) => p.score !== null)
  const last = lastIndex >= 0 ? points[lastIndex] : undefined
  const summary = points.map((p) => `${p.month} ${p.score ?? 'n/a'}`).join(', ')

  return (
    <svg
      role="img"
      aria-label={`${label}: ${summary}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
    >
      <title>{`${label}: ${summary}`}</title>
      <line
        x1={pad}
        x2={width - pad}
        y1={height - pad}
        y2={height - pad}
        stroke="var(--border)"
        strokeDasharray="2 2"
      />
      {segments.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="var(--color-chart-1)"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {last && last.score !== null ? (
        <circle cx={x(lastIndex)} cy={y(last.score)} r={2.5} fill="var(--color-chart-1)" />
      ) : null}
    </svg>
  )
}
