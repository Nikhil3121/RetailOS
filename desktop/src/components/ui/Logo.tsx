/**
 * Logo — the RetailOS mark. Same geometry as the PDF + the mobile
 * `Logo.tsx` (react-native-svg); one identity across every surface.
 *
 * variant="tile"  full cobalt-gradient tile + pulse + trace (default)
 * variant="bare"  mark only, currentColor fill
 * variant="mono"  bare + no pulse, for monochrome contexts
 */

interface LogoProps {
  size?: number;
  variant?: 'tile' | 'bare' | 'mono';
  className?: string;
}

export function Logo({
  size = 24,
  variant = 'tile',
  className,
}: LogoProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      className={className}
      aria-hidden="true"
    >
      {variant === 'tile' && (
        <defs>
          <linearGradient id="rlgTile" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1f47f0" />
            <stop offset="100%" stopColor="#0a1a5c" />
          </linearGradient>
          <radialGradient id="rlgGlow" cx="88%" cy="12%" r="60%">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.35} />
            <stop offset="55%" stopColor="#22d3ee" stopOpacity={0} />
          </radialGradient>
          <linearGradient id="rlgBone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#dfe7f7" />
          </linearGradient>
          <radialGradient id="rlgPulse" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity={1} />
            <stop offset="60%" stopColor="#22d3ee" stopOpacity={0.9} />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
          </radialGradient>
        </defs>
      )}

      {variant === 'tile' && (
        <>
          <rect x={0} y={0} width={128} height={128} rx={28} fill="url(#rlgTile)" />
          <rect x={0} y={0} width={128} height={128} rx={28} fill="url(#rlgGlow)" />
          <line x1={8} y1={118} x2={120} y2={6} stroke="#22d3ee" strokeOpacity={0.14} strokeWidth={1.5} />
        </>
      )}

      {(() => {
        const fill = variant === 'tile' ? 'url(#rlgBone)' : 'currentColor';
        return (
          <>
            <rect x={34} y={30} width={16} height={68} rx={4} fill={fill} />
            <rect x={34} y={30} width={52} height={16} rx={4} fill={fill} />
            <rect x={70} y={30} width={16} height={34} rx={4} fill={fill} />
            <rect x={34} y={52} width={52} height={16} rx={4} fill={fill} />
            <path d="M 54 66 L 100 98 L 84 98 L 40 66 Z" fill={fill} />
          </>
        );
      })()}

      {variant === 'tile' && (
        <>
          <circle cx={94} cy={34} r={10} fill="url(#rlgPulse)" />
          <circle cx={94} cy={34} r={4.5} fill="#22d3ee" />
          <circle cx={94} cy={34} r={2} fill="#eaffff" />
        </>
      )}
      {variant === 'bare' && (
        <circle cx={94} cy={34} r={4} fill="#22d3ee" />
      )}
    </svg>
  );
}
