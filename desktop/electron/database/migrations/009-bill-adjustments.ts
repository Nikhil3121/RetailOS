/**
 * Migration 009 — carry the whole-bill adjustments into the local sale.
 *
 * WHAT WAS WRONG
 * --------------
 * The billing screen can take money off the WHOLE bill in three ways that are
 * not per-line: a bill discount (with a coupon behind it), a loyalty-points
 * redemption, and a round-off to the whole rupee. All three were sent to the
 * server in `SaleCreate` — and none of them existed in the local `sale` table.
 *
 * The consequence only appears offline, which is exactly when this software is
 * supposed to earn its keep. A cashier gives ₹100 off, the bill commits to
 * SQLite at the GROSS figure, the customer is handed a receipt printed from
 * that local row showing the wrong total, and later the queued payload reaches
 * PostgreSQL where the discount IS applied. The receipt, the local database
 * and the server then disagree about what the customer paid — and the receipt
 * is the copy the customer is holding.
 *
 * That breaks the one invariant this whole design rests on:
 *
 *     RECEIPT = SQLITE = POSTGRESQL
 *
 * WHY COLUMNS RATHER THAN FOLDING IT INTO total_paise
 * ---------------------------------------------------
 * Folding the adjustment into `total_paise` alone would make the total right
 * and the bill unexplainable: subtotal − discount + tax would no longer equal
 * it, and neither the reprint nor the sync reconciliation could say why. The
 * server keeps these as their own columns (`sales.bill_discount`,
 * `sales.round_off`) for the same reason — a GST invoice has to add up on
 * paper. This mirrors that shape so the two records line up field for field.
 *
 * WHAT EACH COLUMN IS FOR
 * -----------------------
 * bill_discount_paise   Money off the whole bill, AFTER the lines are totalled
 *                       and never spread across them: allocating it would
 *                       change each line's taxable value and therefore its GST.
 *
 * bill_discount_reason  Why. A manager reviewing a day of discounts needs the
 *                       reason attached to the bill, not remembered.
 *
 * coupon_code           The code as typed, snapshotted. A coupon can be edited
 *                       or deleted later; what the customer used cannot change
 *                       retroactively.
 *
 * redeem_points         Points the customer spent. Recorded even though the
 *                       server owns the ledger — without it, a synced bill
 *                       could not be told apart from a plain discount, and the
 *                       points would look like they vanished.
 *
 * round_off_paise       Signed: −0.40 to round 499.40 down, +0.60 to round
 *                       499.40 up. Its own figure so the invoice still
 *                       reconciles line by line.
 *
 * All five are additive with defaults, so every existing row keeps its current
 * meaning: no adjustment, which is what those bills actually were.
 */

import type { Migration } from './types';

export const migration009: Migration = {
  version: 9,
  name: 'bill-adjustments',
  up: (db) => {
    db.exec(`
      ALTER TABLE sale ADD COLUMN bill_discount_paise INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sale ADD COLUMN bill_discount_reason TEXT;
      ALTER TABLE sale ADD COLUMN coupon_code TEXT;
      ALTER TABLE sale ADD COLUMN redeem_points INTEGER NOT NULL DEFAULT 0;

      -- Signed, and deliberately NOT constrained to a range here. The rounding
      -- convention is the server's to enforce; a local CHECK that disagreed
      -- with it would reject a bill the server would have accepted, which at a
      -- counter means a customer standing there with no bill.
      ALTER TABLE sale ADD COLUMN round_off_paise INTEGER NOT NULL DEFAULT 0;
    `);
  },
};
