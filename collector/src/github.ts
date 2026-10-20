import { createSign } from 'node:crypto'

const API = 'https://api.github.com'

const BASE_HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'plainconcepts-project-health',
}

/**
 * GitHub App credentials, when the collector is given them. An installation token lasts one hour and
 * a collection can take longer, so with these the collector mints its own token and mints a new one
 * before it expires, instead of carrying on with a dead token and writing every later project as
 * unavailable.
 */
interface AppCredentials {
  appId: string
  privateKey: string
  owner: string
}

function appCredentials(): AppCredentials | null {
  const appId = process.env.GITHUB_APP_ID
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
  const owner = process.env.GITHUB_APP_OWNER ?? process.env.GITHUB_REPOSITORY_OWNER
  if (!appId || !privateKey || !owner) return null
  // A key pasted into a secret with escaped newlines is still a valid key.
  return { appId, privateKey: privateKey.replace(/\\n/g, '\n'), owner }
}

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url')

/** The short lived JWT an App signs to ask for an installation token. */
export function appJwt(appId: string, privateKey: string, now = Date.now()): string {
  const seconds = Math.floor(now / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  // Backdated a minute against clock drift; GitHub refuses an expiry more than ten minutes ahead.
  const payload = base64url(JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: appId }))
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey)
  return `${header}.${payload}.${base64url(signature)}`
}

/** A minted token is replaced this long before it expires, so no request goes out with a dead one. */
const REFRESH_MARGIN_MS = 10 * 60_000

interface MintedToken {
  token: string
  expiresAt: number
}

let appToken: MintedToken | null = null
let minting: Promise<MintedToken> | null = null

async function mintInstallationToken(app: AppCredentials): Promise<MintedToken> {
  const headers = { ...BASE_HEADERS, authorization: `Bearer ${appJwt(app.appId, app.privateKey)}` }
  let installation = await fetch(`${API}/orgs/${app.owner}/installation`, { headers })
  if (installation.status === 404) {
    installation = await fetch(`${API}/users/${app.owner}/installation`, { headers })
  }
  if (!installation.ok) {
    throw new Error(`App installation for ${app.owner} answered ${installation.status}`)
  }
  const { id } = (await installation.json()) as { id: number }
  const minted = await fetch(`${API}/app/installations/${id}/access_tokens`, {
    method: 'POST',
    headers,
  })
  if (!minted.ok) throw new Error(`App installation token answered ${minted.status}`)
  const body = (await minted.json()) as { token: string; expires_at: string }
  return { token: body.token, expiresAt: Date.parse(body.expires_at) }
}

/**
 * The token for the next request: the App's own, refreshed before it expires, when App credentials
 * are set, and otherwise GITHUB_TOKEN or METRICS_TOKEN. If minting fails the given token is used, so
 * App credentials never make a run worse than it was without them.
 */
async function currentToken(forceRefresh = false): Promise<string> {
  const fallback = process.env.GITHUB_TOKEN ?? process.env.METRICS_TOKEN
  const app = appCredentials()
  if (app) {
    const fresh = appToken !== null && appToken.expiresAt - Date.now() > REFRESH_MARGIN_MS
    if (!fresh || forceRefresh) {
      minting ??= mintInstallationToken(app).finally(() => {
        minting = null
      })
      try {
        appToken = await minting
      } catch (error) {
        if (!fallback) throw error
        console.warn(`Could not mint an App token, using GITHUB_TOKEN: ${String(error)}`)
        appToken = null
        return fallback
      }
    }
    if (appToken) return appToken.token
  }
  if (!fallback) {
    throw new Error('Set GITHUB_TOKEN or METRICS_TOKEN before running the collector.')
  }
  return fallback
}

/** For tests: forget the minted token so the next request mints again. */
export function resetAppToken() {
  appToken = null
  minting = null
}

/**
 * Resolved on first request rather than at import. A module that throws when it is loaded cannot be
 * imported by a test, or even for its types, which is how this file ended up untestable.
 */
async function authHeaders(forceRefresh = false): Promise<Record<string, string>> {
  return { ...BASE_HEADERS, authorization: `Bearer ${await currentToken(forceRefresh)}` }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const MAX_ATTEMPTS = 5
const REQUEST_TIMEOUT_MS = 45_000

async function request(path: string, attempt = 0, reauthed = false): Promise<Response> {
  const url = path.startsWith('http') ? path : `${API}${path}`

  let response: Response
  try {
    response = await fetch(url, {
      headers: await authHeaders(reauthed),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    // fetch itself throwing means a network or timeout failure rather than an HTTP error. An
    // unattended daily job hits these, and without a retry here a single blip turns a whole
    // project into an unavailable metric for that month.
    if (attempt < MAX_ATTEMPTS) {
      await sleep(Math.min(2 ** attempt * 1000, 30_000))
      return request(path, attempt + 1, reauthed)
    }
    throw error
  }

  // A 401 with App credentials means the minted token was revoked or expired early: mint a new one
  // and try once more.
  if (response.status === 401 && !reauthed && appCredentials()) {
    return request(path, attempt, true)
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
    return request(path, attempt + 1, reauthed)
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
      headers: await authHeaders(),
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
  head_branch?: string | null
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
