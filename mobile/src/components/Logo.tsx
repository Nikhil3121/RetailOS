/**
 * Logo — the RetailOS mark (a geometric R inside a cobalt tile with an
 * aurora pulse dot at the bowl's shoulder). One component, three modes:
 *
 *   variant="tile"    (default) — full cobalt-gradient tile with pulse + glow.
 *                                  Use in TitleBar, LoginScreen, splash.
 *   variant="bare"    — mark only, no tile, currentColor fill. Use when the
 *                       container already provides a surface (e.g. a chip).
 *   variant="mono"    — bare + no pulse. Use in a monochrome footer / print.
 *
 * Sized by the `size` prop; every internal coordinate is on a 128×128 grid.
 */

import type React from 'react';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Line,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

interface LogoProps {
  size?: number;
  variant?: 'tile' | 'bare' | 'mono';
  /** For 'bare' / 'mono' — colour of the mark's strokes. */
  color?: string;
}

export function Logo({
  size = 24,
  variant = 'tile',
  color = '#e8ecf5',
}: LogoProps): React.JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 128 128">
      {variant === 'tile' && (
        <Defs>
          <LinearGradient id="rlgTile" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#1f47f0" />
            <Stop offset="100%" stopColor="#0a1a5c" />
          </LinearGradient>
          <RadialGradient id="rlgGlow" cx="88%" cy="12%" r="60%">
            <Stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
            <Stop offset="55%" stopColor="#22d3ee" stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="rlgBone" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#ffffff" />
            <Stop offset="100%" stopColor="#dfe7f7" />
          </LinearGradient>
          <RadialGradient id="rlgPulse" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#22d3ee" stopOpacity={1} />
            <Stop offset="60%" stopColor="#22d3ee" stopOpacity={0.9} />
            <Stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
          </RadialGradient>
        </Defs>
      )}

      {variant === 'tile' && (
        <>
          <Rect x={0} y={0} width={128} height={128} rx={28} fill="url(#rlgTile)" />
          <Rect x={0} y={0} width={128} height={128} rx={28} fill="url(#rlgGlow)" />
          <Line x1={8} y1={118} x2={120} y2={6} stroke="#22d3ee" strokeOpacity={0.14} strokeWidth={1.5} />
        </>
      )}

      {/* The R — 4 rounded rectangles + 1 parallelogram leg */}
      {(() => {
        const fill = variant === 'tile' ? 'url(#rlgBone)' : color;
        return (
          <>
            <Rect x={34} y={30} width={16} height={68} rx={4} fill={fill} />
            <Rect x={34} y={30} width={52} height={16} rx={4} fill={fill} />
            <Rect x={70} y={30} width={16} height={34} rx={4} fill={fill} />
            <Rect x={34} y={52} width={52} height={16} rx={4} fill={fill} />
            <Path d="M 54 66 L 100 98 L 84 98 L 40 66 Z" fill={fill} />
          </>
        );
      })()}

      {/* Pulse dot */}
      {variant === 'tile' && (
        <>
          <Circle cx={94} cy={34} r={10} fill="url(#rlgPulse)" />
          <Circle cx={94} cy={34} r={4.5} fill="#22d3ee" />
          <Circle cx={94} cy={34} r={2} fill="#eaffff" />
        </>
      )}
      {variant === 'bare' && (
        <Circle cx={94} cy={34} r={4} fill="#22d3ee" />
      )}
    </Svg>
  );
}
