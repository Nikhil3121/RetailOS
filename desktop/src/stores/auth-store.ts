/**
 * Auth store — the single source of truth for identity in the renderer.
 *
 * Persisted to localStorage so a window reload doesn't log the user out. On
 * mount the store hydrates its `user` field from `/auth/me`, which also acts
 * as a token-liveness check: if that call 401s and refresh fails, the store
 * clears and the app returns to the login screen.
 *
 * Later phases move token storage from localStorage to Electron's `safeStorage`
 * (OS keychain) — the store API stays identical, only the persistence layer changes.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { fetchMe, logout as apiLogout, refreshTokens } from '@/lib/auth-api';
import { clearElevation } from '@/lib/elevation';
import { ApiError } from '@/lib/api';
import type { CurrentUser, TokenPair, UserRole } from '@/types/auth';
import { hasMinRole } from '@/types/auth';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: CurrentUser | null;
  status: 'idle' | 'loading' | 'authenticated' | 'guest';

  /** Called on app boot to re-hydrate `user` from the server. */
  bootstrap: () => Promise<void>;

  /** Store a fresh token pair (called from the login flow). */
  setSession: (tokens: TokenPair, user: CurrentUser) => void;

  /** Called by api.ts when a request returns 401. Returns true if refresh succeeded. */
  refresh: () => Promise<boolean>;

  /** Explicitly sign out. Revokes the refresh token server-side (best effort). */
  logout: () => Promise<void>;

  /** Convenience selector for RBAC checks in views. */
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
        } catch (err) {
          // fetchMe automatically attempts a refresh via api.ts — if we still fail, sign out.
          if (err instanceof ApiError && err.status === 401) {
            set({ accessToken: null, refreshToken: null, user: null, status: 'guest' });
            return;
          }
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
        // Wipe local auth state FIRST so the router flips to /login immediately.
        // Doing it after the /auth/logout round-trip lets a stale 'authenticated'
        // status leak through — Login.tsx sees it and bounces the user back to
        // /dashboard before the server response returns.
        set({ accessToken: null, refreshToken: null, user: null, status: 'guest' });
        // The unlock belongs to the person who typed the password. Signing out
        // must not leave it lying around for whoever signs in next.
        clearElevation();
        if (refreshToken) {
          try {
            await apiLogout(refreshToken);
          } catch {
            // Best-effort — the token is already invalid client-side.
          }
        }
      },

      hasMinRole: (min) => hasMinRole(get().user?.role, min),
    }),
    {
      name: 'retailos.auth.v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
    },
  ),
);
