/**
 * The sections of a long project tab (Engineering today): what the section nav lists, what each
 * panel header says while it is folded, and which panels start open.
 *
 * Every section carries a colour and a sentence, so a folded panel still says what is wrong. Red and
 * yellow panels open on arrival and the rest stay folded; whatever the reader changes is written to
 * the query string, so a shared link opens the panels the sender had open.
 */
import type { CheckGate, Facet, Rag, Scorecard } from './types'

export type SectionGroup = 'scorecard' | 'excellence' | 'repository'

export const SECTION_GROUP_LABEL: Record<SectionGroup, string> = {
  scorecard: 'Scorecard',
  excellence: 'Excellence',
  repository: 'Repository',
}

export interface SectionStatus {
  rag: Rag
  text: string
}

export interface SectionMeta extends SectionStatus {
  /** Also the anchor: #engineering/<id> opens the tab on this section. */
  id: string
  title: string
  group: SectionGroup
  /** The engineering excellence facets the section shows. */
  facets: Facet[]
}

const SEVERITY: Record<Rag, number> = { red: 3, yellow: 2, green: 1, grey: 0 }

export const worstRag = (rags: Rag[]): Rag =>
  rags.reduce<Rag>((worst, r) => (SEVERITY[r] > SEVERITY[worst] ? r : worst), 'grey')

/** Panels that need reading open on arrival; the rest start folded. */
export const startsOpen = (rag: Rag) => rag === 'red' || rag === 'yellow'

export const NOT_COLLECTED: SectionStatus = { rag: 'grey', text: 'Not collected' }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * The colour of the practices a section explains, and the reason of the worst one: the scorecard
 * already says why a practice is red, so the panel repeats it rather than inventing a second verdict.
 */
export function practiceStatus(card: Scorecard | null, ids: string[]): SectionStatus {
  const practices = (card?.practices ?? []).filter((p) => ids.includes(p.id) && p.applicable)
  if (practices.length === 0) return { rag: 'grey', text: 'Not applicable' }
  const rag = worstRag(practices.map((p) => p.rag))
  const worst = practices.find((p) => p.rag === rag)
  if (rag === 'green') {
    return {
      rag,
      text:
        practices.length === 1
          ? 'Meets the standard'
          : `${practices.length} practices meet the standard`,
    }
  }
  return { rag, text: worst ? `${worst.name}: ${worst.reason}` : 'Below the standard' }
}

/** Red, yellow and grey practices, counted for the scorecard's own header and the tab badge. */
export function scorecardStatus(card: Scorecard | null): SectionStatus {
  if (!card) return NOT_COLLECTED
  const red = card.practices.filter((p) => p.rag === 'red').length
  const yellow = card.practices.filter((p) => p.rag === 'yellow').length
  if (red + yellow === 0)
    return { rag: 'green', text: 'Every applicable practice meets the standard' }
  return {
    rag: red > 0 ? 'red' : 'yellow',
    text: [red ? `${red} missing or failing` : '', yellow ? `${yellow} below standard` : '']
      .filter(Boolean)
      .join(', '),
  }
}

/**
 * A report-then-ratchet check: findings over the baseline are red once the gate holds them, yellow
 * while it only reports.
 */
export function gateStatus(gates: (CheckGate | null | undefined)[], noun: string): SectionStatus {
  const present = gates.filter((g): g is CheckGate => Boolean(g))
  if (present.length === 0) return NOT_COLLECTED
  const held = present.filter((g) => g.mode === 'ratchet').reduce((n, g) => n + g.violations, 0)
  const reported = present.filter((g) => g.mode !== 'ratchet').reduce((n, g) => n + g.violations, 0)
  if (held > 0) return { rag: 'red', text: `${plural(held, noun)} over the baseline` }
  if (reported > 0) {
    return { rag: 'yellow', text: `${plural(reported, noun)} over the baseline, report-only` }
  }
  return { rag: 'green', text: 'Within the baseline' }
}

/** Which panels are open: the colour's default, then whatever the query says the reader changed. */
export function foldState(sections: SectionMeta[], search: string): Record<string, boolean> {
  const params = new URLSearchParams(search)
  const list = (key: string) => (params.get(key) ?? '').split(',').filter(Boolean)
  const open = list('open')
  const shut = list('shut')
  return Object.fromEntries(
    sections.map((s) => [
      s.id,
      open.includes(s.id) ? true : shut.includes(s.id) ? false : startsOpen(s.rag),
    ]),
  )
}

/** The query that reproduces a fold state: only the panels that differ from their default. */
export function foldQuery(
  sections: SectionMeta[],
  state: Record<string, boolean>,
): { open: string[]; shut: string[] } {
  const open: string[] = []
  const shut: string[] = []
  for (const s of sections) {
    const isOpen = state[s.id] ?? startsOpen(s.rag)
    if (isOpen && !startsOpen(s.rag)) open.push(s.id)
    if (!isOpen && startsOpen(s.rag)) shut.push(s.id)
  }
  return { open, shut }
}
