'use client'

import { type ReactNode, createContext, useContext } from 'react'

export interface Fold {
  isOpen: (id: string) => boolean
  set: (id: string, open: boolean) => void
}

const FoldContext = createContext<Fold | null>(null)

/** Lets a page decide which of its panels are open; panels outside one stay open by default. */
export function FoldProvider({ value, children }: { value: Fold; children: ReactNode }) {
  return <FoldContext.Provider value={value}>{children}</FoldContext.Provider>
}

/**
 * The details element behind every Panel. Inside a FoldProvider its open state is the page's, kept in
 * the URL; anywhere else it is a plain open details element that works with no script at all.
 */
export function FoldDetails({
  id,
  className,
  children,
}: {
  id?: string
  className?: string
  children: ReactNode
}) {
  const fold = useContext(FoldContext)
  const open = id && fold ? fold.isOpen(id) : true
  return (
    <details
      open={open}
      className={className}
      onToggle={(e) => {
        const now = e.currentTarget.open
        if (id && fold && now !== open) fold.set(id, now)
      }}
    >
      {children}
    </details>
  )
}
