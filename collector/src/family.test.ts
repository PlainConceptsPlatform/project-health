import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  type FamilySource,
  appTokens,
  collectFamily,
  compareTags,
  inBaseline,
  manifestMatcher,
  parseExceptions,
  templateRef,
} from './metrics/family.ts'
import type { ProjectConfig } from './types.ts'

const enc = new TextEncoder()

/** A zipball the way GitHub serves it: every path under `<owner>-<repo>-<sha>/`. */
const zipball = (root: string, files: Record<string, string>) =>
  zipSync(
    Object.fromEntries(Object.entries(files).map(([p, t]) => [`${root}/${p}`, enc.encode(t)])),
  )

const project: ProjectConfig = {
  id: 'orders',
  name: 'Orders',
  repo: 'your-org/orders',
  enabled: true,
  status: 'production',
  environments: { production: 'pro', staging: null },
  productionRefPattern: '^v.*$',
  agents: { enabled: false, workflow: null },
  family: 'kitchen-sink',
}

const lines = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => `${prefix} line ${i}`).join('\n')

function source(template: Record<string, Record<string, string>>, tags: string[] | null) {
  const asked: string[] = []
  const fake: FamilySource = {
    defaultBranch: async () => 'main',
    archive: async (_repo, ref) => {
      asked.push(ref)
      const files = template[ref]
      return files ? zipball(`your-org-Kitchen-Sink-${ref}`, files) : null
    },
    tags: async () => tags,
  }
  return { fake, asked }
}

const input = (files: Record<string, string>) => ({
  project,
  zip: zipball('your-org-orders-abc1234', files),
  reference: 'your-org/Kitchen-Sink',
  names: ['Orders', 'orders', 'Kitchen-Sink'],
  today: new Date('2026-11-03T10:00:00Z'),
})

describe('collectFamily in baseline mode', () => {
  const template = {
    main: {
      'apps/api/src/KitchenSink.Api/Security/Headers.cs':
        'namespace KitchenSink.Api.Security;\npublic static class Headers {}\n',
      'apps/api/src/KitchenSink.SharedKernel/Paging/Page.cs': lines(20, 'page'),
      'apps/api/src/KitchenSink.Application/Iam/Roles.cs': lines(10, 'roles'),
      'apps/web/src/shared/ui/button.tsx': 'export const Button = () => null\n',
      'apps/web/src/pages/claims/ui/Claims.tsx': 'not platform\n',
      '.editorconfig': 'root = true\n',
      'README.md': '# Kitchen-Sink\n',
    },
  }

  it('compares the plumbing paths with app names normalised', async () => {
    const { fake, asked } = source(template, ['v1.0.0', 'v1.1.0'])
    const block = await collectFamily(
      input({
        'apps/api/src/Orders.Api/Security/Headers.cs':
          'namespace Orders.Api.Security;\r\npublic static class Headers {}\r\n',
        'apps/api/src/Orders.SharedKernel/Paging/Page.cs': `${lines(19, 'page')}\nextra line`,
        'apps/api/src/Orders.Application/Iam/Roles.cs': lines(10, 'other'),
        'apps/api/src/Orders.Domain/Order.cs': 'not platform\n',
        'scripts/orders-only.mjs': 'export {}\n',
        '.editorconfig': 'root = true\n',
        'README.md': '# Orders\n',
      }),
      fake,
    )

    expect(asked).toEqual(['main'])
    if (!block.available) throw new Error(block.reason)
    const family = block.data
    expect(family.mode).toBe('baseline')
    expect(family.reference).toEqual({ repo: 'your-org/Kitchen-Sink', ref: 'main' })
    expect(family.counts).toEqual({
      platform: 6,
      identical: 2,
      similar: 1,
      modified: 1,
      missing: 1,
      extra: 1,
    })
    expect(family.identicalShare).toBe(0.333)
    expect(family.files.similar).toEqual([
      { path: 'apps/api/src/Orders.SharedKernel/Paging/Page.cs', similarity: 0.95 },
    ])
    expect(family.files.modified).toEqual([
      { path: 'apps/api/src/Orders.Application/Iam/Roles.cs', similarity: 0 },
    ])
    expect(family.files.missing).toEqual(['apps/web/src/shared/ui/button.tsx'])
    expect(family.files.extra).toEqual(['scripts/orders-only.mjs'])
    expect(family.template).toEqual({ tag: null, latest: 'v1.1.0', lag: null })
    expect(family.isReference).toBe(false)
  })

  it('degrades to a reason when the template cannot be downloaded', async () => {
    const { fake } = source({}, null)
    const block = await collectFamily(input({ '.editorconfig': 'root = true\n' }), fake)
    expect(block).toEqual({
      available: false,
      reason:
        'The template your-org/Kitchen-Sink at main could not be downloaded, so nothing was compared.',
    })
  })
})

