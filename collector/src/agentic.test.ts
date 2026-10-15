import { describe, expect, it } from 'vitest'
import {
  type AgenticSource,
  MERGE_GATE_MARKER,
  botOutcome,
  collectAgentic,
  countOutcomes,
  customAgentWorkflows,
  gateVerdict,
  managedVersion,
  mergedByGate,
  setupOf,
  verifyEnvironmentRecorded,
} from './metrics/agentic.ts'
import type { WorkflowFile } from './metrics/scorecard.ts'
import type { BotOutcomes } from './types.ts'

const PERIOD = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') }

const header = (version: string, source: string) =>
  `# Managed by @plainconceptsplatform/workflows@${version}. Source: ${source}. Update with \`workflows update --force\`.\n`

function source(opts: {
  workflows?: WorkflowFile[]
  files?: string[] | null
  contents?: Record<string, string>
  merged?: number
  lastMergedAt?: string | null
  outcomes?: BotOutcomes
  branch?: string | null
}): AgenticSource {
  return {
    defaultBranch: async () => (opts.branch === undefined ? 'main' : opts.branch),
    workflows: async () => opts.workflows ?? [],
    files: async () => (opts.files === undefined ? [] : opts.files),
    file: async (path) => opts.contents?.[path] ?? null,
    botPullRequests: async () => ({
      merged: opts.merged ?? 0,
      lastMergedAt: opts.lastMergedAt ?? null,
      ...(opts.outcomes ? { outcomes: opts.outcomes } : {}),
    }),
    latest: async (pkg) => (pkg.endsWith('agent-harness') ? '3.1.1' : '1.2.3'),
  }
}

const WORKERS = ['triage', 'refine', 'implement', 'merge-gate', 'apply-review', 'audit', 'release']

describe('managedVersion', () => {
  it('reads the version from the router header first', () => {
    const files = [
      { path: '.github/workflows/ci.yml', text: header('0.28.1', 'x') },
      {
        path: '.github/workflows/work-router.yml',
        text: header('1.2.2', 'loops/workflows/work-router.yml'),
      },
    ]
    expect(managedVersion(files)).toBe('1.2.2')
  })

  it('is null when no file is managed by the package', () => {
    expect(managedVersion([{ path: '.github/workflows/ci.yml', text: 'name: CI' }])).toBeNull()
  })
})

describe('customAgentWorkflows', () => {
  it('lists gh-aw sources and agent-named workflows, never locks, readmes or ordinary CI', () => {
    expect(
      customAgentWorkflows([
        '.github/workflows/implement-ready.md',
        '.github/workflows/implement-ready.lock.yml',
        '.github/workflows/agent-implement-ready.yml',
        '.github/workflows/README.md',
        '.github/workflows/ci.yml',
        '.github/workflows/quality-mutation.yml',
        '.github/workflows/shared/opencode-ci.md',
        'docs/agents.md',
      ]),
    ).toEqual(['agent-implement-ready.yml', 'implement-ready.md'])
  })
})

describe('verifyEnvironmentRecorded', () => {
  const slot = (body: string) =>
    `# Verify\n<!-- PC-PROJECT-ENVIRONMENT-START -->\n${body}\n<!-- PC-PROJECT-ENVIRONMENT-END -->\n`

  it('is null without the skill', () => {
    expect(verifyEnvironmentRecorded(null)).toBeNull()
  })

  it('is false while the slot holds the shipped defaults', () => {
    expect(
      verifyEnvironmentRecorded(
        slot(
          '- Start: `pnpm run dev`\n- Sign-in: none recorded yet. Find it.\n- Seeded data: none recorded yet. Create it.',
        ),
      ),
    ).toBe(false)
  })

  it('is true once the project wrote its own start command and sign-in', () => {
    expect(
      verifyEnvironmentRecorded(
        slot(
          '- Start: `pnpm dev` runs the Aspire AppHost.\n- Sign-in: pick Ana in the mock picker.',
        ),
      ),
    ).toBe(true)
  })
})

describe('gateVerdict', () => {
  const gate = (verdict: string) => `${MERGE_GATE_MARKER}
**Verdict:** ${verdict}

Reasons...`

  it('reads the verdict of the last gate comment, ignoring other comments', () => {
    expect(
      gateVerdict([gate('owner-review'), 'LGTM', gate('auto-merge'), '**Verdict:** blocked']),
    ).toBe('auto-merge')
  })

  it('keeps only the verdict word', () => {
    expect(gateVerdict([gate('merge (CI concluded success).')])).toBe('merge')
    expect(gateVerdict([gate('Human-Review')])).toBe('human-review')
  })

  it('is null when the gate never commented', () => {
    expect(gateVerdict(['Nice work'])).toBeNull()
    expect(gateVerdict([])).toBeNull()
  })
})

