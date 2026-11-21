'use client'

import { recalledOverviewQuery } from '@/shared/lib/url-state'
import { withBase } from '@/shared/lib/utils'
import { useEffect, useState } from 'react'

/**
 * "Back to projects", reopening the overview as it was left: the search, filters, sort and tab the
 * overview kept in its query. The static page renders the plain link; the query is added once the
 * page is in the browser, where the overview stored it for this tab.
 */
export function BackToProjects() {
  const [href, setHref] = useState(withBase('/'))
  useEffect(() => setHref(`${withBase('/')}${recalledOverviewQuery()}`), [])
  return (
    <a href={href} className="text-sm text-muted-foreground hover:underline">
      Back to projects
    </a>
  )
}
