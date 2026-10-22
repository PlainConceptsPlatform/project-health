'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { type ReactNode, useEffect, useState } from 'react'

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
export function ProjectTabs({ tabs }: { tabs: ProjectTab[] }) {
  const first = tabs[0]?.id ?? ''
  const [active, setActive] = useState(first)

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
      <TabsList>
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id} className="px-4">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.id} value={t.id} className="space-y-6">
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}
