import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';

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
  const [storeId, setStoreId] = useState<string>('');
  const [status, setStatus] = useState<SaleStatus | ''>('');
  const [fromDate, setFromDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [toDate, setToDate] = useState<string>(new Date().toISOString().slice(0, 10));

  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  const query = useQuery({
    queryKey: ['sales', storeId, status, fromDate, toDate],
    queryFn: () =>
      listSales({
        store_id: storeId || undefined,
        status: status || undefined,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
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
        key: 'status',
        header: 'Status',
        cell: (s) => (
          <span
            className={`rounded-full border px-2 py-0.5 text-xs ${
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
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales history"
        description="Every completed and voided sale, with a link to reprint the invoice."
      />

      <div className="glass flex flex-wrap items-end gap-3 p-4">
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
        <div className="min-w-[160px]">
          <Input label="From" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div className="min-w-[160px]">
          <Input label="To" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
      </div>

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
