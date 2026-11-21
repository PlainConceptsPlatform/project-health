/**
 * View state in the query string: filters, search, sort and the open tab.
 *
 * GitHub Pages serves this site behind the GitHub sign-in, and its redirect keeps the query but
 * drops the hash, so anything a shared link has to reopen lives in the query. The hash is kept for
 * what only matters once the page is open: the project tab and the section inside it.
 *
 * Plain URLSearchParams and history.replaceState, with no Next router: the static export cannot use
 * useSearchParams outside a Suspense boundary, and nothing here needs a navigation. The pure
 * functions take and return strings so they can be tested without a browser.
 */
/** The query parameter a shared link uses for what would otherwise follow the hash. */
export const TAB_PARAM = 'tab'

export type QueryValue = string | readonly string[] | null | undefined

/** A comma list, as `level=0,1`. Empty and unknown values are dropped by the caller's allowlist. */
export function readList(params: URLSearchParams, key: string, allowed?: readonly string[]) {
  const values = (params.get(key) ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  const known = allowed ? values.filter((v) => allowed.includes(v)) : values
  return [...new Set(known)]
}

/** One value, or the fallback when it is missing or not one of the allowed values. */
export function readOne<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = params.get(key)
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/**
 * The query string with `updates` applied. A null, empty string or empty list removes the key, so
 * the default view keeps a clean URL. Keys not named in `updates` are kept as they are.
 */
export function withQuery(search: string, updates: Record<string, QueryValue>): string {
  const params = new URLSearchParams(search)
  for (const [key, value] of Object.entries(updates)) {
    const text = Array.isArray(value) ? value.join(',') : (value as string | null | undefined)
    if (text) params.set(key, text)
    else params.delete(key)
  }
  const query = params.toString().replace(/%2C/g, ',')
  return query ? `?${query}` : ''
}

/** Writes the query in place: no navigation, no history entry, the hash untouched. */
export function writeQuery(updates: Record<string, QueryValue>): void {
  const { pathname, search, hash } = window.location
  const next = withQuery(search, updates)
  if (next === search) return
  window.history.replaceState(window.history.state, '', `${pathname}${next}${hash}`)
}

/**
 * The URL a shared link lands on, turned into the one the page reads: ?tab=roadmap/773 moves into
 * #roadmap/773 and every other key stays in the query. Returns null when there is nothing to move.
 */
export function adoptedUrl(pathname: string, search: string): string | null {
  const params = new URLSearchParams(search)
  const shared = params.get(TAB_PARAM)
  if (!shared) return null
  params.delete(TAB_PARAM)
  const rest = params.toString().replace(/%2C/g, ',')
  return `${pathname}${rest ? `?${rest}` : ''}#${shared}`
}

/**
 * Moves ?tab=roadmap/773 into #roadmap/773. Panels read the hash in effects that can run before the
 * tabs' own, so each of them calls this first; after the first call it does nothing.
 */
export function adoptSharedTab(): void {
  const next = adoptedUrl(window.location.pathname, window.location.search)
  if (next) window.history.replaceState(null, '', next)
}

/**
 * The link to share for the current view: the query as it is, with the hash moved into ?tab= so it
 * survives the sign-in redirect.
 */
export function sharedUrl(href: string): string {
  const url = new URL(href)
  const hash = url.hash.slice(1)
  url.hash = ''
  if (hash) url.searchParams.set(TAB_PARAM, hash)
  return url.toString().replace(/%2C/g, ',').replace(/%2F/g, '/')
}

/** Where the overview's own query is kept, so "Back to projects" reopens the same view. */
export const OVERVIEW_QUERY_KEY = 'project-health:overview-query'

export function rememberOverviewQuery(search: string): void {
  // nosemgrep: platform-hygiene-ts-empty-catch -- blocked storage only means the back link opens the default view
  try {
    window.sessionStorage.setItem(OVERVIEW_QUERY_KEY, search)
  } catch {}
}

export function recalledOverviewQuery(): string {
  try {
    const value = window.sessionStorage.getItem(OVERVIEW_QUERY_KEY) ?? ''
    return value.startsWith('?') ? value : ''
  } catch {
    return ''
  }
}
