import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { actionsRows } from '@/shared/lib/actions'
import { agenticRows } from '@/shared/lib/agentic'
import { codeRows } from '@/shared/lib/code'
import { familyRows } from '@/shared/lib/family'
import type { DataIndex } from '@/shared/lib/types'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ActionsTable } from './actions'
import { AgenticTable } from './agentic'
import { CodeTable } from './code'
import { FamilyTable } from './family'

// Fictional projects with nothing collected yet: every table still has to lay out both ways.
const index: DataIndex = {
  generatedAt: '2026-11-01T00:00:00Z',
  projects: [
    {
      id: 'alder',
      name: 'Alder',
      repo: 'example-org/alder',
      status: 'production',
      group: 'applications',
      family: 'member',
      months: [],
      latest: null,
    },
    {
      id: 'birch',
      name: 'Birch',
      repo: 'example-org/birch',
      status: 'planned',
      group: 'applications',
      family: 'own-design',
      familyReason: 'Keeps its own design on purpose.',
      months: [],
      latest: null,
    },
  ],
}

const tabs = {
  Agentic: () => createElement(AgenticTable, { rows: agenticRows(index, {}) }),
  Code: () => createElement(CodeTable, { rows: codeRows(index, {}, {}) }),
  Actions: () => createElement(ActionsTable, { rows: actionsRows(index, {}) }),
  Family: () => createElement(FamilyTable, { rows: familyRows(index, {}, {}) }),
}

describe('overview tabs on a phone', () => {
  for (const [name, render] of Object.entries(tabs)) {
    it(`${name} renders a card per project as well as the desktop table`, () => {
      const html = renderToStaticMarkup(render())
      expect(html).toContain('data-layout="table"')
      expect(html.match(/data-layout="card"/g)).toHaveLength(2)
      expect(html).toContain('Alder')
    })
  }

  it('keeps no fixed minimum width on an overview table, which would scroll the page sideways', () => {
    const dir = __dirname
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => /min-w-\[\d{3,}px\]/.test(readFileSync(join(dir, f), 'utf8')))
    expect(offenders).toEqual([])
  })
})
