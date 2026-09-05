/**
 * Migration 008 — give the terminal enough of the shop to print a legal bill.
 *
 * WHAT WAS WRONG
 * --------------
 * Nothing in the application ever built a `ShopDetails`, so every thermal
 * receipt fell back to `DEFAULT_SHOP = { name: 'RetailOS' }`. The till roll
 * handed to the customer carried no shop name, no address and NO GSTIN — on a
 * GST invoice the supplier's GSTIN is not decoration, it is the thing that
 * makes the document a tax invoice at all. The A4 copy was correct throughout;
 * only the paper the customer actually walks out with was bare.
 *
 * The cause was structural rather than an oversight in the printer: the local
 * `store` table exists but nothing populates it (catalog sync carries products,
 * not stores), so there was no shop for the printer to read.
 *
 * WHY THE LOCAL TABLE AND NOT THE RENDERER
 * ----------------------------------------
 * The renderer could pass shop details down with each print call, and that
 * would work — right up to the first power cut, which is exactly when this
 * software is supposed to earn its keep. A receipt must be printable with no
 * network and no server round trip, so the shop is SNAPSHOTTED into SQLite
 * whenever fresh server data is seen and read back from there at print time.
 * Same rule the sales path already follows: commit locally, then sync.
 *
 * WHAT EACH COLUMN IS FOR
 * -----------------------
 * phone            Printed under the address. The header already supports it;
 *                  there was simply nowhere to keep it.
 *
 * receipt_message  The shop's own closing line ("Happy Holi", "M.S. wishes"),
 *                  mirroring `stores.receipt_message` added in server migration
 *                  0021. Per store, not per company: the two branches file
 *                  under separate GSTINs and may well want different wording.
 *                  280 characters to match the server column exactly — a
 *                  message that survives on the server but is truncated here
 *                  would print differently from what the manager typed.
 *
 * Additive and idempotent. Existing rows keep NULLs, and a NULL message simply
 * leaves the receipt's existing "Thank you" default in place.
 */

import type { Migration } from './types';

export const migration008: Migration = {
  version: 8,
  name: 'store-receipt',
  up: (db) => {
    db.exec(`
      -- Contact number for the receipt header.
      ALTER TABLE store ADD COLUMN phone TEXT;

      -- Closing line on the receipt. Mirrors stores.receipt_message (server 0021).
      ALTER TABLE store ADD COLUMN receipt_message TEXT;
    `);
  },
};
