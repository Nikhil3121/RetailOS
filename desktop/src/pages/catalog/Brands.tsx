import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, Tag } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ConfirmWithPassword } from '@/components/ui/ConfirmWithPassword';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError } from '@/lib/api';
import {
  createBrand,
  deleteBrand,
  listBrands,
  updateBrand,
  type Brand,
  type BrandCreate,
} from '@/lib/catalog-api';

export function Brands(): JSX.Element {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Brand | null>(null);

  const query = useQuery({ queryKey: ['brands'], queryFn: () => listBrands(1, 200) });

  const toggle = useMutation({
    mutationFn: (b: Brand) => updateBrand(b.id, { is_active: !b.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brands'] }),
  });

  const remove = useMutation({
    mutationFn: (b: Brand) => deleteBrand(b.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['brands'] }),
  });

  const columns = useMemo<Column<Brand>[]>(
    () => [
      {
        key: 'name',
        header: 'Brand',
        cell: (b) => (
          <div className="flex items-center gap-3">
            {b.logo_url ? (
              <img
                src={b.logo_url}
                alt=""
                className="h-8 w-8 rounded-lg border border-border bg-white/[0.02] object-cover"
              />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.03] text-slate-300">
                <Tag className="h-4 w-4" />
              </span>
            )}
            <div>
              <div className="font-medium text-white">{b.name}</div>
              <div className="font-mono text-xs text-slate-500">{b.slug}</div>
            </div>
          </div>
        ),
      },
      {
        key: 'description',
        header: 'Description',
        cell: (b) => (
          <div className="max-w-md truncate text-slate-300">
            {b.description ?? <span className="text-slate-500">—</span>}
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        cell: (b) =>
          b.is_active ? (
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
        cell: (b) => (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => toggle.mutate(b)}>
              {b.is_active ? 'Deactivate' : 'Activate'}
            </Button>
            <Button size="sm" variant="danger" onClick={() => setConfirmDelete(b)}>
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
        title="Brands"
        description="Manufacturer or label under which products are sold."
        actions={
          <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New brand
          </Button>
        }
      />

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(b) => b.id}
        loading={query.isLoading}
        error={
          query.isError
            ? query.error instanceof ApiError
              ? query.error.message
              : 'Failed to load brands.'
            : null
        }
        onRetry={() => query.refetch()}
        empty="No brands yet."
      />

      <CreateBrandModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ['brands'] });
        }}
      />

      <ConfirmWithPassword
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete brand"
        description={`Delete brand "${confirmDelete?.name}"? Products keep their data but lose the brand assignment.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (confirmDelete) await remove.mutateAsync(confirmDelete);
        }}
      />
    </div>
  );
}

function CreateBrandModal({
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
  } = useForm<BrandCreate>({
    defaultValues: { name: '', slug: '', description: '', logo_url: '', is_active: true },
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(values: BrandCreate): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      await createBrand({
        name: values.name.trim(),
        slug: values.slug?.trim() || undefined,
        description: values.description?.trim() || null,
        logo_url: values.logo_url?.trim() || null,
        is_active: values.is_active,
      });
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create brand.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="New brand" size="lg">
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Name"
            error={errors.name?.message}
            {...register('name', { required: 'Name is required' })}
          />
          <Input
            label="Slug"
            hint="URL-safe id. Leave blank to auto-generate."
            {...register('slug')}
          />
        </div>
        <Input label="Logo URL" placeholder="https://…" {...register('logo_url')} />
        <Textarea label="Description" rows={3} {...register('description')} />

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={submitting}>Create brand</Button>
        </div>
      </form>
    </Modal>
  );
}
