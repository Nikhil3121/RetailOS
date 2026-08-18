import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, Scale } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError } from '@/lib/api';
import { listBrands, listCategories, listProducts } from '@/lib/catalog-api';
import {
  createRule,
  deleteRule,
  listRules,
  SCOPE_LABEL,
  TYPE_LABEL,
  type CommissionRule,
  type CommissionRuleCreate,
} from '@/lib/commissions-api';
import { listUsers } from '@/lib/users-api';

const SCOPE_OPTIONS = [
  { label: SCOPE_LABEL.global, value: 'global' },
  { label: SCOPE_LABEL.product, value: 'product' },
  { label: SCOPE_LABEL.category, value: 'category' },
  { label: SCOPE_LABEL.brand, value: 'brand' },
];

const TYPE_OPTIONS = [
  { label: TYPE_LABEL.percentage, value: 'percentage' },
  { label: TYPE_LABEL.fixed, value: 'fixed' },
];

export function CommissionRules(): JSX.Element {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CommissionRule | null>(null);

  const query = useQuery({ queryKey: ['commission-rules'], queryFn: () => listRules(1, 200) });
  const productsQuery = useQuery({ queryKey: ['products', 'brief'], queryFn: () => listProducts({ page_size: 500 }) });
  const brandsQuery = useQuery({ queryKey: ['brands'], queryFn: () => listBrands(1, 500) });
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => listCategories(1, 500) });
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => listUsers(1, 500) });

  const remove = useMutation({
    mutationFn: (r: CommissionRule) => deleteRule(r.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['commission-rules'] }),
  });

  const targetName = (r: CommissionRule): string => {
    if (r.scope === 'global') return 'Everything';
    if (r.scope === 'product') {
      return productsQuery.data?.items.find((p) => p.id === r.product_id)?.name ?? '—';
    }
    if (r.scope === 'category') {
      return categoriesQuery.data?.items.find((c) => c.id === r.category_id)?.name ?? '—';
    }
    return brandsQuery.data?.items.find((b) => b.id === r.brand_id)?.name ?? '—';
  };
  const staffName = (r: CommissionRule): string =>
    r.staff_id
      ? usersQuery.data?.items.find((u) => u.id === r.staff_id)?.full_name ?? '—'
      : 'All staff';

  const columns = useMemo<Column<CommissionRule>[]>(
    () => [
      {
        key: 'name',
        header: 'Rule',
        cell: (r) => (
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.03] text-slate-300">
              <Scale className="h-4 w-4" />
            </span>
            <div>
              <div className="font-medium text-white">{r.name}</div>
              {r.description && <div className="text-xs text-slate-500">{r.description}</div>}
            </div>
          </div>
        ),
      },
      {
        key: 'scope',
        header: 'Scope',
        cell: (r) => (
          <div>
            <span className="rounded-md border border-cobalt-500/30 bg-cobalt-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cobalt-200">
              {SCOPE_LABEL[r.scope]}
            </span>
            <div className="mt-1 text-xs text-slate-400">{targetName(r)}</div>
          </div>
        ),
      },
      { key: 'staff', header: 'Applies to', cell: (r) => <span className="text-slate-300">{staffName(r)}</span> },
      {
        key: 'rate',
        header: 'Payout',
        align: 'right',
        cell: (r) => (
          <span className="font-mono text-slate-100">
            {r.commission_type === 'percentage' ? `${r.rate}%` : `₹${r.rate}/unit`}
          </span>
        ),
      },
      {
        key: 'priority',
        header: 'Priority',
        align: 'right',
        cell: (r) => <span className="font-mono text-slate-400">{r.priority}</span>,
      },
      {
        key: 'window',
        header: 'Effective',
        cell: (r) => (
          <span className="text-xs text-slate-400">
            {r.effective_from ?? 'always'} → {r.effective_to ?? '∞'}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        cell: (r) =>
          r.is_active ? (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200">
              Active
            </span>
          ) : (
            <span className="rounded-full border border-border bg-white/[0.02] px-2 py-0.5 text-xs text-slate-400">
              Inactive
            </span>
          ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        cell: (r) => (
          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(r)}>
            Delete
          </Button>
        ),
      },
    ],
    [productsQuery.data, categoriesQuery.data, brandsQuery.data, usersQuery.data],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Commission rules"
        description="Rules resolve top-down: product > category > brand > global. Priority breaks ties."
        actions={
          <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New rule
          </Button>
        }
      />

      {query.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {query.error instanceof ApiError ? query.error.message : 'Failed to load rules.'}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(r) => r.id}
        empty={query.isLoading ? 'Loading…' : 'No rules yet. Create one to start paying commission.'}
      />

      <CreateRuleModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ['commission-rules'] });
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete commission rule"
        description={`Delete "${confirmDelete?.name}"? Existing commission calculations recompute without it next time they run.`}
        destructive
        confirmLabel="Delete"
        onConfirm={async () => { if (confirmDelete) await remove.mutateAsync(confirmDelete); }}
      />
    </div>
  );
}

function CreateRuleModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}): JSX.Element {
  const {
    register, handleSubmit, watch, setValue, reset,
    formState: { errors },
  } = useForm<CommissionRuleCreate>({
    defaultValues: {
      name: '',
      scope: 'global',
      commission_type: 'percentage',
      rate: '5.00',
      priority: 0,
      is_active: true,
    },
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const productsQuery = useQuery({ queryKey: ['products', 'brief'], queryFn: () => listProducts({ page_size: 500 }) });
  const brandsQuery = useQuery({ queryKey: ['brands'], queryFn: () => listBrands(1, 500) });
  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => listCategories(1, 500) });
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => listUsers(1, 500) });

  const scope = watch('scope');

  async function onSubmit(values: CommissionRuleCreate): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      await createRule({
        ...values,
        name: values.name.trim(),
        description: values.description?.trim() || null,
        product_id: values.scope === 'product' ? values.product_id || null : null,
        category_id: values.scope === 'category' ? values.category_id || null : null,
        brand_id: values.scope === 'brand' ? values.brand_id || null : null,
        staff_id: values.staff_id || null,
        effective_from: values.effective_from || null,
        effective_to: values.effective_to || null,
      });
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Failed to create rule.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="New commission rule" size="lg">
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <Input
          label="Rule name"
          hint="Shown on breakdowns — pick something descriptive"
          error={errors.name?.message}
          {...register('name', { required: 'Name is required' })}
        />
        <Textarea label="Description (optional)" rows={2} {...register('description')} />

        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Scope"
            options={SCOPE_OPTIONS}
            {...register('scope', {
              onChange: () => {
                setValue('product_id', null);
                setValue('category_id', null);
                setValue('brand_id', null);
              },
            })}
          />
          <Select
            label="Payout type"
            options={TYPE_OPTIONS}
            {...register('commission_type')}
          />
        </div>

        {scope === 'product' && (
          <Select
            label="Product"
            placeholder="— Select a product —"
            options={(productsQuery.data?.items ?? []).map((p) => ({ label: p.name, value: p.id }))}
            {...register('product_id')}
          />
        )}
        {scope === 'category' && (
          <Select
            label="Category"
            placeholder="— Select a category —"
            options={(categoriesQuery.data?.items ?? []).map((c) => ({ label: c.name, value: c.id }))}
            {...register('category_id')}
          />
        )}
        {scope === 'brand' && (
          <Select
            label="Brand"
            placeholder="— Select a brand —"
            options={(brandsQuery.data?.items ?? []).map((b) => ({ label: b.name, value: b.id }))}
            {...register('brand_id')}
          />
        )}

        <div className="grid grid-cols-3 gap-4">
          <Input
            label="Rate"
            type="number"
            step="0.0001"
            min="0"
            hint={watch('commission_type') === 'percentage' ? '% of line total' : '₹ per unit'}
            {...register('rate', { required: 'Rate is required' })}
          />
          <Input
            label="Priority"
            type="number"
            step="1"
            hint="Higher wins on tie"
            {...register('priority', { valueAsNumber: true })}
          />
          <Select
            label="Applies to"
            placeholder="— All staff —"
            options={(usersQuery.data?.items ?? []).map((u) => ({ label: u.full_name, value: u.id }))}
            {...register('staff_id')}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input label="Effective from (optional)" type="date" {...register('effective_from')} />
          <Input label="Effective to (optional)" type="date" {...register('effective_to')} />
        </div>

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
          <Button type="submit" loading={submitting}>Create rule</Button>
        </div>
      </form>
    </Modal>
  );
}
