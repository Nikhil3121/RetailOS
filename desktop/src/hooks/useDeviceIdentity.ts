/**
 * The terminal's own identity, read once from the local database.
 *
 * `device_uuid` is generated on first run and never regenerated, so it is the
 * durable answer to "which till rang this sale". It is read through the same
 * named-operation IPC boundary as everything else — the renderer never touches
 * SQLite directly.
 *
 * Returns null outside Electron (browser dev) and while the first read is in
 * flight. Callers must treat null as "unknown terminal" and carry on: a bill
 * must never be blocked because device identity could not be read. An
 * unattributed sale is a reporting gap; a refused sale is a lost customer.
 */

import { useEffect, useState } from 'react';

export interface DeviceIdentity {
  deviceUuid: string;
  terminalCode: string | null;
  terminalName: string | null;
}

interface RawIdentity {
  deviceUuid?: unknown;
  device_uuid?: unknown;
  terminalCode?: unknown;
  terminal_code?: unknown;
  terminalName?: unknown;
  terminal_name?: unknown;
}

/** The repository may return either camelCase or the raw column names. */
function normalise(raw: unknown): DeviceIdentity | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as RawIdentity;
  const uuid = r.deviceUuid ?? r.device_uuid;
  if (typeof uuid !== 'string' || uuid.length === 0) return null;

  const code = r.terminalCode ?? r.terminal_code;
  const name = r.terminalName ?? r.terminal_name;
  return {
    deviceUuid: uuid,
    terminalCode: typeof code === 'string' ? code : null,
    terminalName: typeof name === 'string' ? name : null,
  };
}

export function useDeviceIdentity(): DeviceIdentity | null {
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null);

  useEffect(() => {
    let cancelled = false;
    const bridge = typeof window !== 'undefined' ? window.retailos?.device : undefined;
    if (!bridge) return;

    void (async () => {
      try {
        const res = (await bridge.getIdentity()) as
          | { ok: true; data: unknown }
          | { ok: false; error: string };
        if (!cancelled && res.ok) setIdentity(normalise(res.data));
      } catch {
        // Identity is a reporting concern, never a billing blocker.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return identity;
}
