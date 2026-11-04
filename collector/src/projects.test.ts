import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { baselineProblems, projectProblems } from './config.ts'
import { githubRepo, parseContract, readContract } from './contract.ts'
import { validate } from './metrics/engineering-excellence.ts'
import type { ProjectConfig } from './types.ts'

const root = join(import.meta.dirname, '..', '..')
const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'))

// A private mirror has no example, and a typo in its own list must not stop the collection these
// tests guard; the collector reports that one instead.
const hasExample = existsSync(join(root, 'projects.example.json'))

const project = (extra: Partial<ProjectConfig>): ProjectConfig => ({
  id: 'orders',
  name: 'Orders',
  repo: 'your-org/orders',
  enabled: true,
  status: 'production',
  environments: { production: 'pro', staging: null },
  productionRefPattern: '^v.*$',
  agents: { enabled: false, workflow: null },
  ...extra,
})

describe('projects.json', () => {
  it.skipIf(!hasExample)('accepts the example against the schema and the family rules', () => {
    const example = readJson('projects.example.json')
    expect(validate(example, readJson('schema/projects.schema.json'))).toEqual([])
    expect(example.projects.flatMap(projectProblems)).toEqual([])
    expect(example.projects.map((p: ProjectConfig) => p.family)).toContain('own-design')
  })

  it('rejects a family the schema does not know', () => {
    const errors = validate(
      { organization: 'o', projects: [{ ...project({}), family: 'other' }] },
      readJson('schema/projects.schema.json'),
    )
    expect(errors).toEqual([expect.stringContaining('"other" is not one of')])
  })

  it('asks an own-design project for its reason, and nothing of the rest', () => {
    expect(projectProblems(project({ family: 'own-design' }))).toEqual([
      'orders: family own-design needs a familyReason',
    ])
    expect(projectProblems(project({ family: 'own-design', familyReason: 'Native app.' }))).toEqual(
      [],
    )
    expect(projectProblems(project({ family: 'member' }))).toEqual([])
    expect(projectProblems(project({}))).toEqual([])
  })

  it('states the own-design rule in the schema too', () => {
    const item = readJson('schema/projects.schema.json').properties.projects.items
    expect(item.if.properties.family.const).toBe('own-design')
    expect(item.then.required).toEqual(['familyReason'])
  })
})

describe('family baseline', () => {
  it('accepts a baseline template in the schema, and only one on GitHub', () => {
    const schema = readJson('schema/projects.schema.json')
    const file = (family: unknown) => ({ organization: 'o', family, projects: [project({})] })
    expect(validate(file({ template: 'https://github.com/o/app-template' }), schema)).toEqual([])
    expect(validate(file({ template: 'o/t', paths: ['src/**'] }), schema)).toEqual([])
    expect(validate(file({ paths: [] }), schema)).toEqual([
      expect.stringContaining("missing 'template'"),
    ])
    expect(baselineProblems({ template: 'https://github.com/o/app-template' })).toEqual([])
    expect(baselineProblems(null)).toEqual([])
    expect(baselineProblems({ template: 'https://gitlab.com/o/t/-/tree/main' })).toEqual([
      'family.template "https://gitlab.com/o/t/-/tree/main" is not a GitHub repository',
    ])
  })
})

describe('platform contract', () => {
  const acme = readFileSync(join(import.meta.dirname, 'fixtures', 'contract', 'acme.yml'), 'utf8')

  it('reads the documented example, comments and the fields it does not use included', () => {
    expect(parseContract(acme)).toEqual({
      kind: 'contract',
      contract: {
        source: { name: 'Acme app template', url: 'https://github.com/acme/app-template' },
        owned: ['.platform/contract.yml', 'src/platform/**'],
        exceptions: '.platform/exceptions.yml',
        version: { file: '.copier-answers.yml', key: '_commit' },
      },
    })
  })

  it('prefers contract.yml, and has no contract without both legacy files', () => {
    const files = (entries: Record<string, string>) => (path: string) => entries[path] ?? null
    const legacy = { '.copier-answers.yml': '_src_path: gh:o/t\n', '.platform/manifest': 'src/\n' }
    expect(readContract(files({ ...legacy, '.platform/contract.yml': acme }))?.kind).toBe(
      'contract',
    )
    expect(readContract(files(legacy))?.kind).toBe('legacy')
    expect(readContract(files({ '.copier-answers.yml': '_src_path: gh:o/t\n' }))).toBeNull()
    expect(readContract(files({}))).toBeNull()
  })

  it('reads the repository from every way a GitHub template is written', () => {
    for (const url of [
      'https://github.com/acme/app-template',
      'https://github.com/acme/app-template.git',
      'git@github.com:acme/app-template.git',
      'gh:acme/app-template',
      'acme/app-template',
    ]) {
      expect(githubRepo(url)).toBe('acme/app-template')
    }
    expect(githubRepo('https://gitlab.com/acme/app-template')).toBeNull()
    expect(githubRepo('../app-template')).toBeNull()
  })
})
