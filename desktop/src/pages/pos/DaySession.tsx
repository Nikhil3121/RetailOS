import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { DoorClosed, DoorOpen, Wallet } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError } from '@/lib/api';
import {
  closeSession,
  currentSession,
  openSession,
  sessionSummary,
} from '@/lib/day-sessions-api';
import { listStores } from '@/lib/stores-api';

const LAST_STORE_KEY = 'retailos.pos.last_store_id';

export function DaySessionPage(): JSX.Element {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  // DaySessionGate stashes the path it redirected FROM in location.state
  // so we can bounce the user back once the shift opens. Defaults to
  // /dashboard when the user landed here directly.
  const returnTo =
    (location.state as { returnTo?: string } | null)?.returnTo ?? '/dashboard';

  const [storeId, setStoreId] = useState<string>(
    () => localStorage.getItem(LAST_STORE_KEY) ?? '',
  );
  useEffect(() => {
    if (storeId) localStorage.setItem(LAST_STORE_KEY, storeId);
  }, [storeId]);

  const storesQuery = useQuery({ queryKey: ['stores'], queryFn: () => listStores(1, 200) });
  const sessionQuery = useQuery({
    queryKey: ['day-session', 'current', storeId],
    queryFn: () => currentSession(storeId),
    enabled: !!storeId,
  });

  const summaryQuery = useQuery({
    queryKey: ['day-session', 'summary', sessionQuery.data?.id],
    queryFn: () => sessionSummary(sessionQuery.data!.id),
    enabled: !!sessionQuery.data,
  });

  const isOpen = sessionQuery.data?.status === 'open';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Day session"
        description="Open a shift with your starting cash. Close it when done to reconcile cash on hand."
      />

      <GlassCard className="p-4">
        <Select
          label="Store"
          placeholder="— Select store —"
          options={(storesQuery.data?.items ?? []).map((s) => ({
            label: `${s.code} · ${s.name}`, value: s.id,
          }))}
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
        />
      </GlassCard>

      {!storeId && (
        <div className="rounded-xl border border-border bg-white/[0.02] px-3 py-2 text-sm text-slate-400">
          Choose a store to see or manage its session.
        </div>
      )}

      {storeId && sessionQuery.isLoading && (
        <div className="text-sm text-slate-500">Checking session…</div>
      )}

      {storeId && !sessionQuery.isLoading && !isOpen && (
        <OpenSessionCard
          storeId={storeId}
          onOpened={(session) => {
            // Seed the "current session" cache with the freshly-opened
            // record BEFORE navigating. DaySessionGate on the target
            // page reads this same query key; without the pre-seed it
            // would still see the stale "no session" data and bounce
            // the user right back to /day-session.
            qc.setQueryData(
              ['day-session', 'current', storeId],
              session,
            );
            navigate(returnTo, { replace: true });
          }}
        />
      )}

      {storeId && isOpen && sessionQuery.data && (
        <CloseSessionCard
          sessionId={sessionQuery.data.id}
          openedAt={sessionQuery.data.opened_at}
          openingCash={sessionQuery.data.opening_cash}
          summary={summaryQuery.data}
          onClosed={() => {
            qc.invalidateQueries({ queryKey: ['day-session'] });
          }}
        />
      )}
    </div>
  );
}

function OpenSessionCard({
  storeId, onOpened,
}: {
  storeId: string;
  /** Called after the shift opens, receives the fresh session so the caller
   *  can seed the query cache before navigating away — otherwise a
   *  DaySessionGate on the destination page would still see the stale
   *  "closed" cache and bounce the user right back here. */
  onOpened: (session: import('@/lib/day-sessions-api').DaySession) => void;
}): JSX.Element {
  const {
    register, handleSubmit, reset,
    formState: { errors },
  } = useForm<{ opening_cash: string; notes: string }>({
    defaultValues: { opening_cash: '0.00', notes: '' },
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(values: { opening_cash: string; notes: string }): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      const session = await openSession({
        store_id: storeId,
        opening_cash: values.opening_cash,
        notes: values.notes.trim() || null,
      });
      reset();
      onOpened(session);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to open session.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <GlassCard>
      <div className="flex items-center gap-2 text-lg font-semibold text-white">
        <DoorOpen className="h-5 w-5 text-emerald-300" />
        Open a new day session
      </div>
      <p className="mt-1 text-sm text-slate-400">
        Enter your opening cash (float in the drawer). This becomes the baseline for cash reconciliation at close.
      </p>
      <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <Input
          label="Opening cash"
          type="number"
          step="0.01"
          min="0"
          error={errors.opening_cash?.message}
          {...register('opening_cash', { required: 'Enter the opening cash amount' })}
        />
        <Textarea label="Notes (optional)" rows={2} {...register('notes')} />

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}
        <div className="flex justify-end">
          <Button type="submit" loading={submitting} leadingIcon={<DoorOpen className="h-4 w-4" />}>
            Open session
          </Button>
        </div>
      </form>
    </GlassCard>
  );
}

