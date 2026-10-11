import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { type Artifact, getBinary, paginate } from '../github.ts'
import {
  type EngineeringExcellence,
  FACETS,
  type Facet,
  type FacetDataMap,
  type FacetSample,
  type FacetSeries,
  type MetricBlock,
  type ProjectConfig,
  type Warning,
  ok,
  skip,
} from '../types.ts'
import { mapLimit } from './agents.ts'

export const DEFAULT_BRANCH = 'main'
export const DEFAULT_ARTIFACT_PREFIX = 'engineering-excellence-'

/** The artifact list is newest first and 100 a page, so ten pages reach past the 90 day expiry. */
const MAX_ARTIFACT_PAGES = 10
/** One per main push. A month above this is unusual, and the newest commits are the ones kept. */
const MAX_DOWNLOADS_PER_FACET = 200
const CONCURRENCY = 6

const schemaPath = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'schema',
  'engineering-excellence-facets.schema.json',
)

interface JsonSchema {
  $ref?: string
  type?: string | string[]
  enum?: unknown[]
  minimum?: number
  maximum?: number
  required?: string[]
  properties?: Record<string, JsonSchema>
  additionalProperties?: boolean | JsonSchema
  items?: JsonSchema
  $defs?: Record<string, JsonSchema>
}

let cachedSchema: JsonSchema | null = null
const facetSchema = (): JsonSchema => {
  cachedSchema ??= JSON.parse(readFileSync(schemaPath, 'utf8')) as JsonSchema
  return cachedSchema
}

const typeOf = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v

/**
 * The subset of JSON Schema the facet contract uses: local $ref, type, enum, minimum, maximum,
 * required, properties, additionalProperties and items. The producer validates with the same subset
 * before uploading, so a facet that passed there passes here, without adding a validator dependency.
 */
export function validate(
  value: unknown,
  schema: JsonSchema,
  path = '$',
  root: JsonSchema = schema,
): string[] {
  if (schema.$ref) {
    const target = schema.$ref
      .replace(/^#\//, '')
      .split('/')
      .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], root)
    if (!target) return [`${path}: unresolved $ref ${schema.$ref}`]
    return validate(value, target as JsonSchema, path, root)
  }

  const types = ([] as string[]).concat(schema.type ?? [])
  if (types.length > 0) {
    const actual = typeOf(value)
    const matches = types.some((t) => t === actual || (t === 'number' && actual === 'integer'))
    if (!matches) return [`${path}: expected ${types.join('|')}, got ${actual}`]
  }

  const errors: string[] = []
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`)
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: ${value} is below ${schema.minimum}`)
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: ${value} is above ${schema.maximum}`)
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const key of schema.required ?? []) {
      if (!(key in record)) errors.push(`${path}: missing '${key}'`)
    }
    for (const [key, child] of Object.entries(record)) {
      const sub =
        schema.properties?.[key] ??
        (typeof schema.additionalProperties === 'object' ? schema.additionalProperties : null)
      if (sub) errors.push(...validate(child, sub, `${path}.${key}`, root))
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected '${key}'`)
    }
  }
  if (Array.isArray(value) && schema.items) {
    const items = schema.items
    value.forEach((child, i) => errors.push(...validate(child, items, `${path}[${i}]`, root)))
  }
  return errors
}

export interface Envelope<F extends Facet> {
  schemaVersion: 1
  facet: F
  repo: string | null
  ref: string | null
  commitSha: string | null
  runId: number | null
  runAttempt?: number | null
  generatedAt: string
  data: FacetDataMap[F]
}

export type FacetRead<F extends Facet> =
  | { ok: true; envelope: Envelope<F> }
  | { ok: false; kind: 'missing' | 'mismatch'; reason: string }

/**
 * Reads and checks `<facet>.json` out of an unzipped artifact.
 *
 * A wrong schemaVersion, facet, repository or ref is a mismatch rather than data. The repository
 * and ref are checked because a renamed artifact prefix, or a fork whose CI uploads under the same
 * name, would otherwise put another codebase's numbers on this project's page. Either may be null
 * when the producer ran outside Actions; that is accepted, since the artifact was listed from this
 * repository's own branch runs.
 */
