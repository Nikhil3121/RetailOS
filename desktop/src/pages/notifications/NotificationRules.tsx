import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Bell, Plus } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ConfirmWithPassword } from '@/components/ui/ConfirmWithPassword';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError } from '@/lib/api';
import {
  CHANNEL_LABEL,
  KIND_LABEL,
  createRule,
  deleteRule,
  listRules,
  type NotificationChannel,
  type NotificationKind,
  type NotificationRule,
  type NotificationRuleCreate,
  type NotificationSeverity,
} from '@/lib/notifications-api';
import { listUsers } from '@/lib/users-api';

const KIND_OPTIONS = Object.entries(KIND_LABEL).map(([value, label]) => ({
  value,
  label,
}));

const SEVERITY_OPTIONS = [
  { value: 'info', label: 'Info+' },
  { value: 'warning', label: 'Warning+' },
  { value: 'critical', label: 'Critical only' },
];

const ROLE_OPTIONS = [
  { value: '', label: '— Broadcast (needs a target) —' },
  { value: 'super_admin', label: 'Super admins' },
  { value: 'owner', label: 'Owners+' },
  { value: 'manager', label: 'Managers+' },
  { value: 'cashier', label: 'Cashiers+' },
  { value: 'staff', label: 'All staff' },
];

export function NotificationRules(): JSX.Element {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<NotificationRule | null>(null);

  const query = useQuery({ queryKey: ['notification-rules'], queryFn: listRules });
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => listUsers(1, 500) });

  const remove = useMutation({
    mutationFn: (r: NotificationRule) => deleteRule(r.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-rules'] }),
  });

  const targetLabel = (r: NotificationRule): string => {
    if (r.target_user_id) {
      return (
        usersQuery.data?.items.find((u) => u.id === r.target_user_id)?.full_name ??
        'One user'
      );
    }
    if (r.target_role) {
      return ROLE_OPTIONS.find((o) => o.value === r.target_role)?.label ?? r.target_role;
    }
    return 'Broadcast';
  };

  const columns = useMemo<Column<NotificationRule>[]>(
    () => [
      {
        key: 'name',
        header: 'Rule',
        cell: (r) => (
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.03] text-slate-300">
              <Bell className="h-4 w-4" />
            </span>
            <div>
              <div className="font-medium text-white">{r.name}</div>
              {r.description && <div className="text-xs text-slate-500">{r.description}</div>}
            </div>
          </div>
        ),
      },
      {
        key: 'kind',
        header: 'Fires on',
        cell: (r) => (
          <span className="rounded-md border border-cobalt-500/30 bg-cobalt-500/10 px-2 py-1 text-xs uppercase tracking-wider text-cobalt-200">
            {KIND_LABEL[r.kind]}
          </span>
        ),
      },
      {
        key: 'severity',
        header: 'Min severity',
        cell: (r) => (
          <span className="text-xs text-slate-300">
            {SEVERITY_OPTIONS.find((o) => o.value === r.min_severity)?.label ?? r.min_severity}
          </span>
        ),
      },
      {
        key: 'channels',
        header: 'Channels',
        cell: (r) => (
          <div className="flex flex-wrap gap-1">
            {r.channels.map((c) => (
              <span
                key={c}
                className="rounded-md border border-border bg-white/[0.02] px-2 py-1 text-xs text-slate-300"
              >
                {CHANNEL_LABEL[c as keyof typeof CHANNEL_LABEL] ?? c}
              </span>
            ))}
          </div>
        ),
      },
      {
        key: 'target',
        header: 'Recipients',
        cell: (r) => <span className="text-xs text-slate-300">{targetLabel(r)}</span>,
      },
      {
        key: 'status',
        header: 'Status',
        cell: (r) =>
          r.is_active ? (
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
        cell: (r) => (
          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(r)}>
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
        title="Notification rules"
        description="Configure which events trigger notifications, who gets them, and via which channels."
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
        rows={query.data ?? []}
        rowKey={(r) => r.id}
        empty={
          query.isLoading
            ? 'Loading…'
            : 'No rules yet. Try one for LOW_STOCK to Owners+ so you get warned when to reorder.'
        }
      />

      <CreateRuleModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ['notification-rules'] });
        }}
      />

      <ConfirmWithPassword
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete notification rule"
        description={`Delete "${confirmDelete?.name}"? Past notifications stay; future events for this rule stop firing.`}
        confirmLabel="Delete"
        onConfirm={async () => { if (confirmDelete) await remove.mutateAsync(confirmDelete); }}
      />
    </div>
  );
}

