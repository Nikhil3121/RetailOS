import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

interface TabItem {
  id: string;
  label: ReactNode;
  count?: number;
}

interface TabsProps {
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
}

/**
 * Minimal underlined tab strip. Keyboard-navigable via the buttons' native
 * focus + Enter/Space handling.
 */
export function Tabs({ items, activeId, onChange }: TabsProps): JSX.Element {
  return (
    <div className="flex items-center gap-1 border-b border-border">
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={cn(
              'relative px-4 py-3 text-sm font-medium transition-colors',
              active ? 'text-white' : 'text-slate-400 hover:text-slate-200',
            )}
          >
            <span className="flex items-center gap-2">
              {item.label}
              {typeof item.count === 'number' && (
                <span
                  className={cn(
                    'rounded-full border px-2 py-1 text-xs font-normal',
                    active
                      ? 'border-cobalt-500/40 bg-cobalt-500/10 text-cobalt-200'
                      : 'border-border bg-white/[0.02] text-slate-400',
                  )}
                >
                  {item.count}
                </span>
              )}
            </span>
            {active && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-cobalt-400 to-aurora-400" />
            )}
          </button>
        );
      })}
    </div>
  );
}