export function readFacet<F extends Facet>(
  files: Record<string, Uint8Array>,
  facet: F,
  repo: string,
  branch: string,
): FacetRead<F> {
  const entry = Object.entries(files).find(
    ([name]) => name === `${facet}.json` || name.endsWith(`/${facet}.json`),
  )
  if (!entry) return { ok: false, kind: 'missing', reason: `the artifact has no ${facet}.json` }

  let doc: unknown
  try {
    doc = JSON.parse(new TextDecoder().decode(entry[1]))
  } catch {
    return { ok: false, kind: 'mismatch', reason: `${facet}.json is not valid JSON` }
  }

  const schema = facetSchema()
  const envelopeSchema = schema.$defs?.envelope
  const dataSchema = schema.$defs?.[facet]
  if (!envelopeSchema || !dataSchema) {
    return { ok: false, kind: 'mismatch', reason: `the facet schema does not define ${facet}` }
  }

  const envelopeErrors = validate(doc, envelopeSchema, '$', schema)
  if (envelopeErrors.length > 0) {
    return { ok: false, kind: 'mismatch', reason: envelopeErrors.slice(0, 3).join('; ') }
  }

  const envelope = doc as Envelope<F>
  if (envelope.facet !== facet) {
    return {
      ok: false,
      kind: 'mismatch',
      reason: `the artifact for ${facet} carries the ${envelope.facet} facet`,
    }
  }
  if (envelope.repo !== null && envelope.repo.toLowerCase() !== repo.toLowerCase()) {
    return {
      ok: false,
      kind: 'mismatch',
      reason: `the facet was produced for ${envelope.repo}, not ${repo}`,
    }
  }
  if (envelope.ref !== null && envelope.ref !== `refs/heads/${branch}`) {
    return {
      ok: false,
      kind: 'mismatch',
      reason: `the facet was produced on ${envelope.ref}, not refs/heads/${branch}`,
    }
  }

  const dataErrors = validate(envelope.data, dataSchema, '$.data', schema)
  if (dataErrors.length > 0) {
    return { ok: false, kind: 'mismatch', reason: dataErrors.slice(0, 3).join('; ') }
  }

  return { ok: true, envelope }
}

/**
 * Which listed artifacts are worth downloading for one month.
 *
 * Found by name rather than by workflow, because a repository can run its CI as a reusable workflow
 * inside a deployment workflow on main, so the uploading run is not the workflow that owns the job.
 * The month is the artifact's creation time, the same window every other metric uses. One artifact
 * per commit is kept, the newest, which is the latest attempt when a run was re-run.
 */
export function selectArtifacts(
  artifacts: Artifact[],
  options: { name: string; branch: string; from: Date; to: Date; known: Set<number> },
): Artifact[] {
  const eligible = artifacts.filter((artifact) => {
    if (artifact.name !== options.name || artifact.expired) return false
    if (options.known.has(artifact.id)) return false
    const run = artifact.workflow_run
    if (!run || run.head_branch !== options.branch) return false
    // A pull request from a fork's own main branch reports head_branch "main" as well.
    if (
      run.repository_id !== undefined &&
      run.head_repository_id !== undefined &&
      run.repository_id !== run.head_repository_id
    ) {
      return false
    }
    if (!artifact.created_at) return false
    const at = new Date(artifact.created_at)
    return at >= options.from && at < options.to
  })

  eligible.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
  const seen = new Set<string>()
  const newestPerCommit = eligible.filter((artifact) => {
    const sha = artifact.workflow_run?.head_sha ?? `artifact:${artifact.id}`
    if (seen.has(sha)) return false
    seen.add(sha)
    return true
  })
  return newestPerCommit.slice(0, MAX_DOWNLOADS_PER_FACET)
}

