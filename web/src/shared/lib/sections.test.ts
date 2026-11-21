import { describe, expect, it } from 'vitest'
import { type SectionMeta, foldQuery, foldState, gateStatus, worstRag } from './sections'

const section = (id: string, rag: SectionMeta['rag']): SectionMeta => ({
  id,
  title: id,
  group: 'excellence',
  facets: [],
  rag,
  text: 'x',
})

const sections = [section('security', 'red'), section('sbom', 'green'), section('bundle', 'grey')]

describe('which panels start open', () => {
  it('opens red and yellow panels and folds the rest on a plain link', () => {
    expect(foldState(sections, '')).toEqual({ security: true, sbom: false, bundle: false })
  })

  it('round-trips what the reader changed through the query, and only that', () => {
    const changed = { security: false, sbom: true, bundle: false }
    const query = foldQuery(sections, changed)
    expect(query).toEqual({ open: ['sbom'], shut: ['security'] })
    const search = `?open=${query.open.join(',')}&shut=${query.shut.join(',')}`
    expect(foldState(sections, search)).toEqual(changed)
  })

  it('ignores unknown section ids in an old link', () => {
    expect(foldState(sections, '?open=retired-facet')).toEqual(foldState(sections, ''))
  })
})

describe('statuses', () => {
  it('takes the worst colour', () => {
    expect(worstRag(['green', 'grey', 'yellow'])).toBe('yellow')
    expect(worstRag([])).toBe('grey')
  })

  it('reads findings over the baseline as red only once the gate holds them', () => {
    const report = { mode: 'report' as const, since: null, violations: 2, failed: false }
    expect(gateStatus([report], 'warning').rag).toBe('yellow')
    expect(gateStatus([{ ...report, mode: 'ratchet' }], 'warning')).toEqual({
      rag: 'red',
      text: '2 warnings over the baseline',
    })
    expect(gateStatus([null], 'warning').rag).toBe('grey')
  })
})
