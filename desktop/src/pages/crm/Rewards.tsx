/**
 * Gift schemes — "spend ₹1,000, get a water bottle".
 *
 * The ladder reads cheapest rung first, because that is the order a customer
 * climbs it and the order the counter staff will describe it in.
 *
 * The worked example under the form is the point of this screen. Nobody can
 * read "min bill 2000, gift Steel glass" and picture what it costs; the line
 * that says what a ₹2,000 bill will now hand over is what stops a scheme being
 * set up wrong and discovered a week later.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Pencil, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ConfirmWithPassword } from '@/components/ui/ConfirmWithPassword';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import { listStores, type Store } from '@/lib/stores-api';
import {
  createReward,
  deleteReward,
  giftsGiven,
  listRewards,
  updateReward,
  type RewardScheme,
  type RewardSchemeBody,
} from '@/lib/rewards-api';

export function Rewards(): JSX.Element {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<RewardScheme | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<RewardScheme | null>(null);

  const schemesQuery = useQuery({
    queryKey: ['rewards'],
    queryFn: () => listRewards({ includeInactive: true }),
  });
  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  const givenQuery = useQuery({ queryKey: ['rewards-given'], queryFn: () => giftsGiven({}) });

  const remove = useMutation({
    mutationFn: (s: RewardScheme) => deleteReward(s.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rewards'] });
      void qc.invalidateQueries({ queryKey: ['rewards-given'] });
    },
  });

  const toggle = useMutation({
    mutationFn: (s: RewardScheme) => updateReward(s.id, { is_active: !s.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rewards'] }),
  });

  const stores = storesQuery.data?.items ?? [];
  const storeName = (id: string | null): string =>
    id ? stores.find((s) => s.id === id)?.name ?? 'Unknown branch' : 'Both malls';

  // A failed request must never render as "no schemes yet". A manager who
  // reads that will set the whole ladder up again.
  if (schemesQuery.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Rewards" description="Free gifts on bill value." />
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {schemesQuery.error instanceof ApiError
            ? schemesQuery.error.message
            : 'Could not load the reward schemes.'}
        </div>
      </div>
    );
  }

  const schemes = schemesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rewards"
        description="Free gifts at a bill value — spend ₹1,000, get a water bottle. Separate from loyalty points."
        actions={
          <Button leadingIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Add reward
          </Button>
        }
      />

      <GlassCard>
        <h2 className="text-lg font-semibold text-white">The ladder</h2>
        <p className="mt-1 text-xs text-slate-500">
          A bill earns the highest rung it reaches — a ₹2,000 bill gets the ₹2,000 gift,
          not both.
        </p>

        {schemesQuery.isLoading ? (
          <p className="mt-4 text-sm text-slate-400">Loading…</p>
        ) : schemes.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            No rewards yet. Add one to start offering a gift at a bill value.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {schemes.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                <div
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                    s.is_active
                      ? 'bg-gradient-to-br from-amber-500 to-amber-700 text-white'
                      : 'bg-white/[0.04] text-slate-600',
                  )}
                >
                  <Gift className="h-5 w-5" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{s.gift_label}</span>
                    {!s.is_active && (
                      <span className="rounded-md border border-slate-600 px-2 py-0.5 text-xs text-slate-400">
                        Off
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">
                    {s.name} · {storeName(s.store_id)}
                    {(s.valid_from || s.valid_to) && (
                      <> · {s.valid_from ?? '…'} → {s.valid_to ?? '…'}</>
                    )}
                  </div>
                </div>

                <div className="money shrink-0 text-right text-sm text-slate-200">
                  on {formatMoney(s.min_bill_amount)}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)}
                          leadingIcon={<Pencil className="h-3.5 w-3.5" />}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate(s)}>
                    {s.is_active ? 'Turn off' : 'Turn on'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${s.name}`}
                    title="Delete permanently"
                    onClick={() => setConfirmDelete(s)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      <GlassCard>
        <h2 className="text-lg font-semibold text-white">What you have given away</h2>
        <p className="mt-1 text-xs text-slate-500">
          Counted from the bills themselves, so a cancelled bill drops out on its own.
        </p>

        {givenQuery.isError ? (
          <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            Could not load the giveaway figures.
          </div>
        ) : givenQuery.data && givenQuery.data.length > 0 ? (
          <ul className="mt-4 divide-y divide-border text-sm">
            {givenQuery.data.map((row) => (
              <li key={row.gift_label} className="flex items-center justify-between py-2">
                <span className="text-slate-200">{row.gift_label}</span>
                <span className="text-right">
                  <span className="money font-medium text-white">{row.times_given}</span>
                  <span className="ml-2 text-xs text-slate-500">
                    given · on {formatMoney(row.total_bill_value)} of bills
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-slate-500">Nothing given away yet.</p>
        )}
      </GlassCard>

      <RewardModal
        open={creating || Boolean(editing)}
        editing={editing}
        stores={stores}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          void qc.invalidateQueries({ queryKey: ['rewards'] });
        }}
      />

      <ConfirmWithPassword
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title={`Delete ${confirmDelete?.name ?? 'reward'}`}
        description={
          'Bills that already earned this gift keep it on their record, so your ' +
          'giveaway figures stay correct. Only the scheme itself is removed. ' +
          'If you just want to pause it for now, turn it off instead.'
        }
        confirmLabel="Delete permanently"
        onConfirm={async () => {
          if (confirmDelete) await remove.mutateAsync(confirmDelete);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function RewardModal({
  open,
  editing,
  stores,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: RewardScheme | null;
  stores: Store[];
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const isEdit = Boolean(editing);

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [gift, setGift] = useState('');
  const [storeId, setStoreId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const editingId = editing?.id;
  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(editing?.name ?? '');
    setAmount(editing?.min_bill_amount ?? '');
    setGift(editing?.gift_label ?? '');
    setStoreId(editing?.store_id ?? '');
    setFrom(editing?.valid_from ?? '');
    setTo(editing?.valid_to ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingId]);

  const save = useMutation({
    mutationFn: () => {
      const body: RewardSchemeBody = {
        name: name.trim(),
        min_bill_amount: amount.trim(),
        gift_label: gift.trim(),
        store_id: storeId || null,
        valid_from: from || null,
        valid_to: to || null,
      };
      return editing ? updateReward(editing.id, body) : createReward(body);
    },
    onSuccess: () => onSaved(),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not save the reward.'),
  });

  const ready = name.trim() && gift.trim() && Number(amount) > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${editing?.name}` : 'New reward'}
      description="Set a bill value and what the customer gets when they reach it."
      size="lg"
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) save.mutate();
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Scheme name"
            placeholder="Diwali Dhamaka"
            hint="For your own records — not printed on the bill"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="Gift"
            placeholder="Water bottle"
            hint="Printed on the bill exactly as typed"
            value={gift}
            onChange={(e) => setGift(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Input
            label="Bill value"
            inputMode="decimal"
            placeholder="1000"
            hint="Final amount the customer pays"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
          />
          <Select
            label="Branch"
            placeholder="— Both malls —"
            options={stores.map((s) => ({ label: `${s.code} · ${s.name}`, value: s.id }))}
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="From"
              type="date"
              hint="Optional"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Input
              label="To"
              type="date"
              hint="Optional"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>

        {/* The worked example. Nobody can read the fields above and picture
            what they cost; this says it in the shop's own words. */}
        {ready && (
          <div className="rounded-xl border border-border bg-white/[0.02] px-4 py-3 text-sm">
            <div className="text-[13px] text-slate-400">What this does</div>
            <div className="mt-1 text-slate-200">
              A bill of{' '}
              <span className="font-semibold text-white">{formatMoney(amount)}</span>{' '}
              or more gets a{' '}
              <span className="font-semibold text-white">{gift.trim()}</span> free
              {storeId ? ` at ${stores.find((s) => s.id === storeId)?.name}` : ' at both malls'}.
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
          >
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!ready}>
            {isEdit ? 'Save changes' : 'Create reward'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
