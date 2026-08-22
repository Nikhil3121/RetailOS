/**
 * Held-bills queue — AsyncStorage-backed. Same shape as desktop's
 * localStorage 'retailos.held-bills.v1' key, so a shopkeeper can pick up
 * the same conceptual list on either surface (though for now they don't
 * cross-sync — mobile has its own local queue on the phone).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { storage } from '@/lib/storage';

export interface HeldBillLine {
  variant_id: string;
  sku: string;
  product_name: string;
  variant_name: string;
  unit_price: string;
  tax_rate: string;
  quantity: number;
}

export interface HeldBill {
  id: string;
  held_at: string;
  store_id: string;
  customer_id: string | null;
  salesperson_id: string | null;
  notes: string;
  lines: HeldBillLine[];
}

interface HeldBillsState {
  bills: HeldBill[];
  hold: (bill: Omit<HeldBill, 'id' | 'held_at'>) => string;
  resume: (id: string) => HeldBill | null;
  discard: (id: string) => void;
  clear: () => void;
}

function makeId(): string {
  // RN Hermes doesn't have crypto.randomUUID; timestamp + random suffix is fine.
  return `held-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useHeldBillsStore = create<HeldBillsState>()(
  persist(
    (set, get) => ({
      bills: [],
      hold: (bill) => {
        const id = makeId();
        const next: HeldBill = {
          id,
          held_at: new Date().toISOString(),
          ...bill,
        };
        set({ bills: [...get().bills, next] });
        return id;
      },
      resume: (id) => {
        const found = get().bills.find((b) => b.id === id) ?? null;
        if (found) {
          // Idempotent remove — parent shouldn't accidentally re-hold on double-tap.
          set({ bills: get().bills.filter((b) => b.id !== id) });
        }
        return found;
      },
      discard: (id) => set({ bills: get().bills.filter((b) => b.id !== id) }),
      clear: () => set({ bills: [] }),
    }),
    {
      name: 'retailos.held-bills.v1',
      storage: createJSONStorage(() => storage),
    },
  ),
);
