import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';

import { useAuthStore } from '@/stores/auth-store';
import type { UserRole } from '@/types/auth';

interface RequireAuthProps {
  /** Optional minimum role. If omitted, any authenticated user passes. */
  minRole?: UserRole;
}

/**
 * Route guard. Runs the boot handshake on first mount, then decides:
 *   - status 'loading'         → full-viewport spinner
 *   - status 'authenticated'   → render children
 *   - anything else            → redirect to /login (remembering where we came from)
 */
export function RequireAuth({ minRole }: RequireAuthProps): JSX.Element {
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const user = useAuthStore((s) => s.user);
  const roleOk = useAuthStore((s) => (minRole ? s.hasMinRole(minRole) : true));
  const location = useLocation();

  useEffect(() => {
    if (status === 'idle') void bootstrap();
  }, [status, bootstrap]);

  if (status === 'idle' || status === 'loading') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-ink-950 text-slate-400">
        <LoaderCircle className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (status !== 'authenticated' || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!roleOk) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
