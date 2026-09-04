export const hours = (value: number): string => {
  if (value < 1) return `${Math.round(value * 60)} min`
  if (value < 48) return `${Math.round(value * 10) / 10} h`
  return `${Math.round(value / 24)} d`
}

export const seconds = (value: number): string => {
  if (value < 60) return `${Math.round(value)} s`
  const m = Math.floor(value / 60)
  const s = Math.round(value % 60)
  return m < 60 ? `${m}m ${s}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

export const tokens = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

export const percent = (value: number): string => `${Math.round(value * 1000) / 10}%`

export const monthName = (month: string): string => {
  const [year, m] = month.split('-')
  const date = new Date(Date.UTC(Number(year), Number(m) - 1, 1))
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  })

export const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
