import { describe, expect, it } from 'vitest'
import { adoptedUrl, readList, readOne, sharedUrl, withQuery } from './url-state'

describe('withQuery', () => {
  it('round-trips a list through the query string with readable commas', () => {
    const search = withQuery('', { level: ['0', '1'], q: 'ce' })
    expect(search).toBe('?level=0,1&q=ce')
    expect(readList(new URLSearchParams(search), 'level')).toEqual(['0', '1'])
  })

  it('removes a key set to an empty value, so the default view keeps a clean URL', () => {
    expect(withQuery('?q=ce&level=0', { q: '', level: [] })).toBe('')
  })

  it('keeps the keys it is not asked to change', () => {
    expect(withQuery('?tab=code&q=a', { q: 'b' })).toBe('?tab=code&q=b')
  })
})

describe('reading values', () => {
  it('ignores unknown values instead of failing, so an old link still opens', () => {
    const params = new URLSearchParams('?state=red,purple,red&rv=sideways')
    expect(readList(params, 'state', ['red', 'yellow'])).toEqual(['red'])
    expect(readOne(params, 'rv', ['calendar', 'aligned'], 'calendar')).toBe('calendar')
  })
})

describe('?tab= adoption', () => {
  it('moves the tab into the hash and leaves every other key in the query', () => {
    expect(adoptedUrl('/projects/x/', '?tab=engineering/hygiene&state=red')).toBe(
      '/projects/x/?state=red#engineering/hygiene',
    )
  })

  it('does nothing without a shared tab', () => {
    expect(adoptedUrl('/projects/x/', '?state=red')).toBeNull()
  })

  it('writes the hash back as ?tab= for a link that survives the sign-in redirect', () => {
    const link = sharedUrl('https://example.org/projects/x/?state=red#roadmap/773')
    expect(link).toBe('https://example.org/projects/x/?state=red&tab=roadmap/773')
    const url = new URL(link)
    expect(adoptedUrl(url.pathname, url.search)).toBe('/projects/x/?state=red#roadmap/773')
  })
})
