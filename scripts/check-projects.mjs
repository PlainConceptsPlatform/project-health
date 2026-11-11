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

/** The code repository: the schema always comes from here, so it matches the collector that runs. */
const codeRoot = join(import.meta.dirname, '..')
/** Where projects.json and config/ live, which a deployment can move with PROJECT_HEALTH_CONFIG_DIR. */
const root = process.env.PROJECT_HEALTH_CONFIG_DIR ?? codeRoot

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

  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- the pattern comes from this repository's own schema/
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
        // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- compiling the pattern is the check: it reports one that does not compile
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
export function projectListName(dir = root, exists = existsSync) {
  return exists(join(dir, 'projects.json')) ? 'projects.json' : 'projects.example.json'
}

/**
 * The three files a run reads. The list and config/scorecard.json come from the config folder, the
 * same one the collector reads them from; the schema comes from the code. Resolving the list against
 * the working directory instead made `PROJECT_HEALTH_CONFIG_DIR=<dir> pnpm verify:config` report a
 * missing list, or check a different one than the collector would use.
 */
export function locate({ argv = [], cwd, configDir = root, code = codeRoot, exists = existsSync }) {
  const argIndex = argv.indexOf('--file')
  const list =
    argIndex > -1
      ? resolve(cwd, argv[argIndex + 1])
      : join(configDir, projectListName(configDir, exists))
  const ownScorecard = join(configDir, 'config', 'scorecard.json')
  return {
    list,
    schema: join(code, 'schema', 'projects.schema.json'),
    scorecard: exists(ownScorecard) ? ownScorecard : join(code, 'config', 'scorecard.json'),
  }
}

function report(file, problems) {
  console.error(`${file}: ${problems.length} problem(s)`)
  for (const problem of problems) {
    console.error(`  ${problem.startsWith(': ') ? problem.slice(2) : problem.replace(/^\./, '')}`)
  }
  process.exitCode = 1
}

function main() {
  // pnpm runs the script from the package directory; INIT_CWD is where the command was typed.
  const cwd = process.env.INIT_CWD ?? process.cwd()
  const paths = locate({ argv: process.argv, cwd })
  const file = paths.list

  if (!existsSync(file)) {
    console.error(`No project list at ${file}.`)
    process.exitCode = 1
    return
  }

  const schema = readJson(paths.schema)
  const scorecard = readJson(paths.scorecard)
  const practiceIds = new Set(scorecard.practices.map((practice) => practice.id))

  const list = readJson(file)
  const problems = checkProjects(list, schema, practiceIds)
  if (problems.length > 0) {
    report(file, problems)
    return
  }

  const disabled = list.projects.filter((project) => !project.enabled).length
  const suffix = disabled > 0 ? `, ${disabled} disabled` : ''
  console.log(`${file}: ${list.projects.length} project(s)${suffix}, no problems`)

  if (list.organization === 'your-org') {
    console.log(
      '  organization is still your-org: collection treats this as the example and does nothing',
    )
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedDirectly) main()
