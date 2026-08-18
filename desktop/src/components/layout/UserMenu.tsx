import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, KeyRound, LogOut, UserCircle2 } from 'lucide-react';

import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/auth-store';
import { ROLE_LABEL } from '@/types/auth';

export function UserMenu(): JSX.Element | null {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent): void {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  function handleSignOut(): void {
    setOpen(false);

    // Nuke all persisted client state so nothing can rehydrate the session
    // after the reload. Zustand's `persist` restores from this key on boot;
    // wiping it here guarantees the next document mounts as a guest.
    try {
      localStorage.clear();
    } catch {
      /* ignore quota / privacy-mode errors */
    }
    try {
      sessionStorage.clear();
    } catch {
      /* ignore */
    }

    // Best-effort server-side revoke. We don't await — the client is already out.
    void logout();

    // Rewrite the address bar to /login WITHOUT triggering a hash-router
    // navigation (which wouldn't reload), then hard-reload. `location.reload()`
    // uses whatever URL is currently in the address bar, so the reloaded
    // document boots straight into the login route with an empty store.
    const target = window.location.href.split('#')[0] + '#/login';
    window.history.replaceState(null, '', target);
    window.location.reload();
  }

  if (!user) {
    return null;
  }

  const initials = user.full_name
    .split(/\s+/)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div ref={menuRef} className="titlebar-no-drag relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex items-center gap-2 rounded-full border border-border bg-white/[0.03] py-1 pl-1 pr-2 text-xs transition-colors hover:bg-white/[0.06]',
          open && 'border-border-strong bg-white/[0.06]',
        )}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-cobalt-500 to-cobalt-800 text-[10px] font-semibold text-white">
          {initials}
        </span>

        <span className="hidden max-w-[120px] truncate text-slate-200 sm:inline">
          {user.full_name}
        </span>

        <ChevronDown className="h-3 w-3 text-slate-500" />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-64 overflow-hidden rounded-xl border border-border-strong bg-ink-900/95 shadow-glass-lg backdrop-blur-xl">
          <div className="border-b border-border/70 px-4 py-3">
            <div className="text-sm font-medium text-white">
              {user.full_name}
            </div>

            <div className="mt-0.5 text-xs text-slate-500">
              {user.email}
            </div>

            <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-cobalt-500/30 bg-cobalt-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cobalt-200">
              {ROLE_LABEL[user.role]}
            </div>
          </div>

          <div className="py-1 text-sm">
            <MenuItem
              onClick={() => {
                setOpen(false);
                navigate('/change-password');
              }}
              icon={<KeyRound className="h-4 w-4" />}
            >
              Change password
            </MenuItem>

            <MenuItem
              onClick={() => {
                setOpen(false);
                navigate('/system');
              }}
              icon={<UserCircle2 className="h-4 w-4" />}
            >
              System status
            </MenuItem>

            <div className="my-1 border-t border-border/60" />

            <MenuItem
              onClick={handleSignOut}
              icon={<LogOut className="h-4 w-4" />}
              danger
            >
              Sign out
            </MenuItem>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  icon,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-4 py-2 text-left transition-colors',
        danger
          ? 'text-rose-200 hover:bg-rose-500/10'
          : 'text-slate-200 hover:bg-white/[0.04]',
      )}
    >
      {icon}
      {children}
    </button>
  );
}