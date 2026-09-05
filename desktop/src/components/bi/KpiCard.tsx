import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';

import { Sparkline } from '@/components/charts/Sparkline';
import { cn } from '@/lib/cn';
import type { KPIWithDelta } from '@/lib/dashboard-api';

/**
 * Which way is good for THIS measure.
 *
 * Not every number wants to go up. Discounts given falling is a win; tax
 * collected moving either way is neither. Colouring every drop red made the
 * dashboard a wall of alarm, and a wall of alarm is read as decoration — which
 * costs you the one red chip that actually mattered.
 */
export type KpiDirection = 'up-is-good' | 'down-is-good' | 'neutral';

interface KpiCardProps {
  label: string;
  value: ReactNode;
  kpi?: KPIWithDelta;
  format?: (n: number) => string;
  icon?: ComponentType<{ className?: string }>;
  accent?: 'cobalt' | 'aurora' | 'slate' | 'emerald';
  spark?: number[];
  hint?: string;
  direction?: KpiDirection;
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
  direction = 'up-is-good',
}: KpiCardProps): JSX.Element {
  const delta = kpi ? Number(kpi.delta_absolute) : null;
  const pct = kpi?.delta_pct ? Number(kpi.delta_pct) : null;
  const rose = delta !== null && delta > 0;
  const fell = delta !== null && delta < 0;

  // The ARROW always tells the truth about the movement; the COLOUR says
  // whether that movement is welcome. Separating the two is what lets a
  // falling discount figure read as green without the arrow lying about it.
  const good = direction === 'neutral' ? false : direction === 'up-is-good' ? rose : fell;
  const bad = direction === 'neutral' ? false : direction === 'up-is-good' ? fell : rose;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0.7, 0.2, 1] }}
      className="glass relative overflow-hidden p-5"
    >
      <div className={cn('pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full blur-3xl', ACCENT_BG[accent])} />
      <div className="relative flex items-start justify-between">
        {/* Sentence case, not caps. All-caps strips the word shapes a reader
            uses to recognise a label at a glance, and these are scanned, not
            read — the one place caps costs the most. */}
        <div className="text-[13px] font-medium text-slate-400">{label}</div>
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
        <DeltaChip rose={rose} fell={fell} good={good} bad={bad} pct={pct} />
        {spark && spark.length > 1 && (
          <Sparkline
            values={spark}
            width={100}
            height={28}
            strokeClassName={
              good
                ? 'stroke-emerald-400'
                : bad
                  ? 'stroke-rose-400'
                  : 'stroke-cobalt-400'
            }
            fillClassName={
              good
                ? 'fill-emerald-500/15'
                : bad
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

/**
 * The movement, stated quietly.
 *
 * No filled pill. Twelve outlined chips across two rows was the "wall" — the
 * borders alone drew a grid of boxes that competed with the numbers they were
 * annotating. Colour on the arrow and the figure carries the same information
 * with none of that weight, and it lets the VALUE stay the loudest thing on
 * the card, which is the only reason anyone looks at it.
 */
function DeltaChip({
  rose, fell, good, bad, pct,
}: {
  rose: boolean;
  fell: boolean;
  good: boolean;
  bad: boolean;
  pct: number | null;
}): JSX.Element {
  if (pct === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
        <Minus className="h-3 w-3" /> no prior period
      </span>
    );
  }
  const Icon = rose ? ArrowUpRight : fell ? ArrowDownRight : Minus;
  const tone = good ? 'text-emerald-400' : bad ? 'text-rose-400' : 'text-slate-400';
  const sign = pct > 0 ? '+' : '';
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', tone)}>
      <Icon className="h-3.5 w-3.5" />
      {sign}{pct.toFixed(1)}%
      <span className="font-normal text-slate-500">vs prior</span>
    </span>
  );
}
