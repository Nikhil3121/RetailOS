/**
 * Auth store — ported from desktop/src/stores/auth-store.ts.
 *
 * Differences from desktop:
 * - Uses AsyncStorage (via ../lib/storage.ts) for persistence, not localStorage.
 * - Zustand's `createJSONStorage` needs an object that returns Promises for
 *   getItem/setItem/removeItem on async backends — AsyncStorage's native API
 *   already matches that shape.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { ApiError } from '@/api/api';
import { fetchMe, logout as apiLogout, refreshTokens } from '@/api/auth-api';
import { identifySentryUser } from '@/lib/sentry';
import { storage } from '@/lib/storage';
import type { CurrentUser, TokenPair, UserRole } from '@/types/auth';
import { hasMinRole } from '@/types/auth';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: CurrentUser | null;
  status: 'idle' | 'loading' | 'authenticated' | 'guest';

  /** Called on app boot to re-hydrate `user` from the server. */
  bootstrap: () => Promise<void>;

  /** Store a fresh token pair returned from the login flow. */
  setSession: (tokens: TokenPair, user: CurrentUser) => void;

  /** Called by api.ts when a request 401s. Returns true if refresh succeeded. */
  refresh: () => Promise<boolean>;

  /** Explicit sign-out. Best-effort revocation of the refresh token server-side. */
  logout: () => Promise<void>;

  hasMinRole: (min: UserRole) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      status: 'idle',

      bootstrap: async () => {
        const { accessToken, refreshToken } = get();
        if (!accessToken && !refreshToken) {
          set({ status: 'guest' });
          return;
        }
        set({ status: 'loading' });
        try {
          const user = await fetchMe();
          set({ user, status: 'authenticated' });
          identifySentryUser({ id: user.id, email: user.email });
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            set({ accessToken: null, refreshToken: null, user: null, status: 'guest' });
            identifySentryUser(null);
            return;
          }
          // Non-401 (network / server 5xx) — stay guest, screen shows retry.
          set({ status: 'guest' });
        }
      },

      setSession: (tokens, user) => {
        set({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          user,
          status: 'authenticated',
        });
        // Tell Sentry who's crashing — grouping errors by account is much
        // more actionable than "some user, somewhere". Only id + email
        // are sent; no PII beyond what's already in the JWT.
        identifySentryUser({ id: user.id, email: user.email });
      },

      refresh: async () => {
        const { refreshToken } = get();
        if (!refreshToken) return false;
        try {
          const pair = await refreshTokens(refreshToken);
          set({ accessToken: pair.access_token, refreshToken: pair.refresh_token });
          return true;
        } catch {
          set({ accessToken: null, refreshToken: null, user: null, status: 'guest' });
          return false;
        }
      },

      logout: async () => {
        const { refreshToken } = get();
        // Clear local state first so the router bounces to Login immediately.
        set({ accessToken: null, refreshToken: null, user: null, status: 'guest' });
        identifySentryUser(null);
        if (refreshToken) {
          try {
            await apiLogout(refreshToken);
          } catch {
            // Best-effort — token is already invalid client-side.
          }
        }
      },

      hasMinRole: (min) => hasMinRole(get().user?.role, min),
    }),
    {
      name: 'retailos.auth.v1',
      storage: createJSONStorage(() => storage),
      // Never persist `user` or `status` — those come from bootstrap().
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
    },
  ),
);
