/**
 * Parked carts, from wherever they actually are.
 *
 * Held bills used to be purely local, which meant counter 1 and counter 2 at
 * the same mall could not see each other's. They now live on the server —
 * but the till still has to work with the network down, so this merges the
 * two sources and is honest about which is which.
 *
 * THE TRADE, STATED PLAINLY
 * A bill parked while offline can only ever be resumed at the till that parked
 * it, because no other till can see it. That is not a regression: a purely
 * local bill was ALWAYS like that. The marker on the row says so rather than
 * letting a cashier walk to the other counter and find nothing.
 *
 * Billing itself is untouched and still commits offline. Only holding a bill
 * prefers the network, and it degrades rather than failing.
 */

import type { HeldBillSnapshot } from '@/pages/billing/HeldBillsPanel';
import { discardHeldBill, holdBill, listHeldBills } from '@/lib/held-bills-api';

/** Where a parked cart is stored, which decides who can see it. */
export type HeldSource = 'shared' | 'this-till';

export interface HeldBillItem extends HeldBillSnapshot {
  source: HeldSource;
}

const LOCAL_KEY = 'retailos.held-bills.v1';

function readLocal(): HeldBillSnapshot[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as HeldBillSnapshot[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(list: HeldBillSnapshot[]): void {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch {
    // A full or blocked storage must not take the till down. The bill is lost,
    // which is bad — but a thrown error mid-hold loses the cart as well AND
    // leaves the screen broken.
  }
}

/**
 * Everything parked for this branch, newest first.
 *
 * A server failure degrades to the local list rather than showing an empty
 * panel. "Nothing is parked" and "we could not ask" are different facts, and
 * a cashier who reads the first when the second is true will re-ring a bill
 * that is already waiting.
 */
export async function listParked(
  storeId: string,
): Promise<{ items: HeldBillItem[]; shared: boolean }> {
  const local: HeldBillItem[] = readLocal()
    .filter((s) => !storeId || s.store_id === storeId)
    .map((s) => ({ ...s, source: 'this-till' as const }));

  if (!storeId) return { items: local, shared: false };

  try {
    const server = await listHeldBills(storeId);
    const shared: HeldBillItem[] = server.map((b) => ({
      id: b.id,
      held_at: b.created_at,
      store_id: b.store_id,
      customer_id: b.customer_id,
      salesperson_id: b.salesperson_user_id,
      notes: b.notes ?? '',
      lines: (b.cart?.lines as unknown[]) ?? [],
      source: 'shared' as const,
    }));

    const items = [...shared, ...local].sort(
      (a, b) => new Date(b.held_at).getTime() - new Date(a.held_at).getTime(),
    );
    return { items, shared: true };
  } catch {
    return { items: local, shared: false };
  }
}

/**
 * Park a cart. Prefers the server so the other till can see it.
 *
 * Returns where it ended up, so the screen can tell the cashier the truth
 * rather than implying the other counter will find it.
 */
export async function park(
  snapshot: HeldBillSnapshot,
  terminalUuid?: string | null,
): Promise<HeldSource> {
  try {
    await holdBill({
      store_id: snapshot.store_id,
      customer_id: snapshot.customer_id,
      salesperson_user_id: snapshot.salesperson_id,
      label: null,
      notes: snapshot.notes || null,
      cart: { lines: snapshot.lines },
      terminal_uuid: terminalUuid ?? null,
    });
    return 'shared';
  } catch {
    writeLocal([...readLocal(), snapshot]);
    return 'this-till';
  }
}

/**
 * Remove a parked cart — after it is resumed, or when it is abandoned.
 *
 * A shared bill that has already gone (the other till resumed it a second
 * earlier) is NOT an error here. Both tills racing for the same customer is
 * the normal case, and the loser should simply see it disappear.
 */
export async function unpark(item: HeldBillItem): Promise<void> {
  if (item.source === 'this-till') {
    writeLocal(readLocal().filter((s) => s.id !== item.id));
    return;
  }
  try {
    await discardHeldBill(item.id);
  } catch {
    /* already gone, or offline — either way there is nothing to undo */
  }
}
