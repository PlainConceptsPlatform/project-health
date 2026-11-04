import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  type FamilySource,
  appTokens,
  collectFamily,
  compareTags,
  inBaseline,
  parseExceptions,
  pathMatcher,
  templateRef,
} from './metrics/family.ts'
import type { Baseline, ProjectConfig } from './types.ts'

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
  family: 'member',
}

const lines = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => `${prefix} line ${i}`).join('\n')

function source(template: Record<string, Record<string, string>>, tags: string[] | null) {
  const asked: string[] = []
  const fake: FamilySource = {
    defaultBranch: async () => 'main',
    archive: async (repo, ref) => {
      asked.push(`${repo}@${ref}`)
      const files = template[ref]
      return files ? zipball(`${repo.replace('/', '-')}-${ref}`, files) : null
    },
    tags: async () => tags,
  }
  return { fake, asked }
}

const baseline: Baseline = { template: 'https://github.com/your-org/app-template' }

const input = (files: Record<string, string>, configured: Baseline | null = baseline) => ({
  project,
  zip: zipball('your-org-orders-abc1234', files),
  baseline: configured,
  names: ['Orders', 'orders'],
  today: new Date('2026-11-03T10:00:00Z'),
})

describe('collectFamily without a contract', () => {
  const template = {
    main: {
      'apps/api/src/AppTemplate.Api/Security/Headers.cs':
        'namespace AppTemplate.Api.Security;\npublic static class Headers {}\n',
      'apps/api/src/AppTemplate.SharedKernel/Paging/Page.cs': lines(20, 'page'),
      'apps/api/src/AppTemplate.Application/Iam/Roles.cs': lines(10, 'roles'),
      'apps/web/src/shared/ui/button.tsx': 'export const Button = () => null\n',
      'apps/web/src/pages/claims/ui/Claims.tsx': 'not platform\n',
      '.editorconfig': 'root = true\n',
      'README.md': '# App template\n',
    },
  }
  const app = {
    'apps/api/src/Orders.Api/Security/Headers.cs':
      'namespace Orders.Api.Security;\r\npublic static class Headers {}\r\n',
    'apps/api/src/Orders.SharedKernel/Paging/Page.cs': `${lines(19, 'page')}\nextra line`,
    'apps/api/src/Orders.Application/Iam/Roles.cs': lines(10, 'other'),
    'apps/api/src/Orders.Domain/Order.cs': 'not platform\n',
    'scripts/orders-only.mjs': 'export {}\n',
    '.editorconfig': 'root = true\n',
    'README.md': '# Orders\n',
  }

  it('compares the baseline paths with the configured template, app names normalised', async () => {
    const { fake, asked } = source(template, ['v1.0.0', 'v1.1.0'])
    const block = await collectFamily(input(app), fake)

    expect(asked).toEqual(['your-org/app-template@main'])
    if (!block.available) throw new Error(block.reason)
    const family = block.data
    expect(family.mode).toBe('baseline')
    expect(family.source).toEqual({ name: 'app-template', url: baseline.template })
    expect(family.reference).toEqual({ repo: 'your-org/app-template', ref: 'main' })
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

  it('takes the platform paths from the config when it lists them', async () => {
    const { fake } = source(template, [])
    const block = await collectFamily(
      input(app, { template: 'your-org/app-template', paths: ['scripts/**'] }),
      fake,
    )
    if (!block.available) throw new Error(block.reason)
    expect(block.data.files.extra).toEqual(['scripts/orders-only.mjs'])
    expect(block.data.counts).toMatchObject({ platform: 2, identical: 1, extra: 1 })
  })

  it('compares nothing and downloads nothing when no template is configured', async () => {
    const { fake, asked } = source(template, [])
    const block = await collectFamily(input(app, null), fake)
    expect(asked).toEqual([])
    expect(block).toEqual({
      available: false,
      reason:
        'The app has no .platform/contract.yml and projects.json names no baseline template (family.template), so nothing was compared.',
    })
  })

  it('degrades to a reason when the template cannot be downloaded', async () => {
    const { fake } = source({}, null)
    const block = await collectFamily(input({ '.editorconfig': 'root = true\n' }), fake)
    expect(block).toEqual({
      available: false,
      reason:
        'The template your-org/app-template at main could not be downloaded, so nothing was compared.',
    })
  })
})

const exceptions = [
  'exceptions:',
  '  - path: src/platform/Audit.cs',
  '    reason: "Keeps the old hash until #12 ships"',
  '    issue: https://github.com/your-org/orders/issues/12',
  '    expires: 2026-12-31',
  '  - path: src/platform/Session.cs',
  '    reason: Waited on the template',
  '    expires: 2026-10-01',
].join('\n')

const expired = {
  path: 'src/platform/Session.cs',
  reason: 'Waited on the template',
  issue: null,
  expires: '2026-10-01',
}

describe('collectFamily with a contract', () => {
  const contract = [
    'version: 1',
    'source:',
    '  name: Acme app template',
    '  url: https://github.com/acme/app-template.git',
    'owned:',
    '  - src/platform/',
    '  - "!src/platform/Local.cs"',
    'exceptions: .platform/allowed.yml',
    'sync:',
    '  version:',
    '    file: .template-version',
    '    key: applied',
  ].join('\n')
  const template = {
    'v1.1.0': {
      'src/platform/Session.cs': 'session v1.1\n',
      'src/platform/Audit.cs': 'audit v1.1\n',
      'src/platform/Flags.cs': 'flags v1.1\n',
      'src/orders/Order.cs': 'not platform\n',
    },
  }
  const app = {
    '.platform/allowed.yml': exceptions,
    'src/platform/Session.cs': 'session v1.1\n',
    'src/platform/Audit.cs': 'audit, changed here\n',
    'src/platform/Local.cs': 'excluded by the contract\n',
    'src/orders/Order.cs': 'the app owns this\n',
  }

  it('compares the owned paths byte for byte with the recorded version', async () => {
    const { fake, asked } = source(template, ['v1.0.0', 'v1.1.0', '1.2.0', 'v2.0.0', 'latest'])
    const files = {
      ...app,
      '.platform/contract.yml': contract,
      '.template-version': 'applied: v1.1.0\n',
    }
    const block = await collectFamily(input(files, null), fake)

    expect(asked).toEqual(['acme/app-template@v1.1.0'])
    if (!block.available) throw new Error(block.reason)
    const family = block.data
    expect(family.mode).toBe('contract')
    expect(family.source).toEqual({
      name: 'Acme app template',
      url: 'https://github.com/acme/app-template.git',
    })
    expect(family.reference).toEqual({ repo: 'acme/app-template', ref: 'v1.1.0' })
    expect(family.counts).toMatchObject({ platform: 3, identical: 1, modified: 1, missing: 1 })
    expect(family.files.modified).toEqual([
      { path: 'src/platform/Audit.cs', similarity: null, excepted: true },
    ])
    expect(family.files.missing).toEqual(['src/platform/Flags.cs'])
    expect(family.exceptions.active.map((e) => e.path)).toEqual(['src/platform/Audit.cs'])
    expect(family.exceptions.expired).toEqual([expired])
    expect(family.template).toEqual({ tag: 'v1.1.0', latest: 'v2.0.0', lag: 2 })
  })

  it('wins over the implicit contract, and reads the default branch with no version', async () => {
    const { fake, asked } = source({ main: template['v1.1.0'] }, ['v1.1.0'])
    const block = await collectFamily(
      input({
        ...app,
        '.platform/contract.yml': contract.slice(0, contract.indexOf('\nsync:')),
        '.platform/manifest': 'src/\n',
        '.copier-answers.yml': '_commit: v1.0.0\n_src_path: gh:your-org/other-template\n',
      }),
      fake,
    )
    expect(asked).toEqual(['acme/app-template@main'])
    if (!block.available) throw new Error(block.reason)
    expect(block.data.mode).toBe('contract')
    expect(block.data.template).toEqual({ tag: null, latest: 'v1.1.0', lag: null })
  })

  it('reads .copier-answers.yml and .platform/manifest as the implicit contract', async () => {
    const { fake, asked } = source(template, ['v1.0.0', 'v1.1.0', 'v1.2.0'])
    const block = await collectFamily(
      input({
        ...app,
        '.platform/exceptions.yml': exceptions,
        '.copier-answers.yml': '_commit: v1.1.0\n_src_path: gh:your-org/app-template\n',
        '.platform/manifest': '# platform paths\nsrc/platform/\n!src/platform/Local.cs\n',
      }),
      fake,
    )

    expect(asked).toEqual(['your-org/app-template@v1.1.0'])
    if (!block.available) throw new Error(block.reason)
    const family = block.data
    expect(family.mode).toBe('legacy')
    expect(family.source).toEqual({ name: 'app-template', url: 'gh:your-org/app-template' })
    expect(family.counts).toMatchObject({ platform: 3, identical: 1, modified: 1, missing: 1 })
    expect(family.exceptions.expired).toEqual([expired])
    expect(family.template).toEqual({ tag: 'v1.1.0', latest: 'v1.2.0', lag: 1 })
  })

  it.each([
    ['version: 1\nsource:\n  name: Acme\nowned: [src/]\n', 'source.url is required'],
    ['version: 2\nsource: x\n', 'version 2 is not supported; this collector reads 1'],
    [
      'version: 1\nsource:\n  name: A\n  url: acme/t\nowned: src/\n',
      'owned must be a list of paths',
    ],
    ['version: 1\n  source: x\n', 'line 2 is indented unexpectedly'],
  ])('names the field of an invalid contract and compares nothing', async (text, error) => {
    const { fake, asked } = source(template, [])
    const block = await collectFamily(input({ '.platform/contract.yml': text }), fake)
    expect(asked).toEqual([])
    expect(block).toEqual({
      available: false,
      reason: `Invalid contract. .platform/contract.yml: ${error}.`,
      invalid: true,
    })
  })

  it('names the missing template of an implicit contract', async () => {
    const { fake } = source(template, [])
    const block = await collectFamily(
      input({ '.copier-answers.yml': '_commit: v1.1.0\n', '.platform/manifest': 'src/\n' }),
      fake,
    )
    expect(block).toEqual({
      available: false,
      reason: 'Invalid contract. .copier-answers.yml: _src_path is required.',
      invalid: true,
    })
  })
})

describe('family rules', () => {
  it('reads owned paths the way gitignore does', () => {
    const platform = pathMatcher(['apps/web/src/shared/platform', '*.props', '!Local.props'])
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
    const tokens = appTokens(['Order-Desk'])
    expect([...tokens].sort()).toEqual(
      ['ORDER_DESK', 'Order-Desk', 'OrderDesk', 'order-desk', 'orderdesk'].sort(),
    )
    expect(tokens.indexOf('OrderDesk')).toBeGreaterThan(tokens.indexOf('Order-Desk'))
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
