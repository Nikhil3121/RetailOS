import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, LoaderCircle } from 'lucide-react';

import { getHealth } from '@/lib/api';
import { cn } from '@/lib/cn';

/**
 * Live badge showing the backend connection state.
 *
 * Polls /api/v1/health every 10s. This is the Milestone 1 acceptance test —
 * when this shows "Online", the entire pipeline (Vite -> Electron -> renderer
 * -> fetch -> FastAPI -> response envelope) is wired end-to-end.
 */
export function HealthIndicator(): JSX.Element {
  const query = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    refetchInterval: 10_000,
    staleTime: 8_000,
  });

  if (query.isPending) {
    return (
      <Pill tone="muted" icon={<LoaderCircle className="h-3.5 w-3.5 animate-spin" />}>
        Connecting…
      </Pill>
    );
  }

  if (query.isError) {
    return (
      <Pill tone="danger" icon={<AlertTriangle className="h-3.5 w-3.5" />} title={String(query.error)}>
        API offline
      </Pill>
    );
  }

  return (
    <Pill tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
      <span className="font-medium">Online</span>
      <span className="ml-2 text-xs text-emerald-300/70">v{query.data.version}</span>
    </Pill>
  );
}

interface PillProps {
  children: React.ReactNode;
  icon: React.ReactNode;
  tone: 'success' | 'danger' | 'muted';
  title?: string;
}

function Pill({ children, icon, tone, title }: PillProps): JSX.Element {
  return (
    <div
      title={title}
      className={cn(
        'flex items-center gap-2 rounded-full border px-3 py-1 text-xs',
        tone === 'success' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
        tone === 'danger' && 'border-rose-500/30 bg-rose-500/10 text-rose-200',
        tone === 'muted' && 'border-border bg-white/[0.03] text-slate-400',
      )}
    >
      {icon}
      {children}
    </div>
  );
}
