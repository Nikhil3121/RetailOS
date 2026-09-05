/**
 * Push the shop's details down to the terminal's local database.
 *
 * WHY THIS EXISTS
 * ---------------
 * The thermal receipt is rendered in the Electron main process, which is not
 * authenticated and cannot call the server. Until now nothing ever gave it the
 * shop, so every till receipt printed the built-in default and carried NO SHOP
 * NAME, NO ADDRESS AND NO GSTIN — which is the one field that makes the paper a
 * tax invoice rather than a note.
 *
 * So the renderer, which IS authenticated, writes what the server told it into
 * SQLite, and the printer reads it back from there. That indirection is the
 * point: it is what keeps the GSTIN on the receipt during an outage.
 *
 * Every failure here is swallowed. This is a cache refresh running beside real
 * work — a browser-only session has no bridge at all, and a screen that
 * interrupted a cashier because a background cache write failed would be a
 * worse bug than the stale line it was warning about.
 */

import type { Store } from '@/lib/stores-api';

interface StoreBridge {
  snapshot: (details: unknown) => Promise<unknown>;
}

function bridge(): StoreBridge | null {
  const api = (window as unknown as { retailos?: { store?: StoreBridge } }).retailos;
  return api?.store ?? null;
}

/**
 * Fold the server's structured address into printable lines.
 *
 * Empty parts are dropped rather than printed blank — a receipt with a hole
 * where line 2 should be looks like a fault in the printer.
 */
export function addressLines(store: Store): string[] {
  const locality = [store.city, store.state].filter(Boolean).join(', ');
  const withPin = [locality, store.postal_code].filter(Boolean).join(' ');
  return [store.address_line1, store.address_line2, withPin]
    .map((l) => (l ?? '').trim())
    .filter((l) => l.length > 0);
}

/** Record one store locally. Resolves false when it could not be written. */
export async function snapshotStore(store: Store): Promise<boolean> {
  const store_ = bridge();
  if (!store_) return false;

  try {
    await store_.snapshot({
      serverId: store.id,
      code: store.code,
      name: store.name,
      gstin: store.gstin,
      // Joined with real newlines; the main process splits on them again to
      // rebuild the lines, so what the manager typed is what gets printed.
      address: addressLines(store).join('\n'),
      phone: store.phone,
      receiptMessage: store.receipt_message,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Record every store the user can see.
 *
 * All of them, not just the active one: a supervisor who switches branch
 * mid-shift must not get the other branch's GSTIN on the bill, and the two
 * branches here file under SEPARATE GSTINs — so the wrong one is not a cosmetic
 * error, it is the wrong tax identity on a customer's invoice.
 */
export async function snapshotStores(stores: Store[]): Promise<number> {
  if (!bridge()) return 0;
  const results = await Promise.all(stores.map((s) => snapshotStore(s)));
  return results.filter(Boolean).length;
}
