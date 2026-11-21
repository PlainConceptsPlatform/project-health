'use client'

/**
 * "Show all" for a list rendered whole on the server with its tail hidden: it flips data-all on the
 * nearest list wrapper, whose CSS reveals the hidden rows, and then hides itself.
 */
export function ShowAll({ count }: { count: number }) {
  return (
    <button
      type="button"
      onClick={(e) => e.currentTarget.closest('[data-all]')?.setAttribute('data-all', 'true')}
      className="min-h-11 text-sm font-medium text-primary underline underline-offset-4 group-data-[all=true]/list:hidden md:min-h-0"
    >
      Show all {count}
    </button>
  )
}
