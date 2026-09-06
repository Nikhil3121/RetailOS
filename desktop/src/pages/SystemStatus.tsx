import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Cpu, Database, HardDrive, ShieldCheck, WifiOff } from 'lucide-react';

import { BackupPanel } from '@/components/system/BackupPanel';
import { GlassCard } from '@/components/ui/GlassCard';
import { getHealth, API_V1 } from '@/lib/api';
import { cn } from '@/lib/cn';

/**
 * The system page is the operator's ground-truth view of the pipeline.
 * Milestone 1 wires the API check; readiness (DB/Redis) subsystems get
 * their own tiles once those services are actively used in later milestones.
 */
export function SystemStatus(): JSX.Element {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    refetchInterval: 10_000,
  });

  const runtime = window.retailos;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-white">System status</h1>
        <p className="mt-1 text-sm text-slate-400">
          Live introspection of the desktop client, the API, and the runtime it's talking to.
        </p>
      </header>

      {/* Renders nothing outside the desktop app — backups are a property of
          the local database, and in a browser there is no such database. */}
      <BackupPanel />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <GlassCard>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cobalt-500/15 text-cobalt-300">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm text-slate-400">Backend API</div>
              <div className="text-base font-semibold text-white">{API_V1}</div>
            </div>
          </div>

          <div className="mt-5 space-y-2 text-sm">
            <Row
              icon={health.isSuccess ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <WifiOff className="h-4 w-4 text-rose-400" />}
              label="Reachability"
              value={
                health.isPending
                  ? 'Checking…'
                  : health.isError
                  ? `Error: ${health.error instanceof Error ? health.error.message : 'unknown'}`
                  : 'OK · responding within polling window'
              }
              tone={health.isSuccess ? 'success' : health.isError ? 'danger' : 'muted'}
            />
            <Row
              icon={<Cpu className="h-4 w-4 text-slate-400" />}
              label="Service"
              value={health.data?.service ?? '—'}
            />
            <Row
              icon={<Cpu className="h-4 w-4 text-slate-400" />}
              label="Version"
              value={health.data ? `v${health.data.version}` : '—'}
            />
            <Row
              icon={<Cpu className="h-4 w-4 text-slate-400" />}
              label="Environment"
              value={health.data?.environment ?? '—'}
            />
            <Row
              icon={<Database className="h-4 w-4 text-slate-400" />}
              label="Last check"
              value={health.dataUpdatedAt ? new Date(health.dataUpdatedAt).toLocaleTimeString() : '—'}
            />
          </div>
        </GlassCard>

        <GlassCard>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-aurora-500/15 text-aurora-400">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm text-slate-400">Desktop runtime</div>
              <div className="text-base font-semibold text-white">
                {runtime ? `Electron on ${runtime.platform}` : 'Browser (dev)'}
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-2 text-sm">
            <Row icon={<Cpu className="h-4 w-4 text-slate-400" />} label="Electron" value={runtime?.versions.electron ?? '—'} />
            <Row icon={<Cpu className="h-4 w-4 text-slate-400" />} label="Chromium" value={runtime?.versions.chrome ?? '—'} />
            <Row icon={<Cpu className="h-4 w-4 text-slate-400" />} label="Node" value={runtime?.versions.node ?? '—'} />
            <Row icon={<Cpu className="h-4 w-4 text-slate-400" />} label="Platform" value={runtime?.platform ?? navigator.userAgent.slice(0, 60)} />
          </div>
        </GlassCard>
      </section>
    </div>
  );
}

interface RowProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: 'success' | 'danger' | 'muted';
}

function Row({ icon, label, value, tone = 'muted' }: RowProps): JSX.Element {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-white/[0.015] px-3 py-2">
      <div className="flex items-center gap-2 text-slate-400">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={cn(
          'font-mono text-xs',
          tone === 'success' && 'text-emerald-200',
          tone === 'danger' && 'text-rose-200',
          tone === 'muted' && 'text-slate-200',
        )}
      >
        {value}
      </div>
    </div>
  );
}
