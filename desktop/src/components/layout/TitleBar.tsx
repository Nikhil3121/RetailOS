import { Sparkles } from 'lucide-react';

import { HealthIndicator } from '@/components/ui/HealthIndicator';
import { NotificationBell } from './NotificationBell';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

/**
 * Custom title bar for the frameless Electron window.
 *
 * The whole bar is a drag region (see `.titlebar-drag` in index.css) except
 * for interactive elements, which opt out via `.titlebar-no-drag`.
 */
export function TitleBar(): JSX.Element {
  return (
    <header className="titlebar-drag relative z-[9999] flex h-11 shrink-0 items-center justify-between border-b border-border/60 bg-ink-900/70 px-4 backdrop-blur-xl">
      <div className="flex items-center gap-2 text-sm font-medium tracking-wide text-slate-300">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-cobalt-500 to-cobalt-800 shadow-glow">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </span>
        <span>RetailOS</span>
      </div>
      <div className="titlebar-no-drag flex items-center gap-3">
        <HealthIndicator />
        <ThemeToggle />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
