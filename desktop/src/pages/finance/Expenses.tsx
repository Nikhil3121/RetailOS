import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  CheckCircle2,
  ExternalLink,
  Plus,
  Send,
  Trash2,
  Wallet2,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  approveExpense,
  createExpense,
  deleteExpense,
  EXPENSE_STATUS_LABEL,
  listCategories,
  listExpenses,
  PAYMENT_METHODS,
  rejectExpense,
  submitExpense,
  type Expense,
  type ExpenseCreate,
  type ExpenseStatus,
} from '@/lib/expenses-api';
import { listStores } from '@/lib/stores-api';
import { useAuthStore } from '@/stores/auth-store';

const STATUS_TONE: Record<ExpenseStatus, string> = {
  draft: 'border-border bg-white/[0.03] text-slate-300',
  submitted: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  rejected: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
};

const STATUS_OPTIONS = [
  { label: 'Draft', value: 'draft' },
  { label: 'Awaiting approval', value: 'submitted' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
];

export function Expenses(): JSX.Element {
  const qc = useQueryClient();
  const hasMinRole = useAuthStore((s) => s.hasMinRole);
  const canApprove = hasMinRole('manager');

  const [creating, setCreating] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<Expense | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Expense | null>(null);

  const [status, setStatus] = useState<ExpenseStatus | ''>('');
  const [storeId, setStoreId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');

  const query = useQuery({
    queryKey: ['expenses', status, storeId, categoryId],
    queryFn: () =>
      listExpenses({
        status: status || undefined,
        store_id: storeId || undefined,
        category_id: categoryId || undefined,
        page_size: 300,
      }),
  });
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  const categoriesQuery = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => listCategories(1, 500, true),
  });

  const catName = (id: string): string =>
    categoriesQuery.data?.items.find((c) => c.id === id)?.name ?? '—';
  const storeCode = (id: string | null): string =>
    id
      ? storesQuery.data?.items.find((s) => s.id === id)?.code ?? '—'
      : 'Org-wide';

  const submit = useMutation({
    mutationFn: (e: Expense) => submitExpense(e.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
  const approve = useMutation({
    mutationFn: (e: Expense) => approveExpense(e.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });
  const remove = useMutation({
    mutationFn: (e: Expense) => deleteExpense(e.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  });

  const columns = useMemo<Column<Expense>[]>(
    () => [
      {
        key: 'number',
        header: 'Number',
        cell: (e) => <span className="font-mono text-xs text-slate-300">{e.number}</span>,
      },
      {
        key: 'category',
        header: 'Category',
        cell: (e) => (
          <div>
            <div className="text-white">{catName(e.category_id)}</div>
            <div className="text-xs text-slate-500">{storeCode(e.store_id)}</div>
          </div>
        ),
      },
      {
        key: 'vendor',
        header: 'Vendor / date',
        cell: (e) => (
          <div>
            <div className="text-slate-200">{e.vendor ?? <span className="text-slate-500">—</span>}</div>
            <div className="text-xs text-slate-500">{e.expense_date}</div>
          </div>
        ),
      },
      {
        key: 'amount',
        header: 'Amount',
        align: 'right',
        cell: (e) => (
          <div className="text-right">
            <div className="font-mono text-white">₹{e.grand_total}</div>
            {Number(e.tax_amount) > 0 && (
              <div className="text-[10px] text-slate-500">incl. ₹{e.tax_amount} tax</div>
            )}
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        cell: (e) => (
          <div>
            <span className={cn('rounded-full border px-2 py-0.5 text-xs', STATUS_TONE[e.status])}>
              {EXPENSE_STATUS_LABEL[e.status]}
            </span>
            {e.status === 'rejected' && e.reject_reason && (
              <div className="mt-1 text-[10px] text-rose-300">Reason: {e.reject_reason}</div>
            )}
          </div>
        ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        cell: (e) => (
          <div className="flex justify-end gap-2">
            {e.receipt_url && (
              <a
                href={e.receipt_url}
                target="_blank"
                rel="noreferrer"
                title="Open receipt"
                className="flex h-8 items-center gap-1 rounded-xl border border-border bg-white/[0.04] px-2 text-xs text-slate-300 hover:bg-white/[0.07]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {(e.status === 'draft' || e.status === 'rejected') && (
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Send className="h-3.5 w-3.5" />}
                onClick={() => submit.mutate(e)}
              >
                Submit
              </Button>
            )}
            {e.status === 'submitted' && canApprove && (
              <>
                <Button
                  size="sm"
                  leadingIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  onClick={() => approve.mutate(e)}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  leadingIcon={<XCircle className="h-3.5 w-3.5" />}
                  onClick={() => setRejectTarget(e)}
                >
                  Reject
                </Button>
              </>
            )}
            {(e.status === 'draft' || e.status === 'rejected') && (
              <Button
                size="sm"
                variant="danger"
                leadingIcon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => setConfirmDelete(e)}
              >
                Delete
              </Button>
            )}
          </div>
        ),
      },
    ],
    [catName, storeCode, submit, approve, canApprove],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Log operating expenses. Manager+ approves. Only approved expenses count against P&L."
        actions={
          <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New expense
          </Button>
        }
      />

      <div className="glass flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[180px]">
          <Select
            placeholder="— All statuses —"
            options={STATUS_OPTIONS}
            value={status}
            onChange={(e) => setStatus((e.target.value as ExpenseStatus) || '')}
          />
        </div>
        <div className="min-w-[200px] flex-1">
          <Select
            placeholder="— All stores —"
            options={(storesQuery.data?.items ?? []).map((s) => ({
              label: `${s.code} · ${s.name}`,
              value: s.id,
            }))}
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          />
        </div>
        <div className="min-w-[200px] flex-1">
          <Select
            placeholder="— All categories —"
            options={(categoriesQuery.data?.items ?? []).map((c) => ({
              label: `${c.code} · ${c.name}`,
              value: c.id,
            }))}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          />
        </div>
      </div>

      {query.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {query.error instanceof ApiError ? query.error.message : 'Failed to load expenses.'}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={query.data?.items ?? []}
        rowKey={(e) => e.id}
        empty={query.isLoading ? 'Loading…' : 'No expenses match those filters.'}
      />

      <CreateExpenseModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ['expenses'] });
        }}
      />

      <RejectModal
        target={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onRejected={() => {
          setRejectTarget(null);
          qc.invalidateQueries({ queryKey: ['expenses'] });
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete expense"
        description={`Delete ${confirmDelete?.number}? Only DRAFT or REJECTED expenses can be deleted.`}
        destructive
        confirmLabel="Delete"
        onConfirm={async () => { if (confirmDelete) await remove.mutateAsync(confirmDelete); }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create expense
// ---------------------------------------------------------------------------

function CreateExpenseModal({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}): JSX.Element {
  const {
    register, handleSubmit, reset,
    formState: { errors },
  } = useForm<ExpenseCreate>({
    defaultValues: {
      expense_date: new Date().toISOString().slice(0, 10),
      amount: '0.00',
      tax_amount: '0.00',
      payment_method: 'cash',
      submit: true,
    },
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const categoriesQuery = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => listCategories(1, 500, true),
  });
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });

  async function onSubmit(values: ExpenseCreate): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      await createExpense({
        ...values,
        store_id: values.store_id || null,
        vendor: values.vendor?.trim() || null,
        reference: values.reference?.trim() || null,
        receipt_url: values.receipt_url?.trim() || null,
        notes: values.notes?.trim() || null,
      });
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create expense.');
    } finally {
      setSubmitting(false);
    }
  }

  const categoryOptions = (categoriesQuery.data?.items ?? []).map((c) => ({
    label: `${c.code} · ${c.name}`,
    value: c.id,
  }));
  const noCategories = !categoriesQuery.isLoading && categoryOptions.length === 0;

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="New expense" size="lg">
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        {noCategories && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            No <strong>expense categories</strong> exist yet. Create one under
            Finance → Expense categories first (product categories are separate).
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Category"
            placeholder={
              categoriesQuery.isLoading
                ? 'Loading categories…'
                : noCategories
                  ? '— No expense categories —'
                  : '— Select category —'
            }
            options={categoryOptions}
            disabled={noCategories}
            error={errors.category_id?.message}
            {...register('category_id', { required: 'Category is required' })}
          />
          <Select
            label="Store (optional)"
            placeholder="— Org-wide —"
            options={(storesQuery.data?.items ?? []).map((s) => ({
              label: `${s.code} · ${s.name}`,
              value: s.id,
            }))}
            {...register('store_id')}
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Input
            label="Expense date"
            type="date"
            {...register('expense_date', { required: 'Date is required' })}
          />
          <Input
            label="Amount"
            type="number"
            step="0.01"
            min="0.01"
            error={errors.amount?.message}
            {...register('amount', { required: 'Amount is required' })}
          />
          <Input
            label="Tax amount"
            type="number"
            step="0.01"
            min="0"
            {...register('tax_amount')}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Select
            label="Payment method"
            options={PAYMENT_METHODS}
            {...register('payment_method')}
          />
          <Input label="Vendor" placeholder="Optional" {...register('vendor')} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input label="Reference / bill number" placeholder="Optional" {...register('reference')} />
          <Input label="Receipt URL" placeholder="https://…" {...register('receipt_url')} />
        </div>

        <Textarea label="Notes" rows={3} {...register('notes')} />

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" className="accent-cobalt-500" {...register('submit')} />
          Submit for approval immediately
        </label>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            loading={submitting}
            leadingIcon={<Wallet2 className="h-4 w-4" />}
          >
            Create expense
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Reject
// ---------------------------------------------------------------------------

function RejectModal({
  target, onClose, onRejected,
}: {
  target: Expense | null;
  onClose: () => void;
  onRejected: () => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(): Promise<void> {
    if (!target || !reason.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      await rejectExpense(target.id, reason.trim());
      setReason('');
      onRejected();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reject.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={Boolean(target)}
      onClose={() => { setReason(''); onClose(); }}
      title="Reject expense"
      description={target ? `Rejecting ${target.number}. Add a reason so the submitter knows what to fix.` : ''}
    >
      <div className="space-y-4">
        <Textarea
          label="Reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={submitting} disabled={!reason.trim()} onClick={submit}>
            Reject
          </Button>
        </div>
      </div>
    </Modal>
  );
}
