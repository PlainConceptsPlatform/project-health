import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectProblems } from './config.ts'
import { fromKitchenSink, parseCopierAnswers } from './copier.ts'
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
    expect(projectProblems(project({ family: 'kitchen-sink' }))).toEqual([])
    expect(projectProblems(project({}))).toEqual([])
  })

  it('states the own-design rule in the schema too', () => {
    const item = readJson('schema/projects.schema.json').properties.projects.items
    expect(item.if.properties.family.const).toBe('own-design')
    expect(item.then.required).toEqual(['familyReason'])
  })
})

describe('copier answers', () => {
  it('reads the template, its version and the app name', () => {
    const answers = parseCopierAnswers(
      "# Changes here will be overwritten by Copier\n_commit: v1.4.0\n_src_path: https://github.com/your-org/Kitchen-Sink.git\napp_name: 'Orders'\n",
    )
    expect(answers).toEqual({
      commit: 'v1.4.0',
      srcPath: 'https://github.com/your-org/Kitchen-Sink.git',
      appName: 'Orders',
    })
    expect(fromKitchenSink(answers)).toBe(true)
  })

  it('does not suggest the family for another template', () => {
    expect(fromKitchenSink(parseCopierAnswers('_src_path: gh:your-org/python-starter\n'))).toBe(
      false,
    )
    expect(fromKitchenSink(parseCopierAnswers('_src_path: ../kitchen-sink\n'))).toBe(true)
  })
})
