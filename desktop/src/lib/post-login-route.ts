/**
 * Decide where to send the user immediately after a successful sign-in.
 *
 * Product requirement: after login, if the user's store has NO open day
 * session, land them on /day-session (with a return-to so opening the
 * shift bounces them straight to /dashboard). Once inside the app, we
 * DON'T re-check on every dashboard click — the user explicitly asked
 * for this to fire only at login time, not as a permanent gate.
 *
 * A user without a store scope (typically a super-admin who hasn't
 * picked a location yet) is not gated — they might just be logging in
 * to check reports or manage the catalog.
 *
 * Failures fall back to /dashboard rather than /day-session. Blocking
 * login on a transient network hiccup would be worse than letting the
 * user in and having them open the shift manually if it turns out to
 * be closed.
 */

import { currentSession } from '@/lib/day-sessions-api';
import type { CurrentUser } from '@/types/auth';

// Same key the DaySession page uses — see [pages/pos/DaySession.tsx].
const LAST_STORE_KEY = 'retailos.pos.last_store_id';

export interface PostLoginRoute {
  path: string;
  /** state to pass to react-router's navigate — carries returnTo when we're
   *  detouring through /day-session. */
  state?: { returnTo: string };
}

const DASHBOARD: PostLoginRoute = { path: '/dashboard' };

export async function decidePostLoginRoute(user: CurrentUser): Promise<PostLoginRoute> {
  const storeId =
    user.store_id ?? window.localStorage.getItem(LAST_STORE_KEY) ?? '';
  if (!storeId) return DASHBOARD;

  try {
    const session = await currentSession(storeId);
    if (session?.status === 'open') return DASHBOARD;
  } catch {
    // Backend down / auth race — don't block the user on a check that
    // is only advisory. They can open the shift manually if needed.
    return DASHBOARD;
  }

  return {
    path: '/day-session',
    state: { returnTo: '/dashboard' },
  };
}
