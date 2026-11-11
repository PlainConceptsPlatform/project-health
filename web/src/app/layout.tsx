import { hasSyntheticData, readCollectedAt, readSiteSource } from '@/shared/lib/data'
import { PLATFORM_FOUNDATIONS, PLATFORM_SIBLINGS } from '@/shared/lib/platform'
import { repoSlug, repoUrl } from '@/shared/lib/repo'
import type { SiteSource } from '@/shared/lib/source'
import { withBase } from '@/shared/lib/utils'
import { TooltipProvider } from '@/shared/ui'
import { THEME_INIT_SCRIPT, ThemeToggle } from '@/shared/ui/theme-toggle'
import { Github } from 'lucide-react'
import type { Metadata } from 'next'
import { Outfit } from 'next/font/google'
import type { ReactNode } from 'react'
import './globals.css'

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Project Health',
  description: 'Delivery and agent metrics for Platform projects, collected from GitHub.',
}

/** The header's one-line claim, true for whatever wrote the stored months. */
const TAGLINE: Record<SiteSource, string> = {
  github: 'Delivery and agent metrics from GitHub',
  facets: "Engineering metrics from each repository's CI",
  mixed: 'Delivery, agent and engineering metrics',
}

/** The footer's account of where the numbers come from. */
const PROVENANCE: Record<SiteSource, string> = {
  github:
    'Every number on this site comes from the GitHub API. Metrics that GitHub cannot answer are shown as unavailable rather than estimated. Collection runs daily at 03:15 UTC, so a timestamp much older than that means the last run did not finish.',
  facets:
    "Every number on this site comes from the engineering facets each repository's own CI publishes. Metrics no collector reads on that host are shown as unavailable rather than estimated.",
  mixed:
    'Numbers come from the GitHub API, or, for repositories on other hosts, from the engineering facets their own CI publishes. Metrics that cannot be answered are shown as unavailable rather than estimated.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const collectedAt = readCollectedAt()
  const source = readSiteSource()
  const synthetic = hasSyntheticData()
  const repo = repoUrl()
  const slug = repoSlug()

  return (
    <html lang="en" className={outfit.variable} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant string from theme-toggle.tsx, no user input; it must run before paint */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <header className="border-t-[3px] border-b border-t-primary bg-background">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-6 py-4">
            <nav aria-label="Breadcrumb" className="inline-flex items-center gap-2 text-lg">
              <a
                href={PLATFORM_FOUNDATIONS.href}
                className="inline-flex items-center gap-2 font-semibold tracking-tight text-muted-foreground transition hover:text-foreground"
              >
                <span className="size-2.5 rounded-[2px] bg-primary" aria-hidden="true" />
                {PLATFORM_FOUNDATIONS.name}
              </a>
              <span className="text-muted-foreground" aria-hidden="true">
                /
              </span>
              <a href={withBase('/')} className="font-semibold tracking-tight">
                Project Health
              </a>
            </nav>
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {TAGLINE[source]}
            </span>

            <div className="ml-auto flex items-center gap-2">
              {collectedAt ? (
                <span className="mr-2 text-sm text-muted-foreground">
                  Updated{' '}
                  <time dateTime={collectedAt}>
                    {new Date(collectedAt).toLocaleString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'UTC',
                    })}{' '}
                    UTC
                  </time>
                </span>
              ) : null}

              <ThemeToggle />
              <a
                href={repo}
                aria-label={`Open ${slug} on GitHub`}
                title={slug}
                className="inline-flex size-9 items-center justify-center rounded-md border text-muted-foreground outline-none transition hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Github className="size-4" aria-hidden="true" />
              </a>
            </div>
          </div>
        </header>

        <TooltipProvider delayDuration={150}>
          {synthetic ? (
            <div className="border-b border-warning/30 bg-warning/15">
              <p className="mx-auto max-w-6xl px-6 py-2.5 text-sm text-warning-foreground">
                <strong className="font-semibold">Example data.</strong> These numbers are generated
                so the dashboard demonstrates itself. Point <code>projects.json</code> at your own
                repositories and run a collection to replace them.
              </p>
            </div>
          ) : null}
          <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        </TooltipProvider>

        <footer className="mx-auto max-w-6xl px-6 pb-10 pt-4">
          <p className="text-xs text-muted-foreground">
            {PROVENANCE[source]}{' '}
            <a href={repo} className="underline hover:text-foreground">
              Source and documentation
            </a>
            .
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Part of{' '}
            <a href={PLATFORM_FOUNDATIONS.href} className="underline hover:text-foreground">
              {PLATFORM_FOUNDATIONS.name}
            </a>
            {PLATFORM_SIBLINGS.map((site) => (
              <span key={site.href}>
                {' · '}
                <a href={site.href} className="underline hover:text-foreground">
                  {site.name}
                </a>
              </span>
            ))}
          </p>
        </footer>
      </body>
    </html>
  )
}
