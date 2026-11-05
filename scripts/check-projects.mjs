#!/usr/bin/env node
// Validates the project list against schema/projects.schema.json, then the things a JSON Schema
// cannot express: ids that collide, a practice named in scorecard.notApplicable that does not exist,
// and a productionRefPattern that does not compile.
//
// Every problem is reported, not just the first, because a person fixing this file should not have
// to run the command once per mistake.

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.env.PROJECT_HEALTH_CONFIG_DIR ?? join(import.meta.dirname, '..')

/**
 * The keywords this validator implements. A schema that grows one it does not know would be checked
 * less strictly than it says, so the run fails instead of passing quietly.
 */
const SUPPORTED = new Set([
  '$schema',
  'title',
  'description',
  'type',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'pattern',
  'enum',
  'const',
  'if',
  'then',
  'else',
  'minLength',
  'maxLength',
  'default',
])

const typeOf = (value) => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const show = (value) => (typeof value === 'string' ? `"${value}"` : JSON.stringify(value))

function walkSchema(schema, path, problems) {
  if (typeOf(schema) !== 'object') return
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED.has(keyword)) {
      problems.push(
        `${path}: the schema uses "${keyword}", which this validator does not implement`,
      )
    }
  }
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    walkSchema(child, `${path}.properties.${key}`, problems)
  }
  if (schema.items) walkSchema(schema.items, `${path}.items`, problems)
}

function validate(value, schema, path, problems) {
  if (schema.enum && !schema.enum.includes(value)) {
    problems.push(`${path}: ${show(value)} is not one of ${schema.enum.join(', ')}`)
    return
  }

  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!allowed.includes(typeOf(value))) {
      problems.push(`${path}: expected ${allowed.join(' or ')}, got ${typeOf(value)}`)
      return
    }
  }

  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    problems.push(`${path}: ${show(value)} must be ${show(schema.const)}`)
    return
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      problems.push(`${path}: ${show(value)} is shorter than ${schema.minLength}`)
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      problems.push(`${path}: ${show(value)} is longer than ${schema.maxLength}`)
    }
  }

  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) {
    problems.push(`${path}: ${show(value)} does not match ${schema.pattern}`)
  }

  // A conditional applies when nothing in its `if` fails. The failures are collected separately so
  // that testing the condition does not report the condition itself.
  if (schema.if) {
    const condition = []
    validate(value, schema.if, path, condition)
    if (condition.length === 0) {
      if (schema.then) validate(value, schema.then, path, problems)
    } else if (schema.else) {
      validate(value, schema.else, path, problems)
    }
  }

  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) {
      if (!(key in value)) problems.push(`${path}: missing "${key}"`)
    }
    for (const [key, child] of Object.entries(value)) {
      const childSchema = schema.properties?.[key]
      if (!childSchema) {
        if (schema.additionalProperties === false) {
          problems.push(`${path}.${key}: not a known field`)
        }
        continue
      }
      validate(child, childSchema, `${path}.${key}`, problems)
    }
  }

  if (typeOf(value) === 'array' && schema.items) {
    value.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`, problems))
  }
}

function checkSemantics(projects, practiceIds) {
  const problems = []
  const seen = new Set()

  projects.forEach((project, index) => {
    const path = `projects[${index}]`
    const id = project?.id
    if (typeof id === 'string') {
      if (seen.has(id)) problems.push(`${path}.id: ${show(id)} is used twice`)
      seen.add(id)
    }

    if (typeof project?.productionRefPattern === 'string') {
      try {
        new RegExp(project.productionRefPattern)
      } catch (error) {
        problems.push(`${path}.productionRefPattern: does not compile (${error.message})`)
      }
    }

    for (const practice of project?.scorecard?.notApplicable ?? []) {
      if (!practiceIds.has(practice)) {
        problems.push(
          `${path}.scorecard.notApplicable: ${show(practice)} is not a practice id in config/scorecard.json`,
        )
      }
    }
  })

  if (projects.length === 0) problems.push('the list is empty, so nothing is measured')

  return problems
}

/** Everything wrong with one parsed project list, in the order the file is read. */
export function checkProjects(list, schema, practiceIds) {
  const problems = []
  walkSchema(schema, 'schema', problems)
  validate(list, schema, '', problems)
  if (Array.isArray(list?.projects)) {
    problems.push(...checkSemantics(list.projects, practiceIds))
  }
  return problems
}

/** The file a run should read: the instance's list when it exists, the shipped example otherwise. */
export function projectListName(dir = root) {
  return existsSync(join(dir, 'projects.json')) ? 'projects.json' : 'projects.example.json'
}

function report(file, problems) {
  console.error(`${file}: ${problems.length} problem(s)`)
  for (const problem of problems) {
    console.error(`  ${problem.startsWith(': ') ? problem.slice(2) : problem.replace(/^\./, '')}`)
  }
  process.exitCode = 1
}

function main() {
  const argIndex = process.argv.indexOf('--file')
  const name = argIndex > -1 ? process.argv[argIndex + 1] : projectListName()
  const file = resolve(process.cwd(), name)

  if (!existsSync(file)) {
    console.error(`No project list at ${file}.`)
    process.exitCode = 1
    return
  }

  const schema = readJson(join(root, 'schema', 'projects.schema.json'))
  const scorecard = readJson(join(root, 'config', 'scorecard.json'))
  const practiceIds = new Set(scorecard.practices.map((practice) => practice.id))

  const list = readJson(file)
  const problems = checkProjects(list, schema, practiceIds)
  if (problems.length > 0) {
    report(file, problems)
    return
  }

  const disabled = list.projects.filter((project) => !project.enabled).length
  const suffix = disabled > 0 ? `, ${disabled} disabled` : ''
  console.log(`${name}: ${list.projects.length} project(s)${suffix}, no problems`)

  if (list.organization === 'your-org') {
    console.log(
      '  organization is still your-org: collection treats this as the example and does nothing',
    )
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedDirectly) main()
