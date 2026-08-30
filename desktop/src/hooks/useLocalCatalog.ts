/**
 * React binding for the local catalog.
 *
 * Wraps `catalog-service` in React Query so status is cached and shared, and
 * exposes a stable `lookup` callback for the scan path. Screens import this;
 * they never call `window.retailos` directly.
 *
 * NOTE: Billing.tsx is deliberately NOT modified in this phase. This hook is
 * the integration point for when it is.
 */

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  findByCode,
  getStatus,
  isAvailable,
  search as searchCatalog,
  syncCatalog,
  type CatalogState,
  type LocalVariant,
} from '@/lib/catalog-service';
import { useAuthStore } from '@/stores/auth-store';

export interface UseLocalCatalog {
  /** Availability of the bridge itself — false in a browser preview. */
  available: boolean;
  /** True only when a catalog is present and usable for offline lookup. */
  ready: boolean;
  status: CatalogState | undefined;
  isLoadingStatus: boolean;
  /** Exact barcode then exact SKU. Null means "not found locally". */
  lookup: (code: string) => Promise<LocalVariant | null>;
  /** Fuzzy search for the picker. */
  search: (query: string, limit?: number) => Promise<LocalVariant[]>;
  /** Download and replace the catalog. */
  sync: () => void;
  isSyncing: boolean;
  syncError: string | null;
}

export function useLocalCatalog(): UseLocalCatalog {
  const qc = useQueryClient();
  const available = isAvailable();
  const accessToken = useAuthStore((s) => s.accessToken);

  const statusQuery = useQuery({
    queryKey: ['catalog', 'status'],
    queryFn: getStatus,
    enabled: available,
    // Cheap local call; refresh often enough that a finished sync is noticed
    // without the UI having to subscribe to anything.
    staleTime: 5_000,
    refetchInterval: (query) => (query.state.data?.syncing ? 2_000 : false),
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!accessToken) throw new Error('Sign in before syncing the catalog.');
      const result = await syncCatalog(accessToken);
      if (!result.ok) throw new Error(result.error ?? 'Catalog sync failed.');
      return result;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['catalog', 'status'] });
    },
  });

  const lookup = useCallback(
    async (code: string): Promise<LocalVariant | null> => {
      if (!available) return null;
      return findByCode(code);
    },
    [available],
  );

  const search = useCallback(
    async (query: string, limit = 50): Promise<LocalVariant[]> => {
      if (!available) return [];
      return searchCatalog(query, limit);
    },
    [available],
  );

  return {
    available,
    // READY alone is not enough — a catalog with zero variants cannot answer
    // a scan, and reporting it as usable would be misleading.
    ready: statusQuery.data?.status === 'READY' && (statusQuery.data?.variantCount ?? 0) > 0,
    status: statusQuery.data,
    isLoadingStatus: statusQuery.isLoading,
    lookup,
    search,
    sync: () => syncMutation.mutate(),
    isSyncing: syncMutation.isPending || (statusQuery.data?.syncing ?? false),
    syncError: syncMutation.error instanceof Error ? syncMutation.error.message : null,
  };
}
