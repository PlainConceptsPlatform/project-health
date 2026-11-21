'use client'

import { SECTION_GROUP_LABEL, type SectionGroup, type SectionMeta } from '../lib/sections'
import { cn } from '../lib/utils'
import { RagDot } from './scorecard'

const GROUPS: SectionGroup[] = ['scorecard', 'excellence', 'repository']

/**
 * The table of contents of a long tab. From lg up it is a sticky rail beside the panels, grouped,
 * each entry with the colour of its section; below that a sticky strip of chips that scrolls inside
 * itself. The entry being read is marked with aria-current, and each one links to #<tab>/<id>.
 */
export function SectionNav({
  sections,
  tab,
  active,
  onSelect,
  onExpandAll,
  onCollapseAll,
}: {
  sections: SectionMeta[]
  tab: string
  active: string | null
  onSelect: (id: string) => void
  onExpandAll: () => void
  onCollapseAll: () => void
}) {
  const link = (s: SectionMeta, className: string) => (
    <a
      key={s.id}
      href={`#${tab}/${s.id}`}
      aria-current={active === s.id ? 'location' : undefined}
      title={s.text}
      onClick={(e) => {
        e.preventDefault()
        onSelect(s.id)
      }}
      className={cn(
        className,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active === s.id
          ? 'bg-accent font-medium text-accent-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <RagDot rag={s.rag} label={false} />
      <span className="truncate">{s.title}</span>
    </a>
  )
  const actions = (className: string) => (
    <div className={cn('flex gap-1 text-xs', className)}>
      <button
        type="button"
        onClick={onExpandAll}
        className="min-h-11 rounded px-2 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline lg:min-h-7"
      >
        Expand all
      </button>
      <button
        type="button"
        onClick={onCollapseAll}
        className="min-h-11 rounded px-2 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline lg:min-h-7"
      >
        Collapse all
      </button>
    </div>
  )
  return (
    <>
      <nav
        aria-label="Sections"
        className="sticky top-[var(--sticky-offset,0px)] hidden max-h-[calc(100vh-var(--sticky-offset,0px))] self-start overflow-y-auto py-1 lg:block"
      >
        {GROUPS.map((group) => {
          const entries = sections.filter((s) => s.group === group)
          if (entries.length === 0) return null
          return (
            <div key={group} className="mb-3">
              <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {SECTION_GROUP_LABEL[group]}
              </p>
              <div className="flex flex-col">
                {entries.map((s) =>
                  link(s, 'flex min-h-8 items-center gap-2 rounded-md px-2 text-sm'),
                )}
              </div>
            </div>
          )
        })}
        {actions('px-1')}
      </nav>
      <nav
        aria-label="Sections"
        className="sticky top-[var(--sticky-offset,0px)] z-20 -mx-4 flex items-center gap-1.5 overflow-x-auto border-b bg-background px-4 py-1.5 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:hidden [&::-webkit-scrollbar]:hidden"
      >
        {sections.map((s) =>
          link(
            s,
            'flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px]',
          ),
        )}
        {actions('shrink-0')}
      </nav>
    </>
  )
}
