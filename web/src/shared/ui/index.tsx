import type { ReactNode } from 'react'
import type { GlossaryKey } from '../lib/glossary'
import type { MetricBlock } from '../lib/types'
import { cn } from '../lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card'
import { InfoTip } from './info-tip'
import { Table, TableBody, TableHead, TableHeader, TableRow } from './table'

export { Badge } from './badge'
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './card'
export { InfoTip } from './info-tip'
export { Separator } from './separator'
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'
export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table'
export { cn }

/**
 * A titled card. The shadcn Card is the primitive; this only saves repeating the same four
 * elements at every call site.
 */
export function Panel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? (
          <div className="col-start-2 row-span-2 row-start-1 self-start">{action}</div>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/** The empty state for a metric a project does not produce. Never an error, never a zero. */
export function Unavailable({ reason }: { reason: string }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/40 px-4 py-3">
      <p className="text-sm font-medium text-muted-foreground">Not available</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground/80">{reason}</p>
    </div>
  )
}

/**
 * Renders a metric block, falling back to the unavailable state without the caller branching.
 *
 * The block is allowed to be missing entirely, not just unavailable. Stored files are written by
 * whichever version of the collector ran, so a metric added after a file was written is absent
 * rather than present-and-unavailable. Treating that as a crash would take the whole site down for
 * a field that simply has not been collected yet.
 */
export function Metric<T>({
  block,
  children,
}: {
  block: MetricBlock<T> | undefined | null
  children: (data: T) => ReactNode
}) {
  if (!block) {
    return (
      <Unavailable reason="This metric was added after the stored data was collected. It will appear after the next collection." />
    )
  }
  if (!block.available) return <Unavailable reason={block.reason} />
  return <>{children(block.data)}</>
}

export function Stat({
  label,
  value,
  hint,
  tone,
  explain,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'bad' | 'muted'
  /** Glossary key. Most readers have not read the DORA report. */
  explain?: GlossaryKey
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
        {explain ? <InfoTip term={explain} /> : null}
      </p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums',
          tone === 'bad' && 'text-destructive',
          tone === 'muted' && 'text-muted-foreground',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** Thin wrapper so a table is one element with a header list rather than eight nested tags. */
export function DataTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {head.map((h) => (
              <TableHead key={h}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  )
}
