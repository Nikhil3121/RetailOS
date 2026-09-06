/**
 * The customer's points, at the till — and the control that spends them.
 *
 * Two jobs, deliberately in one place. The cashier has to be able to ANSWER
 * "how many points do I have?" without leaving the bill, and the customer's
 * very next sentence is "use them" — splitting those across two screens is
 * what made points decorative instead of usable.
 *
 * It renders nothing at all when there is no customer, no program, or no
 * balance. A row reading "0 points" beside every walk-in would be permanent
 * clutter on the one screen that has to stay quiet.
 *
 * WHAT THIS COMPONENT DOES NOT DO
 * It never redeems. It reports how many points the operator chose, and the
 * SALE carries them — the server debits the ledger and applies the discount
 * inside the same transaction that writes the bill. Redeeming from here would
 * open a window where the points are gone and the bill was never saved.
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Award } from 'lucide-react';

import { formatMoney } from '@/lib/money';
import { getBalance, getProgram } from '@/lib/loyalty-api';

interface LoyaltyChipProps {
  customerId: string;
  /**
   * The bill total the points are being spent against, in rupees as a string.
   * Points may not exceed it — the server refuses, and a cashier should find
   * that out while typing, not at save.
   */
  billTotal?: string;
  /** Points the operator wants to spend. Owned by the billing screen. */
  redeemPoints?: number;
  /**
   * Reports the points AND what they are worth in rupees. The rupee figure
   * comes back with them because only this component holds the program's
   * redemption rate, and the till has to show a payable that already has the
   * redemption taken off.
   */
  onRedeemChange?: (points: number, value: number) => void;
}

export function LoyaltyChip({
  customerId,
  billTotal,
  redeemPoints = 0,
  onRedeemChange,
}: LoyaltyChipProps): JSX.Element | null {
  const programQuery = useQuery({
    queryKey: ['loyalty-program'],
    queryFn: getProgram,
    // The rates change perhaps twice a year. Re-fetching them per bill would be
    // a request on the critical path of every sale for no benefit.
    staleTime: 5 * 60_000,
  });

  const balanceQuery = useQuery({
    queryKey: ['loyalty-balance', customerId],
    queryFn: () => getBalance(customerId),
    enabled: Boolean(customerId),
  });

  // A customer swap must not carry the previous customer's redemption over.
  // Left unguarded this is a real loss: the points of whoever was on the bill
  // a moment ago get taken off the new person's total.
  useEffect(() => {
    onRedeemChange?.(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const [open, setOpen] = useState(false);

  if (!customerId || !programQuery.data) return null;
  // Deliberately silent on failure. A points figure is a courtesy; an error
  // banner between the customer picker and the cart would interrupt billing
  // over something that does not affect the bill.
  if (balanceQuery.isError || !balanceQuery.data) return null;

  const points = Number(balanceQuery.data.points_balance);
  if (points <= 0) return null;

  const rate = Number(programQuery.data.redemption_rate);
  const worth = points * rate;
  const tier = balanceQuery.data.tier;
  const canRedeem = typeof onRedeemChange === 'function' && rate > 0;

  /**
   * The most points this bill can absorb.
   *
   * Capped by the balance AND by the bill: the server rejects points worth
   * more than the total, and finding that out at save — after the customer
   * has been told their points were used — is the worst moment for it.
   */
  const billValue = Number(billTotal ?? 0);
  const affordable =
    billValue > 0 ? Math.min(points, Math.floor(billValue / rate)) : points;

  const redeemValue = redeemPoints * rate;

  function setPoints(next: number): void {
    const clamped = Math.max(0, Math.min(affordable, Math.floor(next || 0)));
    onRedeemChange?.(clamped, clamped * rate);
  }

  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <Award className="h-4 w-4 shrink-0 text-amber-400" />
        <span className="text-amber-200">
          <span className="money font-semibold">{points.toLocaleString('en-IN')}</span> points
          <span className="text-amber-200/70"> · worth {formatMoney(String(worth))}</span>
        </span>
        {tier && (
          <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">
            {tier.name}
          </span>
        )}
        {canRedeem && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ml-auto shrink-0 rounded-md border border-amber-500/30 px-2 py-0.5 text-amber-200 hover:bg-amber-500/10"
          >
            {redeemPoints > 0 ? 'Change' : 'Use points'}
          </button>
        )}
      </div>

      {canRedeem && open && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-amber-500/20 pt-2">
          <label className="text-amber-200/80" htmlFor="redeem-points">
            Spend
          </label>
          <input
            id="redeem-points"
            type="number"
            min={0}
            max={affordable}
            value={redeemPoints || ''}
            placeholder="0"
            onChange={(e) => setPoints(Number(e.target.value))}
            className="money w-24 rounded-md border border-amber-500/30 bg-black/20 px-2 py-1 text-right text-amber-100 outline-none focus:border-amber-400"
          />
          <span className="text-amber-200/80">points</span>
          <button
            type="button"
            onClick={() => setPoints(affordable)}
            className="rounded-md border border-amber-500/30 px-2 py-1 text-amber-200 hover:bg-amber-500/10"
          >
            Max ({affordable.toLocaleString('en-IN')})
          </button>
          {redeemPoints > 0 && (
            <button
              type="button"
              onClick={() => setPoints(0)}
              className="rounded-md px-2 py-1 text-amber-200/70 hover:text-amber-100"
            >
              Clear
            </button>
          )}
          <span className="ml-auto text-amber-200">
            −{formatMoney(String(redeemValue))} off
          </span>
          {/* Says where the money lands. The invoice shows ONE discount figure,
              and a cashier who expects a separate "points" line would otherwise
              think the redemption was dropped. */}
          {redeemPoints > 0 && (
            <span className="w-full text-amber-200/60">
              Comes off as bill discount. Points are taken when the bill is saved.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
