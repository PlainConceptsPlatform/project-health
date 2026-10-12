import { LEVEL_CLASS, MODE_CLASS, MODE_LABEL, RAG_DOT, RAG_LABEL } from '../lib/scorecard'
import type { AiUsage, MetricBlock, Rag, ScorecardAlert, StandardMode } from '../lib/types'
import { cn } from '../lib/utils'
import { Badge } from './badge'

export function RagDot({ rag, label = true }: { rag: Rag; label?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', RAG_DOT[rag])} />
      {label ? (
        <span className="text-sm">{RAG_LABEL[rag]}</span>
      ) : (
        <span className="sr-only">{RAG_LABEL[rag]}</span>
      )}
    </span>
  )
}

export function ModeBadge({ mode }: { mode: StandardMode }) {
  return (
    <Badge variant="outline" className={MODE_CLASS[mode]}>
      {MODE_LABEL[mode]}
    </Badge>
  )
}

export function LevelBadge({ level }: { level: number }) {
  return (
    <Badge variant="outline" className={cn('tabular-nums', LEVEL_CLASS[level] ?? LEVEL_CLASS[0])}>
      N{level}
    </Badge>
  )
}

export function AiUsageValue({ usage }: { usage: MetricBlock<AiUsage> }) {
  if (!usage.available) {
    return (
      <span className="text-muted-foreground" title={usage.reason}>
        n/a
      </span>
    )
  }
  const { level, share, aiCommits, totalCommits } = usage.data
  return (
    <span
      className="tabular-nums"
      title={`${aiCommits} of ${totalCommits} commits AI-assisted (${Math.round(share * 100)}%)`}
    >
      <span className="font-medium">{level}</span>
      <span className="text-muted-foreground">/5</span>
    </span>
  )
}

const ALERT_SHORT: Record<ScorecardAlert['code'], string> = {
  HIGH_AI_LOW_ENGINEERING: 'High AI, low engineering',
  ENGINEERING_DECLINING: 'Engineering declining',
}

export function AlertBadge({ alert }: { alert: ScorecardAlert }) {
  return (
    <Badge
      variant="outline"
      title={alert.message}
      className={
        alert.severity === 'red'
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-warning/60 bg-warning/15 text-foreground'
      }
    >
      {alert.code === 'ENGINEERING_DECLINING' ? '▼ ' : null}
      {ALERT_SHORT[alert.code]}
    </Badge>
  )
}
