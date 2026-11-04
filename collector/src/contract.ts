/**
 * The platform contract: `.platform/contract.yml` at the root of a repository that receives shared
 * code from an upstream template. It names the template, the paths the template owns and where the
 * applied template version is recorded. The format is shared by convention with other tools; this
 * collector only reads it and needs none of them.
 */
export const CONTRACT = '.platform/contract.yml'

/** The implicit contract written before contract.yml existed: these two files, read as one. */
export const LEGACY_MANIFEST = '.platform/manifest'
export const LEGACY_ANSWERS = '.copier-answers.yml'

const DEFAULT_EXCEPTIONS = '.platform/exceptions.yml'

export interface Contract {
  source: { name: string; url: string }
  /** gitwildmatch globs, repository relative; a leading `/` anchors to the root. */
  owned: string[]
  exceptions: string
  /** The file and top-level key holding the template tag or commit the repository last applied. */
  version: { file: string; key: string } | null
}

export type ContractRead =
  | { kind: 'contract' | 'legacy'; contract: Contract }
  | { kind: 'invalid'; error: string }
  | null

type Yaml = string | number | boolean | null | Yaml[] | { [key: string]: Yaml }

interface Line {
  indent: number
  text: string
  n: number
}

function stripComment(line: string): string {
  let quote: string | null = null
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (quote) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") quote = char
    else if (char === '#' && (i === 0 || /\s/.test(line[i - 1] as string))) return line.slice(0, i)
  }
  return line
}

