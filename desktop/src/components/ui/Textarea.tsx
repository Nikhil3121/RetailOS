import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, id, rows = 4, ...rest },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  const invalid = Boolean(error);

  return (
    <div className="space-y-1">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-xs font-medium text-slate-400"
        >
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        aria-invalid={invalid || undefined}
        className={cn(
          'w-full resize-y rounded-xl border bg-surface-muted px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500',
          'transition-colors focus:outline-none',
          invalid
            ? 'border-rose-500/50 focus:border-rose-400 focus:ring-1 focus:ring-rose-400/40'
            : 'border-border-strong hover:border-slate-400 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/25',
          className,
        )}
        {...rest}
      />
      {(error || hint) && (
        <p className={cn('text-xs', invalid ? 'text-rose-300' : 'text-slate-500')}>{error ?? hint}</p>
      )}
    </div>
  );
});
