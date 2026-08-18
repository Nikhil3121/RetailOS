import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, ShieldCheck, UserCog } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/api';
import { createUser, deleteUser, listUsers, updateUser, type CreateUserBody } from '@/lib/users-api';
import { listStores } from '@/lib/stores-api';
import { useAuthStore } from '@/stores/auth-store';
import type { CurrentUser, UserRole } from '@/types/auth';
import { ROLE_LABEL } from '@/types/auth';

const ROLE_OPTIONS: { label: string; value: UserRole }[] = [
  { label: ROLE_LABEL.staff, value: 'staff' },
  { label: ROLE_LABEL.cashier, value: 'cashier' },
  { label: ROLE_LABEL.manager, value: 'manager' },
  { label: ROLE_LABEL.owner, value: 'owner' },
  { label: ROLE_LABEL.super_admin, value: 'super_admin' },
];

export function Users(): JSX.Element {
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();

  const usersQuery = useQuery({
    queryKey: ['users', 1, 50],
    queryFn: () => listUsers(1, 50),
  });

  const storesQuery = useQuery({
    queryKey: ['stores', 1, 100],
    queryFn: () => listStores(1, 100),
  });

  const currentUserId = useAuthStore((s) => s.user?.id);

  const toggleActive = useMutation({
    mutationFn: (u: CurrentUser) => updateUser(u.id, { is_active: !u.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const remove = useMutation({
    mutationFn: (u: CurrentUser) => deleteUser(u.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const columns = useMemo<Column<CurrentUser>[]>(
    () => [
      {
        key: 'name',
        header: 'Name',
        cell: (u) => (
          <div>
            <div className="font-medium text-white">{u.full_name}</div>
            <div className="text-xs text-slate-500">{u.email}</div>
          </div>
        ),
      },
      {
        key: 'role',
        header: 'Role',
        cell: (u) => <RoleBadge role={u.role} />,
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
        key: 'last_login',
        header: 'Last login',
        cell: (u) =>
          u.last_login_at ? new Date(u.last_login_at).toLocaleString() : <span className="text-slate-500">Never</span>,
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        cell: (u) => (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => toggleActive.mutate(u)}
              disabled={u.id === currentUserId}
            >
              {u.is_active ? 'Deactivate' : 'Activate'}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                if (window.confirm(`Delete ${u.email}? This cannot be undone.`)) {
                  remove.mutate(u);
                }
              }}
              disabled={u.id === currentUserId}
            >
              Delete
            </Button>
          </div>
        ),
      },
    ],
    [toggleActive, remove, currentUserId],
  );

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Users</h1>
          <p className="mt-1 text-sm text-slate-400">
            Manage the people who can sign into RetailOS and what they can do.
          </p>
        </div>
        <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
          New user
        </Button>
      </header>

      {usersQuery.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {usersQuery.error instanceof ApiError ? usersQuery.error.message : 'Failed to load users.'}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={usersQuery.data?.items ?? []}
        rowKey={(u) => u.id}
        empty={usersQuery.isLoading ? 'Loading…' : 'No users yet.'}
      />

      <CreateUserModal
        open={creating}
        onClose={() => setCreating(false)}
        stores={storesQuery.data?.items.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id })) ?? []}
        onCreated={() => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ['users'] });
        }}
      />
    </div>
  );
}

function RoleBadge({ role }: { role: UserRole }): JSX.Element {
  const tone: Record<UserRole, string> = {
    super_admin: 'border-cobalt-400/40 bg-cobalt-500/15 text-cobalt-200',
    owner: 'border-cobalt-500/30 bg-cobalt-600/10 text-cobalt-200',
    manager: 'border-aurora-500/30 bg-aurora-500/10 text-aurora-200',
    cashier: 'border-border bg-white/[0.03] text-slate-200',
    staff: 'border-border bg-white/[0.02] text-slate-300',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${tone[role]}`}>
      {role === 'super_admin' && <ShieldCheck className="h-3 w-3" />}
      {ROLE_LABEL[role]}
    </span>
  );
}

interface CreateUserFormValues extends CreateUserBody {}

function CreateUserModal({
  open,
  onClose,
  stores,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  stores: { label: string; value: string }[];
  onCreated: () => void;
}): JSX.Element {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateUserFormValues>({
    defaultValues: { email: '', full_name: '', password: '', role: 'cashier', is_active: true },
  });

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(values: CreateUserFormValues): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      await createUser({
        ...values,
        email: values.email.trim(),
        full_name: values.full_name.trim(),
        store_id: values.store_id || null,
      });
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create user.');
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
      title="New user"
      description="They'll receive their credentials from you — no email is dispatched yet."
      size="lg"
    >
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Full name"
            leadingIcon={<UserCog className="h-4 w-4" />}
            error={errors.full_name?.message}
            {...register('full_name', { required: 'Full name is required' })}
          />
          <Input
            label="Email"
            type="email"
            error={errors.email?.message}
            {...register('email', {
              required: 'Email is required',
              pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email' },
            })}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Select label="Role" options={ROLE_OPTIONS} {...register('role', { required: true })} />
          <Select
            label="Store"
            placeholder="—"
            options={stores}
            {...register('store_id')}
          />
        </div>
        <Input
          label="Initial password"
          type="password"
          hint="Minimum 8 characters. The user should change it after first sign-in."
          error={errors.password?.message}
          {...register('password', {
            required: 'Password is required',
            minLength: { value: 8, message: 'Use at least 8 characters' },
          })}
        />

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
            Create user
          </Button>
        </div>
      </form>
    </Modal>
  );
}
