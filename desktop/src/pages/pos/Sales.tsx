import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Receipt, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/api';
import { listSales, type SaleStatus, type SaleSummary } from '@/lib/sales-api';
import { listStores } from '@/lib/stores-api';
import { LocalSalesPanel } from '@/pages/pos/LocalSalesPanel';

const STATUS_OPTIONS = [
  { label: 'Completed', value: 'completed' },
  { label: 'Voided', value: 'voided' },
];

export function Sales(): JSX.Element {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  /**
   * Arrived here to START A RETURN rather than to browse.
   *
   * Billing's transaction-type dropdown sends the cashier here because a return
   * is always against one specific invoice. Without this flag the screen gave
   * no hint why it had opened and no way back — which is exactly what happened
   * the first time it shipped.
   */
  const picking = params.get('pick') === 'return';

  const [storeId, setStoreId] = useState<string>('');
  const [status, setStatus] = useState<SaleStatus | ''>('');
  /**
   * Invoice number, phone, or name.
   *
   * The case this exists for: a customer comes back to exchange something and
   * does not have the bill. What they DO have is the phone number they gave
   * at the counter.
   */
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [toDate, setToDate] = useState<string>(new Date().toISOString().slice(0, 10));

  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  // Searching drops the date range, deliberately.
  //
  // The dates default to TODAY, and somebody looking up a bill by phone does
  // not know when it was — that is the entire reason they are searching. Left
  // applied, the filter would answer "no such bill" for a bill that exists,
  // which is worse than no search at all.
  const searching = search.trim().length > 0;
  const query = useQuery({
    queryKey: ['sales', storeId, status, search, fromDate, toDate],
    queryFn: () =>
      listSales({
        store_id: storeId || undefined,
        status: status || undefined,
        search: search.trim() || undefined,
        from_date: searching ? undefined : fromDate || undefined,
        to_date: searching ? undefined : toDate || undefined,
        page_size: 200,
      }),
  });

  const columns = useMemo<Column<SaleSummary>[]>(
    () => [
      {
        key: 'number',
        header: 'Invoice',
        cell: (s) => (
          <Link to={`/sales/${s.id}/invoice`} className="flex items-center gap-3 text-white hover:text-cobalt-200">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.03]">
              <Receipt className="h-4 w-4" />
            </span>
            <span className="font-mono">{s.number}</span>
          </Link>
        ),
      },
      {
        key: 'when',
        header: 'When',
        cell: (s) =>
          s.completed_at ? (
            <span className="text-slate-300">{new Date(s.completed_at).toLocaleString()}</span>
          ) : (
            <span className="text-slate-500">—</span>
          ),
      },
      { key: 'lines', header: 'Lines', align: 'right', cell: (s) => <span className="font-mono">{s.line_count}</span> },
      { key: 'total', header: 'Grand total', align: 'right', cell: (s) => <span className="font-mono text-white">₹{s.grand_total}</span> },
      {
        key: 'return',
        header: '',
        align: 'right',
        // Only a completed SALE can be credited. A voided bill is already
        // reversed, and a credit note cannot itself be returned.
        cell: (s) =>
          s.status === 'completed' ? (
            <Button
              size="sm"
              variant={picking ? 'primary' : 'secondary'}
              leadingIcon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={() => navigate(`/sales/${s.id}/return`)}
            >
              Return
            </Button>
          ) : null,
      },
      {
        key: 'status',
        header: 'Status',
        cell: (s) => (
          <span
            className={`rounded-full border px-2 py-1 text-xs ${
              s.status === 'completed'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
            }`}
          >
            {s.status === 'completed' ? 'Completed' : 'Voided'}
          </span>
        ),
      },
    ],
    [picking, navigate],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={picking ? 'Choose the bill to return against' : 'Sales history'}
        description={
          picking
            ? 'A return is always credited against one specific invoice. Find it below, then press Return on that row.'
            : 'Every completed and voided sale, with a link to reprint the invoice.'
        }
        actions={
          // Always offer the way out. Landing here from Billing with no back
          // button is what stranded the cashier.
          <Button
            variant="ghost"
            leadingIcon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => navigate('/billing')}
          >
            Back to billing
          </Button>
        }
      />

      <div className="glass inline-flex w-fit max-w-full flex-wrap items-end gap-3 px-3 py-2">
        <div className="min-w-[200px] flex-1">
          <Select
            placeholder="— All stores —"
            options={(storesQuery.data?.items ?? []).map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))}
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          />
        </div>
        <div className="min-w-[160px]">
          <Select
            placeholder="— All statuses —"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => setStatus((e.target.value as SaleStatus) || '')}
          />
        </div>
        <div className="min-w-[220px] flex-1">
          <Input
            label="Find a bill"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Phone, invoice no. or name"
          />
        </div>
        <div className="min-w-[160px]">
          <Input
            label="From"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            disabled={searching}
          />
        </div>
        <div className="min-w-[160px]">
          <Input
            label="To"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            disabled={searching}
          />
        </div>
      </div>

      {/* Said out loud, because the dates are still on screen and greyed out.
          A cashier who cannot see WHY they stopped applying will assume the
          filter is broken. */}
      {searching && (
        <p className="text-xs text-slate-500">
          Searching every date — the day filter does not apply while you are
          looking for a bill.
        </p>
      )}

      {/* Bills stored on this terminal, and whether they reached the server.
          Rendered above the server list because an unsynced bill is the thing
          someone is looking for; a synced one is already in the books. */}
      <LocalSalesPanel />

      {query.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {query.error instanceof ApiError ? query.error.message : 'Failed to load sales.'}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(s) => s.id}
        empty={query.isLoading ? 'Loading…' : 'No sales in this range.'}
      />
    </div>
  );
}
