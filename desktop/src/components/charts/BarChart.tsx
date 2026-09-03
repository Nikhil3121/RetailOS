import { useMemo } from 'react';

import { cn } from '@/lib/cn';

interface BarChartProps {
  data: { label: string; value: number; tooltip?: string }[];
  formatValue?: (v: number) => string;
  height?: number;
  className?: string;
}

/**
 * Horizontal-labelled vertical bar chart. Values normalised inside the
 * component; bars use a cobalt→aurora gradient so they visually anchor
 * against the app's dark theme.
 */
export function BarChart({
  data,
  formatValue = (v) => String(v),
  height = 160,
  className,
}: BarChartProps): JSX.Element {
  const max = useMemo(
    () => Math.max(1, ...data.map((d) => d.value)),
    [data],
  );

  if (data.length === 0) {
    return (
      <div className={cn('flex items-center justify-center text-sm text-slate-500', className)}>
        No data.
      </div>
    );
  }

  return (
    <div className={cn('flex items-end gap-1 overflow-x-auto pb-2', className)}>
      {data.map((d) => {
        const h = Math.max(4, Math.round((d.value / max) * height));
        return (
          <div
            key={d.label}
            className="flex min-w-[28px] flex-1 flex-col items-center gap-1"
            title={d.tooltip ?? `${d.label}: ${formatValue(d.value)}`}
          >
            <div
              className="w-full rounded-t-md bg-gradient-to-t from-cobalt-700 via-cobalt-500 to-aurora-400 transition-all"
              style={{ height: `${h}px` }}
            />
            <div className="text-xs text-slate-500">{d.label}</div>
          </div>
        );
      })}
    </div>
  );
}
