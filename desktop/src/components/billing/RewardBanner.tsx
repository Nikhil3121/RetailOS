/**
 * The gift line on the billing screen.
 *
 * Two states, and the SECOND one is the one that earns money:
 *
 *   earned   "Water bottle unlocked" — confirmation, so the cashier remembers
 *            to actually hand it over.
 *   next     "₹180 more for a steel glass" — said out loud while the customer
 *            can still add something.
 *
 * An unlock message on its own arrives after the money is committed and cannot
 * change anything. The gap is the whole commercial point of the scheme, so it
 * is shown at least as prominently.
 *
 * Renders nothing when no scheme applies, so a shop that runs no offers sees
 * no permanent empty box on the one screen that has to stay quiet.
 */

import { useQuery } from '@tanstack/react-query';
import { Gift, TrendingUp } from 'lucide-react';

import { formatMoney } from '@/lib/money';
import { previewReward } from '@/lib/rewards-api';

export function RewardBanner({
  storeId,
  amount,
}: {
  storeId: string;
  /** The bill total so far, as a decimal string. */
  amount: string;
}): JSX.Element | null {
  const query = useQuery({
    queryKey: ['reward-preview', storeId, amount],
    queryFn: () => previewReward(storeId, amount),
    enabled: Boolean(storeId),
    // The ladder changes a few times a year; the cart changes constantly.
    // Caching by amount means scrolling back and forth over a threshold does
    // not re-hit the server.
    staleTime: 60_000,
  });

  // Deliberately silent on failure. A gift prompt is a courtesy; an error
  // banner in the middle of billing would interrupt a sale over something
  // that does not affect the bill.
  if (!storeId || query.isError || !query.data) return null;

  const { earned, next_scheme: next, amount_to_next: gap } = query.data;
  if (!earned && !next) return null;

  return (
    <div className="space-y-2">
      {earned && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
          <Gift className="h-4 w-4 shrink-0 text-emerald-400" />
          <span className="text-emerald-200">
            <span className="font-semibold">{earned.gift_label}</span> unlocked — remember
            to hand it over
          </span>
        </div>
      )}

      {next && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-sm">
          <TrendingUp className="h-4 w-4 shrink-0 text-amber-400" />
          <span className="text-amber-200">
            <span className="money font-semibold">{formatMoney(gap)}</span> more for a{' '}
            <span className="font-semibold">{next.gift_label}</span>
          </span>
        </div>
      )}
    </div>
  );
}
