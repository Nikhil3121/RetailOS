import { useMemo } from 'react';

interface DonutSlice {
  label: string;
  value: number;
  colorClass: string;
}

interface DonutProps {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}

/**
 * Minimal SVG donut for payment-mix / share visualisations. No legend built
 * in — the caller renders one alongside with matching color chips.
 */
export function Donut({
  slices,
  size = 160,
  thickness = 22,
  centerLabel,
  centerValue,
}: DonutProps): JSX.Element {
  const total = useMemo(
    () => slices.reduce((acc, s) => acc + Math.max(s.value, 0), 0),
    [slices],
  );

  const radius = size / 2 - thickness / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const arcs = slices.map((s) => {
    const value = Math.max(s.value, 0);
    const fraction = total > 0 ? value / total : 0;
    const dash = fraction * circumference;
    const gap = circumference - dash;
    // React 19 warns if `key` is spread onto JSX — carry it as a sibling
    // property and hand it to <circle key={...}> directly.
    const arc = {
      key: s.label,
      cx: size / 2,
      cy: size / 2,
      r: radius,
      strokeDasharray: `${dash} ${gap}`,
      strokeDashoffset: -offset,
      className: s.colorClass,
    };
    offset += dash;
    return arc;
  });

  return (
    <div className="relative inline-block" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          className="stroke-white/[0.05]"
          strokeWidth={thickness}
          fill="none"
        />
        {total > 0 &&
          arcs.map(({ key, ...arcProps }) => (
            <circle
              key={key}
              {...arcProps}
              strokeWidth={thickness}
              fill="none"
              strokeLinecap="butt"
            />
          ))}
      </svg>
      {(centerLabel || centerValue) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {centerValue && (
            <div className="font-mono text-lg font-semibold text-white">{centerValue}</div>
          )}
          {centerLabel && (
            <div className="text-[10px] uppercase tracking-wider text-slate-500">
              {centerLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
