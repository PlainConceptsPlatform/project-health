import type { Distribution } from './types.ts'

export const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0] as number
  const rank = (p / 100) * (sorted.length - 1)
  const low = Math.floor(rank)
  const high = Math.ceil(rank)
  const lowValue = sorted[low] as number
  if (low === high) return lowValue
  const highValue = sorted[high] as number
  return lowValue + (highValue - lowValue) * (rank - low)
}

export const distribution = (values: number[]): Distribution => {
  const sorted = [...values].sort((a, b) => a - b)
  const round = (n: number) => Math.round(n * 100) / 100
  return {
    count: sorted.length,
    p50Hours: round(percentile(sorted, 50)),
    p75Hours: round(percentile(sorted, 75)),
    p90Hours: round(percentile(sorted, 90)),
  }
}

export const hoursBetween = (from: string, to: string): number =>
  (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000

export const median = (values: number[]): number | null => {
  if (values.length === 0) return null
  return (
    Math.round(
      percentile(
        [...values].sort((a, b) => a - b),
        50,
      ) * 100,
    ) / 100
  )
}

/** Percentiles in the unit of the input values, for series that are not measured in hours. */
export const percentiles = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const round = (n: number) => Math.round(n * 100) / 100
  return {
    count: sorted.length,
    p50: round(percentile(sorted, 50)),
    p75: round(percentile(sorted, 75)),
    p90: round(percentile(sorted, 90)),
  }
}
