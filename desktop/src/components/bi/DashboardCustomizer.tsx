import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { getLayout, saveLayout } from '@/lib/audit-api';

export interface DashboardSection {
  id: string;
  label: string;
  description?: string;
}

/**
 * Modal that lets the caller show/hide + reorder dashboard sections. Layout
 * persists per-user via /dashboard-layout.
 *
 * Wire-up: the parent renders sections in `orderedVisibleSections()` order,
 * skipping anything not in the returned list.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  sections: DashboardSection[];
}

export function DashboardCustomizer({ open, onClose, sections }: Props): JSX.Element {
  const qc = useQueryClient();
  const layoutQuery = useQuery({ queryKey: ['dashboard-layout'], queryFn: getLayout });

  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [order, setOrder] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const l = layoutQuery.data?.layout;
    setHidden(new Set(l?.hidden ?? []));
    setOrder(mergeOrder(l?.order ?? [], sections.map((s) => s.id)));
    setDirty(false);
  }, [layoutQuery.data, sections]);

  const save = useMutation({
    mutationFn: () =>
      saveLayout({
        hidden: Array.from(hidden),
        order,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard-layout'] });
      setDirty(false);
      onClose();
    },
  });

  function toggle(id: string): void {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setDirty(true);
  }

  function move(id: string, dir: -1 | 1): void {
    setOrder((prev) => {
      const idx = prev.indexOf(id);
      if (idx < 0) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
    setDirty(true);
  }

  const rows = useMemo(
    () =>
      order
        .map((id) => sections.find((s) => s.id === id))
        .filter((s): s is DashboardSection => Boolean(s)),
    [order, sections],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Customize dashboard"
      description="Hide sections you don't need and drag the ones you do to the top of the list."
      size="lg"
    >
      <ul className="space-y-1.5">
        {rows.map((s, idx) => {
          const isHidden = hidden.has(s.id);
          return (
            <li
              key={s.id}
              className={cn(
                'flex items-center gap-3 rounded-xl border px-3 py-2.5',
                isHidden
                  ? 'border-border bg-white/[0.01] opacity-60'
                  : 'border-border-strong bg-white/[0.03]',
              )}
            >
              <label className="flex flex-1 items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="accent-cobalt-500"
                  checked={!isHidden}
                  onChange={() => toggle(s.id)}
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">{s.label}</div>
                  {s.description && (
                    <div className="text-xs text-slate-500">{s.description}</div>
                  )}
                </div>
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => move(s.id, -1)}
                  className="rounded-md border border-border bg-white/[0.02] p-1.5 text-slate-400 hover:bg-white/[0.05] disabled:opacity-40"
                  aria-label="Move up"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={idx === rows.length - 1}
                  onClick={() => move(s.id, 1)}
                  className="rounded-md border border-border bg-white/[0.02] p-1.5 text-slate-400 hover:bg-white/[0.05] disabled:opacity-40"
                  aria-label="Move down"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          leadingIcon={<Settings2 className="h-4 w-4" />}
          loading={save.isPending}
          disabled={!dirty}
          onClick={() => save.mutate()}
        >
          Save layout
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Helpers exposed to the Dashboard page
// ---------------------------------------------------------------------------

export function useDashboardLayout(sections: DashboardSection[]): {
  visibleOrdered: DashboardSection[];
} {
  const q = useQuery({ queryKey: ['dashboard-layout'], queryFn: getLayout });
  const hidden = new Set(q.data?.layout?.hidden ?? []);
  const order = mergeOrder(q.data?.layout?.order ?? [], sections.map((s) => s.id));
  const map = new Map(sections.map((s) => [s.id, s]));
  const visibleOrdered = order
    .filter((id) => !hidden.has(id))
    .map((id) => map.get(id))
    .filter((s): s is DashboardSection => Boolean(s));
  return { visibleOrdered };
}

/** Union of saved order + any newly-added section IDs (appended at the end). */
function mergeOrder(saved: string[], canonical: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of saved) {
    if (canonical.includes(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of canonical) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
