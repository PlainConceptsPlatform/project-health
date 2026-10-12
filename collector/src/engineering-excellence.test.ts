import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { Artifact } from './github.ts'
import {
  type ArtifactSource,
  collectEngineeringExcellence,
  mergeSamples,
  readFacet,
  selectArtifacts,
} from './metrics/engineering-excellence.ts'
import type {
  ComplexityData,
  CoverageData,
  EngineeringExcellence,
  FacetSample,
  FacetSeries,
  HygieneData,
  ProjectConfig,
} from './types.ts'

/**
 * The facets are produced by the measured repository, not derived from the API, so the risks are in
 * finding the right artifact and in keeping what was read once. Each test names the mistake it
 * prevents. Fixtures are trimmed copies of real facet output, except hygiene.json, which is a small
 * synthetic facet whose totals add up so a reader can check them by hand.
 */

const REPO = 'your-org/checkout'
const fixture = (facet: string) =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, 'fixtures', 'engineering-excellence', `${facet}.json`),
      'utf8',
    ),
  ) as Record<string, unknown> & { data: Record<string, unknown> }

const zipOf = (name: string, doc: unknown) => zipSync({ [name]: strToU8(JSON.stringify(doc)) })

const OCTOBER = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') }

const artifact = (
  over: Partial<Artifact> & { id: number; created_at: string; sha?: string; branch?: string },
): Artifact => ({
  name: 'engineering-excellence-coverage',
  expired: false,
  workflow_run: {
    id: over.id * 10,
    repository_id: 1,
    head_repository_id: 1,
    head_branch: over.branch ?? 'main',
    head_sha: over.sha ?? `sha-${over.id}`,
  },
  ...over,
})

const project: ProjectConfig = {
  id: 'checkout',
  name: 'Checkout',
  repo: REPO,
  enabled: true,
  status: 'production',
  environments: { production: 'pro', staging: null },
  productionRefPattern: '^v',
  agents: { enabled: false, workflow: null },
  engineeringExcellence: { enabled: true },
}

const select = (artifacts: Artifact[], known: number[] = []) =>
  selectArtifacts(artifacts, {
    name: 'engineering-excellence-coverage',
    branch: 'main',
    ...OCTOBER,
    known: new Set(known),
  }).map((a) => a.id)

describe('selectArtifacts', () => {
  it('keeps only main branch runs, so a pull request run never reads as the trunk', () => {
    const ids = select([
      artifact({ id: 1, created_at: '2026-10-03T10:00:00Z' }),
      artifact({ id: 2, created_at: '2026-10-03T11:00:00Z', branch: 'feature/x' }),
    ])
    expect(ids).toEqual([1])
  })

  it('drops a fork pull request whose head branch is also called main', () => {
    const fork = artifact({ id: 3, created_at: '2026-10-04T10:00:00Z' })
    if (fork.workflow_run) fork.workflow_run.head_repository_id = 99
    expect(select([fork])).toEqual([])
  })

  it('skips expired artifacts, which would otherwise download as empty and look like a gap', () => {
    const ids = select([
      artifact({ id: 4, created_at: '2026-10-05T10:00:00Z', expired: true }),
      artifact({ id: 5, created_at: '2026-10-05T11:00:00Z' }),
    ])
    expect(ids).toEqual([5])
  })

  it('reads the month by artifact creation time, so a backfill month gets only its own samples', () => {
    const ids = select([
      artifact({ id: 6, created_at: '2026-09-30T23:59:59Z' }),
      artifact({ id: 7, created_at: '2026-10-01T00:00:00Z' }),
      artifact({ id: 8, created_at: '2026-11-01T00:00:00Z' }),
    ])
    expect(ids).toEqual([7])
  })

  it('keeps the newest artifact per commit, which is the latest re-run', () => {
    const ids = select([
      artifact({ id: 9, created_at: '2026-10-06T10:00:00Z', sha: 'same' }),
      artifact({ id: 10, created_at: '2026-10-06T12:00:00Z', sha: 'same' }),
      artifact({ id: 11, created_at: '2026-10-06T11:00:00Z', sha: 'other' }),
    ])
    expect(ids).toEqual([10, 11])
  })

  it('does not download an artifact already stored in the month file', () => {
    const ids = select(
      [
        artifact({ id: 12, created_at: '2026-10-07T10:00:00Z' }),
        artifact({ id: 13, created_at: '2026-10-07T11:00:00Z' }),
      ],
      [12],
    )
    expect(ids).toEqual([13])
  })
})

