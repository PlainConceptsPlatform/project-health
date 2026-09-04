import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** The shadcn class merge helper, at the path components.json points to. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
