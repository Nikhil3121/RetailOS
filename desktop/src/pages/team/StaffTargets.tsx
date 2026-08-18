import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, Target as TargetIcon } from 'lucide-react';

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
  createTarget,
  deleteTarget,
  listTargets,
  TARGET_PERIOD_LABEL,
  targetProgress,
  type StaffTarget,
  type StaffTargetCreate,
} from '@/lib/staff-api';
import { listUsers } from '@/lib/users-api';

const PERIOD_OPTIONS = [
  { label: TARGET_PERIOD_LABEL.month, value: 'month' },
  { label: TARGET_PERIOD_LABEL.quarter, value: 'quarter' },
  { label: TARGET_PERIOD_LABEL.year, value: 'year' },
];

export function StaffTargets(): JSX.Element {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<StaffTarget | null>(null);

  const query = useQuery({ queryKey: ['staff-targets'], queryFn: () => listTargets({ page_size: 200 }) });
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => listUsers(1, 500) });

  const remove = useMutation({
    mutationFn: (t: StaffTarget) => deleteTarget(t.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff-targets'] }),
  });

  const columns = useMemo<Column<StaffTarget>[]>(
    () => [
      {
        key: 'user',
        header: 'Staff',
        cell: (t) => {
          const user = usersQuery.data?.items.find((u) => u.id === t.user_id);
          return (
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.03] text-slate-300">
                <TargetIcon className="h-4 w-4" />
              </span>
              <div>
                <div className="font-medium text-white">{user?.full_name ?? t.user_id}</div>
                <div className="text-xs text-slate-500">{user?.email}</div>
              </div>
            </div>
          );
        },
      },
      {
        key: 'period',
        header: 'Period',
        cell: (t) => (
          <div>
            <div className="text-slate-200">{TARGET_PERIOD_LABEL[t.period]}</div>
            <div className="text-xs text-slate-500">starting {t.period_start}</div>
          </div>
        ),
      },
      {
        key: 'target',
        header: 'Target',
        align: 'right',
        cell: (t) => <span className="font-mono text-white">₹{t.target_amount}</span>,
      },
      {
        key: 'progress',
        header: 'Progress',
        cell: (t) => <ProgressCell targetId={t.id} />,
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        cell: (t) => (
          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(t)}>
            Delete
          </Button>
        ),
      },
    ],
    [usersQuery.data],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff targets"
        description="Set sales targets per staff member. Achievement updates live as sales come in."
        actions={
          <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New target
          </Button>
        }
      />

      {query.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {query.error instanceof ApiError ? query.error.message : 'Failed to load targets.'}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(t) => t.id}
        empty={query.isLoading ? 'Loading…' : 'No targets set. Give your team something to chase.'}
      />

      <CreateTargetModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ['staff-targets'] });
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete target"
        description="Deleting a target doesn't touch sales history — it only removes the goal line."
        destructive
        confirmLabel="Delete"
        onConfirm={async () => { if (confirmDelete) await remove.mutateAsync(confirmDelete); }}
      />
    </div>
  );
}

function ProgressCell({ targetId }: { targetId: string }): JSX.Element {
  const query = useQuery({
    queryKey: ['staff-target', targetId, 'progress'],
    queryFn: () => targetProgress(targetId),
  });
  if (query.isLoading) return <span className="text-xs text-slate-500">…</span>;
  if (query.isError || !query.data) return <span className="text-xs text-slate-500">—</span>;
  const pct = Math.min(Number(query.data.achievement_pct), 100);
  const tone =
    pct >= 100
      ? 'from-emerald-500 to-emerald-300'
      : pct >= 60
        ? 'from-cobalt-500 to-aurora-400'
        : 'from-amber-500 to-amber-300';
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-mono text-slate-100">₹{query.data.achieved_amount}</span>
        <span
          className={
            pct >= 100
              ? 'font-mono text-emerald-300'
              : pct >= 60
                ? 'font-mono text-cobalt-300'
                : 'font-mono text-amber-300'
          }
        >
          {query.data.achievement_pct}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.05]">
        <div className={`h-full bg-gradient-to-r ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CreateTargetModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}): JSX.Element {
  const {
    register, handleSubmit, reset,
    formState: { errors },
  } = useForm<StaffTargetCreate>({
    defaultValues: {
      period: 'month',
      period_start: firstOfMonthISO(),
      target_amount: '100000.00',
    },
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => listUsers(1, 500) });

  async function onSubmit(values: StaffTargetCreate): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      await createTarget({
        ...values,
        notes: values.notes?.trim() || null,
      });
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create target.');
    } finally {
      setSubmitting(false);
    }
  }

  const staffOptions = (usersQuery.data?.items ?? []).map((u) => ({
    label: u.full_name,
    value: u.id,
  }));
  const noStaff = !usersQuery.isLoading && !usersQuery.isError && staffOptions.length === 0;

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="New sales target" size="lg">
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        {usersQuery.isError && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            Couldn't load users.
            <button
              type="button"
              onClick={() => usersQuery.refetch()}
              className="ml-2 underline hover:text-rose-100"
            >
              Retry
            </button>
          </div>
        )}
        {noStaff && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            No users found. Create staff under <strong>Users</strong> first, then come back
            to set a target.
          </div>
        )}
        <Select
          label="Staff"
          placeholder={
            usersQuery.isLoading
              ? 'Loading users…'
              : noStaff
                ? '— No staff to target —'
                : '— Select staff —'
          }
          options={staffOptions}
          disabled={noStaff}
          error={errors.user_id?.message}
          {...register('user_id', { required: 'Staff is required' })}
        />
        <div className="grid grid-cols-2 gap-4">
          <Select label="Period" options={PERIOD_OPTIONS} {...register('period')} />
          <Input
            label="Period starts on"
            type="date"
            hint="First day of the target period"
            {...register('period_start', { required: 'Period start is required' })}
          />
        </div>
        <Input
          label="Target amount (₹)"
          type="number"
          step="0.01"
          min="0.01"
          error={errors.target_amount?.message}
          {...register('target_amount', { required: 'Target amount is required' })}
        />
        <Textarea label="Notes (optional)" rows={2} {...register('notes')} />

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={submitting}>Create target</Button>
        </div>
      </form>
    </Modal>
  );
}

function firstOfMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