describe('readFacet', () => {
  const files = (doc: unknown) => ({ 'coverage.json': strToU8(JSON.stringify(doc)) })

  it('accepts a real coverage facet', () => {
    const read = readFacet(files(fixture('coverage')), 'coverage', REPO, 'main')
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.envelope.data.global.lineRate).toBe(0.5676)
  })

  it('rejects a schemaVersion it does not understand rather than misreading it', () => {
    const read = readFacet(
      files({ ...fixture('coverage'), schemaVersion: 2 }),
      'coverage',
      REPO,
      'main',
    )
    expect(read).toMatchObject({ ok: false, kind: 'mismatch' })
  })

  it("rejects another repository's facet uploaded under the same artifact name", () => {
    const read = readFacet(
      files({ ...fixture('coverage'), repo: 'someone/else' }),
      'coverage',
      REPO,
      'main',
    )
    expect(read).toMatchObject({ ok: false, kind: 'mismatch' })
    if (!read.ok) expect(read.reason).toContain('someone/else')
  })

  it('rejects a facet produced on another ref', () => {
    const read = readFacet(
      files({ ...fixture('coverage'), ref: 'refs/pull/7/merge' }),
      'coverage',
      REPO,
      'main',
    )
    expect(read).toMatchObject({ ok: false, kind: 'mismatch' })
  })

  it('rejects data that breaks the contract: a missing field, or a score given as a percentage', () => {
    const doc = fixture('coverage')
    ;(doc.data.global as Record<string, unknown>).lineRate = undefined
    const read = readFacet(files(doc), 'coverage', REPO, 'main')
    expect(read).toMatchObject({ ok: false, kind: 'mismatch' })

    const mutation = fixture('mutation')
    const domain = (mutation.data.scopes as Record<string, Record<string, unknown>>).domain
    if (domain) domain.coveredScore = 85.9
    const mutationRead = readFacet(
      { 'mutation.json': strToU8(JSON.stringify(mutation)) },
      'mutation',
      REPO,
      'main',
    )
    expect(mutationRead).toMatchObject({ ok: false, kind: 'mismatch' })
    if (!mutationRead.ok) expect(mutationRead.reason).toContain('above 1')
  })

  it('accepts a complexity facet with or without the optional gate block', () => {
    const read = (doc: unknown) =>
      readFacet({ 'complexity.json': strToU8(JSON.stringify(doc)) }, 'complexity', REPO, 'main')
    const withoutGate = fixture('complexity')
    const withGate = fixture('complexity')
    withGate.data.gate = { ccMax: 10, crapMax: 30, baselined: 117, violations: 0, justified: 2 }
    const nullGate = fixture('complexity')
    nullGate.data.gate = null

    expect(read(withoutGate).ok).toBe(true)
    expect(read(nullGate).ok).toBe(true)
    const accepted = read(withGate)
    expect(accepted.ok && accepted.envelope.data.gate?.baselined).toBe(117)
  })

  it('rejects a gate missing its backlog count, since that is the number the page trends', () => {
    const doc = fixture('complexity')
    doc.data.gate = { ccMax: 10, crapMax: 30, violations: 0, justified: 0 }
    const read = readFacet(
      { 'complexity.json': strToU8(JSON.stringify(doc)) },
      'complexity',
      REPO,
      'main',
    )
    expect(read).toMatchObject({ ok: false, kind: 'mismatch' })
    if (!read.ok) expect(read.reason).toContain("missing 'baselined'")
  })

  const readHygiene = (doc: unknown) =>
    readFacet({ 'hygiene.json': strToU8(JSON.stringify(doc)) }, 'hygiene', REPO, 'main')

  it('accepts a hygiene facet, with or without a duplication gate and a Semgrep result', () => {
    const accepted = readHygiene(fixture('hygiene'))
    expect(accepted.ok).toBe(true)
    if (accepted.ok) {
      expect(accepted.envelope.data.global.duplicationRate).toBe(0.08)
      expect(accepted.envelope.data.scopes.web?.swallowedExceptions).toBe(1)
      expect(accepted.envelope.data.gate?.baselineLines).toBe(60)
    }

    const ungated = fixture('hygiene')
    ungated.data.gate = null
    expect(readHygiene(ungated).ok).toBe(true)

    // No Semgrep result means the count is unknown, which the contract spells null, not 0.
    const unscanned = fixture('hygiene')
    ;(unscanned.data.global as Record<string, unknown>).swallowedExceptions = null
    expect(readHygiene(unscanned).ok).toBe(true)
  })

  it('rejects a hygiene facet that breaks the contract', () => {
    const asPercent = fixture('hygiene')
    ;(asPercent.data.global as Record<string, unknown>).duplicationRate = 8
    const percentRead = readHygiene(asPercent)
    expect(percentRead).toMatchObject({ ok: false, kind: 'mismatch' })
    if (!percentRead.ok) expect(percentRead.reason).toContain('$.data.global.duplicationRate')

    const noBacklog = fixture('hygiene')
    noBacklog.data.gate = { baselinedFiles: 2, violations: 0, fixed: 1 }
    const gateRead = readHygiene(noBacklog)
    expect(gateRead).toMatchObject({ ok: false, kind: 'mismatch' })
    if (!gateRead.ok) expect(gateRead.reason).toContain("missing 'baselineLines'")

    // deadCodeWarnings belongs to a scope; a module summary carrying it is a producer bug.
    const misplaced = fixture('hygiene')
    const api = (misplaced.data.scopes as Record<string, { modules: Record<string, object> }>).api
    if (api)
      api.modules['Checkout.Domain'] = { ...api.modules['Checkout.Domain'], deadCodeWarnings: 0 }
    const misplacedRead = readHygiene(misplaced)
    expect(misplacedRead).toMatchObject({ ok: false, kind: 'mismatch' })
    if (!misplacedRead.ok) expect(misplacedRead.reason).toContain("unexpected 'deadCodeWarnings'")
  })

  it('reports a missing file as missing, not as a mismatch', () => {
    expect(readFacet({ 'other.json': strToU8('{}') }, 'coverage', REPO, 'main')).toMatchObject({
      ok: false,
      kind: 'missing',
    })
  })
})

