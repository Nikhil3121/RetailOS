import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Receipt } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/api';
import {
  listPurchaseOrders,
  PO_STATUS_LABEL,
  type POStatus,
  type PurchaseOrderSummary,
} from '@/lib/purchases-api';
import { listSuppliers } from '@/lib/suppliers-api';

const STATUS_OPTIONS: { label: string; value: POStatus | '' }[] = [
  { label: '— All statuses —', value: '' },
  { label: 'Draft', value: 'draft' },
  { label: 'Confirmed', value: 'confirmed' },
  { label: 'Received', value: 'received' },
  { label: 'Cancelled', value: 'cancelled' },
];

export function Purchases(): JSX.Element {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<POStatus | ''>('');

  const query = useQuery({
    queryKey: ['purchase-orders', statusFilter],
    queryFn: () => listPurchaseOrders({ status: statusFilter || undefined, page_size: 200 }),
  });
  const suppliersQuery = useQuery({ queryKey: ['suppliers'], queryFn: () => listSuppliers(1, 500) });

  const supplierName = (id: string): string =>
    suppliersQuery.data?.items.find((s) => s.id === id)?.name ?? '—';

  const columns = useMemo<Column<PurchaseOrderSummary>[]>(
    () => [
      {
        key: 'number',
        header: 'PO number',
        cell: (p) => (
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.03] text-slate-300">
              <Receipt className="h-4 w-4" />
            </span>
            <Link to={`/purchases/${p.id}`} className="font-mono text-white hover:text-cobalt-200">
              {p.number}
            </Link>
          </div>
        ),
      },
      {
        key: 'supplier',
        header: 'Supplier',
        cell: (p) => <span className="text-slate-300">{supplierName(p.supplier_id)}</span>,
      },
      { key: 'order_date', header: 'Date', cell: (p) => <span className="text-slate-300">{p.order_date}</span> },
      { key: 'lines', header: 'Lines', align: 'right', cell: (p) => <span className="font-mono">{p.line_count}</span> },
      {
        key: 'total',
        header: 'Grand total',
        align: 'right',
        cell: (p) => <span className="font-mono text-white">₹{p.grand_total}</span>,
      },
      {
        key: 'status',
        header: 'Status',
        cell: (p) => <StatusBadge status={p.status} />,
      },
    ],
    [suppliersQuery.data],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase orders"
        description="Create a PO, confirm it, then receive stock — the ledger updates automatically."
        actions={
          <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => navigate('/purchases/new')}>
            New purchase order
          </Button>
        }
      />

      <div className="glass flex items-end gap-3 p-4">
        <div className="min-w-[220px]">
          <Select
            options={STATUS_OPTIONS.filter((o) => o.value !== '') as { label: string; value: string }[]}
            placeholder="— All statuses —"
            value={statusFilter}
            onChange={(e) => setStatusFilter((e.target.value as POStatus) || '')}
          />
        </div>
      </div>

      {query.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {query.error instanceof ApiError ? query.error.message : 'Failed to load purchase orders.'}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(p) => p.id}
        empty={query.isLoading ? 'Loading…' : 'No purchase orders yet.'}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: POStatus }): JSX.Element {
  const tone = {
    draft: 'border-border bg-white/[0.03] text-slate-300',
    confirmed: 'border-cobalt-500/30 bg-cobalt-500/10 text-cobalt-200',
    received: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    cancelled: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
  }[status];
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${tone}`}>
      {PO_STATUS_LABEL[status]}
    </span>
  );
}
