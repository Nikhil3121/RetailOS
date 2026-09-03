import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, TicketPercent } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError } from '@/lib/api';
import {
  COUPON_TYPE_LABEL,
  createCoupon,
  deleteCoupon,
  listCoupons,
  type Coupon,
  type CouponCreate,
} from '@/lib/coupons-api';
import { listCustomers } from '@/lib/customers-api';

const TYPE_OPTIONS = [
  { label: COUPON_TYPE_LABEL.percentage, value: 'percentage' },
  { label: COUPON_TYPE_LABEL.flat, value: 'flat' },
];

export function Coupons(): JSX.Element {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Coupon | null>(null);

  const query = useQuery({ queryKey: ['coupons'], queryFn: () => listCoupons(1, 200) });
  const customersQuery = useQuery({ queryKey: ['customers'], queryFn: () => listCustomers(1, 500) });

  const remove = useMutation({
    mutationFn: (c: Coupon) => deleteCoupon(c.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coupons'] }),
  });

  const columns = useMemo<Column<Coupon>[]>(
    () => [
      {
        key: 'code',
        header: 'Coupon',
        cell: (c) => (
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.03] text-slate-300">
              <TicketPercent className="h-4 w-4" />
            </span>
            <div>
              <div className="font-mono font-medium text-white">{c.code}</div>
              <div className="text-xs text-slate-500">{c.name}</div>
            </div>
          </div>
        ),
      },
      {
        key: 'discount',
        header: 'Discount',
        cell: (c) => (
          <span className="font-mono text-slate-100">
            {c.discount_type === 'percentage'
              ? `${c.discount_value}%${c.max_discount_amount ? ` (max ₹${c.max_discount_amount})` : ''}`
              : `₹${c.discount_value}`}
          </span>
        ),
      },
      {
        key: 'min',
        header: 'Min bill',
        align: 'right',
        cell: (c) =>
          Number(c.min_bill_amount) > 0 ? (
            <span className="font-mono">₹{c.min_bill_amount}</span>
          ) : (
            <span className="text-slate-500">—</span>
          ),
      },
      {
        key: 'usage',
        header: 'Usage',
        align: 'right',
        cell: (c) => (
          <span className="font-mono text-slate-300">
            {c.uses_count}
            {c.max_uses_total !== null && ` / ${c.max_uses_total}`}
          </span>
        ),
      },
      {
        key: 'window',
        header: 'Valid',
        cell: (c) => (
          <span className="text-xs text-slate-400">
            {c.valid_from ?? '—'} → {c.valid_to ?? '∞'}
          </span>
        ),
      },
      {
        key: 'scope',
        header: 'Scope',
        cell: (c) => {
          if (!c.customer_id) return <span className="text-xs text-slate-400">Everyone</span>;
          const cust = customersQuery.data?.items.find((x) => x.id === c.customer_id);
          return <span className="text-xs text-cobalt-300">{cust?.name ?? 'One customer'}</span>;
        },
      },
      {
        key: 'status',
        header: 'Status',
        cell: (c) =>
          c.is_active ? (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-200">
              Active
            </span>
          ) : (
            <span className="rounded-full border border-border bg-white/[0.02] px-2 py-1 text-xs text-slate-400">
              Inactive
            </span>
          ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        cell: (c) => (
          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(c)}>Delete</Button>
        ),
      },
    ],
    [customersQuery.data],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Coupons"
        description="Create, validate, and track promo codes."
        actions={
          <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New coupon
          </Button>
        }
      />

      {query.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {query.error instanceof ApiError ? query.error.message : 'Failed to load coupons.'}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(c) => c.id}
        empty={query.isLoading ? 'Loading…' : 'No coupons yet.'}
      />

      <CreateCouponModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ['coupons'] });
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete coupon"
        description="Deleting a coupon leaves past redemptions intact — only the coupon itself disappears."
        destructive
        confirmLabel="Delete"
        onConfirm={async () => {
          if (confirmDelete) await remove.mutateAsync(confirmDelete);
        }}
      />
    </div>
  );
}

function CreateCouponModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}): JSX.Element {
  const {
    register, handleSubmit, watch, reset,
    formState: { errors },
  } = useForm<CouponCreate>({
    defaultValues: {
      code: '',
      name: '',
      discount_type: 'percentage',
      discount_value: '10.00',
      min_bill_amount: '0.00',
      is_active: true,
    },
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const customersQuery = useQuery({ queryKey: ['customers'], queryFn: () => listCustomers(1, 500) });
  const kind = watch('discount_type');

  async function onSubmit(values: CouponCreate): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      await createCoupon({
        ...values,
        code: values.code.trim().toUpperCase(),
        name: values.name.trim(),
        description: values.description?.trim() || null,
        customer_id: values.customer_id || null,
        max_discount_amount: values.max_discount_amount?.trim() || null,
        valid_from: values.valid_from || null,
        valid_to: values.valid_to || null,
        max_uses_total: values.max_uses_total || null,
        max_uses_per_customer: values.max_uses_per_customer || null,
      });
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create coupon.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="New coupon" size="lg">
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Code"
            hint="Uppercase, e.g. WELCOME10"
            error={errors.code?.message}
            {...register('code', { required: 'Code is required' })}
          />
          <Input
            label="Name"
            hint="Shown to staff and on receipts"
            error={errors.name?.message}
            {...register('name', { required: 'Name is required' })}
          />
        </div>
        <Textarea label="Description (optional)" rows={2} {...register('description')} />

        <div className="grid grid-cols-3 gap-4">
          <Select label="Discount type" options={TYPE_OPTIONS} {...register('discount_type')} />
          <Input
            label={kind === 'percentage' ? 'Discount %' : 'Discount ₹'}
            type="number"
            step="0.01"
            min="0"
            {...register('discount_value', { required: true })}
          />
          {kind === 'percentage' ? (
            <Input
              label="Max discount ₹ (optional)"
              type="number"
              step="0.01"
              min="0"
              {...register('max_discount_amount')}
            />
          ) : (
            <div />
          )}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Input
            label="Min bill amount"
            type="number"
            step="0.01"
            min="0"
            {...register('min_bill_amount')}
          />
          <Input
            label="Max uses (total)"
            type="number"
            step="1"
            min="1"
            hint="Blank = unlimited"
            {...register('max_uses_total', { valueAsNumber: true })}
          />
          <Input
            label="Max per customer"
            type="number"
            step="1"
            min="1"
            hint="Blank = unlimited"
            {...register('max_uses_per_customer', { valueAsNumber: true })}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input label="Valid from" type="date" {...register('valid_from')} />
          <Input label="Valid to" type="date" {...register('valid_to')} />
        </div>

        <Select
          label="Restrict to customer (optional)"
          placeholder="— Everyone —"
          options={(customersQuery.data?.items ?? []).map((c) => ({
            label: `${c.name}${c.phone ? ` · ${c.phone}` : ''}`,
            value: c.id,
          }))}
          {...register('customer_id')}
        />

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" className="accent-cobalt-500" {...register('is_active')} />
          Active
        </label>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={submitting}>Create coupon</Button>
        </div>
      </form>
    </Modal>
  );
}
