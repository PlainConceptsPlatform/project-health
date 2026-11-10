import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FacetRejected, addFacet } from './facet-store.ts'
import { readMonth } from './store.ts'
import type { ProjectConfig } from './types.ts'

const root = join(import.meta.dirname, '..')
const coverageFixture = JSON.parse(
  readFileSync(join(root, 'src', 'fixtures', 'engineering-excellence', 'coverage.json'), 'utf8'),
) as Record<string, unknown>

const coverageData = coverageFixture.data as Record<string, unknown> & {
  global: Record<string, unknown>
}

const project: ProjectConfig = {
  id: 'checkout',
  name: 'Checkout',
  repo: 'your-org/checkout',
  enabled: true,
  status: 'production',
  environments: { production: 'pro', staging: null },
  productionRefPattern: '^v[0-9]+$',
  agents: { enabled: false, workflow: null },
  engineeringExcellence: { enabled: true },
}

const dirs: string[] = []
const dataDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'facet-store-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const facet = (overrides: Record<string, unknown> = {}) => ({ ...coverageFixture, ...overrides })

const write = (dir: string, doc: unknown): string => {
  const file = join(dir, 'coverage.json')
  writeFileSync(file, JSON.stringify(doc))
  return file
}

describe('addFacet', () => {
  it('creates the month and says why the host published no deployment data', () => {
    const dir = dataDir()
    const result = addFacet({
      project,
      facet: 'coverage',
      file: write(dir, facet()),
      dataDir: dir,
    })

    const report = readMonth(dir, 'checkout', '2026-10')
    expect(result.created).toBe(true)
    expect(result.samples).toBe(1)
    expect(report?.delivery.deploymentFrequency.available).toBe(false)
    expect(report?.delivery.productionEnvironment).toBe('pro')
    expect(report?.engineeringExcellence?.coverage.available).toBe(true)
  })

  it('keeps one sample per commit and the full detail only on the newest', () => {
    const dir = dataDir()
    addFacet({
      project,
      facet: 'coverage',
      file: write(
        dir,
        facet({ generatedAt: '2026-10-01T10:00:00.000Z', commitSha: 'a'.repeat(40) }),
      ),
      dataDir: dir,
    })
    addFacet({
      project,
      facet: 'coverage',
      file: write(
        dir,
        facet({ generatedAt: '2026-10-02T10:00:00.000Z', commitSha: 'b'.repeat(40) }),
      ),
      dataDir: dir,
    })

    const report = readMonth(dir, 'checkout', '2026-10')
    const series = report?.engineeringExcellence?.coverage
    if (!series?.available) throw new Error('coverage should be available')
    expect(series.data.samples).toHaveLength(2)
    expect(series.data.latestGeneratedAt).toBe('2026-10-02T10:00:00.000Z')
    expect(series.data.latest.scopes['Acme.Domain']?.modules).toBeDefined()
    expect(series.data.samples[0]?.data.scopes['Acme.Domain']?.modules).toBeUndefined()
  })

  it('a later run attempt of the same commit replaces the earlier sample', () => {
    const dir = dataDir()
    const sha = 'c'.repeat(40)
    addFacet({
      project,
      facet: 'coverage',
      file: write(
        dir,
        facet({ commitSha: sha, runAttempt: 1, generatedAt: '2026-10-01T10:00:00.000Z' }),
      ),
      dataDir: dir,
    })
    addFacet({
      project,
      facet: 'coverage',
      file: write(
        dir,
        facet({
          commitSha: sha,
          runAttempt: 2,
          generatedAt: '2026-10-01T11:00:00.000Z',
          data: { ...coverageData, global: { ...coverageData.global, lineRate: 0.9 } },
        }),
      ),
      dataDir: dir,
    })

    const series = readMonth(dir, 'checkout', '2026-10')?.engineeringExcellence?.coverage
    if (!series?.available) throw new Error('coverage should be available')
    expect(series.data.samples).toHaveLength(1)
    expect(series.data.latest.global.lineRate).toBe(0.9)
  })

  it('refuses a facet produced by another repository', () => {
    const dir = dataDir()
    expect(() =>
      addFacet({
        project,
        facet: 'coverage',
        file: write(dir, facet({ repo: 'someone/else' })),
        dataDir: dir,
      }),
    ).toThrow(FacetRejected)
  })

  it('refuses a schemaVersion it does not understand rather than misreading it', () => {
    const dir = dataDir()
    expect(() =>
      addFacet({
        project,
        facet: 'coverage',
        file: write(dir, facet({ schemaVersion: 2 })),
        dataDir: dir,
      }),
    ).toThrow(/schemaVersion|version/i)
  })

  it('writes the index so the month is visible without the collector', () => {
    const dir = dataDir()
    addFacet({ project, facet: 'coverage', file: write(dir, facet()), dataDir: dir })

    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as {
      projects: { id: string; months: string[] }[]
    }
    const entry = index.projects.find((candidate) => candidate.id === 'checkout')
    expect(entry?.months).toContain('2026-10')
  })
})