const coverageSample = (
  over: Partial<FacetSample<CoverageData>> & { artifactId: number; generatedAt: string },
): FacetSample<CoverageData> => ({
  commitSha: `sha-${over.artifactId}`,
  runId: over.artifactId,
  runAttempt: 1,
  data: fixture('coverage').data as unknown as CoverageData,
  ...over,
})

describe('mergeSamples', () => {
  it('keeps stored samples whose artifacts have since expired', () => {
    const stored = mergeSamples('coverage', null, [
      coverageSample({ artifactId: 1, generatedAt: '2026-10-02T00:00:00Z' }),
    ])
    const merged = mergeSamples('coverage', stored, [
      coverageSample({ artifactId: 2, generatedAt: '2026-10-03T00:00:00Z' }),
    ])
    expect(merged?.samples.map((s) => s.artifactId)).toEqual([1, 2])
  })

  it('dedupes by commit and keeps the later run attempt even when it wrote earlier', () => {
    const merged = mergeSamples('coverage', null, [
      coverageSample({
        artifactId: 1,
        commitSha: 'c',
        runAttempt: 2,
        generatedAt: '2026-10-02T00:00:00Z',
      }),
      coverageSample({
        artifactId: 2,
        commitSha: 'c',
        runAttempt: 1,
        generatedAt: '2026-10-02T01:00:00Z',
      }),
    ])
    expect(merged?.samples).toHaveLength(1)
    expect(merged?.samples[0]?.artifactId).toBe(1)
  })

  it('sorts by generatedAt and keeps per-module detail only on the latest', () => {
    const merged = mergeSamples('coverage', null, [
      coverageSample({ artifactId: 2, generatedAt: '2026-10-05T00:00:00Z' }),
      coverageSample({ artifactId: 1, generatedAt: '2026-10-01T00:00:00Z' }),
    ])
    expect(merged?.samples.map((s) => s.artifactId)).toEqual([1, 2])
    expect(merged?.latestGeneratedAt).toBe('2026-10-05T00:00:00Z')
    expect(merged?.samples[0]?.data.scopes['Atlas.Domain']?.modules).toBeUndefined()
    expect(merged?.latest.scopes['Atlas.Domain']?.modules).toBeDefined()
  })

  it('keeps the complexity gate on every sample while dropping hotspots', () => {
    const data = fixture('complexity').data as unknown as ComplexityData
    const gate = { ccMax: 10, crapMax: 30, baselined: 40, violations: 1, justified: 3 }
    const merged = mergeSamples('complexity', null, [
      {
        commitSha: 'a',
        runId: 1,
        runAttempt: 1,
        artifactId: 1,
        generatedAt: '2026-10-01T00:00:00Z',
        data: { ...data, gate },
      },
      {
        commitSha: 'b',
        runId: 2,
        runAttempt: 1,
        artifactId: 2,
        generatedAt: '2026-10-02T00:00:00Z',
        data: { ...data, gate: { ...gate, baselined: 38 } },
      },
    ])
    expect(merged?.samples.map((s) => s.data.gate?.baselined)).toEqual([40, 38])
    expect(merged?.samples[0]?.data.hotspots).toBeUndefined()
    expect(merged?.latest.hotspots?.length).toBeGreaterThan(0)
  })

  it('keeps the hygiene gate and scope totals on every sample, detail only on the latest', () => {
    const data = fixture('hygiene').data as unknown as HygieneData
    const gate = { baselinedFiles: 2, baselineLines: 60, violations: 0, fixed: 1 }
    const sample = (n: number, baselineLines: number): FacetSample<HygieneData> => ({
      commitSha: `c${n}`,
      runId: n,
      runAttempt: 1,
      artifactId: n,
      generatedAt: `2026-10-0${n}T00:00:00Z`,
      data: { ...data, gate: { ...gate, baselineLines } },
    })
    const merged = mergeSamples('hygiene', null, [sample(1, 60), sample(2, 48)])

    expect(merged?.samples.map((s) => s.data.gate?.baselineLines)).toEqual([60, 48])
    expect(merged?.samples.map((s) => s.data.scopes.api?.duplicationRate)).toEqual([0.1, 0.1])
    expect(merged?.samples[0]?.data.hotspots).toBeUndefined()
    expect(merged?.samples[0]?.data.scopes.api?.modules).toBeUndefined()
    expect(merged?.latest.hotspots?.map((h) => h.file)).toEqual([
      'apps/api/src/Checkout.Application/Orders/OrderMapper.cs',
      'apps/web/src/pages/Cart.tsx',
    ])
    expect(Object.keys(merged?.latest.scopes.api?.modules ?? {})).toEqual([
      'Checkout.Application',
      'Checkout.Domain',
    ])
  })

  it('reuses the stored latest detail when nothing newer arrived', () => {
    const stored = mergeSamples('coverage', null, [
      coverageSample({ artifactId: 5, generatedAt: '2026-10-09T00:00:00Z' }),
    ]) as FacetSeries<CoverageData>
    const merged = mergeSamples('coverage', stored, [
      coverageSample({ artifactId: 4, generatedAt: '2026-10-08T00:00:00Z' }),
    ])
    expect(merged?.latestGeneratedAt).toBe('2026-10-09T00:00:00Z')
    expect(merged?.latest.scopes['Atlas.Domain']?.modules).toBeDefined()
  })
})

