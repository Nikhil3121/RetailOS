import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leadingIcon?: ReactNode;
}

/**
 * Text input with matching label + error slot. The visual language is shared
 * across every form in the app — nothing outside this file should re-style inputs.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leadingIcon, className, id, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const invalid = Boolean(error);

  return (
    <div className="space-y-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className="text-xs font-medium uppercase tracking-wider text-slate-400"
        >
          {label}
        </label>
      )}
      <div className="relative">
        {leadingIcon && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">
            {leadingIcon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={invalid || undefined}
          aria-describedby={hint || error ? `${inputId}-desc` : undefined}
          className={cn(
            'w-full rounded-xl border bg-white/[0.02] px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500',
            'transition-colors focus:outline-none',
            leadingIcon && 'pl-10',
            invalid
              ? 'border-rose-500/50 focus:border-rose-400 focus:ring-1 focus:ring-rose-400/40'
              : 'border-border focus:border-cobalt-400 focus:ring-1 focus:ring-cobalt-400/40',
            className,
          )}
          {...rest}
        />
      </div>
      {(error || hint) && (
        <p
          id={`${inputId}-desc`}
          className={cn('text-xs', invalid ? 'text-rose-300' : 'text-slate-500')}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
});
