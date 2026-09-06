import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  BadgeCheck,
  Copy,
  IdCard,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserPlus,
  UserX,
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ConfirmWithPassword } from '@/components/ui/ConfirmWithPassword';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/api';
import { listStores } from '@/lib/stores-api';
import {
  createUser,
  deleteUser,
  listUsers,
  updateUser,
  type CreateUserBody,
  type UpdateUserBody,
} from '@/lib/users-api';
import { ROLE_LABEL, type CurrentUser, type UserRole } from '@/types/auth';
import { cn } from '@/lib/cn';

/** Deliberately permissive — the server is the authority on what it accepts. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STAFF_ROLES: { value: UserRole; label: string }[] = [
  { value: 'staff', label: 'Staff' },
  { value: 'cashier', label: 'Cashier' },
  { value: 'manager', label: 'Manager' },
];

/**
 * Staff Directory — the single screen for adding staff, seeing their auto-
 * generated staff codes, and toggling their active status. The staff_code is
 * what a cashier types at the register (Billing → Salesperson code) to credit
 * the sale to this staff member for commission + performance rollups.
 */
export function StaffDirectory(): JSX.Element {
  const qc = useQueryClient();
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => listUsers(1, 500) });
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });

  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CurrentUser | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<CurrentUser | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CurrentUser | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (usersQuery.data?.items ?? [])
      .filter((u) => u.role !== 'super_admin' && u.role !== 'owner')
      .filter((u) => {
        if (!q) return true;
        const hay = `${u.full_name} ${u.email} ${u.phone ?? ''} ${u.staff_code ?? ''}`.toLowerCase();
        return hay.includes(q);
      });
  }, [usersQuery.data, search]);

  const activeCount = rows.filter((u) => u.is_active).length;
  const inactiveCount = rows.length - activeCount;

  const deactivate = useMutation({
    mutationFn: (u: CurrentUser) => updateUser(u.id, { is_active: !u.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const remove = useMutation({
    mutationFn: (u: CurrentUser) => deleteUser(u.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const storeName = (id: string | null): string => {
    if (!id) return '—';
    return storesQuery.data?.items.find((s) => s.id === id)?.name ?? '—';
  };

  const copy = (text: string): void => {
    void navigator.clipboard.writeText(text).catch(() => {});
  };

  const columns = useMemo<Column<CurrentUser>[]>(
    () => [
      {
        key: 'code',
        header: 'Staff code',
        cell: (u) =>
          u.staff_code ? (
            <button
              type="button"
              onClick={() => copy(u.staff_code!)}
              className="group inline-flex items-center gap-2 rounded-md border border-cobalt-500/30 bg-cobalt-500/10 px-2 py-1 font-mono text-xs text-cobalt-100 hover:bg-cobalt-500/20"
              title="Click to copy"
            >
              <IdCard className="h-3 w-3" />
              {u.staff_code}
              <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ) : (
            <span className="text-xs text-slate-500">—</span>
          ),
      },
      {
        key: 'name',
        header: 'Name',
        cell: (u) => (
          <div>
            <div className="flex items-center gap-2 font-medium text-white">
              {u.full_name}
              {!u.is_active && (
                <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs uppercase tracking-wider text-rose-200">
                  Inactive
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500">{u.email}</div>
          </div>
        ),
      },
      {
        key: 'role',
        header: 'Role',
        cell: (u) => (
          <span className="rounded-md border border-border bg-white/[0.03] px-2 py-1 text-xs uppercase tracking-wider text-slate-300">
            {ROLE_LABEL[u.role]}
          </span>
        ),
      },
      {
        key: 'store',
        header: 'Store',
        cell: (u) => <span className="text-xs text-slate-300">{storeName(u.store_id)}</span>,
      },
      {
        key: 'phone',
        header: 'Phone',
        cell: (u) => (
          <span className="font-mono text-xs text-slate-300">{u.phone ?? '—'}</span>
        ),
      },
      {
        key: 'commission',
        header: 'Default %',
        align: 'right',
        cell: (u) =>
          u.commission_pct ? (
            <span className="font-mono text-xs text-slate-200">{u.commission_pct}%</span>
          ) : (
            <span className="text-xs text-slate-500">—</span>
          ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        cell: (u) => (
          <div className="flex items-center justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(u)}
              leadingIcon={<Pencil className="h-3.5 w-3.5" />}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant={u.is_active ? 'ghost' : 'secondary'}
              onClick={() => setConfirmDeactivate(u)}
              leadingIcon={u.is_active ? <UserX className="h-3.5 w-3.5" /> : <BadgeCheck className="h-3.5 w-3.5" />}
            >
              {u.is_active ? 'Deactivate' : 'Activate'}
            </Button>
            {/* Delete is last and icon-only. Deactivating is almost always the
                right action — it keeps the person's sales history intact —
                so the destructive one is present but not inviting. */}
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Delete ${u.full_name}`}
              title="Delete permanently"
              onClick={() => setConfirmDelete(u)}
            >
              <Trash2 className="h-3.5 w-3.5 text-rose-400" />
            </Button>
          </div>
        ),
      },
    ],
    [storesQuery.data],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff directory"
        description="Add staff, generate their staff code, and manage who can be credited on bills. Attribution flows through to Commissions and Staff Performance."
        actions={
          <Button leadingIcon={<UserPlus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Add staff
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <SummaryTile label="Total staff" value={String(rows.length)} tone="cobalt" />
        <SummaryTile label="Active" value={String(activeCount)} tone="emerald" />
        <SummaryTile label="Inactive" value={String(inactiveCount)} tone="rose" />
      </div>

      <GlassCard className="p-4">
        <Input
          leadingIcon={<Search className="h-4 w-4" />}
          placeholder="Search by name, email, phone, or staff code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </GlassCard>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(u) => u.id}
        loading={usersQuery.isLoading}
        error={
          usersQuery.isError
            ? usersQuery.error instanceof ApiError
              ? usersQuery.error.message
              : 'Failed to load staff.'
            : null
        }
        onRetry={() => usersQuery.refetch()}
        empty="No staff yet. Click Add staff to onboard your first cashier — the staff code is generated automatically."
      />

      <StaffModal
        open={creating || Boolean(editing)}
        editing={editing}
        stores={storesQuery.data?.items ?? []}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={(u, wasNew) => {
          setCreating(false);
          setEditing(null);
          qc.invalidateQueries({ queryKey: ['users'] });
          // Copy the freshly-issued code so it can go straight onto a printed
          // staff card. Only on create — re-copying on every edit would
          // silently overwrite whatever the user had on their clipboard.
          if (wasNew && u.staff_code) copy(u.staff_code);
        }}
      />

      <ConfirmWithPassword
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title={`Delete ${confirmDelete?.full_name ?? 'staff member'}`}
        description={
          'Their bills and the money on them are untouched — but every sale credited ' +
          'to them loses its salesperson, and their commission rules and targets are ' +
          'deleted with them. None of that can be recovered. ' +
          'Deactivating instead keeps the whole history and stops them logging in.'
        }
        confirmLabel="Delete permanently"
        onConfirm={async () => {
          if (confirmDelete) await remove.mutateAsync(confirmDelete);
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDeactivate)}
        onClose={() => setConfirmDeactivate(null)}
        title={confirmDeactivate?.is_active ? 'Deactivate staff' : 'Reactivate staff'}
        description={
          confirmDeactivate?.is_active
            ? `Deactivate ${confirmDeactivate?.full_name}? They can no longer log in or be credited on new bills. Their historical commission stays intact.`
            : `Reactivate ${confirmDeactivate?.full_name}? They'll be pickable on the Billing screen again.`
        }
        destructive={confirmDeactivate?.is_active ?? false}
        confirmLabel={confirmDeactivate?.is_active ? 'Deactivate' : 'Reactivate'}
        onConfirm={async () => {
          if (confirmDeactivate) await deactivate.mutateAsync(confirmDeactivate);
          setConfirmDeactivate(null);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'cobalt' | 'emerald' | 'rose';
}): JSX.Element {
  const cls =
    tone === 'cobalt'
      ? 'text-cobalt-200'
      : tone === 'emerald'
        ? 'text-emerald-200'
        : 'text-rose-200';
  return (
    <GlassCard className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className={cn('mt-1 font-mono text-2xl font-semibold', cls)}>{value}</div>
    </GlassCard>
  );
}

interface StaffFormValues {
  full_name: string;
  email: string;
  phone: string;
  role: UserRole;
  store_id: string;
  password: string;
  staff_code: string;
  commission_pct: string;
}

interface StoreLike {
  id: string;
  code: string;
  name: string;
}

/**
 * One form for adding and editing staff.
 *
 * Deliberately not two components. The fields are identical, and a duplicate
 * form is how "we added a field to Add but forgot Edit" happens — which on
 * this screen would mean a commission percentage that can be set once and
 * never corrected.
 *
 * Three things differ in edit mode:
 *   - The email is shown but locked. It is the login identity and the server
 *     does not accept a change to it, so an editable box would be a lie.
 *   - The password is optional and blank. Filling it resets the password and
 *     signs the person out everywhere; leaving it alone changes nothing.
 *   - The staff code is editable, because a badge gets reprinted.
 */
function StaffModal({
  open,
  editing,
  stores,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: CurrentUser | null;
  stores: StoreLike[];
  onClose: () => void;
  onSaved: (u: CurrentUser, wasNew: boolean) => void;
}): JSX.Element {
  const isEdit = Boolean(editing);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<StaffFormValues>({
    defaultValues: {
      full_name: '',
      email: '',
      phone: '',
      role: 'cashier',
      store_id: '',
      password: '',
      staff_code: '',
      commission_pct: '',
    },
  });

  const [error, setError] = useState<string | null>(null);
  const editingId = editing?.id;

  // Load the row being edited when the dialog opens. Keyed on the id so
  // switching straight from one staff member to another refills the form
  // instead of showing the previous person's details.
  useEffect(() => {
    if (!open) return;
    setError(null);
    reset({
      full_name: editing?.full_name ?? '',
      email: editing?.email ?? '',
      phone: editing?.phone ?? '',
      role: (editing?.role as UserRole) ?? 'cashier',
      store_id: editing?.store_id ?? '',
      password: '',
      staff_code: editing?.staff_code ?? '',
      commission_pct: editing?.commission_pct ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingId, reset]);

  const save = useMutation({
    mutationFn: (v: StaffFormValues) => {
      if (editing) {
        const body: UpdateUserBody = {
          full_name: v.full_name.trim(),
          role: v.role,
          store_id: v.store_id || null,
          phone: v.phone.trim() || null,
          staff_code: v.staff_code.trim().toUpperCase() || null,
          commission_pct: v.commission_pct.trim() || null,
        };
        // Only send a password when one was actually typed. Sending an empty
        // string would reset it to nothing on every ordinary edit.
        if (v.password.trim()) body.password = v.password;
        return updateUser(editing.id, body);
      }

      const body: CreateUserBody = {
        email: v.email.trim().toLowerCase(),
        full_name: v.full_name.trim(),
        role: v.role,
        password: v.password,
        store_id: v.store_id || null,
        is_active: true,
        phone: v.phone.trim() || null,
        staff_code: v.staff_code.trim().toUpperCase() || null,
        commission_pct: v.commission_pct.trim() || null,
      };
      return createUser(body);
    },
    onSuccess: (u) => {
      reset();
      onSaved(u, !isEdit);
    },
    onError: (err) => {
      setError(
        err instanceof ApiError
          ? err.message
          : `Failed to ${isEdit ? 'save' : 'create'} staff.`,
      );
    },
  });

  async function onSubmit(v: StaffFormValues): Promise<void> {
    setError(null);
    await save.mutateAsync(v);
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        setError(null);
        onClose();
      }}
      title={isEdit ? `Edit ${editing?.full_name}` : 'Add staff member'}
      description={
        isEdit
          ? 'Change their details, move them to another branch, or reset a forgotten password.'
          : 'A staff code (STF-####) is generated automatically. Copy it onto a name badge — cashiers type it at the register to credit sales to this person.'
      }
      size="lg"
    >
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Full name"
            error={errors.full_name?.message}
            {...register('full_name', { required: 'Name is required' })}
          />
          <Input
            label={isEdit ? 'Email (login) — cannot be changed' : 'Email (login)'}
            type="email"
            disabled={isEdit}
            error={errors.email?.message}
            {...register('email', {
              required: isEdit ? false : 'Email is required',
              pattern: isEdit
                ? undefined
                : { value: EMAIL_PATTERN, message: 'Enter a valid email' },
            })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input label="Phone (optional)" {...register('phone')} />
          <Input
            label={isEdit ? 'New password (leave blank to keep)' : 'Password'}
            type="password"
            autoComplete="new-password"
            hint={
              isEdit
                ? 'Setting one signs them out of every device.'
                : 'At least 8 characters. Staff can change it later.'
            }
            error={errors.password?.message}
            {...register('password', {
              required: isEdit ? false : 'Password is required',
              // In edit mode a blank box means "leave it alone", so the length
              // rule must not fire on an empty value.
              validate: (v) =>
                (isEdit && !v) || v.length >= 8 || 'At least 8 characters',
            })}
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Select label="Role" options={STAFF_ROLES} {...register('role', { required: true })} />
          <Select
            label="Assigned store (optional)"
            placeholder="— None —"
            hint="Blank means they can work in any branch"
            options={stores.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))}
            {...register('store_id')}
          />
          <Input
            label="Default commission %"
            type="number"
            step="0.01"
            min="0"
            max="100"
            placeholder="Optional"
            hint="Fallback when no rule matches"
            {...register('commission_pct')}
          />
        </div>

        <div>
          <Input
            label={isEdit ? 'Staff code' : 'Staff code (optional — auto if blank)'}
            placeholder="STF-0001"
            hint={
              isEdit
                ? 'Changing this changes what cashiers type at the register.'
                : 'Leave blank to auto-issue the next STF-#### code'
            }
            {...register('staff_code')}
          />
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
          >
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={save.isPending}
            leadingIcon={isEdit ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          >
            {isEdit ? 'Save changes' : 'Create staff'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
