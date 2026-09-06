/**
 * Backups — and the supervised way back from a bad one.
 *
 * WHY RESTORE IS HERE AT ALL
 * It was deliberately kept off the UI, and that was right about the danger:
 * replacing the live database is the most destructive thing this application
 * can do. But it was wrong about the consequence. A shopkeeper whose database
 * will not open then has no path at all, at the exact moment they most need
 * one, and "ring the developer" is not a recovery plan for a shop that is
 * open on a Sunday.
 *
 * So it is here, gated the way a destructive action should be gated rather
 * than hidden:
 *
 *   · the file's own name must be TYPED. A dialog with a Yes button is
 *     dismissed by reflex; a filename is not typed by accident, and typing it
 *     also proves the operator is looking at the row they think they are.
 *   · the backup is verified before anything is touched.
 *   · the current database is moved aside, never deleted.
 *   · the app must be restarted afterwards, and the screen says so rather
 *     than pretending the running process is now consistent.
 *
 * WHEN THE BRIDGE IS ABSENT
 * Renders nothing. Backups are a property of the desktop application's local
 * database; in a plain browser there is no such database, and an empty
 * "Backups" card would be a promise the page cannot keep.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  DatabaseBackup,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';

interface BackupEntry {
  file: string;
  createdAt: string;
  sizeBytes: number;
}

function bridge(): NonNullable<Window['retailos']>['backup'] | undefined {
  return typeof window === 'undefined' ? undefined : window.retailos?.backup;
}

function fileName(pathLike: string): string {
  // Both separators: the path comes from the main process, which is on
  // Windows here but must not be assumed to be.
  return pathLike.split(/[\\/]/).pop() ?? pathLike;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function BackupPanel(): JSX.Element | null {
  const api = bridge();
  const [entries, setEntries] = useState<BackupEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<BackupEntry | null>(null);
  const [typed, setTyped] = useState('');
  const [restored, setRestored] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!api) return;
    try {
      const rows = (await api.list()) as BackupEntry[];
      setEntries(Array.isArray(rows) ? rows : []);
    } catch {
      setError('Could not read the backup folder.');
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!api) return null;

  async function createNow(): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = (await api!.create()) as { ok: boolean; error?: string };
      if (res.ok) {
        setMessage('Backup taken.');
        await refresh();
      } else {
        setError(res.error ?? 'Backup failed.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function checkIntegrity(): Promise<void> {
    setBusy(true);
    setIntegrity(null);
    try {
      const res = (await api!.integrity()) as { ok: boolean; result: string };
      setIntegrity(res.ok ? 'The database checks out.' : `Problem: ${res.result}`);
    } catch {
      setIntegrity('Could not check the database.');
    } finally {
      setBusy(false);
    }
  }

  async function doRestore(): Promise<void> {
    if (!restoring) return;
    setBusy(true);
    setError(null);
    try {
      const res = (await api!.restore(restoring.file, typed.trim())) as {
        ok: boolean;
        error?: string;
        data?: { previousKeptAt: string | null };
      };
      if (!res.ok) {
        setError(res.error ?? 'Restore failed.');
        return;
      }
      setRestoring(null);
      setTyped('');
      setRestored(res.data?.previousKeptAt ?? null);
    } finally {
      setBusy(false);
    }
  }

  const expected = restoring ? fileName(restoring.file) : '';

  return (
    <GlassCard className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <DatabaseBackup className="h-4 w-4" />
          Backups
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void checkIntegrity()}>
            Check database
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void createNow()}>
            Back up now
          </Button>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Taken automatically. This copy lives on this computer — keep a copy
        somewhere else as well, because a backup on the same machine does not
        survive the machine.
      </p>

      {message && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {message}
        </div>
      )}
      {integrity && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-white/[0.02] px-3 py-2 text-xs text-slate-300">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
          {integrity}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* After a successful restore the running process is holding state from
          a database that no longer exists. Saying so is not politeness — it is
          the difference between a clean recovery and a confusing one. */}
      {restored !== null && (
        <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-xs text-amber-100">
          <div className="flex items-center gap-2 font-semibold">
            <Check className="h-4 w-4" />
            Restored. Close and reopen RetailOS now.
          </div>
          <p className="text-amber-200/90">
            The app is still running against the database it had before, so
            nothing on screen can be trusted until it is restarted.
          </p>
          {restored && (
            <p className="text-amber-200/70">
              Your previous database was not deleted — it was kept as{' '}
              <span className="font-mono">{fileName(restored)}</span>.
            </p>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">No backups yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {entries.map((b) => (
            <li key={b.file} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-mono text-xs text-slate-200">
                  {fileName(b.file)}
                </div>
                <div className="text-xs text-slate-500">
                  {new Date(b.createdAt).toLocaleString()} · {megabytes(b.sizeBytes)}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<RotateCcw className="h-3.5 w-3.5" />}
                onClick={() => {
                  setRestoring(b);
                  setTyped('');
                  setError(null);
                }}
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        title="Restore this backup?"
      >
        <div className="space-y-4">
          <div className="flex gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-3 text-sm text-rose-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-semibold">
                This replaces everything currently on this computer.
              </p>
              <p className="text-rose-200/90">
                Any bill rung up since this backup was taken, and not yet synced
                to the server, will be gone.
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-400">
            Your current database is not deleted — it is renamed and kept
            alongside, so this can be undone.
          </p>

          {/* Typing the filename, not clicking Yes. A confirmation dialog is
              dismissed by reflex after the third time somebody sees it. */}
          <Input
            label="Type the file name to confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={expected}
            hint={expected}
          />

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRestoring(null)}>
              Cancel
            </Button>
            <Button
              className={cn(typed.trim() === expected && 'bg-rose-600 hover:bg-rose-500')}
              disabled={busy || typed.trim() !== expected}
              onClick={() => void doRestore()}
              loading={busy}
            >
              Replace the database
            </Button>
          </div>
        </div>
      </Modal>
    </GlassCard>
  );
}
