const API = 'https://api.github.com'

/**
 * Resolved on first request rather than at import. A module that throws when it is loaded cannot be
 * imported by a test, or even for its types, which is how this file ended up untestable.
 */
function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN ?? process.env.METRICS_TOKEN
  if (!token) {
    throw new Error('Set GITHUB_TOKEN or METRICS_TOKEN before running the collector.')
  }
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'plainconcepts-project-health',
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const MAX_ATTEMPTS = 5
const REQUEST_TIMEOUT_MS = 45_000

async function request(path: string, attempt = 0): Promise<Response> {
  const url = path.startsWith('http') ? path : `${API}${path}`

  let response: Response
  try {
    response = await fetch(url, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    // fetch itself throwing means a network or timeout failure rather than an HTTP error. An
    // unattended daily job hits these, and without a retry here a single blip turns a whole
    // project into an unavailable metric for that month.
    if (attempt < MAX_ATTEMPTS) {
      await sleep(Math.min(2 ** attempt * 1000, 30_000))
      return request(path, attempt + 1)
    }
    throw error
  }

  // A 403 means either a spent rate limit or a permission the token does not have. An App
  // installation token answers 403 for a missing permission where a fine grained PAT answers 404,
  // and retrying that five times just delays a failure that will never succeed, so the two are
  // told apart by the rate limit headers.
  const remaining = response.headers.get('x-ratelimit-remaining')
  const reset = Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000
  const throttled = remaining === '0' || response.headers.get('retry-after') !== null

  const retryable =
    response.status === 429 || response.status >= 500 || (response.status === 403 && throttled)

  if (retryable && attempt < MAX_ATTEMPTS) {
    const waitForReset = remaining === '0' && reset > Date.now() ? reset - Date.now() + 1000 : 0
    const backoff = Math.max(waitForReset, 2 ** attempt * 1000)
    await sleep(Math.min(backoff, 60_000))
    return request(path, attempt + 1)
  }
  return response
}

/** Returns null on 404 so a missing resource degrades instead of throwing. */
export async function get<T>(path: string): Promise<T | null> {
  const response = await request(path)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`GET ${path} failed with ${response.status}`)
  return (await response.json()) as T
}

/** Walks the Link header until the last page. Returns an empty array when the resource is gone. */
export async function paginate<T>(path: string, maxPages = 20): Promise<T[]> {
  const items: T[] = []
  let next: string | null = path
  let pages = 0

  while (next && pages < maxPages) {
    const response: Response = await request(next)
    if (response.status === 404) return items
    if (!response.ok) throw new Error(`GET ${next} failed with ${response.status}`)

    // Most list endpoints return a bare array, but some (workflow runs, artifacts, jobs) wrap the
    // list in an object alongside total_count. Take the first array-valued property in that case.
    const page = (await response.json()) as T[] | Record<string, unknown>
    if (Array.isArray(page)) {
      items.push(...page)
    } else {
      const wrapped = Object.values(page).find((value) => Array.isArray(value)) as T[] | undefined
      items.push(...(wrapped ?? []))
    }

    const link = response.headers.get('link') ?? ''
    const match = link.split(',').find((part) => part.includes('rel="next"'))
    next = match ? (match.match(/<([^>]+)>/)?.[1] ?? null) : null
    pages += 1
  }
  return items
}

/**
 * Downloads an artifact zip. Returns null when it is expired, absent, or unreadable.
 *
 * The download endpoint answers with a redirect to blob storage on a different host. That host
 * rejects requests that still carry the GitHub Authorization header, and the signed URL does not
 * need it, so the redirect is followed manually with the header dropped. Letting fetch follow it
 * automatically forwards the header and every download comes back empty.
 */
export async function getBinary(path: string): Promise<Uint8Array | null> {
  const url = path.startsWith('http') ? path : `${API}${path}`

  let response: Response
  try {
    response = await fetch(url, {
      headers: authHeaders(),
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    return null
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (!location) return null
    try {
      const blob = await fetch(location, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      if (!blob.ok) return null
      return new Uint8Array(await blob.arrayBuffer())
    } catch {
      return null
    }
  }

  if (!response.ok) return null
  return new Uint8Array(await response.arrayBuffer())
}

export interface Deployment {
  id: number
  sha: string
  ref: string
  task: string
  environment: string
  created_at: string
  creator?: { login: string } | null
}

export interface DeploymentStatus {
  state: string
  created_at: string
}

export interface CompareResult {
  commits: { sha: string; commit: { author: { date: string }; committer: { date: string } } }[]
}

export interface Issue {
  number: number
  title: string
  state: string
  created_at: string
  closed_at: string | null
  labels: { name: string }[]
  pull_request?: unknown
  updated_at?: string
  body?: string | null
  user?: Actor | null
}

export interface Actor {
  login: string
  type?: string
}

/** One entry of /issues/{n}/timeline. Only the fields the roadmap reads. */
export interface TimelineEvent {
  event: string
  created_at?: string
  actor?: Actor | null
  /** Set on commented events instead of actor. */
  user?: Actor | null
  body?: string | null
  label?: { name: string }
  source?: {
    issue?: {
      number: number
      pull_request?: { merged_at?: string | null } | null
      repository?: { full_name: string }
    }
  }
}

export interface PullRequestDetail {
  number: number
  title: string
  body: string | null
  user: Actor | null
  created_at: string
  merged_at: string | null
  merged_by: Actor | null
  additions: number
  deletions: number
  changed_files: number
}

export interface IssueComment {
  body?: string | null
  user?: Actor | null
  created_at: string
  html_url?: string
  /** The issue or pull request the comment is on, as an API URL ending in its number. */
  issue_url?: string
}

export interface PullRequest {
  number: number
  merged_at: string | null
  base: { ref: string }
  labels: { name: string }[]
}

export interface WorkflowRun {
  id: number
  name: string
  display_title: string
  triggering_actor?: { login: string } | null
  actor?: { login: string } | null
  conclusion: string | null
  status: string
  run_started_at: string
  created_at: string
}

export interface Job {
  id: number
  name: string
  conclusion: string | null
  steps?: { name: string; started_at: string | null; completed_at: string | null }[]
}

export interface Artifact {
  id: number
  name: string
  expired: boolean
  created_at?: string
  /** Present on the repository-wide artifact list, absent on some older per-run responses. */
  workflow_run?: {
    id: number
    repository_id?: number
    head_repository_id?: number
    head_branch: string | null
    head_sha: string
  } | null
}