describe('collectEngineeringExcellence', () => {
  const source = (
    byName: Record<string, Artifact[]>,
    zips: Record<number, Uint8Array>,
  ): ArtifactSource & { downloads: number[] } => {
    const downloads: number[] = []
    return {
      downloads,
      list: async (name) => byName[name] ?? [],
      download: async (id) => {
        downloads.push(id)
        return zips[id] ?? null
      },
    }
  }

  it('builds one block per facet and leaves absent facets unavailable with a reason', async () => {
    const coverage = fixture('coverage')
    const src = source(
      {
        'engineering-excellence-coverage': [
          artifact({ id: 1, created_at: '2026-10-02T10:00:00Z' }),
        ],
      },
      { 1: zipOf('coverage.json', coverage) },
    )
    const { block, warnings } = await collectEngineeringExcellence(
      project,
      OCTOBER.from,
      OCTOBER.to,
      null,
      src,
    )

    expect(block.coverage.available).toBe(true)
    if (block.coverage.available) {
      expect(block.coverage.data.samples).toHaveLength(1)
      expect(block.coverage.data.samples[0]?.commitSha).toBe(coverage.commitSha)
    }
    expect(block.sbom).toMatchObject({ available: false })
    expect(
      warnings.filter((w) => w.code === 'ENGINEERING_EXCELLENCE_ARTIFACT_MISSING'),
    ).toHaveLength(5)
  })

  it('warns on a schema mismatch and keeps the stored samples instead of the bad one', async () => {
    const stored = mergeSamples('coverage', null, [
      coverageSample({ artifactId: 1, generatedAt: '2026-10-02T00:00:00Z' }),
    ]) as FacetSeries<CoverageData>
    const previous = {
      coverage: { available: true, data: stored },
    } as unknown as EngineeringExcellence

    const src = source(
      {
        'engineering-excellence-coverage': [
          artifact({ id: 1, created_at: '2026-10-02T10:00:00Z' }),
          artifact({ id: 2, created_at: '2026-10-03T10:00:00Z' }),
        ],
      },
      { 2: zipOf('coverage.json', { ...fixture('coverage'), facet: 'mutation' }) },
    )
    const { block, warnings } = await collectEngineeringExcellence(
      project,
      OCTOBER.from,
      OCTOBER.to,
      previous,
      src,
    )

    expect(src.downloads).toEqual([2])
    expect(warnings.map((w) => w.code)).toContain('ENGINEERING_EXCELLENCE_SCHEMA_MISMATCH')
    expect(
      block.coverage.available && block.coverage.data.samples.map((s) => s.artifactId),
    ).toEqual([1])
  })

  it('honours a custom branch and artifact prefix', async () => {
    const custom: ProjectConfig = {
      ...project,
      engineeringExcellence: { enabled: true, branch: 'trunk', artifactPrefix: 'quality-' },
    }
    const src = source(
      {
        'quality-coverage': [
          artifact({
            id: 3,
            name: 'quality-coverage',
            created_at: '2026-10-02T10:00:00Z',
            branch: 'trunk',
          }),
        ],
      },
      { 3: zipOf('coverage.json', { ...fixture('coverage'), ref: 'refs/heads/trunk' }) },
    )
    const { block } = await collectEngineeringExcellence(
      custom,
      OCTOBER.from,
      OCTOBER.to,
      null,
      src,
    )
    expect(block.coverage.available).toBe(true)
  })

  it('keeps stored data when listing fails, so an API blip never erases a month', async () => {
    const stored = mergeSamples('coverage', null, [
      coverageSample({ artifactId: 1, generatedAt: '2026-10-02T00:00:00Z' }),
    ]) as FacetSeries<CoverageData>
    const previous = {
      coverage: { available: true, data: stored },
    } as unknown as EngineeringExcellence
    const failing: ArtifactSource = {
      list: async () => {
        throw new Error('GET failed with 502')
      },
      download: async () => null,
    }
    const { block, warnings } = await collectEngineeringExcellence(
      project,
      OCTOBER.from,
      OCTOBER.to,
      previous,
      failing,
    )
    expect(block.coverage).toEqual({ available: true, data: stored })
    expect(warnings.some((w) => w.code === 'COLLECTION_ERROR')).toBe(true)
  })
})
