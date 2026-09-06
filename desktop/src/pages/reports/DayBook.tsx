/**
 * The day book — what moved money today, and what the drawer should hold.
 *
 * Not the sales summary. That answers "what did we sell"; this answers "does
 * the cash in the drawer match what the software says should be there", which
 * is the question actually asked at closing time and the one that catches a
 * mistake while the person who made it is still in the building.
 *
 * CASH IS SEPARATED FROM TAKINGS THROUGHOUT
 * The drawer only ever holds cash. A day of card sales inflates takings and
 * changes the drawer by nothing, so the two figures are never shown as one.
 * The expected-cash panel is the point of the screen; the takings tiles are
 * context.
 *
 * A COUNT IS ENTERED HERE, NOT STORED
 * Typing what was counted shows the difference immediately. It is deliberately
 * not saved: closing a day session already records a counted figure, and a
 * second, quieter place to record cash would eventually disagree with it.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BookOpen, Wallet } from 'lucide-react';

import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { StatTile } from '@/components/ui/StatTile';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import { dayBook } from '@/lib/reports-api';
import { listStores } from '@/lib/stores-api';

const KIND_LABEL: Record<string, string> = {
  sale: 'Sale',
  return: 'Refund',
  collection: 'Collection',
  expense: 'Expense',
};

export function DayBook(): JSX.Element {
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [storeId, setStoreId] = useState('');
  const [counted, setCounted] = useState('');

  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  const stores = storesQuery.data?.items ?? [];

  const query = useQuery({
    queryKey: ['day-book', day, storeId],
    queryFn: () => dayBook({ day, store_id: storeId || undefined }),
  });
  const book = query.data;

  const expected = book?.expected_cash === null ? null : Number(book?.expected_cash ?? 0);
  const countedNum = counted.trim() === '' ? null : Number(counted);
  const difference =
    expected !== null && countedNum !== null && Number.isFinite(countedNum)
      ? countedNum - expected
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Day book"
        description="Every money movement, and what the cash drawer should hold."
      />

      <GlassCard className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[180px]">
          <Input label="Day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        <div className="min-w-[220px] flex-1">
          <Select
            label="Branch"
            placeholder="— All branches —"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            options={stores.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))}
            hint="A drawer belongs to a branch — pick one to reconcile cash."
          />
        </div>
      </GlassCard>

      {query.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {query.error instanceof ApiError
            ? query.error.message
            : 'Could not load the day book.'}
        </div>
      )}

      {book && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Sales" value={formatMoney(book.sales_total)} />
            <StatTile label="Refunds" value={formatMoney(book.returns_total)} />
            <StatTile label="Expenses" value={formatMoney(book.expenses_total)} />
            <StatTile label="Net" value={formatMoney(book.net_total)} />
          </div>

          {/* The reconciliation. Given its own card and the most weight on the
              screen, because it is the reason anyone opens this page. */}
          <GlassCard className="space-y-4 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Wallet className="h-4 w-4" />
              Cash drawer
            </div>

            {book.expected_cash === null ? (
              // "Never opened" and "opened with zero" are different facts.
              // Inventing an opening figure would let a short drawer look
              // balanced, which is the one outcome this screen must not allow.
              <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {storeId
                    ? 'No day session was opened at this branch on this date, so there is no opening cash to reconcile against.'
                    : 'Pick a branch — cash belongs to one drawer, and a figure across both malls could not be counted against anything.'}
                </span>
              </div>
            ) : (
              <>
                <dl className="grid gap-3 sm:grid-cols-4">
                  <Figure label="Opened with" value={book.opening_cash} />
                  <Figure label="Cash in" value={book.cash_in} tone="up" />
                  <Figure label="Cash out" value={book.cash_out} tone="down" />
                  <Figure label="Should be in the drawer" value={book.expected_cash} strong />
                </dl>

                <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
                  <div className="w-40">
                    <Input
                      label="Counted"
                      value={counted}
                      onChange={(e) => setCounted(e.target.value)}
                      inputMode="decimal"
                      placeholder="0.00"
                    />
                  </div>
                  {difference !== null && (
                    <div
                      className={cn(
                        'rounded-lg border px-3 py-2 text-sm',
                        difference === 0
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : 'border-rose-500/30 bg-rose-500/10 text-rose-200',
                      )}
                    >
                      {difference === 0
                        ? 'Balanced.'
                        : `${difference > 0 ? 'Over' : 'Short'} by ${formatMoney(
                            String(Math.abs(difference)),
                          )}`}
                    </div>
                  )}
                  <p className="text-xs text-slate-500">
                    Typed here to check the figure. Closing the day session is
                    what records it.
                  </p>
                </div>
              </>
            )}
          </GlassCard>

          <GlassCard className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold text-slate-100">
              <BookOpen className="h-4 w-4" />
              Movements
              <span className="text-slate-500">({book.entries.length})</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Time</th>
                    <th className="px-4 py-2">What</th>
                    <th className="px-4 py-2">Reference</th>
                    <th className="px-4 py-2">Who</th>
                    <th className="px-4 py-2">Method</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {book.entries.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        Nothing moved on this day.
                      </td>
                    </tr>
                  ) : (
                    book.entries.map((e, i) => {
                      const amount = Number(e.amount);
                      return (
                        <tr key={`${e.reference}-${i}`}>
                          <td className="px-4 py-2 tabular-nums text-slate-400">
                            {new Date(e.at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="px-4 py-2 text-slate-300">
                            {KIND_LABEL[e.kind] ?? e.kind}
                          </td>
                          <td className="px-4 py-2 font-mono text-xs text-slate-300">
                            {e.reference}
                          </td>
                          <td className="px-4 py-2 text-slate-400">{e.party ?? '—'}</td>
                          <td className="px-4 py-2 text-slate-400">{e.method ?? 'On credit'}</td>
                          {/* Signed, and coloured by direction. Both printed as
                              positive would need a legend, and this is the one
                              report nobody can afford to misread at the end of
                              a long day. */}
                          <td
                            className={cn(
                              'px-4 py-2 text-right tabular-nums',
                              amount < 0 ? 'text-rose-300' : 'text-emerald-300',
                            )}
                          >
                            {amount < 0 ? '−' : '+'}
                            {formatMoney(String(Math.abs(amount)))}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string | null;
  tone?: 'up' | 'down';
  strong?: boolean;
}): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-slate-500">{label}</dt>
      <dd
        className={cn(
          'money mt-1 tabular-nums',
          strong ? 'text-lg font-semibold text-white' : 'text-sm text-slate-200',
          tone === 'up' && 'text-emerald-300',
          tone === 'down' && 'text-rose-300',
        )}
      >
        {value === null ? '—' : formatMoney(value)}
      </dd>
    </div>
  );
}
