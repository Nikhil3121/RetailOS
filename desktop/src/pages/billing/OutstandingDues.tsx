import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banknote,
  CreditCard,
  ExternalLink,
  IndianRupee,
  Smartphone,
  Users as UsersIcon,
  Wallet,
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/api';
import { billingSummary, listOutstanding } from '@/lib/billing-api';
import { listCustomers } from '@/lib/customers-api';
import {
  collectSalePayment,
  type PaymentMethod,
  type SaleSummary,
} from '@/lib/sales-api';
import { listStores } from '@/lib/stores-api';
import { cn } from '@/lib/cn';

const METHODS: {
  id: PaymentMethod;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'cash', label: 'Cash', icon: Banknote },
  { id: 'card', label: 'Card', icon: CreditCard },
  { id: 'upi', label: 'UPI', icon: Smartphone },
  { id: 'other', label: 'Other', icon: Wallet },
];

/**
 * Outstanding-dues screen — every bill with `balance_due > 0`, filterable by
 * store + customer, with a per-row "Collect" button that opens a modal to
 * record a payment via POST /sales/{id}/payments.
 */
export function OutstandingDues(): JSX.Element {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [storeId, setStoreId] = useState('');
  const [customerId, setCustomerId] = useState('');

  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  const customersQuery = useQuery({
    queryKey: ['customers'],
    queryFn: () => listCustomers(1, 500),
  });

  const outstandingQuery = useQuery({
    queryKey: ['billing-outstanding', storeId, customerId],
    queryFn: () =>
      listOutstanding({
        store_id: storeId || undefined,
        customer_id: customerId || undefined,
        page_size: 200,
      }),
  });
  const summaryQuery = useQuery({
    queryKey: ['billing-summary', storeId],
    queryFn: () => billingSummary(storeId || undefined),
  });

  const [collectFor, setCollectFor] = useState<SaleSummary | null>(null);

  const customerName = (id: string | null): string => {
    if (!id) return 'Walk-in';
    return customersQuery.data?.items.find((c) => c.id === id)?.name ?? '—';
  };
  const storeCode = (id: string): string =>
    storesQuery.data?.items.find((s) => s.id === id)?.code ?? '';

  const columns = useMemo<Column<SaleSummary>[]>(
    () => [
      {
        key: 'number',
        header: 'Bill',
        cell: (r) => (
          <div>
            <div className="font-mono text-sm text-white">{r.number}</div>
            <div className="text-xs text-slate-500">
              {new Date(r.created_at).toLocaleString()}
            </div>
          </div>
        ),
      },
      {
        key: 'customer',
        header: 'Customer',
        cell: (r) => (
          <span className="text-sm text-slate-200">{customerName(r.customer_id)}</span>
        ),
      },
      {
        key: 'store',
        header: 'Store',
        cell: (r) => (
          <span className="text-xs text-slate-400">{storeCode(r.store_id)}</span>
        ),
      },
      {
        key: 'grand',
        header: 'Total',
        align: 'right',
        cell: (r) => (
          <span className="font-mono text-sm text-slate-200">₹{r.grand_total}</span>
        ),
      },
      {
        key: 'paid',
        header: 'Paid',
        align: 'right',
        cell: (r) => (
          <span className="font-mono text-sm text-slate-300">₹{r.paid_total}</span>
        ),
      },
      {
        key: 'balance',
        header: 'Balance due',
        align: 'right',
        cell: (r) => (
          <span className="font-mono text-sm font-semibold text-amber-200">
            ₹{r.balance_due}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        cell: (r) => (
          <div className="flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate(`/sales/${r.id}/invoice`)}
              trailingIcon={<ExternalLink className="h-3 w-3" />}
            >
              Bill
            </Button>
            <Button size="sm" onClick={() => setCollectFor(r)}>
              Collect
            </Button>
          </div>
        ),
      },
    ],
    // customersQuery.data + storesQuery.data feed cell renderers — recompute when they arrive.
    [customersQuery.data, storesQuery.data, navigate],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Outstanding dues"
        description="Every bill that still has a balance. Collect a payment against any of them here."
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SummaryTile
          label="Total outstanding"
          value={`₹${summaryQuery.data?.total_due ?? '0.00'}`}
          icon={IndianRupee}
          tone="amber"
        />
        <SummaryTile
          label="Bills with due"
          value={String(summaryQuery.data?.outstanding_bills ?? 0)}
          icon={Banknote}
        />
        <SummaryTile
          label="Customers with due"
          value={String(summaryQuery.data?.customers_with_due ?? 0)}
          icon={UsersIcon}
        />
      </div>

      <GlassCard className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Select
            label="Filter · Store"
            placeholder="— All stores —"
            options={(storesQuery.data?.items ?? []).map((s) => ({
              label: `${s.code} · ${s.name}`,
              value: s.id,
            }))}
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          />
          <Select
            label="Filter · Customer"
            placeholder="— All customers —"
            options={(customersQuery.data?.items ?? []).map((c) => ({
              label: `${c.name}${c.phone ? ` · ${c.phone}` : ''}`,
              value: c.id,
            }))}
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          />
        </div>
      </GlassCard>

      <DataTable
        columns={columns}
        rows={outstandingQuery.data?.items ?? []}
        rowKey={(r) => r.id}
        loading={outstandingQuery.isLoading}
        error={
          outstandingQuery.isError
            ? outstandingQuery.error instanceof ApiError
              ? outstandingQuery.error.message
              : 'Failed to load outstanding bills.'
            : null
        }
        onRetry={() => outstandingQuery.refetch()}
        empty="No outstanding bills — everyone's paid up."
      />

      <CollectPaymentModal
        sale={collectFor}
        onClose={() => setCollectFor(null)}
        onCollected={() => {
          setCollectFor(null);
          qc.invalidateQueries({ queryKey: ['billing-outstanding'] });
          qc.invalidateQueries({ queryKey: ['billing-summary'] });
          qc.invalidateQueries({ queryKey: ['sales'] });
        }}
      />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'amber';
}): JSX.Element {
  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </div>
          <div
            className={cn(
              'mt-1 font-mono text-2xl font-semibold',
              tone === 'amber' ? 'text-amber-200' : 'text-white',
            )}
          >
            {value}
          </div>
        </div>
        <span
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg',
            tone === 'amber'
              ? 'border border-amber-500/30 bg-amber-500/10 text-amber-200'
              : 'border border-border bg-white/[0.03] text-slate-300',
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </GlassCard>
  );
}

