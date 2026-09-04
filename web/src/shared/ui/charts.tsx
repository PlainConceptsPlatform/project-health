'use client'

import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, XAxis, YAxis } from 'recharts'
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from './chart'

/**
 * Charts are limited to the first two slots of the Foundations chart ramp on purpose.
 *
 * Running the palette validator over all five slots fails: chart-4 (error-500) against chart-3
 * (success-700) separates by only 3.5 in OKLab for protanopia, a red against green collision, and
 * success-700 sits under the chroma floor so it reads gray. Slots 1 and 2 separate by 32.3 in light
 * and 37.4 in dark, the widest of any pair in the ramp.
 *
 * Every multi series chart therefore also carries a legend and direct labels, so identity never
 * depends on colour alone. That also covers the one check the pair does not pass: chart-2 in dark
 * mode is brighter than the recommended lightness band, which is a property of the Foundations dark
 * ramp rather than something a single chart should override.
 */
const SERIES_1 = 'var(--color-chart-1)'
const SERIES_2 = 'var(--color-chart-2)'

const AXIS = {
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
  className: 'text-xs fill-muted-foreground',
} as const

const grid = <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />

/** Releases per day across the month. One series, so no legend: the title names it. */
export function ReleasesPerDay({ data }: { data: { day: string; releases: number }[] }) {
  const config = { releases: { label: 'Releases', color: SERIES_1 } } satisfies ChartConfig
  return (
    <ChartContainer config={config} className="h-[180px] w-full">
      <BarChart data={data} barCategoryGap={2}>
        {grid}
        <XAxis dataKey="day" {...AXIS} interval="preserveStartEnd" />
        <YAxis allowDecimals={false} width={28} {...AXIS} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar
          dataKey="releases"
          fill="var(--color-releases)"
          radius={[4, 4, 0, 0]}
          maxBarSize={22}
        />
      </BarChart>
    </ChartContainer>
  )
}

/** Tokens per agent kind. Two series, so legend plus a direct label on every bar. */
export function TokensByKind({
  data,
}: {
  data: { kind: string; input: number; output: number }[]
}) {
  const config = {
    input: { label: 'Input', color: SERIES_1 },
    output: { label: 'Output', color: SERIES_2 },
  } satisfies ChartConfig
  const millions = (v: number) =>
    v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${Math.round(v / 1000)}K`
  // Recharts types a label formatter as accepting string | number | undefined.
  const millionsLabel = (v: unknown) => millions(Number(v ?? 0))

  return (
    <ChartContainer config={config} className="h-[200px] w-full">
      <BarChart data={data} barGap={2}>
        {grid}
        <XAxis dataKey="kind" {...AXIS} />
        <YAxis width={44} tickFormatter={millions} {...AXIS} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="input" fill="var(--color-input)" radius={[4, 4, 0, 0]} maxBarSize={44}>
          <LabelList
            dataKey="input"
            position="top"
            offset={6}
            formatter={millionsLabel}
            className="fill-muted-foreground text-[10px]"
          />
        </Bar>
        <Bar dataKey="output" fill="var(--color-output)" radius={[4, 4, 0, 0]} maxBarSize={44}>
          <LabelList
            dataKey="output"
            position="top"
            offset={6}
            formatter={millionsLabel}
            className="fill-muted-foreground text-[10px]"
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

/** Agent step duration per kind, median against the slow tail. */
export function DurationByKind({ data }: { data: { kind: string; p50: number; p90: number }[] }) {
  const config = {
    p50: { label: 'Median', color: SERIES_1 },
    p90: { label: 'p90', color: SERIES_2 },
  } satisfies ChartConfig
  const mins = (v: number) => (v >= 60 ? `${Math.round(v / 60)}m` : `${Math.round(v)}s`)
  const minsLabel = (v: unknown) => mins(Number(v ?? 0))

  return (
    <ChartContainer config={config} className="h-[200px] w-full">
      <BarChart data={data} layout="vertical" barGap={2}>
        <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis type="number" tickFormatter={mins} {...AXIS} />
        <YAxis type="category" dataKey="kind" width={80} {...AXIS} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="p50" fill="var(--color-p50)" radius={[0, 4, 4, 0]} maxBarSize={18}>
          <LabelList
            dataKey="p50"
            position="right"
            offset={6}
            formatter={minsLabel}
            className="fill-muted-foreground text-[10px]"
          />
        </Bar>
        <Bar dataKey="p90" fill="var(--color-p90)" radius={[0, 4, 4, 0]} maxBarSize={18}>
          <LabelList
            dataKey="p90"
            position="right"
            offset={6}
            formatter={minsLabel}
            className="fill-muted-foreground text-[10px]"
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

/** Who did something, one series, horizontal so long logins stay readable. */
export function PeopleBars({
  data,
  label,
}: {
  data: { login: string; count: number }[]
  label: string
}) {
  const config = { count: { label, color: SERIES_1 } } satisfies ChartConfig
  return (
    <ChartContainer config={config} className="h-[170px] w-full">
      <BarChart data={data} layout="vertical" barCategoryGap={4}>
        <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
        <XAxis type="number" allowDecimals={false} {...AXIS} />
        <YAxis type="category" dataKey="login" width={130} {...AXIS} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} maxBarSize={18}>
          <LabelList
            dataKey="count"
            position="right"
            offset={6}
            className="fill-muted-foreground text-[10px]"
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

/** Releases and lead time across the collected months. Needs at least two months to say anything. */
export function MonthlyTrend({
  data,
}: {
  data: { month: string; releases: number; leadTimeHours: number | null }[]
}) {
  const config = {
    releases: { label: 'Releases', color: SERIES_1 },
  } satisfies ChartConfig
  return (
    <ChartContainer config={config} className="h-[180px] w-full">
      <LineChart data={data}>
        {grid}
        <XAxis dataKey="month" {...AXIS} />
        <YAxis allowDecimals={false} width={28} {...AXIS} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Line
          dataKey="releases"
          type="monotone"
          stroke="var(--color-releases)"
          strokeWidth={2}
          dot={{ r: 4, strokeWidth: 2 }}
        />
      </LineChart>
    </ChartContainer>
  )
}
