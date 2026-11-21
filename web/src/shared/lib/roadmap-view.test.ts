import { describe, expect, it } from 'vitest'
import { readRoadmapView, roadmapViewQuery } from './roadmap-view'
import { withQuery } from './url-state'

describe('roadmap filter and layout in the query', () => {
  it('round-trips through the query string', () => {
    const search = withQuery(
      '?tab=roadmap',
      roadmapViewQuery({ filter: 'stalled', view: 'aligned' }),
    )
    expect(search).toBe('?tab=roadmap&rf=stalled&rv=aligned')
    expect(readRoadmapView(search)).toEqual({ filter: 'stalled', view: 'aligned' })
  })

  it('writes nothing for the defaults, so the plain URL stays the default view', () => {
    expect(withQuery('', roadmapViewQuery({ filter: 'all', view: 'calendar' }))).toBe('')
  })

  it('falls back to the defaults on unknown values', () => {
    expect(readRoadmapView('?rf=everything&rv=gantt')).toEqual({ filter: 'all', view: 'calendar' })
  })
})
