/**
 * The rewards program: what a rupee earns, what a point is worth, and the tiers.
 *
 * Two rates, not one, because they are almost never the same number. A shop
 * grants a point per rupee and redeems four points to the rupee — that is a 25%
 * giveback, and a screen that offered a single "reward rate" would hide the
 * only figure that decides whether the scheme costs the shop money.
 *
 * The worked example below the fields is the point of this page. Nobody can
 * read "0.0100 points per rupee, redeemed at 0.2500" and know what a ₹1,000
 * bill gives away, so the page says it in rupees.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Plus } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { ApiError } from '@/lib/api';
import { formatMoney } from '@/lib/money';
import {
  createTier,
  getProgram,
  listTiers,
  saveProgram,
} from '@/lib/loyalty-api';

export function Loyalty(): JSX.Element {
  const queryClient = useQueryClient();
  const [addingTier, setAddingTier] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const programQuery = useQuery({ queryKey: ['loyalty-program'], queryFn: getProgram });
  const tiersQuery = useQuery({ queryKey: ['loyalty-tiers'], queryFn: listTiers });

  const [name, setName] = useState('Rewards');
  const [perRupee, setPerRupee] = useState('1.0000');
  const [rate, setRate] = useState('0.2500');
  const [expiryDays, setExpiryDays] = useState('365');

  // Seed the form from the server once it arrives. Without this the fields show
  // the defaults over a program that is already configured, and a manager who
  // pressed Save would silently reset their own rates.
  useEffect(() => {
    const p = programQuery.data;
    if (!p) return;
    setName(p.name);
    setPerRupee(p.points_per_rupee);
    setRate(p.redemption_rate);
    setExpiryDays(p.expiry_days === null ? '' : String(p.expiry_days));
  }, [programQuery.data]);

  const save = useMutation({
    mutationFn: () =>
      saveProgram({
        name,
        points_per_rupee: perRupee,
        redemption_rate: rate,
        expiry_days: expiryDays.trim() === '' ? null : Number(expiryDays),
        is_active: true,
      }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['loyalty-program'] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not save the program.'),
  });

  // A worked example on a round number, because the rates alone are unreadable.
  const sample = 1000;
  const pointsOn1000 = sample * Number(perRupee || 0);
  const valueOfThose = pointsOn1000 * Number(rate || 0);
  const givebackPct = sample > 0 ? (valueOfThose / sample) * 100 : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Loyalty"
        description="What customers earn, what it is worth, and the membership tiers."
      />

      {(programQuery.isError || tiersQuery.isError) && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {programQuery.error instanceof ApiError
            ? programQuery.error.message
            : 'Could not load the loyalty settings.'}
        </div>
      )}

      <GlassCard>
        <h2 className="text-lg font-semibold text-white">Earn and redeem rates</h2>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Input label="Program name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            label="Points per rupee"
            hint="0.01 = one point per ₹100"
            inputMode="decimal"
            value={perRupee}
            onChange={(e) => setPerRupee(e.target.value.replace(/[^\d.]/g, ''))}
          />
          <Input
            label="Rupees per point"
            hint="0.25 = four points to the rupee"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))}
          />
          <Input
            label="Points expire after (days)"
            hint="Leave blank so they never lapse"
            inputMode="numeric"
            value={expiryDays}
            onChange={(e) => setExpiryDays(e.target.value.replace(/[^\d]/g, ''))}
          />
        </div>

        <div className="mt-4 rounded-xl border border-border bg-white/[0.02] px-4 py-3 text-sm">
          <div className="text-[13px] text-slate-400">On a ₹1,000 bill</div>
          <div className="mt-1 text-slate-200">
            the customer earns{' '}
            <span className="font-semibold text-white">
              {pointsOn1000.toLocaleString('en-IN')} points
            </span>
            , worth{' '}
            <span className="font-semibold text-white">{formatMoney(String(valueOfThose))}</span>
            {' '}— a giveback of{' '}
            <span className="font-semibold text-white">{givebackPct.toFixed(1)}%</span>.
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
          >
            {error}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Save program
          </Button>
        </div>
      </GlassCard>

      <GlassCard>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Membership tiers</h2>
            <p className="mt-1 text-xs text-slate-500">
              Reached by lifetime spend. A tier multiplies what later bills earn.
            </p>
          </div>
          <Button
            variant="secondary"
            leadingIcon={<Plus className="h-4 w-4" />}
            onClick={() => setAddingTier(true)}
          >
            Add tier
          </Button>
        </div>

        {tiersQuery.data && tiersQuery.data.length > 0 ? (
          <ul className="mt-4 divide-y divide-border">
            {tiersQuery.data.map((tier) => (
              <li key={tier.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <Award className="h-4 w-4 text-amber-400" />
                  <div>
                    <div className="text-sm font-medium text-slate-100">{tier.name}</div>
                    <div className="text-xs text-slate-500">
                      from {formatMoney(tier.min_lifetime_spend)} lifetime spend
                    </div>
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="text-slate-200">{tier.points_multiplier}× points</div>
                  {Number(tier.default_discount_pct) > 0 && (
                    <div className="text-xs text-slate-500">
                      {tier.default_discount_pct}% standing discount
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          !tiersQuery.isError && (
            <p className="mt-4 text-sm text-slate-500">
              No tiers yet. Everyone earns at the base rate.
            </p>
          )
        )}
      </GlassCard>

      <TierModal open={addingTier} onClose={() => setAddingTier(false)} />
    </div>
  );
}

function TierModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [spend, setSpend] = useState('0.00');
  const [multiplier, setMultiplier] = useState('1.000');
  const [discount, setDiscount] = useState('0.00');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createTier({
        name,
        min_lifetime_spend: spend,
        points_multiplier: multiplier,
        default_discount_pct: discount,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['loyalty-tiers'] });
      setName('');
      setError(null);
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not create the tier.'),
  });

  return (
    <Modal open={open} onClose={onClose} title="New membership tier" size="lg">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Name" placeholder="Gold" value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            label="Reached at lifetime spend"
            inputMode="decimal"
            value={spend}
            onChange={(e) => setSpend(e.target.value.replace(/[^\d.]/g, ''))}
          />
          <Input
            label="Points multiplier"
            hint="2.0 = double points"
            inputMode="decimal"
            value={multiplier}
            onChange={(e) => setMultiplier(e.target.value.replace(/[^\d.]/g, ''))}
          />
          <Input
            label="Standing discount %"
            inputMode="decimal"
            value={discount}
            onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ''))}
          />
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
          >
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
            Create tier
          </Button>
        </div>
      </form>
    </Modal>
  );
}
