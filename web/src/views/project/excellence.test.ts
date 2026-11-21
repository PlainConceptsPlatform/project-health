import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  architectureRules,
  architectureTools,
  baselineOf,
  checkModeLabel,
  kilobytes,
  patternRules,
  patternsTools,
} from '../../shared/lib/excellence'
import type {
  ArchitectureData,
  ArchitectureDotnet,
  ArchitectureWeb,
  BundleData,
  CheckGate,
  DeadCodeWeb,
  EngineeringExcellence,
  MonthlyReport,
  PatternsData,
  PatternsDotnet,
  PatternsSemgrep,
} from '../../shared/lib/types'
import { FACETS } from '../../shared/lib/types'
import { TooltipProvider } from '../../shared/ui/tooltip'
import {
  ArchitectureSection,
  BundleSection,
  DeadCodeWebPanel,
  PatternsSection,
  excellenceSections,
} from './excellence'

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

const steiger = (over: Partial<ArchitectureWeb> = {}): ArchitectureWeb => ({
  tool: 'steiger',
  version: '0.10.0',
  errors: 0,
  warnings: 5,
  byRule: {
    'fsd/insignificant-slice': { errors: 0, warnings: 1 },
    'fsd/public-api': { errors: 0, warnings: 4 },
  },
  baseline: { 'fsd/insignificant-slice': 1, 'fsd/public-api': 2 },
  gate: gate({ violations: 2 }),
  ...over,
})

const archTests = (over: Partial<ArchitectureDotnet> = {}): ArchitectureDotnet => ({
  tool: 'archunitnet',
  project: 'App.ArchitectureTests',
  rules: 9,
  passed: 9,
  failed: 0,
  skipped: 0,
  failing: [],
  ...over,
})

const withArchitecture = (data: ArchitectureData | null) =>
  ({
    architecture: data
      ? {
          available: true,
          data: { samples: [], latest: data, latestGeneratedAt: '2026-11-17T00:00:00Z' },
        }
      : undefined,
  }) as unknown as EngineeringExcellence
const renderArchitecture = (data: ArchitectureData | null) =>
  inPage(createElement(ArchitectureSection, { excellence: withArchitecture(data) }))

describe('architecture', () => {
  it('orders Steiger rules worst first and allows none outside the baseline', () => {
    const rows = architectureRules(
      steiger({
        byRule: {
          'fsd/insignificant-slice': { errors: 0, warnings: 1 },
          'fsd/public-api': { errors: 0, warnings: 4 },
          'fsd/forbidden-imports': { errors: 1, warnings: 0 },
          'fsd/segments-by-purpose': { errors: 0, warnings: 1 },
        },
      }),
    )
    expect(rows.map((r) => [r.rule, r.allowed, r.over])).toEqual([
      ['fsd/forbidden-imports', 0, false],
      ['fsd/public-api', 2, true],
      ['fsd/segments-by-purpose', 0, true],
      ['fsd/insignificant-slice', 1, false],
    ])
    expect(architectureRules(steiger({ baseline: null }))[0]?.allowed).toBeNull()
  })

  it('names Steiger and the architecture tests library as the tools', () => {
    expect(architectureTools({ web: steiger(), dotnet: archTests() })).toEqual([
      'Steiger',
      'ArchUnitNET',
    ])
    expect(architectureTools({ web: null, dotnet: archTests({ tool: 'netarchtest' }) })).toEqual([
      'NetArchTest',
    ])
    expect(architectureTools({ web: null, dotnet: archTests({ tool: null }) })).toEqual([])
  })

  it('shows report-only warnings over the baseline without marking them as a failure', () => {
    const html = renderArchitecture({ web: steiger(), dotnet: archTests() })
    expect(html).toContain('Steiger 0.10.0')
    expect(html).toContain('report-only since 2026-11-16')
    expect(html).toContain('fsd/public-api')
    expect(html).toContain('2 warnings over the baseline, not failing while report-only')
    expect(html).toContain('does not count on the scorecard')
    expect(html).toContain('ArchUnitNET')
    expect(html).not.toContain('text-destructive')
  })

  it('marks warnings over the baseline once a ratchet, and errors and failing rules in any mode', () => {
    const ratchet = renderArchitecture({
      web: steiger({ gate: gate({ mode: 'ratchet', violations: 2, failed: true }) }),
      dotnet: null,
    })
    expect(ratchet).toContain('failing in CI')
    expect(ratchet).toContain('count towards Code hygiene')
    expect(ratchet.match(/text-destructive/g)).toHaveLength(1)

    const broken = renderArchitecture({
      web: steiger({ errors: 1, gate: gate() }),
      dotnet: archTests({ passed: 8, failed: 1, failing: ['LayerTests.Domain_is_pure'] }),
    })
    expect(broken).toContain('LayerTests.Domain_is_pure')
    expect(broken.match(/text-destructive/g)).toHaveLength(2)
  })

  it('shows a part the repository does not run as unavailable, and an older month as unavailable', () => {
    const dotnetOnly = renderArchitecture({ web: null, dotnet: archTests() })
    expect(dotnetOnly).toContain('No Steiger report')
    expect(dotnetOnly).toContain('9')
    expect(renderArchitecture({ web: steiger(), dotnet: null })).toContain(
      'No architecture test results',
    )
    expect(renderArchitecture(null)).toContain('the architecture facet is newer')
  })
})

