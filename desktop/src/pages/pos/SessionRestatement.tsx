/**
 * Makes a restated shift visible.
 *
 * A day session's expected cash and cash difference can change AFTER it was
 * closed and signed off, when an offline bill from that shift finally reaches
 * the server. The accounting is correct — the money did belong to that shift —
 * but numbers moving after sign-off with no explanation is indistinguishable
 * from tampering to the person who counted the drawer.
 *
 * This component does no arithmetic. It reads the figures the server already
 * recorded in the `day_session.restated` audit entries and shows them, so the
 * change is explained rather than merely visible.
 */

import { useQuery } from '@tanstack/react-query';
import { History, TriangleAlert } from 'lucide-react';

import { listAuditLogs } from '@/lib/audit-api';

function money(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? `₹${value}` : '—';
}

export function RestatementBanner({ restatedAt }: { restatedAt: string }): JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
      <TriangleAlert className="mt-1 h-4 w-4 shrink-0" />
      <div>
        <div className="font-medium">This shift was restated after it was closed.</div>
        <p className="mt-1 text-xs text-amber-200/80">
          An offline bill from this shift reached the server on{' '}
          {new Date(restatedAt).toLocaleString()}. Expected cash and the cash
          difference were recalculated to include it. The cash that was counted
          and who closed the shift are unchanged.
        </p>
      </div>
    </div>
  );
}

/**
 * The restatement history for one session.
 *
 * Reuses the existing audit endpoint filtered by entity — no new API and no
 * second audit store. Renders nothing at all when a session has never been
 * restated, which is the common case.
 */
export function RestatementHistory({ sessionId }: { sessionId: string }): JSX.Element | null {
  const query = useQuery({
    queryKey: ['audit', 'day_session.restated', sessionId],
    queryFn: () =>
      listAuditLogs({
        action: 'day_session.restated',
        entity_type: 'day_session',
        entity_id: sessionId,
        page_size: 50,
      }),
    enabled: !!sessionId,
  });

  const entries = query.data?.items ?? [];

  // "Never restated" and "could not check" are different claims, and this
  // component's whole purpose is explaining why a signed-off figure moved.
  if (query.isError) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
        Could not load the restatement history for this shift. If its figures
        changed after sign-off, the reason is not shown here.
      </div>
    );
  }
  if (query.isLoading || entries.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        <History className="h-4 w-4 text-amber-300" />
        Restatement history
        <span className="text-xs font-normal text-slate-500">
          ({entries.length} {entries.length === 1 ? 'change' : 'changes'})
        </span>
      </div>

      <div className="mt-3 space-y-3">
        {entries.map((entry) => {
          const c = entry.changes ?? {};
          return (
            <div key={entry.id} className="rounded-lg border border-border/70 bg-black/20 p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-slate-300">
                  {new Date(entry.created_at).toLocaleString()}
                </span>
                <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 font-mono text-xs text-amber-300">
                  {String(c.reason ?? 'restated')}
                </span>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                <Delta
                  label="Expected cash"
                  before={money(c.previous_expected_cash)}
                  after={money(c.new_expected_cash)}
                />
                <Delta
                  label="Cash difference"
                  before={money(c.previous_cash_diff)}
                  after={money(c.new_cash_diff)}
                />
              </div>

              <div className="mt-2 border-t border-border/70 pt-2 text-xs text-slate-500">
                Counted cash unchanged at {money(c.counted_cash_unchanged)} · caused by sale{' '}
                <span className="font-mono">{String(c.caused_by_sale_id ?? '—').slice(0, 8)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Delta({
  label, before, after,
}: {
  label: string; before: string; after: string;
}): JSX.Element {
  return (
    <div>
      <div className="text-slate-500">{label}</div>
      <div className="font-mono text-slate-300">
        <span className="text-slate-500 line-through">{before}</span>
        <span className="mx-1 text-slate-600">→</span>
        <span className="text-white">{after}</span>
      </div>
    </div>
  );
}
