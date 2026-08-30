/**
 * Device identity repository.
 *
 * The `device` table holds exactly one row for the lifetime of the install.
 * `device_uuid` is generated once on first launch and never regenerated —
 * an app update, a database migration, or a user logging out must all leave
 * it untouched, because it is what ties queued transactions to the machine
 * that created them.
 *
 * Two identifiers, deliberately separate:
 *   - `device_uuid`   technical, opaque, machine-generated, never shown
 *   - `terminal_code` human-readable ("C1", "COUNTER-2"), operator-assigned,
 *                     and safe to change if a shop renumbers its counters
 */

import { randomUUID } from 'node:crypto';

import type { Db } from '../connection';
import { log } from '../logger';

export interface DeviceIdentity {
  deviceUuid: string;
  terminalCode: string | null;
  terminalName: string | null;
  organizationId: string | null;
  mallId: string | null;
  storeId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DeviceRow {
  device_uuid: string;
  terminal_code: string | null;
  terminal_name: string | null;
  organization_id: string | null;
  mall_id: string | null;
  store_id: string | null;
  created_at: string;
  updated_at: string;
}

function toIdentity(row: DeviceRow): DeviceIdentity {
  return {
    deviceUuid: row.device_uuid,
    terminalCode: row.terminal_code,
    terminalName: row.terminal_name,
    organizationId: row.organization_id,
    mallId: row.mall_id,
    storeId: row.store_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class DeviceRepository {
  constructor(private readonly db: Db) {}

  find(): DeviceIdentity | null {
    const row = this.db
      .prepare('SELECT * FROM device WHERE singleton_guard = 1')
      .get() as DeviceRow | undefined;
    return row ? toIdentity(row) : null;
  }

  /**
   * Return the existing identity, or create one on first launch.
   *
   * The INSERT uses `OR IGNORE` against the singleton primary key, so even if
   * two calls raced (they cannot today — the main process is single-threaded —
   * but a future worker could) only the first would win and both would read
   * back the same UUID.
   */
  getOrCreate(): DeviceIdentity {
    const existing = this.find();
    if (existing) return existing;

    const now = new Date().toISOString();
    const uuid = randomUUID();

    this.db
      .prepare(
        `INSERT OR IGNORE INTO device
           (singleton_guard, device_uuid, created_at, updated_at)
         VALUES (1, ?, ?, ?)`,
      )
      .run(uuid, now, now);

    const created = this.find();
    if (!created) throw new Error('Failed to create device identity.');

    // The UUID itself is not sensitive — it identifies a terminal, not a
    // person — and having it in the log is what makes a support call
    // tractable ("read me the device id from the About screen").
    log.info('device.identity_created', { device_uuid: created.deviceUuid });
    return created;
  }

  /**
   * Update the operator-assigned fields. `device_uuid` is intentionally not
   * updatable through this method — there is no legitimate reason to change
   * it, and offering the capability invites accidental data orphaning.
   *
   * Undefined fields are left alone; null explicitly clears a field.
   */
  updateAssignment(patch: {
    terminalCode?: string | null;
    terminalName?: string | null;
    organizationId?: string | null;
    mallId?: string | null;
    storeId?: string | null;
  }): DeviceIdentity {
    const current = this.getOrCreate();
    const next = {
      terminalCode: patch.terminalCode !== undefined ? patch.terminalCode : current.terminalCode,
      terminalName: patch.terminalName !== undefined ? patch.terminalName : current.terminalName,
      organizationId:
        patch.organizationId !== undefined ? patch.organizationId : current.organizationId,
      mallId: patch.mallId !== undefined ? patch.mallId : current.mallId,
      storeId: patch.storeId !== undefined ? patch.storeId : current.storeId,
    };

    this.db
      .prepare(
        `UPDATE device SET
           terminal_code = ?, terminal_name = ?, organization_id = ?,
           mall_id = ?, store_id = ?, updated_at = ?
         WHERE singleton_guard = 1`,
      )
      .run(
        next.terminalCode,
        next.terminalName,
        next.organizationId,
        next.mallId,
        next.storeId,
        new Date().toISOString(),
      );

    log.info('device.assignment_updated', {
      terminal_code: next.terminalCode,
      store_id: next.storeId,
      mall_id: next.mallId,
    });

    const updated = this.find();
    if (!updated) throw new Error('Device identity vanished during update.');
    return updated;
  }
}
