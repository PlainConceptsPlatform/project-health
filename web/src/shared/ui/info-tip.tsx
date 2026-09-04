'use client'

import { InfoIcon } from 'lucide-react'
import { GLOSSARY, type GlossaryKey } from '../lib/glossary'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

/**
 * An explanation attached to a metric label. Most people reading this site have not read the DORA
 * report, and a number nobody can interpret is worse than no number.
 *
 * The trigger is a real button so it is reachable by keyboard and announced by a screen reader,
 * rather than a hover-only affordance.
 */
export function InfoTip({ term }: { term: GlossaryKey }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="What this means"
          className="ml-1 inline-flex align-middle text-muted-foreground/60 transition hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
        >
          <InfoIcon className="size-3" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-pretty leading-relaxed">
        {GLOSSARY[term]}
      </TooltipContent>
    </Tooltip>
  )
}