/** Drops the per-module detail kept only on the latest sample. See FacetSeries. */
export function summarize<F extends Facet>(facet: F, data: FacetDataMap[F]): FacetDataMap[F] {
  const withoutModules = (scopes: Record<string, { modules?: unknown }>) =>
    Object.fromEntries(
      Object.entries(scopes).map(([name, { modules: _modules, ...rest }]) => [name, rest]),
    )

  switch (facet) {
    case 'coverage':
    case 'mutation': {
      const d = data as { scopes: Record<string, { modules?: unknown }> }
      return { ...d, scopes: withoutModules(d.scopes) } as FacetDataMap[F]
    }
    case 'complexity': {
      const { hotspots: _hotspots, ...d } = data as FacetDataMap['complexity']
      return { ...d, scopes: withoutModules(d.scopes) } as FacetDataMap[F]
    }
    case 'sbom': {
      const { licenses: _licenses, ...d } = data as FacetDataMap['sbom']
      return d as FacetDataMap[F]
    }
    default:
      return data
  }
}

const sampleKey = (s: FacetSample<unknown>) =>
  s.commitSha ?? (s.runId !== null ? `run:${s.runId}` : `artifact:${s.artifactId}`)

/** True when a should replace b for the same commit: a later attempt, then a later write. */
const supersedes = (a: FacetSample<unknown>, b: FacetSample<unknown>) => {
  const attemptA = a.runAttempt ?? 0
  const attemptB = b.runAttempt ?? 0
  if (attemptA !== attemptB) return attemptA > attemptB
  return a.generatedAt > b.generatedAt
}

/**
 * Folds freshly downloaded samples into the ones already stored for the month.
 *
 * Artifacts expire after about 90 days, so the stored month file is the durable record, exactly as
 * it is for agent runs. A sample read once is never lost because its artifact later disappeared.
 * `fresh` carries full data; stored samples are summaries, and the stored `latest` is reused when
 * the newest sample is one that was read on an earlier day.
 */
export function mergeSamples<F extends Facet>(
  facet: F,
  previous: FacetSeries<FacetDataMap[F]> | null,
  fresh: FacetSample<FacetDataMap[F]>[],
): FacetSeries<FacetDataMap[F]> | null {
  const byCommit = new Map<string, FacetSample<FacetDataMap[F]>>()
  const consider = (sample: FacetSample<FacetDataMap[F]>) => {
    const key = sampleKey(sample)
    const current = byCommit.get(key)
    if (!current || supersedes(sample, current)) byCommit.set(key, sample)
  }
  for (const sample of previous?.samples ?? []) consider(sample)
  for (const sample of fresh) consider(sample)

  const merged = [...byCommit.values()].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))
  const newest = merged.at(-1)
  if (!newest) return null

  const freshNewest = fresh.find((s) => s.artifactId === newest.artifactId)
  const latest =
    freshNewest?.data ??
    (previous && previous.latestGeneratedAt === newest.generatedAt ? previous.latest : newest.data)

  return {
    samples: merged.map((s) => ({ ...s, data: summarize(facet, s.data) })),
    latest,
    latestGeneratedAt: newest.generatedAt,
  }
}

export interface ArtifactSource {
  list: (name: string) => Promise<Artifact[]>
  download: (artifactId: number) => Promise<Uint8Array | null>
}

export const githubSource = (repo: string): ArtifactSource => ({
  list: (name) =>
    paginate<Artifact>(
      `/repos/${repo}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=100`,
      MAX_ARTIFACT_PAGES,
    ),
  download: (id) => getBinary(`/repos/${repo}/actions/artifacts/${id}/zip`),
})

export interface EngineeringExcellenceResult {
  block: EngineeringExcellence
  warnings: Warning[]
}

