import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';

import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

/**
 * FLAT AND SOLID, not gradient-and-glow.
 *
 * A vertical gradient plus a 40px coloured halo is the 2015 look, and it is
 * most of why the interface read as amateur. A real control states its
 * affordance through weight and contrast: one solid fill, a darker hover, and
 * a 1px press. Nothing glows.
 *
 * `secondary` also stops using `bg-white/[0.04]` — `white` is remapped to the
 * ink token, so on the light theme that resolved to 4% near-black, i.e. an
 * almost invisible wash. It now takes a real surface token.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-onbrand hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-600/45 disabled:text-onbrand/70',
  secondary:
    'bg-surface-muted text-slate-100 border border-border-strong hover:bg-surface hover:border-slate-400',
  ghost: 'text-slate-300 hover:bg-surface-muted hover:text-slate-100',
  danger:
    'bg-rose-600 text-onbrand hover:bg-rose-700 active:bg-rose-800 disabled:bg-rose-600/45',
};

const SIZES: Record<Size, string> = {
  /* Comfortable with a mouse, and already correct if a touchscreen till ever
     appears — 44px is the accepted minimum and `md` was 40. */
  sm: 'h-9 px-4 text-xs',
  md: 'h-11 px-5 text-sm',
  lg: 'h-14 px-7 text-item',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    loading = false,
    leadingIcon,
    trailingIcon,
    disabled,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      // data-variant is a stable hook for scoped theme overrides (see
      // index.css `html[data-theme="light"] button[data-variant="…"]`).
      // Without it, light-mode has no way to target variant-specific styles
      // and secondary/ghost buttons render white-on-white.
      data-variant={variant}
      className={cn(
        // `rounded-lg` (10px) is the control radius. A button is a control, not
        // a card, and matching the 14px card radius made every button look
        // oversized and soft.
        'inline-flex select-none items-center justify-center gap-2 rounded-lg font-semibold tracking-tight',
        'transition-[background-color,border-color,transform] duration-100',
        // A 1px drop on press. Physical feedback is what tells a cashier the
        // tap registered without waiting for the screen behind it to change.
        'active:translate-y-px',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
        'disabled:cursor-not-allowed disabled:active:translate-y-0',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
});
