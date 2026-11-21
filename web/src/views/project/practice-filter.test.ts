import { filterRows, optionCounts } from '@/shared/lib/list-filter'
import { practiceQuery } from '@/shared/lib/practices'
import type { PracticeResult, Rag } from '@/shared/lib/types'
import { TooltipProvider } from '@/shared/ui/tooltip'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PracticeTables } from './practice-filter'

const practice = (id: string, rag: Rag, phase: PracticeResult['phase']): PracticeResult => ({
  id,
  number: 1,
  name: `Practice ${id}`,
  phase,
  standardMode: 'blocking',
  description: `What ${id} checks.`,
  applicable: rag !== 'grey',
  rag,
  reason: `Why ${id} is ${rag}.`,
  source: 'detected',
  tools: ['Trivy'],
  mode: null,
  result: null,
  resultAt: null,
  lastRun: null,
})

const practices = [
  practice('secrets', 'red', 'build'),
  practice('sbom', 'green', 'build'),
  practice('dast', 'grey', 'test-env'),
  practice('restoredrill', 'yellow', 'operate'),
]

describe('practice filter', () => {
  it('keeps grey practices visible when nothing is picked', () => {
    const shown = filterRows(practices, practiceQuery({}, ''))
    expect(shown.map((p) => p.id)).toContain('dast')
    const html = renderToStaticMarkup(
      createElement(TooltipProvider, null, createElement(PracticeTables, { practices })),
    )
    expect(html).toContain('Practice dast')
  })

  it('combines states with OR and phases with AND', () => {
    const shown = filterRows(
      practices,
      practiceQuery({ state: ['red', 'yellow'], phase: ['build'] }, ''),
    )
    expect(shown.map((p) => p.id)).toEqual(['secrets'])
  })

  it('searches the tools and the reason as well as the name', () => {
    expect(filterRows(practices, practiceQuery({}, 'trivy'))).toHaveLength(4)
    expect(filterRows(practices, practiceQuery({}, 'is yellow')).map((p) => p.id)).toEqual([
      'restoredrill',
    ])
  })

  it('counts each state with the phase filter applied', () => {
    const counts = optionCounts(practices, practiceQuery({ phase: ['build'] }, ''))
    expect(counts.state).toEqual({ red: 1, yellow: 0, green: 1, grey: 0 })
  })

  it('leads a coloured practice with the reason for its colour', () => {
    const html = renderToStaticMarkup(
      createElement(TooltipProvider, null, createElement(PracticeTables, { practices })),
    )
    expect(html.indexOf('Why secrets is red.')).toBeLessThan(html.indexOf('What secrets checks.'))
  })
})