describe('collectFamily in manifest mode', () => {
  const manifest = '# platform paths\napps/api/src/Platform/\n!apps/api/src/Platform/Local.cs\n'
  const template = {
    'v1.1.0': {
      '.platform/manifest': manifest,
      'apps/api/src/Platform/Session.cs': 'session v1.1\n',
      'apps/api/src/Platform/Audit.cs': 'audit v1.1\n',
      'apps/api/src/Platform/Flags.cs': 'flags v1.1\n',
      'apps/api/src/Orders/Order.cs': 'not platform\n',
    },
  }

  it('compares the manifest paths byte for byte with the rendered tag', async () => {
    const { fake, asked } = source(template, ['v1.0.0', 'v1.1.0', 'v1.2.0', 'v2.0.0', 'latest'])
    const block = await collectFamily(
      input({
        '.copier-answers.yml': '_commit: v1.1.0\n_src_path: gh:your-org/Kitchen-Sink\n',
        '.platform/manifest': manifest,
        '.platform/exceptions.yml': [
          'exceptions:',
          '  - path: apps/api/src/Platform/Audit.cs',
          '    reason: "Keeps the old hash until #12 ships"',
          '    issue: https://github.com/your-org/orders/issues/12',
          '    expires: 2026-12-31',
          '  - path: apps/api/src/Platform/Session.cs',
          '    reason: Waited on the template',
          '    expires: 2026-10-01',
        ].join('\n'),
        'apps/api/src/Platform/Session.cs': 'session v1.1\n',
        'apps/api/src/Platform/Audit.cs': 'audit, changed here\n',
        'apps/api/src/Platform/Local.cs': 'excluded by the manifest\n',
        'apps/api/src/Orders/Order.cs': 'the app owns this\n',
      }),
      fake,
    )

    expect(asked).toEqual(['v1.1.0'])
    if (!block.available) throw new Error(block.reason)
    const family = block.data
    expect(family.mode).toBe('manifest')
    expect(family.counts).toMatchObject({ platform: 3, identical: 1, modified: 1, missing: 1 })
    expect(family.files.modified).toEqual([
      { path: 'apps/api/src/Platform/Audit.cs', similarity: null, excepted: true },
    ])
    expect(family.files.missing).toEqual(['apps/api/src/Platform/Flags.cs'])
    expect(family.exceptions.active.map((e) => e.path)).toEqual(['apps/api/src/Platform/Audit.cs'])
    expect(family.exceptions.expired).toEqual([
      {
        path: 'apps/api/src/Platform/Session.cs',
        reason: 'Waited on the template',
        issue: null,
        expires: '2026-10-01',
      },
    ])
    expect(family.template).toEqual({ tag: 'v1.1.0', latest: 'v2.0.0', lag: 2 })
  })
})

describe('family rules', () => {
  it('reads the manifest the way gitignore does', () => {
    const platform = manifestMatcher('apps/web/src/shared/platform\n*.props\n!Local.props\n')
    expect(platform('apps/web/src/shared/platform/theme/index.ts')).toBe(true)
    expect(platform('apps/web/src/shared/platformer.ts')).toBe(false)
    expect(platform('apps/api/Directory.Packages.Platform.props')).toBe(true)
    expect(platform('apps/api/Local.props')).toBe(false)
  })

  it('keeps the baseline to plumbing, root config included and docs left out', () => {
    expect(inBaseline('apps/api/src/APP.Infrastructure/Iam/Session.cs')).toBe(true)
    expect(inBaseline('apps/api/src/APP.Infrastructure/Quoting/Quote.cs')).toBe(false)
    expect(inBaseline('apps/api/Directory.Build.props')).toBe(true)
    expect(inBaseline('apps/api/tests/APP.Tests/A.cs')).toBe(false)
    expect(inBaseline('.github/workflows/app-ci.yml')).toBe(true)
    expect(inBaseline('.github/workflows/agent-implement.md')).toBe(false)
    expect(inBaseline('package.json')).toBe(true)
    expect(inBaseline('AGENTS.md')).toBe(false)
    expect(inBaseline('pnpm-lock.yaml')).toBe(false)
  })

  it('spells an app name every way code does', () => {
    const tokens = appTokens(['Kitchen-Sink'])
    expect([...tokens].sort()).toEqual(
      ['KITCHEN_SINK', 'Kitchen-Sink', 'KitchenSink', 'kitchen-sink', 'kitchensink'].sort(),
    )
    expect(tokens.indexOf('KitchenSink')).toBeGreaterThan(tokens.indexOf('Kitchen-Sink'))
  })

  it('orders template tags as PEP 440 does and reads a described commit', () => {
    expect(['v1.10.0', 'v1.2.0', 'v1.2.0rc1', 'v1.9.1'].sort(compareTags)).toEqual([
      'v1.2.0rc1',
      'v1.2.0',
      'v1.9.1',
      'v1.10.0',
    ])
    expect(templateRef('v1.2.0-3-gabc1234')).toEqual({ ref: 'abc1234', tag: 'v1.2.0' })
    expect(templateRef('v1.2.0')).toEqual({ ref: 'v1.2.0', tag: 'v1.2.0' })
  })

  it('reads an empty exceptions file as none', () => {
    expect(parseExceptions('exceptions: []\n')).toEqual([])
  })
})
