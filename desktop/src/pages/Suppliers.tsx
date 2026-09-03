import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, Search, Truck } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError } from '@/lib/api';
import {
  createSupplier,
  deleteSupplier,
  listSuppliers,
  updateSupplier,
  type Supplier,
  type SupplierCreate,
} from '@/lib/suppliers-api';

export function Suppliers(): JSX.Element {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Supplier | null>(null);

  const query = useQuery({
    queryKey: ['suppliers', search],
    queryFn: () => listSuppliers(1, 200, search.trim() || undefined),
  });

  const toggle = useMutation({
    mutationFn: (s: Supplier) => updateSupplier(s.id, { is_active: !s.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
  const remove = useMutation({
    mutationFn: (s: Supplier) => deleteSupplier(s.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });

  const columns = useMemo<Column<Supplier>[]>(
    () => [
      {
        key: 'name',
        header: 'Supplier',
        cell: (s) => (
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.03] text-slate-300">
              <Truck className="h-4 w-4" />
            </span>
            <div>
              <div className="font-medium text-white">{s.name}</div>
              <div className="font-mono text-xs text-slate-500">{s.code}</div>
            </div>
          </div>
        ),
      },
      {
        key: 'contact',
        header: 'Contact',
        cell: (s) => (
          <div className="text-slate-300">
            {s.contact_person && <div>{s.contact_person}</div>}
            <div className="text-xs text-slate-500">
              {[s.phone, s.email].filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
        ),
      },
      {
        key: 'gstin',
        header: 'GSTIN',
        cell: (s) =>
          s.gstin ? <span className="font-mono text-xs">{s.gstin}</span> : <span className="text-slate-500">—</span>,
      },
      {
        key: 'status',
        header: 'Status',
        cell: (s) =>
          s.is_active ? (
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
        cell: (s) => (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => toggle.mutate(s)}>
              {s.is_active ? 'Deactivate' : 'Activate'}
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmDelete(s)}>
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
        title="Suppliers"
        description="Vendors you purchase from."
        actions={
          <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New supplier
          </Button>
        }
      />

      <div className="glass inline-flex w-fit max-w-full flex-wrap items-end gap-3 px-3 py-2">
        <div className="flex-1">
          <Input
            placeholder="Search by name or code"
            leadingIcon={<Search className="h-4 w-4" />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {query.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {query.error instanceof ApiError ? query.error.message : 'Failed to load suppliers.'}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(s) => s.id}
        empty={query.isLoading ? 'Loading…' : 'No suppliers yet.'}
      />

      <CreateSupplierModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ['suppliers'] });
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete supplier"
        description={`Delete "${confirmDelete?.name}"? Any linked purchase orders will refuse to update further.`}
        destructive
        confirmLabel="Delete"
        onConfirm={async () => { if (confirmDelete) await remove.mutateAsync(confirmDelete); }}
      />
    </div>
  );
}

function CreateSupplierModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}): JSX.Element {
  const {
    register, handleSubmit, reset,
    formState: { errors },
  } = useForm<SupplierCreate>({
    defaultValues: { code: '', name: '', country: 'IN', is_active: true },
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(values: SupplierCreate): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      await createSupplier({
        ...values,
        code: values.code.trim().toUpperCase(),
        name: values.name.trim(),
        gstin: values.gstin?.trim() || null,
        email: values.email?.trim() || null,
        phone: values.phone?.trim() || null,
      });
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create supplier.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="New supplier" size="lg">
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Code" hint="Short unique code, e.g. ACME01"
            error={errors.code?.message} {...register('code', { required: 'Code is required' })} />
          <Input label="Name" error={errors.name?.message} {...register('name', { required: 'Name is required' })} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Contact person" {...register('contact_person')} />
          <Input label="GSTIN" hint="15-char identifier" {...register('gstin')} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Phone" {...register('phone')} />
          <Input label="Email" type="email" {...register('email')} />
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
          <Button type="submit" loading={submitting}>Create supplier</Button>
        </div>
      </form>
    </Modal>
  );
}
