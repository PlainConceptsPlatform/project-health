import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResponsiveTable } from './responsive-table'

const rows = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, value: i }))
const render = (limit?: number) =>
  renderToStaticMarkup(
    createElement(ResponsiveTable<(typeof rows)[number]>, {
      label: 'Modules',
      rows,
      rowKey: (r) => r.id,
      limit,
      columns: [
        { key: 'id', label: 'Module', cell: (r) => r.id },
        { key: 'value', label: 'Value', cell: (r) => r.value },
      ],
    }),
  )

describe('ResponsiveTable', () => {
  it('renders every row, hiding the ones past the limit behind Show all', () => {
    const html = render(5)
    expect(html).toContain('m6')
    expect(html).toContain('data-all="false"')
    expect(html).toContain('Show all 7')
    expect(html.match(/group-data-\[all=true\]\/list:table-row/g)).toHaveLength(2)
  })

  it('has no Show all when the rows fit', () => {
    expect(render()).not.toContain('Show all')
  })
})
