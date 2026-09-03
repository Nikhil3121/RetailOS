import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  size?: 'md' | 'lg';
}

/**
 * Portal-based modal with an animated backdrop. Closes on Escape and on
 * backdrop click. The child is expected to render the entire body — including
 * any footer buttons — because layout inside a modal varies too much to abstract.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = 'md',
}: ModalProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const width = size === 'lg' ? 'max-w-2xl' : 'max-w-md';

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/70 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.2, 0.7, 0.2, 1] }}
            className={`glass-strong relative m-4 flex w-full ${width} max-h-[90vh] flex-col`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sticky header — always visible while the body scrolls. */}
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-white">{title}</h2>
                {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-lg p-2 text-slate-400 hover:bg-white/[0.05] hover:text-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Scrollable body — always overflows internally, never the viewport. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
