import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * The shadcn `cn` helper: conditional class names via clsx, then tailwind-merge
 * to resolve conflicting utilities so the last one wins rather than both
 * landing in the class list.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
