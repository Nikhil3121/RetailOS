/**
 * The customer's points, at the till.
 *
 * Read-only. The cashier's job here is to be able to ANSWER "how many points do
 * I have?" without leaving the bill — a question asked constantly at a counter
 * and, until now, unanswerable without abandoning the cart.
 *
 * It renders nothing at all when there is no customer, no program, or no
 * balance. A row reading "0 points" beside every walk-in would be permanent
 * clutter on the one screen that has to stay quiet.
 */

import { useQuery } from '@tanstack/react-query';
import { Award } from 'lucide-react';

import { formatMoney } from '@/lib/money';
import { getBalance, getProgram } from '@/lib/loyalty-api';

export function LoyaltyChip({ customerId }: { customerId: string }): JSX.Element | null {
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

  if (!customerId || !programQuery.data) return null;
  // Deliberately silent on failure. A points figure is a courtesy; an error
  // banner between the customer picker and the cart would interrupt billing
  // over something that does not affect the bill.
  if (balanceQuery.isError || !balanceQuery.data) return null;

  const points = Number(balanceQuery.data.points_balance);
  if (points <= 0) return null;

  const worth = points * Number(programQuery.data.redemption_rate);
  const tier = balanceQuery.data.tier;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-xs">
      <Award className="h-4 w-4 shrink-0 text-amber-400" />
      <span className="text-amber-200">
        <span className="money font-semibold">{points.toLocaleString('en-IN')}</span> points
        <span className="text-amber-200/70"> · worth {formatMoney(String(worth))}</span>
      </span>
      {tier && (
        <span className="ml-auto shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">
          {tier.name}
        </span>
      )}
    </div>
  );
}
