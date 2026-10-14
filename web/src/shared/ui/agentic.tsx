import { CheckIcon, MinusIcon, TriangleAlertIcon, XIcon } from 'lucide-react'
import {
  type AgenticVerdict,
  VERDICT_DESCRIPTION,
  VERDICT_LABEL,
  type VersionState,
  versionState,
} from '../lib/agentic'
import { cn } from '../lib/utils'

const VERDICT_CLASS: Record<AgenticVerdict, string> = {
  aligned: 'border-primary/30 bg-primary/10 text-primary',
  behind: 'border-warning/60 bg-warning/15 text-warning-foreground dark:text-warning',
  custom: 'border-muted-foreground/40 text-muted-foreground',
  none: 'border-destructive/40 bg-destructive/10 text-destructive',
}

export function VerdictBadge({ verdict }: { verdict: AgenticVerdict }) {
  return (
    <span
      title={VERDICT_DESCRIPTION[verdict]}
      className={cn(
        'inline-flex w-fit whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold',
        VERDICT_CLASS[verdict],
      )}
    >
      {VERDICT_LABEL[verdict]}
    </span>
  )
}

const STATE_CLASS: Record<VersionState, string> = {
  current: 'text-foreground',
  patch: 'text-foreground',
  behind: 'text-warning-foreground dark:text-warning',
  missing: 'text-destructive',
  unknown: 'text-foreground',
}

const STATE_TITLE: Record<VersionState, (latest: string | null) => string> = {
  current: () => 'The newest release',
  patch: (latest) => `A patch behind ${latest}`,
  behind: (latest) => `Behind the newest release, ${latest}`,
  missing: () => 'Not installed',
  unknown: () => 'The newest release could not be read to compare',
}

/** An installed version against the newest on npm, or a cross when it is not installed. */
export function VersionCell({
  version,
  latest,
  fallback,
}: {
  version: string | null
  latest: string | null
  /** Shown instead of the cross, for something that is installed but not as the package. */
  fallback?: string | null
}) {
  const state = versionState(version, latest)
  if (state === 'missing') {
    return fallback ? (
      <span className="text-sm text-muted-foreground">{fallback}</span>
    ) : (
      <Mark ok={false} label="Not installed" />
    )
  }
  return (
    <span
      title={STATE_TITLE[state](latest)}
      className={cn('inline-flex items-center gap-1.5 tabular-nums', STATE_CLASS[state])}
    >
      {version}
      {state === 'behind' ? (
        <span className="text-xs text-muted-foreground">of {latest}</span>
      ) : null}
    </span>
  )
}

/** A yes or no with its meaning in the accessible name, never the icon alone. */
export function Mark({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) {
    return (
      <span title={label} className="inline-flex text-muted-foreground">
        <MinusIcon className="size-4" aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </span>
    )
  }
  const Icon = ok ? CheckIcon : XIcon
  return (
    <span title={label} className={cn('inline-flex', ok ? 'text-success' : 'text-destructive')}>
      <Icon className="size-4" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** A warning glyph with text beside it, for a partial or non-standard state. */
export function Partial({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex items-start gap-1.5 text-sm">
      <TriangleAlertIcon
        className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning"
        aria-hidden="true"
      />
      <span>{children}</span>
    </span>
  )
}
