'use client'

import { type SectionMeta, foldQuery, foldState } from '@/shared/lib/sections'
import { writeQuery } from '@/shared/lib/url-state'
import { sectionAnchor } from '@/shared/ui'
import { FoldProvider } from '@/shared/ui/fold'
import { SectionNav } from '@/shared/ui/section-nav'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'

const TAB = 'engineering'
const SECTION_HASH = /^#engineering\/([\w-]+)$/

/** Scrolls to a section once it is laid out: the tab may only just have switched to Engineering. */
function scrollTo(id: string) {
  let frames = 0
  const step = () => {
    const el = document.getElementById(sectionAnchor(id))
    if (el && el.offsetParent !== null) el.scrollIntoView({ block: 'start' })
    else if (++frames < 60) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/**
 * The Engineering tab: a section nav beside the panels, which panels are open, and the section being
 * read. Red and yellow panels open on arrival; whatever the reader opens or folds is written to the
 * query (?open=&shut=), so a shared link opens the panels the sender had open.
 */
export function EngineeringTab({
  sections,
  children,
}: {
  sections: SectionMeta[]
  children: ReactNode
}) {
  const [open, setOpen] = useState(() => foldState(sections, ''))
  const [active, setActive] = useState<string | null>(sections[0]?.id ?? null)

  const apply = useCallback(
    (next: Record<string, boolean>) => {
      setOpen(next)
      writeQuery(foldQuery(sections, next))
    },
    [sections],
  )

  const select = useCallback(
    (id: string) => {
      setOpen((prev) => {
        if (prev[id]) return prev
        const next = { ...prev, [id]: true }
        writeQuery(foldQuery(sections, next))
        return next
      })
      setActive(id)
      const { pathname, search } = window.location
      window.history.replaceState(null, '', `${pathname}${search}#${TAB}/${id}`)
      scrollTo(id)
    },
    [sections],
  )

  useEffect(() => {
    setOpen(foldState(sections, window.location.search))
    const fromHash = () => {
      const id = window.location.hash.match(SECTION_HASH)?.[1]
      if (id && sections.some((s) => s.id === id)) select(id)
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [sections, select])

  // The entry being read follows the scroll: the topmost section under the sticky bar.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const visible = new Map<string, number>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = e.target.id.replace(/^section-/, '')
          if (e.isIntersecting) visible.set(id, e.boundingClientRect.top)
          else visible.delete(id)
        }
        const top = [...visible.entries()].sort((a, b) => a[1] - b[1])[0]
        if (top) setActive(top[0])
      },
      { rootMargin: '-20% 0px -60% 0px' },
    )
    for (const s of sections) {
      const el = document.getElementById(sectionAnchor(s.id))
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [sections])

  const fold = useMemo(
    () => ({
      isOpen: (id: string) => open[id] ?? true,
      set: (id: string, value: boolean) => apply({ ...open, [id]: value }),
    }),
    [open, apply],
  )

  return (
    <FoldProvider value={fold}>
      <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-6">
        <SectionNav
          sections={sections}
          tab={TAB}
          active={active}
          onSelect={select}
          onExpandAll={() => apply(Object.fromEntries(sections.map((s) => [s.id, true])))}
          onCollapseAll={() => apply(Object.fromEntries(sections.map((s) => [s.id, false])))}
        />
        <div className="mt-4 min-w-0 space-y-6 lg:mt-0">{children}</div>
      </div>
    </FoldProvider>
  )
}
