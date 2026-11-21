/**
 * The practice filter on the Engineering tab: by state, by phase and by a search over the practice,
 * its tools and its description. All of it lives in the query (?state=red,yellow&phase=build&pq=),
 * so a shared link opens on the same practices.
 */
import type { FilterGroupDef, ListQuery, Selection } from './list-filter'
import { PHASES, RAG_LABEL } from './scorecard'
import type { PracticeResult, Rag } from './types'

export const PRACTICE_STATES: Rag[] = ['red', 'yellow', 'green', 'grey']

export const PRACTICE_GROUPS: FilterGroupDef<PracticeResult>[] = [
  {
    key: 'state',
    label: 'State',
    options: PRACTICE_STATES.map((rag) => ({
      value: rag,
      label: RAG_LABEL[rag],
      match: (p: PracticeResult) => p.rag === rag,
    })),
  },
  {
    key: 'phase',
    label: 'Phase',
    options: PHASES.map((phase) => ({
      value: phase.key,
      label: phase.label,
      match: (p: PracticeResult) => p.phase === phase.key,
    })),
  },
]

export const practiceText = (p: PracticeResult) =>
  [p.name, p.description, p.reason, ...p.tools].join(' ')

export const practiceQuery = (selection: Selection, query: string): ListQuery<PracticeResult> => ({
  groups: PRACTICE_GROUPS,
  selection,
  query,
  text: practiceText,
})

/** The query keys the filter owns, read and written as a whole. */
export const PRACTICE_KEYS = { state: 'state', phase: 'phase', search: 'pq' } as const
