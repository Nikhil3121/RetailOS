import { useState } from 'react';

import { Button } from './Button';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
}

/**
 * Themed replacement for `window.confirm`. Awaits `onConfirm` so callers can
 * show a loading spinner and swallow errors without dismissing the dialog.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
}: ConfirmDialogProps): JSX.Element {
  const [submitting, setSubmitting] = useState(false);

  async function handle(): Promise<void> {
    setSubmitting(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} description={description}>
      <div className="flex justify-end gap-2 pt-4">
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          {cancelLabel}
        </Button>
        <Button variant={destructive ? 'danger' : 'primary'} onClick={handle} loading={submitting}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
