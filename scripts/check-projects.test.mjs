import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkProjects } from './check-projects.mjs'

const root = join(import.meta.dirname, '..')
const read = (name) => JSON.parse(readFileSync(join(root, name), 'utf8'))

const schema = read('schema/projects.schema.json')
const scorecard = read('config/scorecard.json')
const practiceIds = new Set(scorecard.practices.map((practice) => practice.id))
const example = read('projects.example.json')

const project = (overrides = {}) => ({
  id: 'checkout',
  name: 'Checkout',
  repo: 'acme/checkout',
  enabled: true,
  status: 'production',
  environments: { production: 'pro', staging: null },
  productionRefPattern: '^v[0-9]+$',
  agents: { enabled: true, workflow: null },
  ...overrides,
})

const listOf = (...projects) => ({ organization: 'acme', projects })
const check = (list) => checkProjects(list, schema, practiceIds)

test('the example that ships with the template is valid', () => {
  assert.deepEqual(check(example), [])
})

test('a field the schema does not know is an error, because the collector ignores it in silence', () => {
  const problems = check(listOf(project({ colour: 'red' })))
  assert.equal(problems.length, 1)
  assert.match(problems[0], /not a known field/)
})

test('two projects sharing an id would write into the same data folder', () => {
  const problems = check(listOf(project(), project({ name: 'Other', repo: 'acme/other' })))
  assert.ok(problems.some((problem) => problem.includes('is used twice')))
})

test('a status outside the enum is neither deployed nor planned', () => {
  const problems = check(listOf(project({ status: 'prod' })))
  assert.ok(problems.some((problem) => problem.includes('is not one of')))
})

test('a ref pattern that does not compile fails here, not on the first collection', () => {
  const problems = check(listOf(project({ productionRefPattern: '^v[' })))
  assert.ok(problems.some((problem) => problem.includes('does not compile')))
})

test('a practice that does not exist would be dropped by the scorecard without a word', () => {
  const problems = check(listOf(project({ scorecard: { notApplicable: ['not-a-practice'] } })))
  assert.ok(problems.some((problem) => problem.includes('is not a practice id')))
})

test('an empty list is reported rather than passing', () => {
  assert.ok(check(listOf()).some((problem) => problem.includes('empty')))
})

test('own-design is a decision, so the entry has to say why', () => {
  const problems = check(listOf(project({ family: 'own-design' })))
  assert.ok(problems.some((problem) => problem.includes('missing "familyReason"')))
})

test('an empty reason is not a reason', () => {
  const problems = check(listOf(project({ family: 'own-design', familyReason: '' })))
  assert.ok(problems.some((problem) => problem.includes('shorter than 1')))
})

test('a family member needs no reason', () => {
  assert.deepEqual(check(listOf(project({ family: 'member' }))), [])
})

test('a schema keyword the validator does not implement fails the run', () => {
  const problems = checkProjects(listOf(project()), { ...schema, minProperties: 1 }, practiceIds)
  assert.ok(problems.some((problem) => problem.includes('does not implement')))
})
