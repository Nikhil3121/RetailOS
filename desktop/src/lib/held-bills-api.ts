/**
 * Parked carts, shared across the tills of one branch.
 *
 * These used to live in `localStorage`, which meant they lived in ONE BROWSER:
 * counter 1 and counter 2 at the same mall could not see each other's parked
 * bills, so a customer who stepped away at one till could not be finished at
 * the other.
 *
 * They are now held on the server. That does mean holding a bill needs the
 * network — which is the right trade: a held bill is only useful if the OTHER
 * till can see it, and a purely local one never could. Billing itself is
 * unaffected and still commits offline.
 */

import { apiRequest } from '@/lib/api';

export interface HeldBill {
  id: string;
  store_id: string;
  customer_id: string | null;
  salesperson_user_id: string | null;
  /** How the counter identifies it — "blue saree lady", "Sharma ji". */
  label: string | null;
  notes: string | null;
  /** The cart, verbatim as the billing screen held it. */
  cart: {
    lines?: unknown[];
    [key: string]: unknown;
  };
  held_by_user_id: string | null;
  terminal_uuid: string | null;
  created_at: string;
}

export interface HeldBillCreate {
  store_id: string;
  customer_id?: string | null;
  salesperson_user_id?: string | null;
  label?: string | null;
  notes?: string | null;
  cart: Record<string, unknown>;
  terminal_uuid?: string | null;
}

export function listHeldBills(storeId: string): Promise<HeldBill[]> {
  return apiRequest<HeldBill[]>({
    path: `/held-bills?store_id=${encodeURIComponent(storeId)}`,
    method: 'GET',
  });
}

export function holdBill(body: HeldBillCreate): Promise<HeldBill> {
  return apiRequest<HeldBill>({ path: '/held-bills', method: 'POST', body });
}

export function discardHeldBill(id: string): Promise<void> {
  return apiRequest<void>({ path: `/held-bills/${id}`, method: 'DELETE' });
}
