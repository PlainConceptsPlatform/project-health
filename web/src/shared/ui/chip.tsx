'use client'

import { cn } from '../lib/utils'

/**
 * A toggle chip: a real button whose pressed state is announced. Filters, sorts and view switches
 * across the site use it, so every chip looks and behaves the same.
 */
export function Chip({
  active,
  onClick,
  children,
  className,
  ...rest
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'className' | 'children'>) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 border px-3.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-background text-foreground hover:bg-muted',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