const analyzers = (over: Partial<PatternsDotnet> = {}): PatternsDotnet => ({
  tool: 'roslyn',
  compiler: '4.14.0',
  logs: 4,
  errors: 0,
  warnings: 7,
  notes: 2,
  suppressed: 1,
  byAnalyzer: {
    meziantou: { errors: 0, warnings: 4, notes: 0 },
    netanalyzers: { errors: 0, warnings: 0, notes: 2 },
    roslynator: { errors: 0, warnings: 3, notes: 0 },
  },
  byRule: {
    CA1822: { errors: 0, warnings: 0, notes: 2 },
    MA0004: { errors: 0, warnings: 4, notes: 0 },
    RCS1036: { errors: 0, warnings: 3, notes: 0 },
  },
  baseline: { MA0004: 3, RCS1036: 3 },
  gate: gate({ violations: 1 }),
  ...over,
})

const ownRules = (over: Partial<PatternsSemgrep> = {}): PatternsSemgrep => ({
  tool: 'semgrep',
  version: '1.168.0',
  rules: 3,
  errors: 0,
  warnings: 0,
  notes: 0,
  byRule: { 'platform-hygiene-ts-empty-catch': { errors: 0, warnings: 0, notes: 0 } },
  ...over,
})

const withPatterns = (data: PatternsData | null) =>
  ({
    patterns: data
      ? {
          available: true,
          data: { samples: [], latest: data, latestGeneratedAt: '2026-11-18T00:00:00Z' },
        }
      : undefined,
  }) as unknown as EngineeringExcellence
const renderPatterns = (data: PatternsData | null) =>
  inPage(createElement(PatternsSection, { excellence: withPatterns(data) }))

