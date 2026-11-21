/**
 * The roadmap timeline's filter and layout, kept in the query (?rf=stalled&rv=aligned) so a shared
 * link opens the same issues the same way. The selected issue stays in the hash (#roadmap/773).
 */
import type { QueryValue } from './url-state'
import { readOne } from './url-state'

export const ROADMAP_FILTERS = ['all', 'open', 'stalled', 'hand', 'automation'] as const
export type RoadmapFilter = (typeof ROADMAP_FILTERS)[number]

export const ROADMAP_VIEWS = ['calendar', 'aligned'] as const
export type RoadmapLayout = (typeof ROADMAP_VIEWS)[number]

export interface RoadmapViewState {
  filter: RoadmapFilter
  view: RoadmapLayout
}

export const readRoadmapView = (search: string): RoadmapViewState => {
  const params = new URLSearchParams(search)
  return {
    filter: readOne(params, 'rf', ROADMAP_FILTERS, 'all'),
    view: readOne(params, 'rv', ROADMAP_VIEWS, 'calendar'),
  }
}

/** The defaults write nothing, so the plain project URL stays the default view. */
export const roadmapViewQuery = (state: RoadmapViewState): Record<string, QueryValue> => ({
  rf: state.filter === 'all' ? null : state.filter,
  rv: state.view === 'calendar' ? null : state.view,
})
