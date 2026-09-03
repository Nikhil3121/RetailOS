/**
 * The JR Retail OS brand marks.
 *
 * TWO assets, not one, because a single file cannot serve every size. The
 * lockup carries the "RETAIL OS" wordmark under the symbol; below roughly
 * 60px tall that wordmark stops being legible and turns into a grey smear.
 * So small placements get the symbol alone and large ones get the lockup.
 *
 *   <Logo />         symbol only — title bar, compact chrome
 *   <Wordmark />     full lockup — login, splash, documents
 *
 * Both are transparent PNGs and carry their own colour, so they sit correctly
 * on the light and the dark theme without a variant switch.
 */

import markSrc from '@/assets/brand/logo-mark@128.png';
import markDarkSrc from '@/assets/brand/logo-mark-dark@128.png';
import lockupSrc from '@/assets/brand/logo-lockup@720.png';
import lockupDarkSrc from '@/assets/brand/logo-lockup-dark@720.png';

import { cn } from '@/lib/cn';

/**
 * Two grounds, two files.
 *
 * The mark's navy half disappears on the dark theme, so a light-ink variant
 * exists alongside it. Both are rendered and CSS shows the right one — see
 * `.brand-on-light` / `.brand-on-dark` in styles/index.css. Doing it in CSS
 * rather than by subscribing to theme state avoids a flash of the wrong mark
 * on first paint.
 */
interface LogoProps {
  /** Rendered HEIGHT in px. Width follows the mark's own aspect ratio. */
  size?: number;
  className?: string;
}

export function Logo({ size = 24, className }: LogoProps): JSX.Element {
  const common = {
    alt: '',
    'aria-hidden': true as const,
    style: { height: size, width: 'auto' as const },
    draggable: false,
  };
  return (
    <>
      <img src={markSrc} {...common} className={cn('brand-on-light', className)} />
      <img src={markDarkSrc} {...common} className={cn('brand-on-dark', className)} />
    </>
  );
}

interface WordmarkProps {
  /** Rendered WIDTH in px — the lockup is wider than it is tall. */
  width?: number;
  className?: string;
  /** Accessible name. Empty string marks it decorative. */
  alt?: string;
}

export function Wordmark({
  width = 220,
  className,
  alt = 'JR Retail OS',
}: WordmarkProps): JSX.Element {
  const common = {
    style: { width, height: 'auto' as const },
    draggable: false,
  };
  return (
    <>
      <img
        src={lockupSrc}
        alt={alt}
        {...common}
        className={cn('brand-on-light', className)}
      />
      {/* The second copy is decorative — the accessible name is already
          carried by the first, and only one is ever visible. */}
      <img
        src={lockupDarkSrc}
        alt=""
        aria-hidden
        {...common}
        className={cn('brand-on-dark', className)}
      />
    </>
  );
}

/**
 * The previous hand-drawn cobalt "R" tile.
 *
 * Kept, not deleted: it is pure SVG with no asset dependency, which makes it
 * the only mark usable in a context where the PNGs cannot be bundled (an
 * emailed HTML report, an inline signature). Nothing renders it today.
 */
export function LegacyLogo({
  size = 24,
  variant = 'tile',
  className,
}: {
  size?: number;
  variant?: 'tile' | 'bare' | 'mono';
  className?: string;
}): JSX.Element {
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
