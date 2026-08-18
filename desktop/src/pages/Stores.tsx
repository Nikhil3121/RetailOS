import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, Store as StoreIcon } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ApiError } from '@/lib/api';
import {
  createStore,
  deleteStore,
  listStores,
  updateStore,
  type CreateStoreBody,
  type Store,
} from '@/lib/stores-api';

export function Stores(): JSX.Element {
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();

  const query = useQuery({ queryKey: ['stores', 1, 50], queryFn: () => listStores(1, 50) });

  const toggleActive = useMutation({
    mutationFn: (s: Store) => updateStore(s.id, { is_active: !s.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stores'] }),
  });

  const remove = useMutation({
    mutationFn: (s: Store) => deleteStore(s.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stores'] }),
  });

  const columns = useMemo<Column<Store>[]>(
    () => [
      {
        key: 'code',
        header: 'Code',
        cell: (s) => (
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cobalt-500/15 text-cobalt-300">
              <StoreIcon className="h-4 w-4" />
            </span>
            <div>
              <div className="font-mono font-medium text-white">{s.code}</div>
              <div className="text-xs text-slate-500">{s.name}</div>
            </div>
          </div>
        ),
      },
      {
        key: 'location',
        header: 'Location',
        cell: (s) => (
          <div className="text-slate-300">
            {[s.city, s.state, s.country].filter(Boolean).join(', ') || <span className="text-slate-500">—</span>}
          </div>
        ),
      },
      {
        key: 'gstin',
        header: 'GSTIN',
        cell: (s) =>
          s.gstin ? (
            <span className="font-mono text-xs text-slate-300">{s.gstin}</span>
          ) : (
            <span className="text-slate-500">—</span>
          ),
      },
      {
        key: 'status',
        header: 'Status',
        cell: (s) =>
          s.is_active ? (
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
        cell: (s) => (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => toggleActive.mutate(s)}>
              {s.is_active ? 'Deactivate' : 'Activate'}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                if (window.confirm(`Delete store ${s.code}? This cannot be undone.`)) {
                  remove.mutate(s);
                }
              }}
            >
              Delete
            </Button>
          </div>
        ),
      },
    ],
    [toggleActive, remove],
  );

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Stores</h1>
          <p className="mt-1 text-sm text-slate-400">Physical locations your team operates from.</p>
        </div>
        <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
          New store
        </Button>
      </header>

      {query.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {query.error instanceof ApiError ? query.error.message : 'Failed to load stores.'}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(s) => s.id}
        empty={query.isLoading ? 'Loading…' : 'No stores yet. Create your first store to get started.'}
      />

      <CreateStoreModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ['stores'] });
        }}
      />
    </div>
  );
}

function CreateStoreModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}): JSX.Element {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateStoreBody>({
    defaultValues: {
      code: '',
      name: '',
      country: 'IN',
      is_active: true,
    },
  });

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(values: CreateStoreBody): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      await createStore({
        ...values,
        code: values.code.trim().toUpperCase(),
        name: values.name.trim(),
        gstin: values.gstin?.trim() || null,
      });
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create store.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New store"
      size="lg"
    >
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Code"
            hint="Short unique code, e.g. DEL01"
            error={errors.code?.message}
            {...register('code', {
              required: 'Code is required',
              maxLength: { value: 32, message: 'Max 32 characters' },
            })}
          />
          <Input
            label="Name"
            error={errors.name?.message}
            {...register('name', { required: 'Name is required' })}
          />
        </div>
        <Input label="Address line 1" {...register('address_line1')} />
        <div className="grid grid-cols-3 gap-4">
          <Input label="City" {...register('city')} />
          <Input label="State" {...register('state')} />
          <Input label="Postal code" {...register('postal_code')} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="GSTIN" hint="15-char GST identifier" {...register('gstin')} />
          <Input label="Phone" {...register('phone')} />
        </div>
        <Input label="Email" type="email" {...register('email')} />

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Create store
          </Button>
        </div>
      </form>
    </Modal>
  );
}
