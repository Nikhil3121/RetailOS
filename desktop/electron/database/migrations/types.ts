import type { Db } from '../connection';

/**
 * One ordered, forward-only schema change.
 *
 * There is deliberately no `down`. A POS holding a shop's only copy of its
 * sales history must never run a scripted rollback that drops data — recovery
 * is a restore from backup, which is an explicit human decision.
 */
export interface Migration {
  /** Monotonic. Gaps are allowed; duplicates are rejected at startup. */
  version: number;
  /** Short slug, recorded in schema_migrations for readable history. */
  name: string;
  /** Runs inside a transaction. Throwing rolls the whole migration back. */
  up: (db: Db) => void;
}
