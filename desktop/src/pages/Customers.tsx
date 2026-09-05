import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, Search, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ConfirmWithPassword } from '@/components/ui/ConfirmWithPassword';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { listPriceLists } from '@/lib/price-lists-api';
import { ApiError } from '@/lib/api';
import {
  createCustomer,
  deleteCustomer,
  listCustomers,
  updateCustomer,
  type Customer,
  type CustomerCreate,
} from '@/lib/customers-api';

export function Customers(): JSX.Element {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Customer | null>(null);

  const query = useQuery({
    queryKey: ['customers', search],
    queryFn: () => listCustomers(1, 200, search.trim() || undefined),
  });

  const toggle = useMutation({
    mutationFn: (c: Customer) => updateCustomer(c.id, { is_active: !c.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  });
  const remove = useMutation({
    mutationFn: (c: Customer) => deleteCustomer(c.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  });

  const columns = useMemo<Column<Customer>[]>(
    () => [
      {
        key: 'name',
        header: 'Customer',
        cell: (c) => (
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.03] text-slate-300">
              <UserRound className="h-4 w-4" />
            </span>
            <div>
              <div className="font-medium text-white">{c.name}</div>
              {c.company_name && (
                <div className="text-xs text-slate-500">{c.company_name}</div>
              )}
            </div>
          </div>
        ),
      },
      {
        key: 'contact',
        header: 'Contact',
        cell: (c) => (
          <div className="text-slate-300">
            {c.phone && <div className="font-mono text-xs">{c.phone}</div>}
            {c.email && <div className="text-xs text-slate-500">{c.email}</div>}
            {!c.phone && !c.email && <span className="text-slate-500">—</span>}
          </div>
        ),
      },
      {
        key: 'gstin',
        header: 'GSTIN',
        cell: (c) =>
          c.gstin ? <span className="font-mono text-xs">{c.gstin}</span> : <span className="text-slate-500">—</span>,
      },
      {
        key: 'location',
        header: 'Location',
        cell: (c) => (
          <span className="text-slate-300">
            {[c.city, c.state].filter(Boolean).join(', ') || <span className="text-slate-500">—</span>}
          </span>
        ),
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
          <div className="flex justify-end gap-2">
            <Link
              to={`/customers/${c.id}`}
              className="inline-flex h-8 items-center rounded-xl border border-border bg-white/[0.04] px-3 text-xs font-medium text-slate-100 hover:bg-white/[0.07]"
            >
              View
            </Link>
            <Button size="sm" variant="secondary" onClick={() => toggle.mutate(c)}>
              {c.is_active ? 'Deactivate' : 'Activate'}
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmDelete(c)}>
              Delete
            </Button>
          </div>
        ),
      },
    ],
    [toggle],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Walk-in shoppers and B2B accounts."
        actions={
          <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New customer
          </Button>
        }
      />

      <div className="glass inline-flex w-fit max-w-full flex-wrap items-end gap-3 px-3 py-2">
        <div className="flex-1">
          <Input
            placeholder="Search by name, phone, or email"
            leadingIcon={<Search className="h-4 w-4" />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {query.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {query.error instanceof ApiError ? query.error.message : 'Failed to load customers.'}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(c) => c.id}
        empty={query.isLoading ? 'Loading…' : 'No customers yet.'}
      />

      <CreateCustomerModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ['customers'] });
        }}
      />

      <ConfirmWithPassword
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete customer"
        description={`Delete "${confirmDelete?.name}"? Their purchase history stays visible on old invoices but the profile disappears.`}
        confirmLabel="Delete"
        onConfirm={async () => { if (confirmDelete) await remove.mutateAsync(confirmDelete); }}
      />
    </div>
  );
}

function CreateCustomerModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}): JSX.Element {
  const {
    register, handleSubmit, reset,
    formState: { errors },
  } = useForm<CustomerCreate>({
    defaultValues: { name: '', country: 'IN', is_active: true },
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Rate cards to choose from. Cheap, cached, and the dialog is rarely open.
  const priceListsQuery = useQuery({
    queryKey: ['price-lists'],
    queryFn: () => listPriceLists(),
  });

  async function onSubmit(values: CustomerCreate): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      await createCustomer({
        ...values,
        name: values.name.trim(),
        phone: values.phone?.trim() || null,
        email: values.email?.trim() || null,
        gstin: values.gstin?.trim() || null,
        company_name: values.company_name?.trim() || null,
        date_of_birth: values.date_of_birth || null,
        anniversary: values.anniversary || null,
        // Empty means "no list of their own" — they fall to the default list,
        // or the shelf price if there is none.
        price_list_id: values.price_list_id || null,
        credit_limit: values.credit_limit ? String(values.credit_limit) : null,
      });
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create customer.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="New customer" size="lg">
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Name" error={errors.name?.message} {...register('name', { required: 'Name is required' })} />
          <Input label="Company (optional)" {...register('company_name')} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Phone" {...register('phone')} />
          <Input label="Email" type="email" {...register('email')} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Input label="GSTIN" {...register('gstin')} />
          {/* The rate card this customer buys on. Blank is the common case —
              a walk-in falls to the default list, or the shelf price. */}
          <Select
            label="Price list"
            placeholder="— Default —"
            options={(priceListsQuery.data ?? [])
              .filter((pl) => pl.is_active)
              .map((pl) => ({ label: pl.name, value: pl.id }))}
            {...register('price_list_id')}
          />
          {/* Checked against TOTAL outstanding across every open bill, not
              just the one being rung up — otherwise the ceiling is trivially
              bypassed one small credit sale at a time. */}
          <Input
            label="Credit limit"
            type="number"
            step="0.01"
            min="0"
            placeholder="No limit"
            hint="Maximum this customer may owe in total. Leave blank for no limit."
            {...register('credit_limit')}
          />
          <Input label="Date of birth" type="date" {...register('date_of_birth')} />
          <Input label="Anniversary" type="date" {...register('anniversary')} />
        </div>
        <Input label="Address line 1" {...register('address_line1')} />
        <div className="grid grid-cols-3 gap-4">
          <Input label="City" {...register('city')} />
          <Input label="State" {...register('state')} />
          <Input label="Postal code" {...register('postal_code')} />
        </div>
        <Textarea label="Notes" rows={3} {...register('notes')} />

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={submitting}>Create customer</Button>
        </div>
      </form>
    </Modal>
  );
}
