import { motion } from 'framer-motion';
import type { ComponentType, ReactNode } from 'react';

import { cn } from '@/lib/cn';

interface StatTileProps {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
  accent?: 'cobalt' | 'aurora' | 'slate';
}

/**
 * A single KPI tile. Design intentionally quiet — real numbers arrive when
 * the sales/inventory modules ship. The visual system is what we're locking
 * in here so later dashboards feel consistent.
 */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  accent = 'slate',
}: StatTileProps): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0.7, 0.2, 1] }}
      className="glass relative overflow-hidden p-5"
    >
      <div
        className={cn(
          'pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full blur-3xl',
          accent === 'cobalt' && 'bg-cobalt-500/25',
          accent === 'aurora' && 'bg-aurora-500/25',
          accent === 'slate' && 'bg-white/[0.04]',
        )}
      />
      <div className="relative flex items-start justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</div>
        {Icon && (
          <div
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-white/[0.02]',
              accent === 'cobalt' && 'text-cobalt-300',
              accent === 'aurora' && 'text-aurora-400',
              accent === 'slate' && 'text-slate-400',
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="relative mt-3 text-3xl font-semibold tracking-tight text-white">{value}</div>
      {hint && <div className="relative mt-1 text-xs text-slate-500">{hint}</div>}
    </motion.div>
  );
}
