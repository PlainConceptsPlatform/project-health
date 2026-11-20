'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { type ReactNode, useEffect, useRef, useState } from 'react'

/** The query parameter a shared link uses for what would otherwise follow the hash. */
export const TAB_PARAM = 'tab'

/**
 * Moves ?tab=roadmap/773 into #roadmap/773. Panels read the hash in effects that can run before
 * this component's own, so each of them calls this first; after the first call it does nothing.
 */
export function adoptSharedTab(): void {
  const params = new URLSearchParams(window.location.search)
  const shared = params.get(TAB_PARAM)
  if (!shared) return
  params.delete(TAB_PARAM)
  const search = params.size ? `?${params}` : ''
  window.history.replaceState(null, '', `${window.location.pathname}${search}#${shared}`)
}

export interface ProjectTab {
  id: string
  label: string
  content: ReactNode
}

/**
 * The panels are rendered on the server and handed in whole; this only decides which one shows.
 * The tab lives in the URL hash so a link to a project's roadmap opens on the roadmap, and the
 * first tab clears the hash so the plain project URL stays the default view. What follows a slash
 * belongs to the tab, such as the selected issue in #roadmap/773.
 *
 * A shared link carries the same thing as ?tab=roadmap/773 instead. GitHub Pages sends a visitor
 * without a session through the GitHub sign-in, which keeps the query but drops the hash, so the
 * query is moved into the hash on arrival and everything else keeps reading the hash.
 */
export interface MonthLink {
  month: string
  href: string
  current: boolean
}

export function ProjectTabs({ tabs, months = [] }: { tabs: ProjectTab[]; months?: MonthLink[] }) {
  const first = tabs[0]?.id ?? ''
  const [active, setActive] = useState(first)
  const monthNav = useRef<HTMLElement>(null)

  // The newest month sits at the right end; on a narrow screen the row would open scrolled away
  // from the month being shown, so bring the current one into view.
  // Run again once the web font is in: the row only overflows at its final width.
  useEffect(() => {
    const align = () => {
      const nav = monthNav.current
      const current = nav?.querySelector<HTMLElement>('[aria-current="page"]')
      if (!nav || !current) return
      const overflow = current.getBoundingClientRect().right - nav.getBoundingClientRect().right
      if (overflow > 0) nav.scrollLeft += overflow
    }
    align()
    document.fonts?.ready.then(align)
  }, [])

  useEffect(() => {
    adoptSharedTab()
    const fromHash = () => {
      // A tab can carry more after a slash, like the issue in #roadmap/773.
      const hash = window.location.hash.slice(1).split('/')[0] ?? ''
      setActive(tabs.some((t) => t.id === hash) ? hash : first)
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [tabs, first])

  const change = (id: string) => {
    setActive(id)
    const url = `${window.location.pathname}${window.location.search}${id === first ? '' : `#${id}`}`
    window.history.replaceState(null, '', url)
  }

  return (
    <Tabs value={active} onValueChange={change} className="gap-6">
      {/*
        Sticky with the month picker beside it, so switching tab or month never means scrolling back
        to the top. Both rows scroll inside themselves on a phone instead of widening the page.
      */}
      <div className="sticky top-0 z-30 -mx-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-background px-4 py-2 sm:-mx-6 sm:px-6">
        <div className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList className="h-11 md:h-9">
            {tabs.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="px-4">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {months.length > 1 ? (
          <nav
            ref={monthNav}
            aria-label="Month"
            className="flex max-w-full gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {months.map((m) => (
              <a
                key={m.month}
                // The open tab travels with the month, so stepping back a month stays on the roadmap.
                href={`${m.href}${active === first ? '' : `#${active}`}`}
                aria-current={m.current ? 'page' : undefined}
                className={
                  m.current
                    ? 'shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground'
                    : 'shrink-0 rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent'
                }
              >
                {m.month}
              </a>
            ))}
          </nav>
        ) : null}
      </div>
      {tabs.map((t) => (
        <TabsContent key={t.id} value={t.id} className="space-y-6">
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
