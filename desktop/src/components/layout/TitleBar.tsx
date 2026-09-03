import { HealthIndicator } from '@/components/ui/HealthIndicator';
import { Logo } from '@/components/ui/Logo';
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
      {/* The symbol carries the JR; the text completes the name beside it. */}
      <div className="flex items-center gap-3 text-sm font-medium tracking-tight text-slate-300">
        <Logo size={22} />
        <span>
          Retail<span className="font-bold text-white">OS</span>
        </span>
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
