/**
 * Filtering, counting and sorting for every list on the site, as pure functions.
 *
 * A filter is a set of groups, each a list of options. Options in one group widen the result (OR):
 * L0 or L1. Groups narrow it (AND): L0 or L1, and in PRO. A group with nothing picked does not
 * filter at all. Each option's count is the rows it would show given every other group, so a chip
 * never promises rows it cannot deliver.
 */

export interface FilterOption<T> {
  value: string
  label: string
  match: (row: T) => boolean
}

export interface FilterGroupDef<T> {
  key: string
  label: string
  options: FilterOption<T>[]
}

/** The picked values of each group, by group key. A missing or empty list is "any". */
export type Selection = Record<string, readonly string[]>

/** Lower-cased words of the query; every one has to appear in the row's text. */
export const searchTerms = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean)

export function matchesSearch(text: string, query: string): boolean {
  const haystack = text.toLowerCase()
  return searchTerms(query).every((term) => haystack.includes(term))
}

function matchesGroup<T>(row: T, group: FilterGroupDef<T>, picked: readonly string[] | undefined) {
  if (!picked || picked.length === 0) return true
  return group.options.some((o) => picked.includes(o.value) && o.match(row))
}

/** True when the row passes every group but `skip`, which the option counts leave out. */
export function matchesAll<T>(
  row: T,
  groups: FilterGroupDef<T>[],
  selection: Selection,
  skip?: string,
): boolean {
  return groups.every((g) => g.key === skip || matchesGroup(row, g, selection[g.key]))
}

export interface ListQuery<T> {
  groups: FilterGroupDef<T>[]
  selection: Selection
  query: string
  /** The text a search runs over: name, repository and whatever else a reader would type. */
  text: (row: T) => string
}

export function filterRows<T>(rows: T[], q: ListQuery<T>): T[] {
  return rows.filter(
    (row) => matchesSearch(q.text(row), q.query) && matchesAll(row, q.groups, q.selection),
  )
}

/** Rows each option would show, given the search and every other group's picks. */
export function optionCounts<T>(
  rows: T[],
  q: ListQuery<T>,
): Record<string, Record<string, number>> {
  const searched = rows.filter((row) => matchesSearch(q.text(row), q.query))
  return Object.fromEntries(
    q.groups.map((g) => {
      const rest = searched.filter((row) => matchesAll(row, q.groups, q.selection, g.key))
      return [
        g.key,
        Object.fromEntries(g.options.map((o) => [o.value, rest.filter(o.match).length])),
      ]
    }),
  )
}

/** How many options are picked across all groups, for the "Filters (n)" button. */
export const pickedCount = (selection: Selection) =>
  Object.values(selection).reduce((n, values) => n + values.length, 0)

/** The selection with one value toggled in one group. */
export function toggle(selection: Selection, key: string, value: string): Selection {
  const current = selection[key] ?? []
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
  return { ...selection, [key]: next }
}

/**
 * A comparator that keeps rows without a value at the bottom whatever the direction, so a project
 * that cannot report the sorted number is never read as a zero at the top.
 */
export function sinkMissing<T>(
  hasValue: (row: T) => boolean,
  compare: (a: T, b: T) => number,
): (a: T, b: T) => number {
  return (a, b) => {
    const ha = hasValue(a)
    const hb = hasValue(b)
    if (ha !== hb) return ha ? -1 : 1
    return compare(a, b)
  }
}
