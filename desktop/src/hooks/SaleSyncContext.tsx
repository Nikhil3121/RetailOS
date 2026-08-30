/**
 * One sync loop per app, shared with anything that wants to show or trigger it.
 *
 * A context rather than calling `useSaleSync()` wherever it is needed: each
 * call would start its OWN interval. The worker and the database claim would
 * reject the overlapping runs, but creating a race and relying on a lower
 * layer to clean it up is not a design. Mounted once, in AppShell.
 */

import { createContext, useContext, type ReactNode } from 'react';

import { useSaleSync, type UseSaleSync } from '@/hooks/useSaleSync';

const SaleSyncContext = createContext<UseSaleSync | null>(null);

export function SaleSyncProvider({ children }: { children: ReactNode }): JSX.Element {
  const value = useSaleSync();
  return <SaleSyncContext.Provider value={value}>{children}</SaleSyncContext.Provider>;
}

/**
 * Returns null outside the provider (a page rendered in isolation, a test)
 * rather than throwing. A status panel that cannot find the loop should show
 * nothing, not take the screen down.
 */
export function useSaleSyncContext(): UseSaleSync | null {
  return useContext(SaleSyncContext);
}
