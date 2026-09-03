/**
 * One consistent chip for a sale's synchronisation state.
 *
 * The wording is chosen for a cashier, not an engineer. The distinction that
 * matters most on the floor is BLOCKED versus FAILED: blocked clears itself
 * once someone opens a day session, whereas failed needs a person. Showing
 * both as a red "error" would hide exactly the difference that decides
 * whether anyone has to do anything.
 */

import type { LocalSyncState } from '@/lib/local-sales-service';

const STYLES: Record<LocalSyncState, { label: string; className: string; hint: string }> = {
  SYNCED: {
    label: 'Synced',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    hint: 'Stored on the server.',
  },
  LOCAL: {
    label: 'Local',
    className: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
    hint: 'Saved on this terminal, not yet queued.',
  },
  QUEUED: {
    label: 'Queued',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
    hint: 'Waiting to be sent to the server.',
  },
  SYNCING: {
    label: 'Syncing',
    className: 'border-cobalt-500/30 bg-cobalt-500/10 text-cobalt-200',
    hint: 'Being sent right now.',
  },
  BLOCKED: {
    label: 'Waiting for day session',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    hint: 'The bill is fine. It will sync once a day session is open.',
  },
  FAILED: {
    label: 'Needs attention',
    className: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
    hint: 'The server rejected this bill. Someone has to look at it.',
  },
};

export function SyncStatusBadge({ state }: { state: LocalSyncState }): JSX.Element {
  const style = STYLES[state] ?? STYLES.LOCAL;
  return (
    <span
      title={style.hint}
      className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${style.className}`}
    >
      {style.label}
    </span>
  );
}

export function syncStateHint(state: LocalSyncState): string {
  return (STYLES[state] ?? STYLES.LOCAL).hint;
}
