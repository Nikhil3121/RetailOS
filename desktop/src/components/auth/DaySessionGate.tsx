/**
 * DaySessionGate
 * ==============
 *
 * Wraps a route whose page assumes there is an *open* day session for the
 * current user's store. If there isn't, we bounce the user to /day-session
 * and stash where they were headed so the day-session page can send them
 * back after opening the shift.
 *
 * The shop-floor flow the owner asked for:
 *
 *     login  →  Dashboard requested  →  no open session
 *            →  Day session page (Open shift form)
 *            →  user enters opening cash → Open session
 *            →  we auto-navigate to /dashboard (or the originally-requested
 *               path, if the user was trying to reach something else).
 *
 * A super-admin without any store assigned (store_id === null on their
 * user record and no cached store id in localStorage) is NOT gated —
 * they might just be logging in to check reports or manage users, and
 * requiring them to pick a store first would be surprising. Cashiers /
 * counter users who are tied to a store always hit the gate.
 */

import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { currentSession } from '@/lib/day-sessions-api';
import { useAuthStore } from '@/stores/auth-store';

// Same key the DaySession page uses to remember the last-selected store,
// so a store the user set once persists across logins on the same machine.
const LAST_STORE_KEY = 'retailos.pos.last_store_id';

interface Props {
  /** Optional children — the gate is usually used as a layout <Outlet/> host. */
  children?: ReactNode;
}

export function DaySessionGate({ children }: Props): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  // Prefer the store on the user record (set when the account was
  // scoped to a single location) and fall back to the last store the
  // user explicitly chose in the Day Session page.
  const storeId =
    user?.store_id ?? window.localStorage.getItem(LAST_STORE_KEY) ?? '';

  const sessionQuery = useQuery({
    queryKey: ['day-session', 'current', storeId],
    queryFn: () => currentSession(storeId),
    enabled: Boolean(storeId),
    // Cache briefly so the same check across sibling routes doesn't
    // hammer the API — but stay fresh enough that a shift closed in
    // one tab is noticed by the other within half a minute.
    staleTime: 30_000,
  });

  // No store to gate on — the user is a super-admin or hasn't picked
  // a location yet. Let them through; the pages themselves surface a
  // "select a store" empty state where needed.
  if (!storeId) {
    return <>{children ?? <Outlet />}</>;
  }

  // Waiting for the check — hold the current view (blank) rather than
  // flashing the dashboard before we know whether to redirect.
  if (sessionQuery.isLoading) {
    return <div className="h-full w-full" aria-busy="true" />;
  }

  if (sessionQuery.data?.status === 'open') {
    return <>{children ?? <Outlet />}</>;
  }

  // No open session — redirect to /day-session and remember the path
  // we were trying to reach so the day-session page can bounce us
  // back once the shift is opened.
  return (
    <Navigate
      to="/day-session"
      replace
      state={{ returnTo: location.pathname + location.search }}
    />
  );
}
