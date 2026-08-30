/**
 * POS runtime configuration.
 *
 * Resolution order, highest priority first:
 *   1. Environment variables (RETAILOS_*) — set by an operator or a launcher
 *   2. Persisted device assignment in SQLite (terminal code, store, mall)
 *   3. Built-in defaults
 *
 * There are no production URLs hardcoded here. The default points at
 * localhost, which is safe: a misconfigured build fails to reach a backend
 * rather than silently writing a shop's data to someone else's server.
 *
 * Nothing secret belongs in this file. Configuration is not credentials — the
 * API token lives in the renderer's auth store and the login password lives in
 * the OS keychain, neither of which passes through here.
 */

import { databaseService } from './database/database-service';
import { log } from './database/logger';

export type Environment = 'development' | 'staging' | 'production';

export interface PosConfig {
  apiBaseUrl: string;
  environment: Environment;
  deviceId: string | null;
  terminalCode: string | null;
  terminalName: string | null;
  storeId: string | null;
  mallId: string | null;
  organizationId: string | null;
}

function resolveEnvironment(): Environment {
  const raw = (process.env.RETAILOS_ENV ?? '').toLowerCase();
  if (raw === 'production' || raw === 'staging' || raw === 'development') return raw;
  // app.isPackaged would be the obvious default, but a packaged build handed to
  // a pilot shop is not necessarily "production" in the deployment sense.
  // Requiring the variable to be explicit avoids guessing wrong.
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

function resolveApiBaseUrl(): string {
  const fromEnv = process.env.RETAILOS_API_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  return 'http://127.0.0.1:8000';
}

/**
 * Current configuration. Reads device assignment from SQLite when available;
 * falls back to env-only values when the database failed to initialise, so a
 * database problem never leaves the app with no configuration at all.
 */
export function getPosConfig(): PosConfig {
  const identity = databaseService.identity();

  return {
    apiBaseUrl: resolveApiBaseUrl(),
    environment: resolveEnvironment(),
    deviceId: identity?.deviceUuid ?? null,
    terminalCode: process.env.RETAILOS_TERMINAL_CODE ?? identity?.terminalCode ?? null,
    terminalName: process.env.RETAILOS_TERMINAL_NAME ?? identity?.terminalName ?? null,
    storeId: process.env.RETAILOS_STORE_ID ?? identity?.storeId ?? null,
    mallId: process.env.RETAILOS_MALL_ID ?? identity?.mallId ?? null,
    organizationId: process.env.RETAILOS_ORG_ID ?? identity?.organizationId ?? null,
  };
}

/** Log the resolved configuration once at boot. Values here are locations and
 *  identifiers, never secrets. */
export function logResolvedConfig(): void {
  const cfg = getPosConfig();
  log.info('config.resolved', {
    environment: cfg.environment,
    api_base_url: cfg.apiBaseUrl,
    device_id: cfg.deviceId,
    terminal_code: cfg.terminalCode,
    store_id: cfg.storeId,
    mall_id: cfg.mallId,
  });
}
