import { GaugeIcon, LockIcon, type LucideIcon, ScrollTextIcon } from 'lucide-react'
import { LEVEL_CLASS, MODE_DESCRIPTION, MODE_LABEL, RAG_DOT, RAG_LABEL } from '../lib/scorecard'
import type {
  AiUsage,
  FinalEnvironment,
  MetricBlock,
  Rag,
  ScorecardAlert,
  StandardMode,
} from '../lib/types'
import { cn } from '../lib/utils'
import { Badge } from './badge'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

export function RagDot({ rag, label = true }: { rag: Rag; label?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', RAG_DOT[rag])} />
      {label ? <span>{RAG_LABEL[rag]}</span> : <span className="sr-only">{RAG_LABEL[rag]}</span>}
    </span>
  )
}

const MODE_ICON: Record<StandardMode, LucideIcon> = {
  blocking: LockIcon,
  threshold: GaugeIcon,
  policy: ScrollTextIcon,
}

/**
 * How a practice is enforced, in a neutral colour: the mode is a fact about the gate, and a red
 * badge on every blocking row read as a failure.
 */
export function ModeIcon({ mode }: { mode: StandardMode }) {
  const Icon = MODE_ICON[mode]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={MODE_LABEL[mode]}
          className="inline-flex text-muted-foreground transition hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-pretty">
        <span className="font-medium">{MODE_LABEL[mode]}.</span> {MODE_DESCRIPTION[mode]}
      </TooltipContent>
    </Tooltip>
  )
}

/** The status colour alone; its label and reason sit in the tooltip and the accessible name. */
export function StatusDot({ rag, reason }: { rag: Rag; reason: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${RAG_LABEL[rag]}. ${reason}`}
          className="inline-flex rounded-full p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden className={cn('size-3 shrink-0 rounded-full', RAG_DOT[rag])} />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-pretty">
        <span className="font-medium">{RAG_LABEL[rag]}.</span> {reason}
      </TooltipContent>
    </Tooltip>
  )
}

export function ScorecardLegend() {
  const modes = Object.keys(MODE_ICON) as StandardMode[]
  const rags = Object.keys(RAG_DOT) as Rag[]
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-foreground">Mode</span>
        {modes.map((mode) => {
          const Icon = MODE_ICON[mode]
          return (
            <span
              key={mode}
              className="inline-flex items-center gap-1"
              title={MODE_DESCRIPTION[mode]}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {MODE_LABEL[mode]}
            </span>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium text-foreground">Status</span>
        {rags.map((rag) => (
          <RagDot key={rag} rag={rag} />
        ))}
      </div>
    </div>
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

/**
 * The furthest environment the application has reached. PRO is filled and PRE outlined, so the
 * column reads at a glance; the tooltip names the resource group each tier was read from.
 */
export function EnvironmentTag({
  environment,
}: { environment: MetricBlock<FinalEnvironment> | null }) {
  if (!environment) return <span className="text-xs text-muted-foreground">n/a</span>
  if (!environment.available) {
    return (
      <span className="text-xs text-muted-foreground" title={environment.reason}>
        Not deployed
      </span>
    )
  }
  const { final, environments } = environment.data
  const evidence = environments
    .map(
      (e) =>
        `${e.name}: ${e.tier ?? 'unknown tier'} (${e.resourceGroup ?? 'from the environment name'})`,
    )
    .join('\n')
  if (!final) {
    return (
      <span className="text-xs text-muted-foreground" title={evidence}>
        Unknown
      </span>
    )
  }
  return (
    <Badge
      variant={final === 'PRO' ? 'default' : 'outline'}
      className="tabular-nums"
      title={evidence}
    >
      {final}
    </Badge>
  )
}
