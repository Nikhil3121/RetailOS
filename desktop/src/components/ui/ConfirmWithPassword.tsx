/**
 * Confirm a destructive action by re-entering your password.
 *
 * The shop asked for a password before edits and deletes. This is the visible
 * half; the half that actually protects anything is `require_elevation` on the
 * server, which refuses the request whether or not this dialog was ever shown.
 *
 * Two states, on purpose:
 *
 *  - No live confirmation → ask for the password.
 *  - Confirmed in the last few minutes → ask only "are you sure?".
 *
 * The second state is why the window exists at all. A manager clearing out six
 * dead products should type their password once; making them type it six times
 * is how a shop ends up sharing one password on a sticky note, which leaves
 * them worse off than no gate at all.
 *
 * The dialog NEVER closes itself on failure. A wrong password, or a delete the
 * server refused, leaves the message on screen — closing would tell the user
 * the action succeeded.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { ShieldAlert } from 'lucide-react';

import { Button } from './Button';
import { Input } from './Input';
import { Modal } from './Modal';
import { ApiError } from '@/lib/api';
import { confirmPassword } from '@/lib/auth-api';
import { hasLiveElevation } from '@/lib/elevation';

interface ConfirmWithPasswordProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  /** Runs only after the password is accepted. Throwing keeps the dialog open. */
  onConfirm: () => Promise<void> | void;
}

export function ConfirmWithPassword({
  open,
  onClose,
  title,
  description,
  confirmLabel = 'Delete',
  onConfirm,
}: ConfirmWithPasswordProps): JSX.Element {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Whether a password is needed is decided when the dialog OPENS. Re-reading
  // it on every render would let the field appear mid-interaction as the
  // window expired, moving the button out from under the pointer.
  const [needsPassword, setNeedsPassword] = useState(true);

  useEffect(() => {
    if (!open) return;
    setNeedsPassword(!hasLiveElevation());
    setPassword('');
    setError(null);
  }, [open]);

  async function handle(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (needsPassword) {
        await confirmPassword(password);
      }
      await onConfirm();
      onClose();
    } catch (err) {
      // A rejected password and a rejected delete land here alike, and both
      // need to be said out loud rather than dismissed.
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'That did not work. Please try again.',
      );
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} description={description}>
      <form onSubmit={handle} className="space-y-4 pt-2">
        {needsPassword ? (
          <>
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>This cannot be undone. Enter your password to continue.</span>
            </div>
            <Input
              type="password"
              label="Your password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>This cannot be undone.</span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
          >
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            loading={submitting}
            disabled={needsPassword && password.length === 0}
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
