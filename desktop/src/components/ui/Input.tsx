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
    <div className="space-y-1">
      {/*
        SENTENCE CASE, not ALL CAPS.

        Uppercase strips the ascender/descender profile the eye uses to
        recognise a word by shape, so it is measurably slower to read — and a
        screen full of shouting micro-labels is the single most dated thing in
        an enterprise UI. The label is also pulled closer to its field
        (space-y-1, not 2): Gestalt proximity, so a label visibly belongs to
        the input under it rather than floating between two of them.
      */}
      {label && (
        <label
          htmlFor={inputId}
          className="block text-xs font-medium text-slate-400"
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
            // A field needs a real fill. `bg-white/[0.02]` resolved to 2%
            // near-black on the light theme — no fill at all — so inputs read
            // as ghost outlines rather than as something you can type into.
            'w-full rounded-lg border bg-surface-muted px-3 h-11 text-sm text-slate-100',
            'placeholder:text-slate-500 transition-colors focus:outline-none',
            leadingIcon && 'pl-10',
            invalid
              ? 'border-rose-500 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/25'
              : 'border-border-strong hover:border-slate-400 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/25',
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
