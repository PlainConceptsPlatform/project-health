/**
 * The answers Copier writes to `.copier-answers.yml`. Its presence is what marks a repository as
 * generated from a template, `_src_path` says which one and `_commit` which version.
 */
export interface CopierAnswers {
  commit: string | null
  srcPath: string | null
  appName: string | null
}

const unquote = (value: string) => value.trim().replace(/^(['"])(.*)\1$/, '$2')

/** Copier writes flat `key: value` lines, so a full YAML parser is not needed to read them. */
export function parseCopierAnswers(text: string): CopierAnswers {
  const values = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][\w-]*):\s*(.*?)\s*(?:#.*)?$/)
    if (match?.[2]) values.set(match[1] as string, unquote(match[2]))
  }
  return {
    commit: values.get('_commit') ?? null,
    srcPath: values.get('_src_path') ?? null,
    appName: values.get('app_name') ?? null,
  }
}

/** True when the answers come from the Kitchen-Sink template, by URL or by a local checkout path. */
export const fromKitchenSink = (answers: CopierAnswers): boolean =>
  /kitchen-?sink(\.git)?\/?$/i.test(answers.srcPath ?? '')
