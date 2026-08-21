import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useHotkey } from '@/lib/hotkeys';

/**
 * Global keyboard shortcuts — always mounted inside AppShell so they work
 * on every authenticated screen. Screen-specific shortcuts (F7 save,
 * F10 print, F3 hold) live inside the Billing page.
 *
 * Kept as a headless component (returns null) so navigation state stays in
 * one place instead of being sprinkled into layouts.
 */
export function AppShortcuts(): null {
  const navigate = useNavigate();

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

  return null;
}