async function collectFacet<F extends Facet>(
  facet: F,
  project: ProjectConfig,
  from: Date,
  to: Date,
  previous: MetricBlock<FacetSeries<FacetDataMap[F]>> | undefined,
  source: ArtifactSource,
  warnings: Warning[],
): Promise<MetricBlock<FacetSeries<FacetDataMap[F]>>> {
  const config = project.engineeringExcellence
  const branch = config?.branch ?? DEFAULT_BRANCH
  const name = `${config?.artifactPrefix ?? DEFAULT_ARTIFACT_PREFIX}${facet}`
  const stored = previous?.available ? previous.data : null

  let listed: Artifact[]
  try {
    listed = await source.list(name)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnings.push({
      code: 'COLLECTION_ERROR',
      message: `The ${name} artifacts could not be listed: ${message}`,
      context: { facet },
    })
    // Keeping what was already stored is better than replacing a month of samples with nothing.
    return stored ? ok(stored) : skip(`The ${name} artifacts could not be listed. ${message}`)
  }

  const known = new Set((stored?.samples ?? []).map((s) => s.artifactId))
  const selected = selectArtifacts(listed, { name, branch, from, to, known })

  const reads = await mapLimit(selected, CONCURRENCY, async (artifact) => {
    const zip = await source.download(artifact.id)
    if (!zip) {
      return { artifact, read: { ok: false, kind: 'missing', reason: 'download failed' } as const }
    }
    let files: Record<string, Uint8Array>
    try {
      files = unzipSync(zip)
    } catch {
      return { artifact, read: { ok: false, kind: 'missing', reason: 'unreadable zip' } as const }
    }
    return { artifact, read: readFacet(files, facet, project.repo, branch) }
  })

  const fresh: FacetSample<FacetDataMap[F]>[] = []
  let unreadable = 0
  const mismatches: string[] = []
  for (const { artifact, read } of reads) {
    if (!read.ok) {
      if (read.kind === 'missing') unreadable += 1
      else mismatches.push(read.reason)
      continue
    }
    const envelope = read.envelope
    fresh.push({
      commitSha: envelope.commitSha ?? artifact.workflow_run?.head_sha ?? null,
      runId: envelope.runId ?? artifact.workflow_run?.id ?? null,
      runAttempt: envelope.runAttempt ?? null,
      artifactId: artifact.id,
      generatedAt: envelope.generatedAt,
      data: envelope.data as FacetDataMap[F],
    })
  }

  if (unreadable > 0) {
    warnings.push({
      code: 'ENGINEERING_EXCELLENCE_ARTIFACT_MISSING',
      message: `${unreadable} of ${selected.length} ${name} artifact(s) could not be downloaded or did not contain ${facet}.json.`,
      context: { facet, artifacts: unreadable, of: selected.length },
    })
  }
  if (mismatches.length > 0) {
    warnings.push({
      code: 'ENGINEERING_EXCELLENCE_SCHEMA_MISMATCH',
      message: `${mismatches.length} ${name} artifact(s) did not match the facet contract and were ignored. First: ${mismatches[0]}`,
      context: { facet, artifacts: mismatches.length },
    })
  }

  const series = mergeSamples(facet, stored, fresh)
  if (!series) {
    warnings.push({
      code: 'ENGINEERING_EXCELLENCE_ARTIFACT_MISSING',
      message: `No ${name} artifact from ${branch} was found for this period.`,
      context: { facet },
    })
    return skip(
      `No ${name} artifact was uploaded from ${branch} in this period, or every one has expired.`,
    )
  }
  return ok(series)
}

/**
 * Reads the engineering excellence facets the repository's own CI uploads.
 *
 * Unlike every other metric, these numbers are produced by the repository rather than derived from
 * the GitHub API: coverage, complexity, mutation score, scanner findings and SBOM shape. The
 * collector only finds, checks and keeps them. Each facet is independent, because their cadences
 * differ (mutation testing typically runs weekly, the rest on every push to main) and a repository
 * may produce only some of them.
 */
export async function collectEngineeringExcellence(
  project: ProjectConfig,
  from: Date,
  to: Date,
  previous: EngineeringExcellence | null = null,
  source: ArtifactSource = githubSource(project.repo),
): Promise<EngineeringExcellenceResult> {
  const warnings: Warning[] = []
  const collect = <F extends Facet>(facet: F) =>
    collectFacet(
      facet,
      project,
      from,
      to,
      previous?.[facet] as MetricBlock<FacetSeries<FacetDataMap[F]>> | undefined,
      source,
      warnings,
    )

  const block: EngineeringExcellence = {
    coverage: await collect('coverage'),
    complexity: await collect('complexity'),
    mutation: await collect('mutation'),
    security: await collect('security'),
    sbom: await collect('sbom'),
  }
  return { block, warnings }
}

/** Every facet unavailable for one reason, for when the whole collection failed. */
export const unavailableExcellence = (reason: string): EngineeringExcellence =>
  Object.fromEntries(FACETS.map((facet) => [facet, skip(reason)])) as EngineeringExcellence
