import { hasSyntheticData, readCollectedAt } from '@/shared/lib/data'
import { repoSlug, repoUrl } from '@/shared/lib/repo'
import { TooltipProvider } from '@/shared/ui'
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

export default function RootLayout({ children }: { children: ReactNode }) {
  const collectedAt = readCollectedAt()
  const synthetic = hasSyntheticData()
  const repo = repoUrl()
  const slug = repoSlug()

  return (
    <html lang="en" className={outfit.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <header className="border-b border-primary bg-primary text-primary-foreground">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-6 py-4">
            <a href="/" className="text-lg font-semibold tracking-tight">
              Project Health
            </a>
            <span className="hidden text-sm sm:inline">Delivery and agent metrics from GitHub</span>

            <div className="ml-auto flex items-center gap-4">
              {collectedAt ? (
                <span className="text-sm">
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

              {/* The slug is hidden on small screens, so the icon carries an accessible name. */}
              <a
                href={repo}
                aria-label={`Open ${slug} on GitHub`}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-primary-foreground/60 px-3 text-sm text-primary-foreground outline-none transition hover:bg-primary-foreground/10 focus-visible:ring-2 focus-visible:ring-primary-foreground"
              >
                <Github className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">{slug}</span>
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
            Every number on this site comes from the GitHub API. Metrics that GitHub cannot answer
            are shown as unavailable rather than estimated. Collection runs daily at 03:15 UTC, so a
            timestamp much older than that means the last run did not finish.{' '}
            <a href={repo} className="underline hover:text-foreground">
              Source and documentation
            </a>
            .
          </p>
        </footer>
      </body>
    </html>
  )
}
