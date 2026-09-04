/**
 * A calculator on F11.
 *
 * Counter staff do arithmetic constantly — what three metres comes to, what
 * change is owed on a split payment, whether a quoted rate matches. Today they
 * reach for a phone, which means looking away from the till mid-transaction.
 *
 * Deliberately plain: four operations, a percent key, and keyboard entry. It is
 * a desk calculator, not a spreadsheet, and anything more would be a second
 * thing to learn.
 *
 * IT IS NOT WIRED TO THE BILL. Nothing here can change a price or a quantity —
 * a scratch pad that could silently alter a total would be far worse than no
 * calculator at all.
 */

import { useCallback, useEffect, useState } from 'react';
import { Delete, X } from 'lucide-react';

import { cn } from '@/lib/cn';

type Op = '+' | '-' | '×' | '÷';

export function Calculator({
  open, onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element | null {
  const [display, setDisplay] = useState('0');
  const [stored, setStored] = useState<number | null>(null);
  const [op, setOp] = useState<Op | null>(null);
  const [fresh, setFresh] = useState(true);

  const digit = useCallback((d: string) => {
    setDisplay((cur) => {
      if (fresh) return d === '.' ? '0.' : d;
      if (d === '.' && cur.includes('.')) return cur;
      // 12 digits is more than any bill in this shop, and stops the display
      // overflowing its box.
      if (cur.replace(/[.-]/g, '').length >= 12) return cur;
      return cur === '0' && d !== '.' ? d : cur + d;
    });
    setFresh(false);
  }, [fresh]);

  const apply = useCallback((a: number, b: number, o: Op): number => {
    switch (o) {
      case '+': return a + b;
      case '-': return a - b;
      case '×': return a * b;
      // Division by zero yields Infinity in JS, which would print as "Infinity"
      // on a till. Show a dash and let the operator start again.
      case '÷': return b === 0 ? NaN : a / b;
    }
  }, []);

  const equals = useCallback(() => {
    if (op === null || stored === null) return;
    const result = apply(stored, Number(display), op);
    setDisplay(Number.isFinite(result) ? trim(result) : '—');
    setStored(null);
    setOp(null);
    setFresh(true);
  }, [apply, display, op, stored]);

  const chooseOp = useCallback((next: Op) => {
    const current = Number(display);
    if (op !== null && stored !== null && !fresh) {
      const result = apply(stored, current, op);
      if (!Number.isFinite(result)) {
        setDisplay('—');
        setStored(null);
        setOp(null);
        setFresh(true);
        return;
      }
      setDisplay(trim(result));
      setStored(result);
    } else {
      setStored(current);
    }
    setOp(next);
    setFresh(true);
  }, [apply, display, fresh, op, stored]);

  const clear = useCallback(() => {
    setDisplay('0');
    setStored(null);
    setOp(null);
    setFresh(true);
  }, []);

  /** Percent of the stored operand, which is what a discount actually means. */
  const percent = useCallback(() => {
    const current = Number(display);
    const base = stored ?? 0;
    setDisplay(trim(op && stored !== null ? (base * current) / 100 : current / 100));
    setFresh(true);
  }, [display, op, stored]);

  // Keyboard entry. A calculator you have to click is barely faster than a
  // phone; the point is typing while looking at the customer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      const k = e.key;
      if (/^[0-9.]$/.test(k)) { e.preventDefault(); digit(k); }
      else if (k === '+') { e.preventDefault(); chooseOp('+'); }
      else if (k === '-') { e.preventDefault(); chooseOp('-'); }
      else if (k === '*') { e.preventDefault(); chooseOp('×'); }
      else if (k === '/') { e.preventDefault(); chooseOp('÷'); }
      else if (k === '%') { e.preventDefault(); percent(); }
      else if (k === 'Enter' || k === '=') { e.preventDefault(); equals(); }
      else if (k === 'Backspace') {
        e.preventDefault();
        setDisplay((c) => (c.length <= 1 || c === '—' ? '0' : c.slice(0, -1)));
      } else if (k === 'Escape') { e.preventDefault(); onClose(); }
      else if (k.toLowerCase() === 'c') { e.preventDefault(); clear(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, digit, chooseOp, equals, percent, clear, onClose]);

  if (!open) return null;

  const KEYS: { label: string; run: () => void; kind?: 'op' | 'accent' }[] = [
    { label: 'C', run: clear, kind: 'op' },
    { label: '%', run: percent, kind: 'op' },
    { label: '÷', run: () => chooseOp('÷'), kind: 'op' },
    { label: '×', run: () => chooseOp('×'), kind: 'op' },
    { label: '7', run: () => digit('7') },
    { label: '8', run: () => digit('8') },
    { label: '9', run: () => digit('9') },
    { label: '-', run: () => chooseOp('-'), kind: 'op' },
    { label: '4', run: () => digit('4') },
    { label: '5', run: () => digit('5') },
    { label: '6', run: () => digit('6') },
    { label: '+', run: () => chooseOp('+'), kind: 'op' },
    { label: '1', run: () => digit('1') },
    { label: '2', run: () => digit('2') },
    { label: '3', run: () => digit('3') },
    { label: '=', run: equals, kind: 'accent' },
    { label: '0', run: () => digit('0') },
    { label: '.', run: () => digit('.') },
  ];

  return (
    // Fixed, but this is a floating tool rather than page content — it must
    // stay put while the bill behind it scrolls.
    <div className="fixed bottom-6 right-6 z-[10000] w-[268px] rounded-xl border border-border-strong bg-surface shadow-2xl">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-slate-400">Calculator · F11</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close calculator"
          className="rounded p-1 text-slate-500 hover:bg-surface-muted hover:text-slate-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-3 py-3">
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-slate-500">
            {stored !== null && op ? `${trim(stored)} ${op}` : ''}
          </span>
        </div>
        <div className="money truncate text-right text-3xl font-semibold leading-tight text-white">
          {display}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1 p-2 pt-0">
        {KEYS.map((k) => (
          <button
            key={k.label}
            type="button"
            onClick={k.run}
            className={cn(
              'h-11 rounded-lg text-sm font-medium transition-colors',
              k.kind === 'accent'
                ? 'row-span-2 bg-brand-600 text-onbrand hover:bg-brand-700'
                : k.kind === 'op'
                  ? 'bg-surface-muted text-slate-300 hover:bg-surface hover:text-white'
                  : 'bg-surface-muted text-white hover:bg-surface',
              k.label === '0' && 'col-span-2',
            )}
          >
            {k.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 border-t border-border px-3 py-1.5 text-xs text-slate-500">
        <Delete className="h-3 w-3" />
        Backspace deletes · Esc closes
      </div>
    </div>
  );
}

/** Trim float noise without lying about the value. */
function trim(n: number): string {
  return String(Number(n.toFixed(6)));
}
