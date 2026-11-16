import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { baselineOf, checkModeLabel, kilobytes } from '../../shared/lib/excellence'
import type {
  BundleData,
  CheckGate,
  DeadCodeWeb,
  EngineeringExcellence,
} from '../../shared/lib/types'
import { TooltipProvider } from '../../shared/ui/tooltip'
import { BundleSection, DeadCodeWebPanel } from './excellence'

/**
 * A new check runs report-only for its first weeks: measured and shown, never failing CI and never
 * counted on the scorecard. These pin that the Engineering tab says which state a check is in and
 * since when, and that a report-only finding is never painted as a failure.
 */

const gate = (over: Partial<CheckGate> = {}): CheckGate => ({
  mode: 'report',
  since: '2026-11-16',
  violations: 0,
  failed: false,
  ...over,
})

const web = (over: Partial<DeadCodeWeb> = {}): DeadCodeWeb => ({
  tool: 'knip',
  unusedFiles: 3,
  unusedExports: 47,
  unusedDependencies: 1,
  unlistedDependencies: 0,
  byType: { files: 3, exports: 40, types: 7, dependencies: 1 },
  baseline: { files: 2, exports: 40, types: 7 },
  gate: gate({ violations: 2 }),
  ...over,
})

const bundle = (over: Partial<BundleData> = {}): BundleData => ({
  tool: 'size-limit',
  compression: 'brotli',
  totalJsBytes: 450_000,
  largestChunkBytes: 61_000,
  largestChunk: 'framework-9f8e.js',
  chunks: 38,
  baselineBytes: 400_000,
  limitBytes: 440_000,
  overBudget: true,
  gate: gate({ violations: 1 }),
  ...over,
})

const withBundle = (data: BundleData | null) =>
  ({
    bundle: data
      ? {
          available: true,
          data: {
            samples: [],
            latest: data,
            latestGeneratedAt: '2026-11-16T00:00:00Z',
          },
        }
      : undefined,
  }) as unknown as EngineeringExcellence

// The glossary tips are tooltips, which need their provider as on the page.
const inPage = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(TooltipProvider, null, element))
const renderDeadCode = (data: DeadCodeWeb) => inPage(createElement(DeadCodeWebPanel, { web: data }))
const renderBundle = (data: BundleData | null) =>
  inPage(createElement(BundleSection, { excellence: withBundle(data) }))

describe('report-then-ratchet checks', () => {
  it('names the mode and the day the check was introduced', () => {
    expect(checkModeLabel(gate())).toBe('report-only since 2026-11-16')
    expect(checkModeLabel(gate({ mode: 'ratchet' }))).toBe('ratchet since 2026-11-16')
    expect(checkModeLabel(gate({ since: null }))).toBe('report-only')
  })

  it('sums the baseline of the Knip types behind a headline count, and has none before it is written', () => {
    expect(baselineOf({ exports: 40, types: 7, files: 2 }, ['exports', 'nsExports', 'types'])).toBe(
      47,
    )
    expect(baselineOf(null, ['files'])).toBeNull()
  })

  it('prints sizes in kB as size-limit does', () => {
    expect(kilobytes(412_000)).toBe('412.0 kB')
    expect(kilobytes(null)).toBe('n/a')
  })

  it('shows report-only dead code without marking anything as a failure', () => {
    const html = renderDeadCode(web())
    expect(html).toContain('report-only since 2026-11-16')
    expect(html).toContain('2 over the baseline, not failing while report-only')
    expect(html).toContain('does not count on the scorecard')
    expect(html).not.toContain('text-destructive')
  })

  it('marks dead code over its baseline, and any unused dependency, once the gate is a ratchet', () => {
    const html = renderDeadCode(
      web({ gate: gate({ mode: 'ratchet', violations: 2, failed: true }) }),
    )
    expect(html).toContain('ratchet since 2026-11-16')
    expect(html).toContain('failing in CI')
    expect(html).toContain('Counts towards Code hygiene')
    // Unused files over the baseline and the unused dependency; exports sit at their baseline.
    expect(html.match(/text-destructive/g)).toHaveLength(2)
  })

  it('says when no baseline has been committed yet', () => {
    expect(renderDeadCode(web({ baseline: null }))).toContain('No baseline committed yet.')
  })

  it('shows a report-only bundle over budget in words, not in red', () => {
    const html = renderBundle(bundle())
    expect(html).toContain('450.0 kB')
    expect(html).toContain('baseline 400.0 kB + 10%')
    expect(html).toContain('Over budget, not failing while report-only.')
    expect(html).not.toContain('text-destructive')
  })

  it('marks a ratchet bundle over budget, and has no budget before a baseline', () => {
    const over = renderBundle(
      bundle({ gate: gate({ mode: 'ratchet', violations: 1, failed: true }) }),
    )
    expect(over).toContain('text-destructive')
    expect(over).toContain('Counts towards Performance')

    const unbudgeted = renderBundle(
      bundle({ baselineBytes: null, limitBytes: null, overBudget: false, gate: gate() }),
    )
    expect(unbudgeted).toContain('No budget committed yet.')
    expect(unbudgeted).toContain('no baseline yet')
  })

  it('reads a month collected before the bundle facet existed as unavailable, not as a crash', () => {
    expect(renderBundle(null)).toContain('the bundle facet is newer')
  })
})
