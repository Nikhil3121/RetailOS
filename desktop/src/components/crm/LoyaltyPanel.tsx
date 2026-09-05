/**
 * A customer's reward points: the balance, the tier, and why.
 *
 * The statement is not a nice-to-have here. Points are money the shop owes,
 * and the question a customer actually asks at the counter is never "what is my
 * balance" — the screen already says that — it is "why is it that". A running
 * total cannot answer it; a list of movements each carrying the balance it
 * produced can, and that is what makes an argument at the till end quickly.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Gift, History, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import {
  getBalance,
  getProgram,
  getStatement,
  redeem,
  type LoyaltyEntry,
  type LoyaltyKind,
} from '@/lib/loyalty-api';

/** How each movement reads to a person, and which way it went. */
const KIND_LABEL: Record<LoyaltyKind, string> = {
  earn: 'Earned',
  redeem: 'Redeemed',
  reversal: 'Returned',
  adjustment: 'Adjusted',
  expiry: 'Expired',
};

export function LoyaltyPanel({ customerId }: { customerId: string }): JSX.Element {
  const queryClient = useQueryClient();
  const [points, setPoints] = useState('');
  const [error, setError] = useState<string | null>(null);

  const programQuery = useQuery({ queryKey: ['loyalty-program'], queryFn: getProgram });
  const balanceQuery = useQuery({
    queryKey: ['loyalty-balance', customerId],
    queryFn: () => getBalance(customerId),
  });
  const statementQuery = useQuery({
    queryKey: ['loyalty-statement', customerId],
    queryFn: () => getStatement(customerId, 50),
  });

  const spend = useMutation({
    mutationFn: () => redeem(customerId, points),
    onSuccess: () => {
      setPoints('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['loyalty-balance', customerId] });
      void queryClient.invalidateQueries({ queryKey: ['loyalty-statement', customerId] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not redeem those points.'),
  });

  // A failed request must never render as an empty state. "No points yet" and
  // "we could not reach the server" are different facts, and showing the first
  // when the second is true is how someone concludes a balance is gone.
  if (balanceQuery.isError || programQuery.isError) {
    const err = balanceQuery.error ?? programQuery.error;
    return (
      <GlassCard>
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {err instanceof ApiError ? err.message : 'Could not load reward points.'}
        </div>
      </GlassCard>
    );
  }

  if (programQuery.isLoading || balanceQuery.isLoading) {
    return (
      <GlassCard>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading reward points…
        </div>
      </GlassCard>
    );
  }

  const program = programQuery.data;
  const balance = balanceQuery.data;

  if (!program) {
    return (
      <GlassCard>
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <Award className="h-5 w-5 text-slate-600" />
          <span>
            No rewards program is set up. An owner can create one under
            {' '}<span className="text-slate-300">CRM → Loyalty</span>.
          </span>
        </div>
      </GlassCard>
    );
  }

  const held = Number(balance?.points_balance ?? 0);
  const worth = held * Number(program.redemption_rate);
  const entered = Number(points || 0);
  const enteredWorth = entered * Number(program.redemption_rate);

  return (
    <GlassCard>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-amber-700 text-white">
            <Award className="h-6 w-6" />
          </div>
          <div>
            <div className="text-[13px] text-slate-400">Reward points</div>
            <div className="money text-2xl font-semibold text-white">
              {held.toLocaleString('en-IN')}
            </div>
            {/* The rupee value is the number a customer actually cares about;
                "1,000 points" means nothing without it. */}
            <div className="text-xs text-slate-500">
              worth {formatMoney(String(worth))}
            </div>
          </div>
        </div>

        {balance?.tier && (
          <div
            className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300"
            title={`Reached at ${formatMoney(balance.tier.min_lifetime_spend)} lifetime spend`}
          >
            {balance.tier.name} member · {balance.tier.points_multiplier}× points
          </div>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Figure label="Lifetime spend" value={formatMoney(balance?.lifetime_spend)} />
        <Figure label="Total earned" value={Number(balance?.lifetime_earned ?? 0).toLocaleString('en-IN')} />
        <Figure label="Total redeemed" value={Number(balance?.lifetime_redeemed ?? 0).toLocaleString('en-IN')} />
      </dl>

      {/* ---- redeem ---- */}
      <form
        className="mt-5 border-t border-border pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (entered > 0) spend.mutate();
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Input
              label="Redeem points"
              inputMode="numeric"
              value={points}
              onChange={(e) => setPoints(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="0"
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            leadingIcon={<Gift className="h-4 w-4" />}
            loading={spend.isPending}
            disabled={entered <= 0 || entered > held}
          >
            Redeem
          </Button>
          {entered > 0 && (
            <span className="pb-2 text-sm text-slate-400">
              = {formatMoney(String(enteredWorth))}
              {entered > held && (
                <span className="ml-2 text-rose-400">more than they hold</span>
              )}
            </span>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
          >
            {error}
          </div>
        )}

        {/* Said plainly rather than left for someone to discover at the till. */}
        <p className="mt-3 text-xs text-slate-500">
          Redeeming records the points as spent and their rupee value against this
          customer. It does not yet reduce a bill automatically — apply the amount
          as a line discount when billing.
        </p>
      </form>

      {/* ---- statement ---- */}
      <div className="mt-5 border-t border-border pt-4">
        <div className="mb-2 flex items-center gap-2 text-[13px] text-slate-400">
          <History className="h-4 w-4" /> Recent activity
        </div>

        {statementQuery.isError ? (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            Could not load the points history.
          </div>
        ) : statementQuery.data && statementQuery.data.length > 0 ? (
          <ul className="divide-y divide-border text-sm">
            {statementQuery.data.map((entry) => (
              <Row key={entry.id} entry={entry} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No points activity yet.</p>
        )}
      </div>
    </GlassCard>
  );
}

function Figure({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="money mt-0.5 text-sm font-medium text-slate-200">{value}</dd>
    </div>
  );
}

function Row({ entry }: { entry: LoyaltyEntry }): JSX.Element {
  const delta = Number(entry.points_delta);
  const up = delta > 0;
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-slate-200">{KIND_LABEL[entry.kind]}</div>
        {entry.reason && (
          <div className="truncate text-xs text-slate-500">{entry.reason}</div>
        )}
      </div>
      <div className="shrink-0 text-right">
        <div className={cn('money font-medium', up ? 'text-emerald-400' : 'text-slate-300')}>
          {up ? '+' : ''}{delta.toLocaleString('en-IN')}
        </div>
        <div className="text-xs text-slate-500">
          balance {Number(entry.points_balance_after).toLocaleString('en-IN')}
        </div>
      </div>
    </li>
  );
}
