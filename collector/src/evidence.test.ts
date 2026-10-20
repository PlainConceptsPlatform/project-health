import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { copyEvidence, copyOf, rawSource } from './evidence.ts'

const SHOT =
  'https://github.com/acme/shop/raw/4b4a66f/openspec/changes/archive/pin-tools/evidence/01-home.jpg'

const month = (images: (string | null)[]) => ({
  roadmap: {
    available: true,
    data: {
      asOf: '2026-10-20T00:00:00Z',
      issues: [
        {
          number: 12,
          evidence: {
            pullRequest: 34,
            url: 'https://github.com/acme/shop/pull/34#issuecomment-1',
            note: null,
            waypoints: images.map((image, i) => ({
              plan: null,
              n: i + 1,
              capture: `shot ${i + 1}`,
              expect: null,
              reached: true,
              image,
            })),
          },
        },
      ],
    },
  },
})

const folder = (report: unknown) => {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-'))
  writeFileSync(join(dir, '2026-10.json'), JSON.stringify(report))
  return dir
}

const waypoints = (dir: string) =>
  JSON.parse(readFileSync(join(dir, '2026-10.json'), 'utf8')).roadmap.data.issues[0].evidence
    .waypoints as { image: string | null; copy?: string }[]

describe('rawSource', () => {
  it('points a github.com raw link at the host that answers a token', () => {
    expect(rawSource(SHOT)).toBe(
      'https://raw.githubusercontent.com/acme/shop/4b4a66f/openspec/changes/archive/pin-tools/evidence/01-home.jpg',
    )
  })

  it('leaves anything else alone', () => {
    expect(rawSource('/example-evidence/checkout-error.svg')).toBeNull()
    expect(rawSource('https://example.com/a.png')).toBeNull()
  })
})

describe('copyOf', () => {
  it('keeps two plans with the same file name apart', () => {
    const other = SHOT.replace('pin-tools', 'other-plan')
    expect(copyOf('shop', 34, SHOT).file).not.toBe(copyOf('shop', 34, other).file)
    expect(copyOf('shop', 34, SHOT).site).toMatch(
      /^evidence\/shop\/pr-34\/[0-9a-f]{8}-01-home\.jpg$/,
    )
  })
})

describe('copyEvidence', () => {
  it('stores each screenshot once and records the copy on its waypoint', async () => {
    const dir = folder(month([SHOT, null]))
    const fetched: string[] = []
    const fetchImage = async (url: string) => {
      fetched.push(url)
      return new Uint8Array([1, 2, 3])
    }

    expect(await copyEvidence(dir, 'shop', fetchImage)).toBe(1)
    const [shot, none] = waypoints(dir)
    expect(shot?.copy).toBe(copyOf('shop', 34, SHOT).site)
    expect(existsSync(join(dir, copyOf('shop', 34, SHOT).file))).toBe(true)
    expect(none?.copy).toBeUndefined()

    // A second run finds the file and fetches nothing.
    expect(await copyEvidence(dir, 'shop', fetchImage)).toBe(0)
    expect(fetched).toHaveLength(1)
  })

  it('leaves the waypoint without a copy when the screenshot cannot be read', async () => {
    const dir = folder(month([SHOT]))
    expect(await copyEvidence(dir, 'shop', async () => null)).toBe(0)
    expect(waypoints(dir)[0]?.copy).toBeUndefined()
  })

  it('records a copy on a month collected again, whose waypoints come back without one', async () => {
    const dir = folder(month([SHOT]))
    await copyEvidence(dir, 'shop', async () => new Uint8Array([1]))
    writeFileSync(join(dir, '2026-10.json'), JSON.stringify(month([SHOT])))
    expect(await copyEvidence(dir, 'shop', async () => null)).toBe(0)
    expect(waypoints(dir)[0]?.copy).toBe(copyOf('shop', 34, SHOT).site)
  })
})
