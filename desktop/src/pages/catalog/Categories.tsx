import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { ChevronRight, FolderTree, Plus } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  categoryTree,
  createCategory,
  deleteCategory,
  listCategories,
  type Category,
  type CategoryCreate,
  type CategoryTreeNode,
} from '@/lib/catalog-api';

export function Categories(): JSX.Element {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CategoryTreeNode | null>(null);

  const treeQuery = useQuery({ queryKey: ['categories', 'tree'], queryFn: categoryTree });
  const flatQuery = useQuery({ queryKey: ['categories'], queryFn: () => listCategories(1,200) });

  const remove = useMutation({
    mutationFn: (id: string) => deleteCategory(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['categories', 'tree'] });
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categories"
        description="Group your catalog into a hierarchy. Products can attach at any depth."
        actions={
          <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New category
          </Button>
        }
      />

      {treeQuery.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {treeQuery.error instanceof ApiError ? treeQuery.error.message : 'Failed to load categories.'}
        </div>
      )}

      <GlassCard>
        {treeQuery.isLoading ? (
          <div className="py-6 text-sm text-slate-400">Loading…</div>
        ) : !treeQuery.data || treeQuery.data.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <FolderTree className="mb-3 h-10 w-10 text-slate-500" />
            <p className="text-sm text-slate-400">
              No categories yet. Create top-level ones first (Apparel, Grocery, Electronics), then
              add children under them.
            </p>
          </div>
        ) : (
          <ul className="space-y-1">
            {treeQuery.data.map((node) => (
              <TreeRow key={node.id} node={node} depth={0} onDelete={setConfirmDelete} />
            ))}
          </ul>
        )}
      </GlassCard>

      <CreateCategoryModal
        open={creating}
        onClose={() => setCreating(false)}
        categories={flatQuery.data?.items ?? []}
        onCreated={() => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ['categories'] });
          qc.invalidateQueries({ queryKey: ['categories', 'tree'] });
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete category"
        description={
          confirmDelete
            ? `Delete "${confirmDelete.name}"? Children re-parent to the root, and products keep their data but lose the category assignment.`
            : ''
        }
        destructive
        confirmLabel="Delete"
        onConfirm={async () => {
          if (confirmDelete) await remove.mutateAsync(confirmDelete.id);
        }}
      />
    </div>
  );
}

function TreeRow({
  node,
  depth,
  onDelete,
}: {
  node: CategoryTreeNode;
  depth: number;
  onDelete: (n: CategoryTreeNode) => void;
}): JSX.Element {
  return (
    <li>
      <div
        className={cn(
          'group flex items-center justify-between rounded-xl border border-border/60 bg-white/[0.015] px-3 py-2 hover:bg-white/[0.03]',
        )}
        style={{ marginLeft: depth * 20 }}
      >
        <div className="flex items-center gap-2 text-sm">
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 text-slate-500',
              node.children.length === 0 && 'opacity-30',
            )}
          />
          <span className="font-medium text-white">{node.name}</span>
          <span className="font-mono text-xs text-slate-500">{node.slug}</span>
          {!node.is_active && (
            <span className="rounded-full border border-border bg-white/[0.02] px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">
              Inactive
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="danger"
          className="opacity-0 group-hover:opacity-100"
          onClick={() => onDelete(node)}
        >
          Delete
        </Button>
      </div>
      {node.children.length > 0 && (
        <ul className="mt-1 space-y-1">
          {node.children.map((child) => (
            <TreeRow key={child.id} node={child} depth={depth + 1} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </li>
  );
}

function CreateCategoryModal({
  open,
  onClose,
  categories,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  onCreated: () => void;
}): JSX.Element {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CategoryCreate>({
    defaultValues: { name: '', slug: '', description: '', parent_id: '', is_active: true },
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const parentOptions = categories.map((c) => ({ label: c.name, value: c.id }));

  async function onSubmit(values: CategoryCreate): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      await createCategory({
        name: values.name.trim(),
        slug: values.slug?.trim() || undefined,
        description: values.description?.trim() || null,
        parent_id: values.parent_id || null,
        is_active: values.is_active,
      });
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create category.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="New category" size="lg">
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Name"
            error={errors.name?.message}
            {...register('name', { required: 'Name is required' })}
          />
          <Input
            label="Slug"
            hint="Optional — auto-generated from name"
            {...register('slug')}
          />
        </div>
        <Select
          label="Parent"
          placeholder="— None (top-level) —"
          options={parentOptions}
          {...register('parent_id')}
        />
        <Textarea label="Description" rows={3} {...register('description')} />

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={submitting}>Create category</Button>
        </div>
      </form>
    </Modal>
  );
}