function CollectPaymentModal({
  sale,
  onClose,
  onCollected,
}: {
  sale: SaleSummary | null;
  onClose: () => void;
  onCollected: () => void;
}): JSX.Element | null {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Reset every time a new sale is picked to collect against.
  useEffect(() => {
    if (sale) {
      setMethod('cash');
      setAmount(sale.balance_due);
      setReference('');
      setError(null);
    }
  }, [sale?.id, sale?.balance_due]);

  const collect = useMutation({
    mutationFn: () =>
      collectSalePayment(sale!.id, {
        method,
        amount: (Number(amount) || 0).toFixed(2),
        reference: method === 'cash' ? null : reference.trim() || null,
      }),
    onSuccess: onCollected,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Failed to collect payment.'),
  });

  if (!sale) return null;

  const amountNum = Number(amount) || 0;
  const balance = Number(sale.balance_due) || 0;
  const remainingAfter = Math.max(balance - amountNum, 0);
  const overflow = Math.max(amountNum - balance, 0);
  const invalid = amountNum <= 0;

  return (
    <Modal
      open={!!sale}
      onClose={onClose}
      title={`Collect payment · ${sale.number}`}
      description={`Outstanding balance ₹${sale.balance_due}. Enter what the customer is paying now.`}
      size="md"
    >
      <div className="mb-3 grid grid-cols-4 gap-2">
        {METHODS.map((m) => {
          const Icon = m.icon;
          const active = m.id === method;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMethod(m.id)}
              className={cn(
                'flex flex-col items-center justify-center gap-1 rounded-xl border py-2 text-xs font-medium transition-colors',
                active
                  ? 'border-cobalt-500/40 bg-cobalt-500/10 text-cobalt-100 shadow-glow'
                  : 'border-border bg-white/[0.02] text-slate-300 hover:bg-white/[0.05]',
              )}
            >
              <Icon className="h-4 w-4" />
              {m.label}
            </button>
          );
        })}
      </div>

      <Input
        label="Amount"
        type="number"
        step="0.01"
        min="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setAmount(sale.balance_due)}
          className="rounded-md border border-cobalt-500/30 bg-cobalt-500/10 px-3 py-1 text-xs font-medium text-cobalt-200 hover:bg-cobalt-500/20"
        >
          Full ₹{sale.balance_due}
        </button>
        {[100, 500, 1000].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setAmount(v.toFixed(2))}
            className="rounded-md border border-border bg-white/[0.02] px-3 py-1 text-xs font-medium text-slate-300 hover:bg-white/[0.05]"
          >
            ₹{v}
          </button>
        ))}
      </div>

      {method !== 'cash' && (
        <div className="mt-3">
          <Input
            label="Reference (optional)"
            placeholder="last 4 digits · UPI txn id"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
      )}

      <dl className="mt-4 space-y-1 rounded-xl border border-border bg-white/[0.02] p-3 text-sm">
        <MRow label="Current balance" value={`₹${sale.balance_due}`} />
        <MRow label="Paying now" value={`₹${amountNum.toFixed(2)}`} tone="cobalt" />
        <div className="my-1 border-t border-border/60" />
        <MRow
          label={overflow > 0 ? 'Change to return' : 'Remaining balance'}
          value={
            overflow > 0
              ? `₹${overflow.toFixed(2)}`
              : `₹${remainingAfter.toFixed(2)}`
          }
          tone={
            overflow > 0
              ? 'emerald'
              : remainingAfter === 0
                ? 'emerald'
                : 'amber'
          }
          strong
        />
      </dl>

      {error && (
        <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={collect.isPending}>
          Cancel
        </Button>
        <Button
          disabled={invalid || collect.isPending}
          loading={collect.isPending}
          onClick={() => collect.mutate()}
        >
          Record payment
        </Button>
      </div>
    </Modal>
  );
}

function MRow({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'cobalt' | 'emerald' | 'amber';
}): JSX.Element {
  const toneClass =
    tone === 'cobalt'
      ? 'text-cobalt-200'
      : tone === 'emerald'
        ? 'text-emerald-200'
        : tone === 'amber'
          ? 'text-amber-200'
          : 'text-slate-200';
  return (
    <div className="flex items-center justify-between">
      <dt className={strong ? 'font-medium text-slate-200' : 'text-slate-400'}>
        {label}
      </dt>
      <dd
        className={cn(
          'font-mono',
          toneClass,
          strong && 'text-base font-semibold',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
