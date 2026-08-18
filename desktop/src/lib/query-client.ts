import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/lib/api';

/**
 * Shared React Query client.
 *
 * Retry policy:
 *   - Up to 3 attempts with exponential back-off, capped at 4s.
 *   - Never retry 4xx client errors — those aren't transient.
 *   - Never retry 401 either; the api.ts layer already tries a single refresh
 *     per request, so React Query retrying would multiply that.
 *
 * `refetchOnWindowFocus` stays on: an Electron window can be idle for hours
 * and stale data on refocus is worse than one extra fetch.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 3;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
    },
    mutations: {
      retry: 0,
    },
  },
});
