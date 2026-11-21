'use client'

import { CheckIcon, LinkIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { sharedUrl } from '../lib/url-state'
import { cn } from '../lib/utils'

type CopyState = 'idle' | 'copied' | 'failed'

const LABEL: Record<CopyState, string> = {
  idle: 'Copy link',
  copied: 'Copied',
  failed: 'Copy the address bar',
}

/**
 * Copies a link to the view on screen. By default that is the address bar with its hash moved into
 * ?tab=, the form that survives the GitHub Pages sign-in. With no clipboard (an insecure origin, or
 * permission refused) it says so instead of claiming a copy that did not happen.
 */
export function CopyLink({
  url = () => sharedUrl(window.location.href),
  className,
  label = LABEL.idle,
}: {
  url?: () => string
  className?: string
  label?: string
}) {
  const [state, setState] = useState<CopyState>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const timer = setTimeout(() => setState('idle'), state === 'copied' ? 2000 : 4000)
    return () => clearTimeout(timer)
  }, [state])
  return (
    <button
      type="button"
      title="Copy a link to this exact view"
      onClick={() => {
        if (!navigator.clipboard) {
          setState('failed')
          return
        }
        navigator.clipboard.writeText(url()).then(
          () => setState('copied'),
          () => setState('failed'),
        )
      }}
      className={cn(
        'inline-flex min-h-11 items-center gap-2 rounded-lg border bg-background px-3.5 text-sm font-medium transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9',
        className,
      )}
    >
      {state === 'copied' ? (
        <CheckIcon className="size-4" aria-hidden="true" />
      ) : (
        <LinkIcon className="size-4" aria-hidden="true" />
      )}
      <span aria-live="polite">{state === 'idle' ? label : LABEL[state]}</span>
    </button>
  )
}
