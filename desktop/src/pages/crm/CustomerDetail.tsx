import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Cake,
  Mail,
  Phone,
  Receipt,
  Sparkles,
  Ticket,
  UserRound,
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { LoyaltyPanel } from '@/components/crm/LoyaltyPanel';
import { PageHeader } from '@/components/ui/PageHeader';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  customerTimeline,
  getCustomer,
  type TimelineEntry,
  type TimelineKind,
} from '@/lib/customers-api';

export function CustomerDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const customerQuery = useQuery({
    queryKey: ['customer', id],
    queryFn: () => getCustomer(id!),
    enabled: !!id,
  });
  const timelineQuery = useQuery({
    queryKey: ['customer-timeline', id],
    queryFn: () => customerTimeline(id!, 200),
    enabled: !!id,
  });

  const c = customerQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={c?.name ?? 'Customer'}
        description={c?.company_name || (c?.phone ?? '')}
        actions={
          <Button
            variant="ghost"
            leadingIcon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => navigate('/customers')}
          >
            Back
          </Button>
        }
      />

      {customerQuery.isError && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {customerQuery.error instanceof ApiError
            ? customerQuery.error.message
            : 'Failed to load customer.'}
        </div>
      )}

      <GlassCard>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cobalt-500 to-cobalt-800 text-white">
            <UserRound className="h-6 w-6" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-500">
              Profile
            </div>
            <div className="mt-1 text-xl font-semibold text-white">
              {c?.name ?? '—'}
            </div>
            {c?.company_name && (
              <div className="text-xs text-slate-400">{c.company_name}</div>
            )}
          </div>
        </div>
        <ul className="mt-5 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          {c?.phone && <Row icon={<Phone className="h-3.5 w-3.5" />} value={c.phone} />}
          {c?.email && <Row icon={<Mail className="h-3.5 w-3.5" />} value={c.email} />}
          {c?.gstin && (
            <Row icon={<Receipt className="h-3.5 w-3.5" />} value={c.gstin} />
          )}
          {c?.date_of_birth && (
            <Row icon={<Cake className="h-3.5 w-3.5" />} value={`DOB ${c.date_of_birth}`} />
          )}
          {c?.anniversary && (
            <Row
              icon={<Sparkles className="h-3.5 w-3.5" />}
              value={`Anniv ${c.anniversary}`}
            />
          )}
          {c && (c.city || c.state) && (
            <li className="flex items-center gap-2 text-slate-300">
              <span className="text-slate-500">📍</span>
              {[c.city, c.state, c.country].filter(Boolean).join(', ')}
            </li>
          )}
        </ul>
      </GlassCard>

      {id && <LoyaltyPanel customerId={id} />}

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Activity timeline
        </h2>
        <GlassCard className="p-0">
          {timelineQuery.isLoading && (
            <div className="p-6 text-sm text-slate-400">Loading…</div>
          )}
          {timelineQuery.data && timelineQuery.data.entries.length === 0 && (
            <div className="p-6 text-center text-sm text-slate-500">
              No activity yet.
            </div>
          )}
          <ol className="divide-y divide-border/60">
            {(timelineQuery.data?.entries ?? []).map((e, idx) => (
              <TimelineRow key={`${e.at}-${idx}`} entry={e} />
            ))}
          </ol>
        </GlassCard>
      </div>
    </div>
  );
}

function Row({ icon, value }: { icon: React.ReactNode; value: string }): JSX.Element {
  return (
    <li className="flex items-center gap-2 text-slate-300">
      <span className="text-slate-500">{icon}</span>
      {value}
    </li>
  );
}

const KIND_META: Record<TimelineKind, { icon: React.ReactNode; tone: string }> = {
  sale: {
    icon: <Receipt className="h-4 w-4" />,
    tone: 'border-cobalt-500/30 bg-cobalt-500/10 text-cobalt-200',
  },
  sale_voided: {
    icon: <Receipt className="h-4 w-4" />,
    tone: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  },
  coupon_redemption: {
    icon: <Ticket className="h-4 w-4" />,
    tone: 'border-aurora-500/30 bg-aurora-500/10 text-aurora-200',
  },
};

function TimelineRow({ entry }: { entry: TimelineEntry }): JSX.Element {
  const meta = KIND_META[entry.kind];
  return (
    <li className="flex items-start gap-4 px-4 py-3">
      <div
        className={cn(
          'mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border',
          meta.tone,
        )}
      >
        {meta.icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-white">
              {entry.title}
            </div>
            {entry.subtitle && (
              <div className="truncate text-xs text-slate-500">{entry.subtitle}</div>
            )}
          </div>
          {entry.amount && (
            <div className="shrink-0 font-mono text-sm text-slate-100">
              ₹{entry.amount}
            </div>
          )}
        </div>
        <div className="mt-1 text-xs uppercase tracking-wider text-slate-500">
          {new Date(entry.at).toLocaleString()}
          {entry.reference && <> · {entry.reference}</>}
        </div>
      </div>
    </li>
  );
}
