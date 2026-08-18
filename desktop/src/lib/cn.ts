import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind class strings safely (later classes win on conflict). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