interface RuleForm {
  kind: NotificationKind;
  name: string;
  description: string;
  is_active: boolean;
  channel_in_app: boolean;
  channel_email: boolean;
  channel_whatsapp: boolean;
  channel_push: boolean;
  target_role: string;
  target_user_id: string;
  min_severity: NotificationSeverity;
}

function CreateRuleModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}): JSX.Element {
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => listUsers(1, 500) });

  const {
    register, handleSubmit, reset, watch,
    formState: { errors },
  } = useForm<RuleForm>({
    defaultValues: {
      kind: 'low_stock',
      name: '',
      description: '',
      is_active: true,
      channel_in_app: true,
      channel_email: false,
      channel_whatsapp: false,
      channel_push: false,
      target_role: 'owner',
      target_user_id: '',
      min_severity: 'warning',
    },
  });

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const targetUserId = watch('target_user_id');

  async function onSubmit(values: RuleForm): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      const channels: NotificationChannel[] = [];
      if (values.channel_in_app) channels.push('in_app');
      if (values.channel_email) channels.push('email');
      if (values.channel_whatsapp) channels.push('whatsapp');
      if (values.channel_push) channels.push('push');

      const body: NotificationRuleCreate = {
        kind: values.kind,
        name: values.name.trim(),
        description: values.description.trim() || null,
        is_active: values.is_active,
        channels,
        min_severity: values.min_severity,
      };
      if (values.target_user_id) {
        body.target_user_id = values.target_user_id;
      } else if (values.target_role) {
        body.target_role = values.target_role;
      }
      await createRule(body);
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create rule.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="New notification rule" size="lg">
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <Input
          label="Rule name"
          hint="What triggers this — e.g. 'Owner low-stock alerts'"
          error={errors.name?.message}
          {...register('name', { required: 'Name is required' })}
        />
        <Textarea label="Description (optional)" rows={2} {...register('description')} />

        <div className="grid grid-cols-2 gap-4">
          <Select label="Fires on" options={KIND_OPTIONS} {...register('kind')} />
          <Select label="Minimum severity" options={SEVERITY_OPTIONS} {...register('min_severity')} />
        </div>

        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
            Channels
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-white/[0.02] p-3 text-sm text-slate-300 md:grid-cols-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="accent-cobalt-500" {...register('channel_in_app')} />
              In-app
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="accent-cobalt-500" {...register('channel_email')} />
              Email
            </label>
            <label className="flex items-center gap-2 text-slate-500">
              <input type="checkbox" className="accent-cobalt-500" {...register('channel_whatsapp')} />
              WhatsApp <span className="text-xs">(stub)</span>
            </label>
            <label className="flex items-center gap-2 text-slate-500">
              <input type="checkbox" className="accent-cobalt-500" {...register('channel_push')} />
              Push <span className="text-xs">(stub)</span>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Send to role"
            options={ROLE_OPTIONS}
            hint="Ignored if a specific user is picked below"
            {...register('target_role')}
          />
          <Select
            label="Or one user"
            placeholder="— None —"
            options={(usersQuery.data?.items ?? []).map((u) => ({
              label: u.full_name,
              value: u.id,
            }))}
            {...register('target_user_id')}
          />
        </div>

        {!targetUserId && !watch('target_role') && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Broadcast (no target) posts an in-app record visible to everyone but doesn't
            trigger email/WhatsApp/push. Pick a role or user to actually dispatch.
          </div>
        )}

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
