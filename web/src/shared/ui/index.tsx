import { ChevronDownIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { GlossaryKey } from '../lib/glossary'
import type { MetricBlock, Rag } from '../lib/types'
import { cn } from '../lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card'
import { FoldDetails } from './fold'
import { InfoTip } from './info-tip'
import { RagDot } from './scorecard'
import { Table, TableBody, TableHead, TableHeader, TableRow } from './table'
import { ToolList } from './tools'

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
 *
 * The header folds the card away, so a long project page can be closed down to the sections being
 * read. It is a native details element: it works in the static export without any script, opens
 * for the browser's find-in-page, and starts open so nothing is hidden on arrival.
 */
export function Panel({
  title,
  description,
  action,
  children,
  className,
  section,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  /**
   * Makes the panel a section of its tab: an anchor (#<tab>/<id>), a status line and tool links
   * that stay visible while it is folded, and an open state the tab keeps in its URL.
   */
  section?: PanelSection
}) {
  return (
    <Card
      id={section ? sectionAnchor(section.id) : undefined}
      className={cn(
        'gap-0',
        section &&
          'scroll-mt-[calc(var(--sticky-offset,0px)+4rem)] lg:scroll-mt-[calc(var(--sticky-offset,0px)+1rem)]',
        className,
      )}
    >
      <FoldDetails id={section?.id} className="group/panel">
        <summary className="cursor-pointer list-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ChevronDownIcon
                className="size-4 shrink-0 -rotate-90 text-muted-foreground transition-transform group-open/panel:rotate-0"
                aria-hidden="true"
              />
              {title}
              {section ? (
                <a
                  href={`#${section.tab}/${section.id}`}
                  aria-label={`Link to ${typeof title === 'string' ? title : 'this section'}`}
                  className="ml-0.5 inline-flex min-h-6 items-center rounded px-1 text-sm font-normal text-muted-foreground hover:text-foreground"
                >
                  #
                </a>
              ) : null}
            </CardTitle>
            {section ? (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <RagDot rag={section.rag} label={false} />
                  {section.status}
                </span>
                {section.tools && section.tools.length > 0 ? (
                  <span>
                    From <ToolList tools={section.tools} />
                  </span>
                ) : null}
              </p>
            ) : null}
            {description ? <CardDescription className="pl-6">{description}</CardDescription> : null}
            {action ? (
              <div className="col-start-2 row-span-2 row-start-1 self-start">{action}</div>
            ) : null}
          </CardHeader>
        </summary>
        <CardContent className="mt-6">{children}</CardContent>
      </FoldDetails>
    </Card>
  )
}

export interface PanelSection {
  id: string
  /** The tab the section belongs to, for its #<tab>/<id> link. */
  tab: string
  rag: Rag
  status: string
  tools?: string[]
}

/** The element id of a section's panel; the section nav scrolls to it. */
export const sectionAnchor = (id: string) => `section-${id}`

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
