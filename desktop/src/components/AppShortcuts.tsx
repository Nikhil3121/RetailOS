import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useHotkey } from '@/lib/hotkeys';
import { Calculator } from '@/components/tools/Calculator';

/**
 * Global keyboard shortcuts — always mounted inside AppShell so they work
 * on every authenticated screen. Screen-specific shortcuts (F7 save,
 * F10 print, F3 hold) live inside the Billing page.
 *
 * Navigation state stays in one place instead of being sprinkled into
 * layouts. It also hosts the F11 calculator, which has to survive page
 * changes and so cannot live on any single screen.
 */
export function AppShortcuts(): JSX.Element {
  const navigate = useNavigate();
  const [calcOpen, setCalcOpen] = useState(false);

  // F11 → calculator, from anywhere. Counter staff otherwise reach for a
  // phone, which means looking away from the till mid-transaction.
  useHotkey('F11', () => setCalcOpen((v) => !v));

  // Shift+F5 → the return picker. F5 alone is reload in Electron, and a
  // cashier who meant "return" must never lose the cart to a refresh.
  useHotkey('Shift+F5', () => navigate('/sales?pick=return'));

  // F2 → jump to the New Bill (POS) screen from anywhere. Classic retail
  // muscle-memory carried over from Marg / Busy / Richie.
  useHotkey(
    'F2',
    useCallback(() => navigate('/billing'), [navigate]),
  );

  // F9 → today's bill history. `/sales` is the sales register; the page
  // already defaults its date filter to "today" so this lands users on the
  // day's bills without extra query params.
  useHotkey(
    'F9',
    useCallback(() => navigate('/sales'), [navigate]),
  );

  // No longer headless: the calculator is a floating tool that must outlive
  // any single page, so it is rendered from the one component already mounted
  // for the whole authenticated session.
  return <Calculator open={calcOpen} onClose={() => setCalcOpen(false)} />;
}
