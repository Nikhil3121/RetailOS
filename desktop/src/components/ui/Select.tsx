import { forwardRef, useId, type SelectHTMLAttributes } from 'react';

import { cn } from '@/lib/cn';

interface Option {
  label: string;
  value: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: string;
  hint?: string;
  error?: string;
  options: Option[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, options, placeholder, className, id, ...rest },
  ref,
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const invalid = Boolean(error);

  return (
    <div className="space-y-1">
      {label && (
        <label
          htmlFor={selectId}
          className="block text-xs font-medium text-slate-400"
        >
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        aria-invalid={invalid || undefined}
        // Force the OS-rendered dropdown popup + <option> rows into a dark
        // colour scheme. Without this Chromium falls back to the light theme
        // and the highlighted row is unreadable pale-blue-on-blue.
        style={{ colorScheme: 'dark' }}
        className={cn(
          'w-full appearance-none rounded-xl border bg-surface-muted px-4 py-3 text-sm text-slate-100',
          'transition-colors focus:outline-none',
          invalid
            ? 'border-rose-500/50 focus:border-rose-400 focus:ring-1 focus:ring-rose-400/40'
            : 'border-border-strong hover:border-slate-400 focus:border-brand-600 focus:ring-2 focus:ring-brand-600/25',
          className,
        )}
        {...rest}
      >
        {placeholder && (
          <option value="" style={{ backgroundColor: '#0f1220', color: '#cbd5e1' }}>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option
            key={o.value}
            value={o.value}
            style={{ backgroundColor: '#0f1220', color: '#f1f5f9' }}
          >
            {o.label}
          </option>
        ))}
      </select>
      {(error || hint) && (
        <p className={cn('text-xs', invalid ? 'text-rose-300' : 'text-slate-500')}>{error ?? hint}</p>
      )}
    </div>
  );
});