describe('botOutcome', () => {
  it('recognises the gate Apps however GitHub spells them', () => {
    expect(mergedByGate('platform-devbox[bot]')).toBe(true)
    expect(mergedByGate('app/platform-devbox')).toBe(true)
    expect(mergedByGate('github-actions[bot]')).toBe(true)
    expect(mergedByGate('dependabot[bot]')).toBe(false)
    expect(mergedByGate('CKGrafico')).toBe(false)
    expect(mergedByGate(null)).toBe(false)
  })

  it('is the gate when its App merged, whatever the verdict', () => {
    expect(botOutcome('platform-devbox[bot]', 'auto-merge')).toBe('gate')
    expect(botOutcome('github-actions[bot]', null)).toBe('gate')
  })

  it('is parked when a person merged after the gate left it for review', () => {
    expect(botOutcome('CKGrafico', 'owner-review')).toBe('parked')
    expect(botOutcome('CKGrafico', 'human-review')).toBe('parked')
    expect(botOutcome('CKGrafico', 'blocked')).toBe('parked')
  })

  it('is a person when they merged without the gate parking it', () => {
    expect(botOutcome('CKGrafico', null)).toBe('person')
    expect(botOutcome('dsrodenas', 'auto-merge')).toBe('person')
    expect(botOutcome('dsrodenas', 'remediated')).toBe('person')
  })

  it('counts every outcome', () => {
    expect(countOutcomes(['gate', 'gate', 'parked', 'person'])).toEqual({
      gate: 2,
      person: 1,
      parked: 1,
    })
  })
})

describe('setupOf', () => {
  const none = { router: false, managed: null, harness: null, legacyHarness: false, custom: [] }

  it('is standard only with the package router', () => {
    expect(setupOf({ ...none, router: true, managed: '0.28.11' })).toBe('standard')
    expect(setupOf({ ...none, router: true })).toBe('custom')
  })

  it('is custom with hand-built agent workflows or only a harness', () => {
    expect(setupOf({ ...none, custom: ['implement-ready.md'] })).toBe('custom')
    expect(setupOf({ ...none, legacyHarness: true })).toBe('custom')
  })

  it('is none without any agent tooling', () => {
    expect(setupOf(none)).toBe('none')
  })
})

describe('collectAgentic', () => {
  it('describes a standard install with every worker, evidence and the harness', async () => {
    const files = [
      '.github/workflows/work-router.yml',
      '.github/workflows/evidence.yml',
      ...WORKERS.map((w) => `.github/workflows/agent-${w}.md`),
      '.opencode/harness.json',
      '.agents/skills/pc-repo-verify/SKILL.md',
    ]
    const block = await collectAgentic(
      'org/app',
      PERIOD,
      source({
        files,
        workflows: [
          { path: '.github/workflows/work-router.yml', text: header('1.2.2', 'work-router') },
        ],
        contents: {
          '.opencode/harness.json': JSON.stringify({ harnessVersion: '3.1.0' }),
          '.agents/skills/pc-repo-verify/SKILL.md':
            '<!-- PC-PROJECT-ENVIRONMENT-START -->\n- Start: `pnpm dev`\n<!-- PC-PROJECT-ENVIRONMENT-END -->',
        },
        merged: 12,
        lastMergedAt: '2026-10-14T10:00:00Z',
        outcomes: { gate: 7, person: 3, parked: 2 },
      }),
    )
    expect(block.available).toBe(true)
    if (!block.available) return
    const d = block.data
    expect(d.setup).toBe('standard')
    expect(d.harness).toEqual({
      version: '3.1.0',
      latest: '3.1.1',
      legacy: false,
      legacyVersion: null,
    })
    expect(d.workflows.version).toBe('1.2.2')
    expect(d.workflows.latest).toBe('1.2.3')
    expect(d.workflows.workers.every((w) => w.present)).toBe(true)
    expect(d.workflows.evidence).toBe(true)
    expect(d.workflows.retired).toEqual([])
    expect(d.workflows.custom).toEqual([])
    expect(d.verifyEnvironment).toBe(true)
    expect(d.bot).toEqual({
      prefix: '[bot]',
      merged: 12,
      lastMergedAt: '2026-10-14T10:00:00Z',
      outcomes: { gate: 7, person: 3, parked: 2 },
    })
  })

  it('flags an old install that still carries a retired worker and has no harness', async () => {
    const block = await collectAgentic(
      'org/app',
      PERIOD,
      source({
        files: [
          '.github/workflows/work-router.yml',
          '.github/workflows/agent-implement.md',
          '.github/workflows/agent-visual-verify.md',
        ],
        workflows: [
          { path: '.github/workflows/work-router.yml', text: header('0.28.11', 'work-router') },
        ],
      }),
    )
    if (!block.available) throw new Error(block.reason)
    expect(block.data.setup).toBe('standard')
    expect(block.data.harness.version).toBeNull()
    expect(block.data.workflows.retired).toEqual(['agent-visual-verify'])
    expect(block.data.workflows.evidence).toBe(false)
    expect(block.data.verifyEnvironment).toBeNull()
  })

  it('recognises the legacy opencode-onboard harness and hand-built workflows', async () => {
    const block = await collectAgentic(
      'org/app',
      PERIOD,
      source({
        files: [
          '.opencode/opencode-onboard.json',
          '.github/workflows/work-router.yml',
          '.github/workflows/implement.md',
        ],
        workflows: [{ path: '.github/workflows/work-router.yml', text: 'name: router' }],
        contents: {
          '.opencode/opencode-onboard.json': JSON.stringify({ onboardVersion: '1.6.0' }),
        },
      }),
    )
    if (!block.available) throw new Error(block.reason)
    expect(block.data.setup).toBe('custom')
    expect(block.data.harness.legacy).toBe(true)
    expect(block.data.harness.legacyVersion).toBe('1.6.0')
    expect(block.data.workflows.custom).toEqual(['implement.md', 'work-router.yml'])
  })

  it('is unavailable when the repository cannot be read', async () => {
    const block = await collectAgentic('org/app', PERIOD, source({ branch: null }))
    expect(block.available).toBe(false)
  })
})
