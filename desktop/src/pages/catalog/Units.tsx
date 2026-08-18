import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, Ruler } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { ApiError } from '@/lib/api';
import {
  createUnit,
  deleteUnit,
  listUnits,
  updateUnit,
  type Unit,
  type UnitCreate,
} from '@/lib/catalog-api';

export function Units(): JSX.Element {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Unit | null>(null);

  const query = useQuery({ queryKey: ['units'], queryFn: () => listUnits(1, 200) });

  const toggle = useMutation({
    mutationFn: (u: Unit) => updateUnit(u.id, { is_active: !u.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['units'] }),
  });

  const remove = useMutation({
    mutationFn: (u: Unit) => deleteUnit(u.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['units'] }),
  });

  const columns = useMemo<Column<Unit>[]>(
    () => [
      {
        key: 'name',
        header: 'Name',
        cell: (u) => (
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.03] text-slate-300">
              <Ruler className="h-4 w-4" />
            </span>
            <div>
              <div className="font-medium text-white">{u.name}</div>
              <div className="font-mono text-xs text-slate-500">{u.symbol}</div>
            </div>
          </div>
        ),
      },
      {
        key: 'fractional',
        header: 'Fractional',
        cell: (u) => (u.is_fractional ? 'Yes' : 'No'),
      },
      {
        key: 'status',
        header: 'Status',
        cell: (u) =>
          u.is_active ? (
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
        cell: (u) => (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => toggle.mutate(u)}>
              {u.is_active ? 'Deactivate' : 'Activate'}
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmDelete(u)}>
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
        title="Units of measure"
        description="Every quantity in the system — sold, purchased, or held — is expressed in one of these units."
        actions={
          <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New unit
          </Button>
        }
      />

      {query.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {query.error instanceof ApiError ? query.error.message : 'Failed to load units.'}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(u) => u.id}
        empty={query.isLoading ? 'Loading…' : 'No units yet. Create Piece, Kilogram, Litre to start.'}
      />

      <CreateUnitModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ['units'] });
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete unit"
        description={`Delete unit "${confirmDelete?.name}"? Products using this unit will refuse the change until reassigned.`}
        destructive
        confirmLabel="Delete"
        onConfirm={async () => {
          if (confirmDelete) await remove.mutateAsync(confirmDelete);
        }}
      />
    </div>
  );
}

function CreateUnitModal({
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
  } = useForm<UnitCreate>({
    defaultValues: { name: '', symbol: '', is_fractional: false, is_active: true },
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(values: UnitCreate): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      await createUnit({
        ...values,
        name: values.name.trim(),
        symbol: values.symbol.trim(),
      });
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create unit.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="New unit">
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <Input
          label="Name"
          hint="Human-readable, e.g. Kilogram"
          error={errors.name?.message}
          {...register('name', { required: 'Name is required' })}
        />
        <Input
          label="Symbol"
          hint="Short display, e.g. kg"
          error={errors.symbol?.message}
          {...register('symbol', { required: 'Symbol is required', maxLength: { value: 16, message: 'Max 16 characters' } })}
        />
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" className="accent-cobalt-500" {...register('is_fractional')} />
          Allow fractional quantities (e.g. 0.5 kg)
        </label>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={submitting}>Create unit</Button>
        </div>
      </form>
    </Modal>
  );
}
