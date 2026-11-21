import {
  type ActionsEntry,
  STORAGE_LIMIT_BYTES,
  storageSize,
  summariseActions,
} from '@/shared/lib/actions'
import { densityTone, percent } from '@/shared/lib/code'
import type { ExcellenceHistory } from '@/shared/lib/data'
import type { DailyScore } from '@/shared/lib/scorecard'
import {
  NOT_COLLECTED,
  type SectionMeta,
  type SectionStatus,
  scorecardStatus,
} from '@/shared/lib/sections'
import type { MonthlyReport } from '@/shared/lib/types'
import { Panel, type PanelSection } from '@/shared/ui'
import { ActionsPanel } from './actions'
import { CodePanel } from './code'
import { EngineeringTab } from './engineering-tab'
import { excellenceSections } from './excellence'
import { ScorecardPanel } from './scorecard'

const TONE_RAG = { good: 'green', warn: 'yellow', bad: 'red' } as const

function codeStatus(report: MonthlyReport): SectionStatus {
  const block = report.codebase
  if (!block?.available) return NOT_COLLECTED
  const density = block.data.comments.density
  const tone = densityTone(density)
  return {
    rag: tone ? TONE_RAG[tone] : 'grey',
    text: `${percent(density)} comment lines per code line`,
  }
}

function actionsStatus(history: ActionsEntry[]): SectionStatus {
  const a = summariseActions(history)
  if (!a.minutes && !a.storage) return NOT_COLLECTED
  if (a.storageOver) return { rag: 'red', text: `Storage over ${storageSize(STORAGE_LIMIT_BYTES)}` }
  if (a.minutesSurge) return { rag: 'red', text: 'Minutes surging on the previous month' }
  return { rag: 'green', text: 'Within the thresholds' }
}

/** The red practices, for the Engineering tab's badge. */
export function redPractices(report: MonthlyReport): number {
  return report.scorecard?.available
    ? report.scorecard.data.practices.filter((p) => p.rag === 'red').length
    : 0
}

/**
 * Everything on the Engineering tab, as sections: the scorecard, one panel per group of excellence
 * facets, then the repository's comments, tests and Actions usage. The section nav, the panel
 * headers and which panels start open all come from the same list.
 */
export function EngineeringContent({
  report,
  history,
  typeLabels,
  daily,
  actions,
}: {
  report: MonthlyReport
  history: ExcellenceHistory | undefined
  typeLabels: Record<string, string>
  daily?: DailyScore[]
  actions: ActionsEntry[]
}) {
  const card = report.scorecard?.available ? report.scorecard.data : null
  const scorecard: SectionMeta = {
    id: 'scorecard',
    title: 'Engineering scorecard',
    group: 'scorecard',
    facets: [],
    ...scorecardStatus(card),
  }
  const excellence = excellenceSections(report, history)
  const code: SectionMeta = {
    id: 'code',
    title: 'Comments and tests',
    group: 'repository',
    facets: [],
    ...codeStatus(report),
  }
  const usage: SectionMeta = {
    id: 'actions',
    title: 'GitHub Actions usage',
    group: 'repository',
    facets: [],
    ...actionsStatus(actions),
  }
  const meta: SectionMeta[] = [scorecard, ...excellence, code, usage].map(
    ({ id, title, group, facets, rag, text }) => ({ id, title, group, facets, rag, text }),
  )
  const section = (s: SectionMeta & { tools?: string[] }): PanelSection => ({
    id: s.id,
    tab: 'engineering',
    rag: s.rag,
    status: s.text,
    tools: s.tools,
  })

  return (
    <EngineeringTab sections={meta}>
      <ScorecardPanel report={report} typeLabels={typeLabels} section={section(scorecard)} />
      {excellence.map((s) => (
        <Panel key={s.id} title={s.title} description={s.description} section={section(s)}>
          {s.content}
        </Panel>
      ))}
      <CodePanel report={report} daily={daily} section={section(code)} />
      <ActionsPanel history={actions} section={section(usage)} />
    </EngineeringTab>
  )
}
