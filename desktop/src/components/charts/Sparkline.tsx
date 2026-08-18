import { useMemo } from 'react';

/**
 * Compact SVG sparkline. Renders a filled area + top line without any external
 * chart dependency. Values are unscaled — the component picks its own min/max
 * from the data.
 */
interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  strokeClassName?: string;
  fillClassName?: string;
}

export function Sparkline({
  values,
  width = 120,
  height = 32,
  strokeClassName = 'stroke-cobalt-400',
  fillClassName = 'fill-cobalt-500/20',
}: SparklineProps): JSX.Element {
  const { path, area } = useMemo(() => {
    if (values.length === 0) {
      return { path: '', area: '' };
    }
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 1);
    const range = max - min || 1;
    const stepX = values.length > 1 ? width / (values.length - 1) : 0;
    const points = values.map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    const line = `M ${points.join(' L ')}`;
    const filled = `${line} L ${(width).toFixed(2)},${height} L 0,${height} Z`;
    return { path: line, area: filled };
  }, [values, width, height]);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-hidden>
      <path d={area} className={fillClassName} />
      <path d={path} className={`${strokeClassName} fill-none`} strokeWidth={1.5} />
    </svg>
  );
}
