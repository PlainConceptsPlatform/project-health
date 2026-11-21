'use client'

import { adoptSharedTab } from '@/shared/lib/url-state'
import { CopyLink } from '@/shared/ui/copy-link'
import { type MonthLink, PeriodSelect } from '@/shared/ui/period-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { type ReactNode, useEffect, useRef, useState } from 'react'

export { TAB_PARAM, adoptSharedTab } from '@/shared/lib/url-state'
export type { MonthLink } from '@/shared/ui/period-select'

export interface ProjectTab {
  id: string
  label: string
  content: ReactNode
  /** Things on the tab that need action, shown on the tab itself; nothing when zero. */
  badge?: { count: number; title: string }
}

/**
 * The panels are rendered on the server and handed in whole; this only decides which one shows.
 * The tab lives in the URL hash so a link to a project's roadmap opens on the roadmap, and the
 * first tab clears the hash so the plain project URL stays the default view. What follows a slash
 * belongs to the tab, such as the selected issue in #roadmap/773 or the section in
 * #engineering/hygiene.
 *
 * A shared link carries the same thing as ?tab=roadmap/773 instead. GitHub Pages sends a visitor
 * without a session through the GitHub sign-in, which keeps the query but drops the hash, so the
 * query is moved into the hash on arrival and everything else keeps reading the hash.
 *
 * The bar is sticky with the project header above it, on a phone too, so the level and score stay
 * in sight deep down a long tab. Its height is published as --sticky-offset, which the section nav
 * and the section anchors use to sit just under it.
 */
export function ProjectTabs({
  tabs,
  months = [],
  header,
}: {
  tabs: ProjectTab[]
  months?: MonthLink[]
  header?: ReactNode
}) {
  const first = tabs[0]?.id ?? ''
  const [active, setActive] = useState(first)
  const bar = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = bar.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const publish = () =>
      document.documentElement.style.setProperty('--sticky-offset', `${el.offsetHeight}px`)
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(el)
    return () => observer.disconnect()
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
      <div
        ref={bar}
        className="sticky top-0 z-30 -mx-4 flex flex-col gap-2 border-b bg-background px-4 py-2 sm:-mx-6 sm:px-6"
      >
        {header}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsList className="h-11 md:h-9">
              {tabs.map((t) => (
                <TabsTrigger key={t.id} value={t.id} className="px-4">
                  {t.label}
                  {t.badge && t.badge.count > 0 ? (
                    <span
                      title={t.badge.title}
                      className="ml-0.5 rounded-full bg-destructive/10 px-1.5 text-xs font-semibold text-destructive tabular-nums"
                    >
                      {t.badge.count}
                      <span className="sr-only"> {t.badge.title}</span>
                    </span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <div className="flex items-center gap-2">
            {months.length > 1 ? (
              <PeriodSelect months={months} hash={active === first ? '' : active} />
            ) : null}
            <CopyLink />
          </div>
        </div>
      </div>
      {tabs.map((t) => (
        <TabsContent key={t.id} value={t.id} className="space-y-6">
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
