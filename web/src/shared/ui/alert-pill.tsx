import { AlertTriangleIcon } from 'lucide-react'
import {
  ENV_LABEL,
  type PortfolioAlert,
  type PortfolioEnv,
  type PortfolioRow,
} from '../lib/portfolio'
import { cn } from '../lib/utils'

export const ALERT_TONE: Record<PortfolioAlert['severity'], string> = {
  red: 'bg-destructive/10 text-destructive',
  amber: 'bg-warning/15 text-warning-foreground dark:text-warning',
}

// PRO stands out, PRE is quieter, and no environment is plain text: it is an absence, not a tier.
const ENV_CHIP: Record<PortfolioEnv, string> = {
  pro: 'rounded-md border border-transparent bg-primary/10 px-2 py-0.5 text-xs font-semibold text-[color-mix(in_oklab,var(--primary)_80%,black)] dark:text-primary',
  pre: 'rounded-md border border-muted-foreground/40 px-2 py-0.5 text-xs font-semibold text-muted-foreground',
  none: 'text-sm text-muted-foreground',
  na: 'text-sm text-muted-foreground',
}

const envTitle = (row: Pick<PortfolioRow, 'env' | 'environment'>) =>
  row.env === 'na'
    ? 'Platform tooling is not deployed to PRE/PRO environments, so the environment does not apply.'
    : row.environment?.available
      ? row.environment.data.environments
          .map(
            (e) =>
              `${e.name}: ${e.tier ?? 'unknown'} (${e.resourceGroup ?? 'from the environment name'})`,
          )
          .join('\n')
      : row.environment?.reason

export function EnvChip({ row }: { row: Pick<PortfolioRow, 'env' | 'environment'> }) {
  return (
    <span className={cn('inline-flex whitespace-nowrap', ENV_CHIP[row.env])} title={envTitle(row)}>
      {ENV_LABEL[row.env]}
    </span>
  )
}

/**
 * The single most pressing reason to look at a project. `compact` keeps only the icon below sm, for
 * the one-line sticky header on a phone; the text stays as its accessible name.
 */
export function AlertPill({ alert, compact }: { alert: PortfolioAlert; compact?: boolean }) {
  return (
    <span
      title={alert.detail}
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-2 text-xs font-semibold',
        ALERT_TONE[alert.severity],
      )}
    >
      <AlertTriangleIcon className="size-3" aria-hidden="true" />
      <span className={cn(compact && 'sr-only sm:not-sr-only')}>{alert.text}</span>
    </span>
  )
}
