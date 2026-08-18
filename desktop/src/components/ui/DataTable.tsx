import { AlertTriangle, LoaderCircle, RefreshCcw } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  /** Show a spinner state instead of the empty message. */
  loading?: boolean;
  /**
   * Show an error state with the given message. Takes precedence over
   * loading / empty. `onRetry` renders a retry button next to it.
   */
  error?: string | null;
  onRetry?: () => void;
}

/**
 * Simple presentational table. Later milestones swap the implementation for
 * AG Grid (virtualised, filterable, resizable columns) — components consuming
 * this API do not have to change.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  onRowClick,
  loading = false,
  error = null,
  onRetry,
}: DataTableProps<T>): JSX.Element {
  // Precedence: error > loading (with no data yet) > empty > rows.
  const showError = Boolean(error);
  const showLoading = !showError && loading && rows.length === 0;
  const showEmpty = !showError && !showLoading && rows.length === 0;

  return (
    <div className="glass overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-white/[0.02]">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    'px-4 py-3 text-xs font-medium uppercase tracking-wider text-slate-400',
                    c.align === 'right' && 'text-right',
                    c.align === 'center' && 'text-center',
                    !c.align && 'text-left',
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {showError ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-16">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <AlertTriangle className="h-6 w-6 text-rose-300" />
                    <div className="text-sm text-rose-200">{error}</div>
                    {onRetry && (
                      <button
                        type="button"
                        onClick={onRetry}
                        className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-border bg-white/[0.03] px-3 py-1.5 text-xs text-slate-200 hover:bg-white/[0.06]"
                      >
                        <RefreshCcw className="h-3.5 w-3.5" /> Retry
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : showLoading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-16">
                  <div className="flex items-center justify-center gap-2 text-sm text-slate-400">
                    <LoaderCircle className="h-4 w-4 animate-spin" /> Loading…
                  </div>
                </td>
              </tr>
            ) : showEmpty ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-16 text-center text-sm text-slate-500"
                >
                  {empty ?? 'No rows to show.'}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-border/60 last:border-b-0 transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-white/[0.03]',
                  )}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        'px-4 py-3 text-slate-200',
                        c.align === 'right' && 'text-right',
                        c.align === 'center' && 'text-center',
                        c.className,
                      )}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
