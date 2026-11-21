import type { ReactNode } from 'react'
import { cn } from '../lib/utils'

export interface Column<T> {
  key: string
  label: string
  cell: (row: T) => ReactNode
  /** Extra classes for this column's cells in the table. */
  className?: string
}

/**
 * One list, two layouts. From the breakpoint up it is a table, the right shape for comparing
 * projects; below it every row is a card of label and value pairs, so a phone never scrolls the page
 * sideways. Neither layout has a fixed minimum width.
 *
 * The first column is the row's title: the table's first cell and the card's heading. A row that
 * `note` returns text for has nothing to compare, so the note spans the rest of the table row and
 * replaces the pairs in its card.
 */
export function ResponsiveTable<T>({
  rows,
  columns,
  rowKey,
  note,
  rowClassName,
  breakpoint = 'lg',
  label,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  note?: (row: T) => ReactNode | null
  rowClassName?: (row: T) => string | false | undefined
  /** md: the table from 768 px; lg: from 1024 px, for tables with many columns. */
  breakpoint?: 'md' | 'lg'
  /** What the list is, for the card list's accessible name. */
  label: string
}) {
  const [title, ...rest] = columns
  if (!title) return null
  const asTable = breakpoint === 'md' ? 'hidden md:block' : 'hidden lg:block'
  const asCards = breakpoint === 'md' ? 'md:hidden' : 'lg:hidden'
  return (
    <>
      <div className={cn('overflow-x-auto rounded-xl border', asTable)} data-layout="table">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="px-4 py-3 font-semibold">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const text = note?.(row) ?? null
              return (
                <tr key={rowKey(row)} className={cn('border-t align-middle', rowClassName?.(row))}>
                  <td className={cn('px-4 py-3.5', title.className)}>{title.cell(row)}</td>
                  {text === null ? (
                    rest.map((c) => (
                      <td key={c.key} className={cn('px-4 py-3.5', c.className)}>
                        {c.cell(row)}
                      </td>
                    ))
                  ) : (
                    <td colSpan={rest.length} className="px-4 py-3.5 text-xs">
                      {text}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <ul aria-label={label} className={cn('m-0 flex list-none flex-col gap-2.5 p-0', asCards)}>
        {rows.map((row) => {
          const text = note?.(row) ?? null
          return (
            <li
              key={rowKey(row)}
              className={cn('rounded-xl border bg-card p-3.5', rowClassName?.(row))}
              data-layout="card"
            >
              <div className="mb-2.5">{title.cell(row)}</div>
              {text === null ? (
                <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3">
                  {rest.map((c) => (
                    <div key={c.key} className="min-w-0">
                      <dt className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {c.label}
                      </dt>
                      <dd className="m-0 min-w-0 break-words text-sm">{c.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-xs">{text}</p>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}
