import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

import { Sparkline } from '@/components/charts/Sparkline';
import { cn } from '@/lib/cn';
import type { KPIWithDelta } from '@/lib/dashboard-api';

interface KpiCardProps {
  label: string;
  value: ReactNode;
  kpi?: KPIWithDelta;
  format?: (n: number) => string;
  icon?: ComponentType<{ className?: string }>;
  accent?: 'cobalt' | 'aurora' | 'slate' | 'emerald';
  spark?: number[];
  hint?: string;
}

const ACCENT_BG: Record<NonNullable<KpiCardProps['accent']>, string> = {
  cobalt: 'bg-cobalt-500/25',
  aurora: 'bg-aurora-500/25',
  emerald: 'bg-emerald-500/20',
  slate: 'bg-white/[0.04]',
};

const ACCENT_TEXT: Record<NonNullable<KpiCardProps['accent']>, string> = {
  cobalt: 'text-cobalt-300',
  aurora: 'text-aurora-400',
  emerald: 'text-emerald-300',
  slate: 'text-slate-400',
};

/**
 * KPI card with a coloured glow accent, optional icon + sparkline, and a
 * period-over-period delta chip that colours green on gain and red on drop.
 */
export function KpiCard({
  label,
  value,
  kpi,
  icon: Icon,
  accent = 'slate',
  spark,
  hint,
}: KpiCardProps): JSX.Element {
  const delta = kpi ? Number(kpi.delta_absolute) : null;
  const pct = kpi?.delta_pct ? Number(kpi.delta_pct) : null;
  const positive = delta !== null && delta > 0;
  const negative = delta !== null && delta < 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0.7, 0.2, 1] }}
      className="glass relative overflow-hidden p-5"
    >
      <div className={cn('pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full blur-3xl', ACCENT_BG[accent])} />
      <div className="relative flex items-start justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</div>
        {Icon && (
          <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-white/[0.02]', ACCENT_TEXT[accent])}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>

      <div className="relative mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
        {value}
      </div>

      <div className="relative mt-2 flex items-center justify-between">
        <DeltaChip positive={positive} negative={negative} pct={pct} />
        {spark && spark.length > 1 && (
          <Sparkline
            values={spark}
            width={100}
            height={28}
            strokeClassName={
              positive
                ? 'stroke-emerald-400'
                : negative
                  ? 'stroke-rose-400'
                  : 'stroke-cobalt-400'
            }
            fillClassName={
              positive
                ? 'fill-emerald-500/15'
                : negative
                  ? 'fill-rose-500/15'
                  : 'fill-cobalt-500/15'
            }
          />
        )}
      </div>

      {hint && <div className="relative mt-1 text-xs text-slate-500">{hint}</div>}
    </motion.div>
  );
}

function DeltaChip({
  positive, negative, pct,
}: {
  positive: boolean;
  negative: boolean;
  pct: number | null;
}): JSX.Element {
  if (pct === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-white/[0.02] px-2 py-1 text-xs text-slate-500">
        <Minus className="h-3 w-3" /> vs prior
      </span>
    );
  }
  const Icon = positive ? ArrowUpRight : negative ? ArrowDownRight : Minus;
  const tone = positive
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : negative
      ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
      : 'border-border bg-white/[0.02] text-slate-400';
  const sign = pct > 0 ? '+' : '';
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs', tone)}>
      <Icon className="h-3 w-3" />
      {sign}{pct.toFixed(1)}% vs prior
    </span>
  );
}