describe('code patterns', () => {
  it('orders analyzer rules worst first, names the analyzer and allows none outside the baseline', () => {
    const rows = patternRules(
      analyzers({
        byRule: {
          CA1822: { errors: 0, warnings: 0, notes: 2 },
          MA0004: { errors: 0, warnings: 4, notes: 0 },
          RCS1036: { errors: 0, warnings: 3, notes: 0 },
          CS8618: { errors: 0, warnings: 1, notes: 0 },
        },
      }),
    )
    expect(rows.map((r) => [r.rule, r.analyzer, r.allowed, r.over])).toEqual([
      ['MA0004', 'Meziantou.Analyzer', 3, true],
      ['CS8618', 'C# compiler (CS)', 0, true],
      ['RCS1036', 'Roslynator', 3, false],
      ['CA1822', '.NET analyzers (CA)', 0, false],
    ])
    expect(patternRules(analyzers({ baseline: null }))[0]?.allowed).toBeNull()
  })

  it('names the analyzers that reported and Semgrep as the tools', () => {
    expect(patternsTools({ dotnet: analyzers(), semgrep: ownRules() })).toEqual([
      'Roslyn analyzers',
      'Meziantou.Analyzer',
      'Roslynator',
      'Semgrep',
    ])
    expect(patternsTools({ dotnet: null, semgrep: ownRules() })).toEqual(['Semgrep'])
  })

  it('shows report-only findings over the baseline without marking them as a failure', () => {
    const html = renderPatterns({ dotnet: analyzers(), semgrep: ownRules() })
    expect(html).toContain('MA0004')
    expect(html).toContain('Meziantou.Analyzer')
    expect(html).toContain('report-only since 2026-11-16')
    expect(html).toContain('1 findings over the baseline, not failing while report-only')
    expect(html).toContain('does not count on the scorecard')
    expect(html).not.toContain('text-destructive')
  })

  it('marks findings over the baseline once a ratchet, and any Semgrep finding in any mode', () => {
    const ratchet = renderPatterns({
      dotnet: analyzers({ gate: gate({ mode: 'ratchet', violations: 1, failed: true }) }),
      semgrep: null,
    })
    expect(ratchet).toContain('count towards Code hygiene')
    expect(ratchet.match(/text-destructive/g)).toHaveLength(1)

    const semgrep = renderPatterns({
      dotnet: null,
      semgrep: ownRules({
        errors: 2,
        byRule: { 'platform-hygiene-ts-empty-catch': { errors: 2, warnings: 0, notes: 0 } },
      }),
    })
    expect(semgrep).toContain('platform-hygiene-ts-empty-catch: 2')
    expect(semgrep.match(/text-destructive/g)).toHaveLength(1)
  })

  it('shows a part the repository does not run as unavailable, and an older month as unavailable', () => {
    expect(renderPatterns({ dotnet: null, semgrep: ownRules() })).toContain('No analyzer SARIF')
    expect(renderPatterns({ dotnet: analyzers(), semgrep: null })).toContain('No Semgrep report')
    expect(renderPatterns(null)).toContain('the patterns facet is newer')
  })
})

describe('engineering sections', () => {
  const unavailable = { available: false, reason: 'Not run in CI.' }
  const report = (excellence: EngineeringExcellence | undefined) =>
    ({
      repo: 'example-org/alder',
      engineeringExcellence: excellence,
    }) as unknown as MonthlyReport

  it('gives every excellence facet a section, so a new facet cannot ship without a nav entry', () => {
    const excellence = Object.fromEntries(
      FACETS.map((f) => [f, unavailable]),
    ) as unknown as EngineeringExcellence
    const sections = excellenceSections(report(excellence), undefined)
    for (const facet of FACETS) {
      expect(
        sections.some((s) => s.facets.includes(facet)),
        `${facet} has no section`,
      ).toBe(true)
    }
    for (const s of sections) {
      expect(s.text, `${s.id} has no status`).not.toBe('')
      expect(s.group).toBe('excellence')
    }
    expect(new Set(sections.map((s) => s.id)).size).toBe(sections.length)
  })

  it('reads grey for a facet with no sample rather than a pass', () => {
    const excellence = Object.fromEntries(
      FACETS.map((f) => [f, unavailable]),
    ) as unknown as EngineeringExcellence
    const sections = excellenceSections(report(excellence), undefined)
    expect(sections.find((s) => s.id === 'security')?.rag).toBe('grey')
  })

  it('keeps one section covering every facet when nothing is collected', () => {
    const sections = excellenceSections(report(undefined), undefined)
    expect(sections).toHaveLength(1)
    expect(sections[0]?.facets).toEqual([...FACETS])
  })

  it('paints a report-only bundle over budget yellow and a held one red', () => {
    const base = Object.fromEntries(FACETS.map((f) => [f, unavailable]))
    const status = (data: BundleData) =>
      excellenceSections(
        report({ ...base, ...withBundle(data) } as unknown as EngineeringExcellence),
        undefined,
      ).find((s) => s.id === 'bundle')?.rag
    expect(status(bundle())).toBe('yellow')
    expect(status(bundle({ gate: gate({ mode: 'ratchet', violations: 1 }) }))).toBe('red')
    expect(status(bundle({ overBudget: false }))).toBe('green')
  })
})
