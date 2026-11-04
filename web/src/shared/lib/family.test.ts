import { describe, expect, it } from 'vitest'
import { familyRows, lagLabel, templateName } from './family'
import type { DataIndex, Family, MonthlyReport } from './types'

const drift = (identicalShare: number, over: Partial<Family> = {}): Family => ({
  mode: 'baseline',
  source: { name: 'app-template', url: 'https://github.com/your-org/app-template' },
  reference: { repo: 'your-org/app-template', ref: 'main' },
  isReference: false,
  counts: {
    platform: 10,
    identical: 10 * identicalShare,
    similar: 0,
    modified: 0,
    missing: 0,
    extra: 0,
  },
  identicalShare,
  files: { similar: [], modified: [], missing: [], extra: [] },
  truncated: false,
  exceptions: { active: [], expired: [] },
  template: { tag: null, latest: null, lag: null },
  ...over,
})

const entry = (id: string, over: Partial<DataIndex['projects'][number]> = {}) => ({
  id,
  name: id,
  repo: `your-org/${id}`,
  status: 'production',
  group: 'applications' as const,
  months: ['2026-10', '2026-11'],
  latest: '2026-11',
  ...over,
})

const report = (family: MonthlyReport['family']) => ({ family }) as MonthlyReport

describe('familyRows', () => {
  const index: DataIndex = {
    generatedAt: '2026-11-03T00:00:00Z',
    projects: [
      entry('outside'),
      entry('bot', { family: 'own-design', familyReason: 'Its own architecture.' }),
      entry('orders', { family: 'member' }),
      entry('app-template', { family: 'member' }),
      entry('ledger', { family: 'member' }),
      entry('fresh', { family: 'member' }),
      entry('broken', { family: 'member' }),
    ],
  }
  const months = {
    '2026-10': {
      orders: report({ available: true, data: drift(0.4) }),
      ledger: report({ available: true, data: drift(0.3) }),
      broken: report({ available: true, data: drift(0.9) }),
    },
    '2026-11': {
      orders: report(undefined),
      'app-template': report({ available: true, data: drift(1, { isReference: true }) }),
      ledger: report({ available: true, data: drift(0.6) }),
      fresh: report({ available: false, reason: 'The template could not be downloaded.' }),
      broken: report({ available: false, reason: 'Invalid contract. x', invalid: true }),
    },
  }

  it('lists members first, the template on top, and own-design last with its reason', () => {
    const rows = familyRows(index, months)
    expect(rows.map((r) => r.id)).toEqual([
      'app-template',
      'ledger',
      'orders',
      'broken',
      'fresh',
      'bot',
    ])
    expect(rows.at(-1)).toMatchObject({ familyReason: 'Its own architecture.', reason: null })
  })

  it('keeps the newest comparison and says why a member has none', () => {
    const rows = familyRows(index, months)
    expect(rows.find((r) => r.id === 'orders')?.drift?.identicalShare).toBe(0.4)
    expect(rows.find((r) => r.id === 'ledger')?.drift?.identicalShare).toBe(0.6)
    expect(rows.find((r) => r.id === 'fresh')?.reason).toBe('The template could not be downloaded.')
  })

  it('shows an invalid contract instead of the last comparison that worked', () => {
    const broken = familyRows(index, months).find((r) => r.id === 'broken')
    expect(broken).toMatchObject({ drift: null, reason: 'Invalid contract. x', invalid: true })
  })

  it('names the template by the contract source, or by its repository in older files', () => {
    expect(templateName(drift(1, { source: { name: 'Acme app template', url: 'acme/t' } }))).toBe(
      'Acme app template',
    )
    expect(templateName(drift(1, { source: undefined }))).toBe('your-org/app-template')
  })
})

describe('lagLabel', () => {
  it('names the lag, or why there is none', () => {
    expect(lagLabel({ tag: null, latest: 'v1.4.0', lag: null }, 'baseline')).toBe('Not adopted yet')
    expect(lagLabel({ tag: null, latest: 'v1.4.0', lag: null }, 'contract')).toBe('No version tag')
    expect(lagLabel({ tag: 'v1.3.0', latest: 'v1.4.0', lag: 1 }, 'contract')).toBe('1 tag behind')
    expect(lagLabel({ tag: 'v1.4.0', latest: 'v1.4.0', lag: 0 }, 'legacy')).toBe('Current')
  })
})