function scalar(raw: string): Yaml {
  const value = raw.trim()
  if (value === '' || value === '~' || value === 'null') return null
  const quoted = value.match(/^(['"])(.*)\1$/)
  if (quoted) return quoted[2] as string
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim()
    return inner === '' ? [] : inner.split(',').map(scalar)
  }
  if (/^-?\d+$/.test(value)) return Number(value)
  if (value === 'true' || value === 'false') return value === 'true'
  return value
}

const isItem = (line: Line | undefined) =>
  line !== undefined && (line.text === '-' || line.text.startsWith('- '))

/**
 * The YAML the contract needs: nested mappings, block and flow lists, quoted and plain scalars and
 * comments. Anchors, multi-line strings and flow mappings are not read.
 */
export function parseYaml(text: string): Yaml {
  const lines: Line[] = text
    .split(/\r?\n/)
    .map((raw, i) => ({ raw: stripComment(raw).trimEnd(), n: i + 1 }))
    .filter(({ raw }) => raw.trim() !== '' && raw.trim() !== '---')
    .map(({ raw, n }) => ({ indent: raw.length - raw.trimStart().length, text: raw.trim(), n }))
  let i = 0

  const block = (indent: number): Yaml => {
    const first = lines[i]
    if (!first || first.indent < indent) return null
    return isItem(first) ? sequence(first.indent) : mapping(first.indent)
  }

  const sequence = (indent: number): Yaml[] => {
    const items: Yaml[] = []
    while (lines[i]?.indent === indent && isItem(lines[i])) {
      const line = lines[i] as Line
      const rest = line.text.slice(1).trim()
      if (rest === '') {
        i += 1
        items.push(block(indent + 1))
      } else if (/^[^'"[{\s][^:]*:(\s|$)/.test(rest)) {
        lines[i] = { indent: indent + 2, text: rest, n: line.n }
        items.push(mapping(indent + 2))
      } else {
        i += 1
        items.push(scalar(rest))
      }
    }
    return items
  }

  const mapping = (indent: number): { [key: string]: Yaml } => {
    const out: { [key: string]: Yaml } = {}
    while (lines[i]?.indent === indent && !isItem(lines[i])) {
      const line = lines[i] as Line
      const match = line.text.match(/^([^:'"\s][^:]*?):(?:\s+(.*))?$/)
      if (!match) throw new Error(`line ${line.n} is not "key: value"`)
      i += 1
      const next = lines[i]
      out[match[1] as string] =
        match[2] !== undefined
          ? scalar(match[2])
          : next && (next.indent > indent || (next.indent === indent && isItem(next)))
            ? block(next.indent)
            : null
    }
    return out
  }

  const result = block(0)
  if (i < lines.length) throw new Error(`line ${lines[i]?.n} is indented unexpectedly`)
  return result
}

const isMap = (value: Yaml | undefined): value is { [key: string]: Yaml } =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: Yaml | undefined) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

/** A top-level value of a flat YAML file, such as the version a template tool recorded. */
export function topLevel(source: string, key: string): string | null {
  try {
    const parsed = parseYaml(source)
    const value = isMap(parsed) ? parsed[key] : undefined
    return typeof value === 'number' ? String(value) : text(value)
  } catch {
    return null
  }
}

/** `owner/repo` from a GitHub URL, `gh:owner/repo` or `owner/repo`; null for any other host. */
export function githubRepo(url: string): string | null {
  const match = url
    .trim()
    .match(
      /^(?:(?:https?:\/\/|git\+https:\/\/|ssh:\/\/git@)github\.com\/|git@github\.com:|gh:)?(\w[\w.-]*)\/(\w[\w.-]*?)(?:\.git)?\/?$/i,
    )
  return match ? `${match[1]}/${match[2]}` : null
}

const repoName = (url: string) =>
  url
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .split(/[/:]/)
    .at(-1) || url

/** Reads contract.yml, or names the single field that is wrong. */
export function parseContract(source: string): ContractRead {
  const invalid = (error: string): ContractRead => ({
    kind: 'invalid',
    error: `${CONTRACT}: ${error}`,
  })
  let parsed: Yaml
  try {
    parsed = parseYaml(source)
  } catch (error) {
    return invalid(error instanceof Error ? error.message : String(error))
  }
  if (!isMap(parsed)) return invalid('the file is not a YAML mapping')
  const { version, source: from, owned, exceptions, sync } = parsed
  if (version === undefined || version === null) return invalid('version is required')
  if (typeof version !== 'number') return invalid('version must be a whole number')
  if (version !== 1) return invalid(`version ${version} is not supported; this collector reads 1`)
  if (!isMap(from)) return invalid('source is required')
  const name = text(from.name)
  const url = text(from.url)
  if (!name) return invalid('source.name is required')
  if (!url) return invalid('source.url is required')
  if (!Array.isArray(owned) || owned.length === 0 || !owned.every((p) => text(p))) {
    return invalid('owned must be a list of paths')
  }
  if (exceptions !== undefined && exceptions !== null && !text(exceptions)) {
    return invalid('exceptions must be a path')
  }
  if (sync !== undefined && sync !== null && !isMap(sync)) return invalid('sync must be a mapping')
  const recorded = isMap(sync) ? sync.version : undefined
  if (recorded !== undefined && recorded !== null) {
    if (!isMap(recorded)) return invalid('sync.version must have file and key')
    if (!text(recorded.file)) return invalid('sync.version.file is required')
    if (!text(recorded.key)) return invalid('sync.version.key is required')
  }
  return {
    kind: 'contract',
    contract: {
      source: { name, url },
      owned: owned.map((p) => text(p) as string),
      exceptions: text(exceptions) ?? DEFAULT_EXCEPTIONS,
      version: isMap(recorded)
        ? { file: text(recorded.file) as string, key: text(recorded.key) as string }
        : null,
    },
  }
}

/** The implicit contract: the answers name the template and its version, the manifest the paths. */
export function legacyContract(answers: string, manifest: string): ContractRead {
  const url = topLevel(answers, '_src_path')
  if (!url) return { kind: 'invalid', error: `${LEGACY_ANSWERS}: _src_path is required` }
  return {
    kind: 'legacy',
    contract: {
      source: { name: repoName(url), url },
      owned: manifest
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#')),
      exceptions: DEFAULT_EXCEPTIONS,
      version: { file: LEGACY_ANSWERS, key: '_commit' },
    },
  }
}

/** contract.yml wins; otherwise the legacy pair; otherwise the repository has no contract. */
export function readContract(read: (path: string) => string | null): ContractRead {
  const file = read(CONTRACT)
  if (file !== null) return parseContract(file)
  const answers = read(LEGACY_ANSWERS)
  const manifest = read(LEGACY_MANIFEST)
  return answers !== null && manifest !== null ? legacyContract(answers, manifest) : null
}
