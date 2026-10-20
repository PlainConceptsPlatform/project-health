import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** The shadcn class merge helper, at the path components.json points to. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/**
 * A site path under the base path. Next adds it to its own assets, but not to a plain anchor or an
 * image, so a site served from a github.io subpath would otherwise link back to the domain root.
 * Absolute URLs pass through unchanged.
 */
export const withBase = (path: string): string =>
  path.startsWith('/') ? `${BASE_PATH}${path}` : path
