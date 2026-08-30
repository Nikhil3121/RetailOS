/**
 * Local sales and whether they actually reached the server.
 *
 * This is the screen that answers the question offline billing creates: "the
 * internet was down last night — did those bills ever arrive?" Before this,
 * the Sales page listed only what the SERVER already had, so a queued or
 * blocked bill was invisible precisely when someone needed to see it.
 *
 * Deliberately a separate panel rather than extra rows in the server table.
 * A local record and a server record are different things — one is the till's
 * copy, the other is the books — and merging them would blur which is
 * authoritative at exactly the wrong moment.
 *
 * Entirely read-only. It reports stored state and computes no money.
 */

import { useQueryClient, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CloudOff, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { useSaleSyncContext } from '@/hooks/SaleSyncContext';
import { SyncStatusBadge, syncStateHint } from '@/components/SyncStatusBadge';
import {
  isLocalSalesAvailable,
  listLocalSales,
  needsAttention,
  paiseToDisplay,
  unsyncedCount,
  type LocalSaleSummary,
} from '@/lib/local-sales-service';

export function LocalSalesPanel(): JSX.Element | null {
  const available = isLocalSalesAvailable();
  const qc = useQueryClient();
  const sync = useSaleSyncContext();

  const query = useQuery({
    queryKey: ['local-sales'],
    queryFn: () => listLocalSales(100),
    enabled: available,
    // A sale can move QUEUED -> SYNCING -> SYNCED without any user action, so
    // the view refreshes on its own rather than showing a stale status.
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  // Outside Electron there is no local database and nothing to report.
  if (!available) return null;

  const sales = query.data ?? [];
  if (sales.length === 0) return null;

  const pending = unsyncedCount(sales);
  const attention = needsAttention(sales);

  return (
    <GlassCard className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-lg font-semibold text-white">
            <CloudOff className="h-5 w-5 text-cobalt-300" />
            This terminal&rsquo;s bills
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Every bill rung up on this till, and whether it has reached the
            server yet. Bills are stored here first, so nothing is lost while
            the connection is down.
          </p>
        </div>
        <div className="flex items-start gap-4">
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-slate-500">Not yet on server</div>
            <div
              className={`font-mono text-lg font-semibold ${
                pending === 0 ? 'text-emerald-300' : 'text-amber-300'
              }`}
            >
              {pending}
            </div>
          </div>
          {sync && (
            <Button
              variant="secondary"
              loading={sync.running}
              leadingIcon={<RefreshCw className="h-4 w-4" />}
              onClick={async () => {
                await sync.runNow();
                // The statuses this panel shows were just changed by the run.
                void qc.invalidateQueries({ queryKey: ['local-sales'] });
              }}
            >
              Sync now
            </Button>
          )}
        </div>
      </div>

      {attention.length > 0 && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {attention.length} {attention.length === 1 ? 'bill was' : 'bills were'} rejected by the
          server and {attention.length === 1 ? 'needs' : 'need'} attention. They are still stored
          safely on this terminal — nothing has been lost.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="pb-2 pr-3 font-medium">Reference</th>
              <th className="pb-2 pr-3 font-medium">When</th>
              <th className="pb-2 pr-3 text-right font-medium">Total</th>
              <th className="pb-2 pr-3 font-medium">Status</th>
              <th className="pb-2 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((sale) => (
              <LocalSaleRow key={sale.id} sale={sale} />
            ))}
          </tbody>
        </table>
      </div>

      <SyncLoopStatus />

      {query.isFetching && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <RefreshCw className="h-3 w-3 animate-spin" />
          Refreshing…
        </div>
      )}
    </GlassCard>
  );
}

function LocalSaleRow({ sale }: { sale: LocalSaleSummary }): JSX.Element {
  const when = sale.occurredAt ?? sale.createdAt;

  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="py-2 pr-3">
        <Link
          to={`/sales/local/${sale.id}/invoice`}
          className="font-mono text-xs text-white hover:text-cobalt-200"
        >
          {sale.localReference ?? sale.id.slice(0, 8)}
        </Link>
        {sale.invoiceNumber && (
          <div className="font-mono text-[10px] text-emerald-300/80">{sale.invoiceNumber}</div>
        )}
      </td>
      <td className="py-2 pr-3 text-xs text-slate-300">
        {when ? new Date(when).toLocaleString() : '—'}
      </td>
      <td className="py-2 pr-3 text-right font-mono text-white">
        ₹{paiseToDisplay(sale.totalPaise)}
      </td>
      <td className="py-2 pr-3">
        <SyncStatusBadge state={sale.state} />
      </td>
      <td className="py-2 text-xs text-slate-400">
        <SyncDetail sale={sale} />
      </td>
    </tr>
  );
}

/**
 * What a person can actually act on: why it has not synced, how many attempts
 * it has had, and when it will try again.
 */
function SyncDetail({ sale }: { sale: LocalSaleSummary }): JSX.Element {
  if (sale.state === 'SYNCED') {
    return (
      <span className="text-slate-500">
        {sale.syncedAt ? `Synced ${new Date(sale.syncedAt).toLocaleString()}` : 'On the server.'}
      </span>
    );
  }

  return (
    <div className="space-y-0.5">
      <div>{syncStateHint(sale.state)}</div>
      {sale.error && (
        <div className="font-mono text-[10px] text-slate-500" title={sale.error}>
          {sale.error.length > 90 ? `${sale.error.slice(0, 90)}…` : sale.error}
        </div>
      )}
      {(sale.attemptCount > 0 || sale.nextAttemptAt) && (
        <div className="text-[10px] text-slate-500">
          {sale.attemptCount > 0 &&
            `${sale.attemptCount} attempt${sale.attemptCount === 1 ? '' : 's'}`}
          {sale.attemptCount > 0 && sale.nextAttemptAt && ' · '}
          {sale.nextAttemptAt &&
            `next try ${new Date(sale.nextAttemptAt).toLocaleTimeString()}`}
        </div>
      )}
    </div>
  );
}


/**
 * What the background loop is doing, in plain words.
 *
 * Being offline is reported as a normal state, not an error: the queue is
 * durable and billing is unaffected, so alarming a cashier about it would be
 * both wrong and unhelpful.
 */
function SyncLoopStatus(): JSX.Element | null {
  const sync = useSaleSyncContext();
  if (!sync) return null;

  if (sync.running) {
    return (
      <div className="flex items-center gap-2 text-xs text-cobalt-200">
        <RefreshCw className="h-3 w-3 animate-spin" />
        Sending bills to the server…
      </div>
    );
  }

  if (sync.lastSkip === 'offline') {
    return (
      <div className="text-xs text-amber-300/80">
        Offline — bills are saved here and will send when the connection returns.
      </div>
    );
  }

  if (sync.lastResult && sync.lastRunAt) {
    const r = sync.lastResult;
    const when = new Date(sync.lastRunAt).toLocaleTimeString();
    if (!r.ok) {
      return (
        <div className="text-xs text-rose-300/90">
          Last sync at {when} could not complete{r.error ? `: ${r.error}` : '.'} It will try again.
        </div>
      );
    }
    return (
      <div className="text-xs text-slate-500">
        Last checked {when}
        {r.synced > 0 && ` · sent ${r.synced}`}
        {r.blocked > 0 && ` · ${r.blocked} waiting for a day session`}
        {r.permanent > 0 && ` · ${r.permanent} need attention`}
      </div>
    );
  }

  return null;
}
