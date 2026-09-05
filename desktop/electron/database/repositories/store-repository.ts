/**
 * Local snapshot of the shop, kept so a receipt can be printed offline.
 *
 * The renderer knows the store because it is authenticated and has fetched it
 * from the server. The PRINTER runs in the main process and may need to print
 * during a power cut, an outage, or a cold start before any network call has
 * succeeded. So the shop is written down here whenever fresh server data is
 * seen, and read back from SQLite at print time.
 *
 * This is a cache of server truth, never an authority over it. Nothing in this
 * file creates a store; `snapshot` only records one the server already has.
 */

import type { Db } from '../connection';

export interface StoreSnapshotInput {
  /** The SERVER store uuid. The identity everything else is matched on. */
  serverId: string;
  code: string;
  name: string;
  gstin?: string | null;
  address?: string | null;
  phone?: string | null;
  receiptMessage?: string | null;
}

export interface StoreRecord {
  id: string;
  serverId: string | null;
  code: string;
  name: string;
  gstin: string | null;
  address: string | null;
  phone: string | null;
  receiptMessage: string | null;
}

interface StoreRow {
  id: string;
  server_id: string | null;
  code: string;
  name: string;
  gstin: string | null;
  address: string | null;
  phone: string | null;
  receipt_message: string | null;
}

function toRecord(row: StoreRow): StoreRecord {
  return {
    id: row.id,
    serverId: row.server_id,
    code: row.code,
    name: row.name,
    gstin: row.gstin,
    address: row.address,
    phone: row.phone,
    receiptMessage: row.receipt_message,
  };
}

export class StoreRepository {
  constructor(private readonly db: Db) {}

  /**
   * Record what the server says about this store.
   *
   * Matched on `server_id`, not on `code`: a shop may rename or recode a branch,
   * and matching on the mutable field would leave two rows for one store and a
   * coin-flip over which one the receipt reads.
   *
   * Existing local rows are UPDATED rather than replaced so the local `id` —
   * which other tables hold foreign keys to — survives.
   */
  snapshot(input: StoreSnapshotInput): StoreRecord {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare('SELECT id FROM store WHERE server_id = ?')
      .get(input.serverId) as { id: string } | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE store
              SET code = ?, name = ?, gstin = ?, address = ?,
                  phone = ?, receipt_message = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(
          input.code,
          input.name,
          input.gstin ?? null,
          input.address ?? null,
          input.phone ?? null,
          input.receiptMessage ?? null,
          now,
          existing.id,
        );
      return this.findByServerId(input.serverId) as StoreRecord;
    }

    // The local id is the server id. These rows only ever mirror a server
    // store, so inventing a second identifier would buy nothing and give the
    // sync path one more pair of ids to confuse.
    this.db
      .prepare(
        `INSERT INTO store (id, server_id, code, name, gstin, address,
                            phone, receipt_message, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        input.serverId,
        input.serverId,
        input.code,
        input.name,
        input.gstin ?? null,
        input.address ?? null,
        input.phone ?? null,
        input.receiptMessage ?? null,
        now,
        now,
      );

    return this.findByServerId(input.serverId) as StoreRecord;
  }

  findByServerId(serverId: string): StoreRecord | null {
    const row = this.db
      .prepare('SELECT * FROM store WHERE server_id = ?')
      .get(serverId) as StoreRow | undefined;
    return row ? toRecord(row) : null;
  }
}