interface CloseCardProps {
  sessionId: string;
  openedAt: string;
  openingCash: string;
  summary: import('@/lib/day-sessions-api').DaySessionSummary | undefined;
  onClosed: () => void;
}

function CloseSessionCard({
  sessionId, openedAt, openingCash, summary, onClosed,
}: CloseCardProps): JSX.Element {
  const {
    register, handleSubmit, watch, reset,
    formState: { errors },
  } = useForm<{ counted_cash: string; notes: string }>({
    defaultValues: { counted_cash: '0.00', notes: '' },
  });
  useEffect(() => {
    if (summary) reset({ counted_cash: summary.expected_cash, notes: '' });
  }, [summary, reset]);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const counted = Number(watch('counted_cash') || '0') || 0;
  const expected = Number(summary?.expected_cash ?? openingCash) || 0;
  const diff = counted - expected;

  async function onSubmit(values: { counted_cash: string; notes: string }): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      await closeSession(sessionId, {
        counted_cash: values.counted_cash,
        notes: values.notes.trim() || null,
      });
      onClosed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to close session.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <GlassCard>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-lg font-semibold text-white">
              <DoorOpen className="h-5 w-5 text-emerald-300" />
              Session is open
            </div>
            <p className="mt-1 text-xs text-slate-400">Opened {new Date(openedAt).toLocaleString()}</p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-slate-500">Opening cash</div>
            <div className="font-mono text-lg text-white">₹{openingCash}</div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Sales" value={summary ? String(summary.sales_count) : '—'} />
          <Stat label="Cash sales" value={summary ? `₹${summary.cash_sales_total}` : '—'} />
          <Stat label="Card sales" value={summary ? `₹${summary.card_sales_total}` : '—'} />
          <Stat label="UPI sales" value={summary ? `₹${summary.upi_sales_total}` : '—'} />
        </div>
      </GlassCard>

      <GlassCard>
        <div className="flex items-center gap-2 text-lg font-semibold text-white">
          <DoorClosed className="h-5 w-5 text-cobalt-300" />
          Close and reconcile
        </div>
        <p className="mt-1 text-sm text-slate-400">
          Count the cash in the drawer and enter the total. We'll compare it to the expected amount and record any difference.
        </p>

        <form className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-4">
            <Input
              label="Counted cash"
              type="number"
              step="0.01"
              min="0"
              leadingIcon={<Wallet className="h-4 w-4" />}
              error={errors.counted_cash?.message}
              {...register('counted_cash', { required: 'Enter counted cash' })}
            />
            <Textarea label="Notes (optional)" rows={3} {...register('notes')} />
            {error && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {error}
              </div>
            )}
            <Button type="submit" loading={submitting} leadingIcon={<DoorClosed className="h-4 w-4" />}>
              Close session
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-white/[0.02] p-4 text-sm">
            <Row label="Opening cash" value={`₹${openingCash}`} />
            <Row label="Cash taken during shift" value={summary ? `₹${summary.cash_sales_total}` : '—'} />
            <div className="my-2 border-t border-border/70" />
            <Row label="Expected in drawer" value={`₹${expected.toFixed(2)}`} strong />
            <Row label="Counted in drawer" value={`₹${counted.toFixed(2)}`} strong />
            <div className="my-2 border-t border-border/70" />
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Difference</span>
              <span
                className={`font-mono text-lg font-semibold ${
                  diff === 0
                    ? 'text-emerald-300'
                    : diff > 0
                      ? 'text-cobalt-300'
                      : 'text-rose-300'
                }`}
              >
                {diff >= 0 ? '+' : ''}₹{diff.toFixed(2)}
              </span>
            </div>
          </div>
        </form>
      </GlassCard>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-white/[0.02] px-3 py-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-lg text-white">{value}</div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }): JSX.Element {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={strong ? 'text-slate-200' : 'text-slate-500'}>{label}</span>
      <span className={`font-mono ${strong ? 'text-slate-100' : 'text-slate-300'}`}>{value}</span>
    </div>
  );
}
