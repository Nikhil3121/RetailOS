import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  CheckCircle2,
  Mail,
  MessageCircle,
  Megaphone,
  Plus,
  Send,
  Smartphone,
  Users as UsersIcon,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { ApiError } from '@/lib/api';
import {
  CHANNEL_LABEL,
  SEGMENT_LABEL,
  createCampaign,
  listCampaigns,
  previewSegment,
  type CampaignChannel,
  type CampaignCreate,
  type CampaignSummary,
  type SegmentName,
} from '@/lib/campaigns-api';
import { cn } from '@/lib/cn';

const CHANNEL_OPTIONS = [
  { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
];

const SEGMENT_OPTIONS = (Object.keys(SEGMENT_LABEL) as SegmentName[]).map((v) => ({
  value: v,
  label: SEGMENT_LABEL[v],
}));

export function Campaigns(): JSX.Element {
  const qc = useQueryClient();
  const listQuery = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => listCampaigns(1, 200),
  });
  const [creating, setCreating] = useState(false);

  const rows = listQuery.data?.items ?? [];

  const totals = useMemo(() => {
    let sent = 0;
    let failed = 0;
    for (const r of rows) {
      sent += r.sent_count;
      failed += r.failed_count;
    }
    return { runs: rows.length, sent, failed };
  }, [rows]);

  const columns = useMemo<Column<CampaignSummary>[]>(
    () => [
      {
        key: 'title',
        header: 'Campaign',
        cell: (r) => (
          <div>
            <div className="text-sm font-medium text-white">{r.title}</div>
            <div className="text-[11px] text-slate-500">
              {new Date(r.created_at).toLocaleString()}
            </div>
          </div>
        ),
      },
      {
        key: 'channel',
        header: 'Channel',
        cell: (r) => (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white/[0.03] px-2 py-0.5 text-[11px] uppercase tracking-wider text-slate-300">
            {ChannelIcon(r.channel)}
            {CHANNEL_LABEL[r.channel]}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        cell: (r) => <StatusChip status={r.status} />,
      },
      {
        key: 'recipients',
        header: 'Recipients',
        align: 'right',
        cell: (r) => (
          <div className="text-right">
            <div className="font-mono text-sm text-slate-100">
              {r.total_recipients}
            </div>
            <div className="text-[10px] text-slate-500">
              <span className="text-emerald-300">{r.sent_count} sent</span>
              {r.failed_count > 0 && (
                <>
                  {' · '}
                  <span className="text-rose-300">{r.failed_count} failed</span>
                </>
              )}
            </div>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        description="Blast an SMS / WhatsApp / Email to a segment of customers. Dispatch is stubbed in dev — every recipient is written to the audit log so you can validate the fan-out."
        actions={
          <Button
            leadingIcon={<Plus className="h-4 w-4" />}
            onClick={() => setCreating(true)}
          >
            New campaign
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Tile label="Campaigns" value={String(totals.runs)} icon={Megaphone} />
        <Tile
          label="Total delivered"
          value={String(totals.sent)}
          icon={CheckCircle2}
          tone="emerald"
        />
        <Tile
          label="Total failed"
          value={String(totals.failed)}
          icon={XCircle}
          tone="rose"
        />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={listQuery.isLoading}
        error={
          listQuery.isError
            ? listQuery.error instanceof ApiError
              ? listQuery.error.message
              : 'Failed to load campaigns.'
            : null
        }
        onRetry={() => listQuery.refetch()}
        empty="No campaigns yet. Click New campaign to send your first."
      />

      <NewCampaignModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          qc.invalidateQueries({ queryKey: ['campaigns'] });
        }}
      />
    </div>
  );
}

function ChannelIcon(channel: CampaignChannel): JSX.Element {
  if (channel === 'whatsapp') return <MessageCircle className="h-3 w-3" />;
  if (channel === 'email') return <Mail className="h-3 w-3" />;
  return <Smartphone className="h-3 w-3" />;
}

function StatusChip({ status }: { status: CampaignSummary['status'] }): JSX.Element {
  const cls =
    status === 'sent'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
      : status === 'sending'
        ? 'border-cobalt-500/40 bg-cobalt-500/10 text-cobalt-200'
        : status === 'failed'
          ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
          : 'border-border bg-white/[0.03] text-slate-300';
  return (
    <span
      className={cn(
        'rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
        cls,
      )}
    >
      {status}
    </span>
  );
}

function Tile({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'emerald' | 'rose';
}): JSX.Element {
  return (
    <GlassCard className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {label}
          </div>
          <div
            className={cn(
              'mt-1 font-mono text-2xl font-semibold',
              tone === 'emerald'
                ? 'text-emerald-200'
                : tone === 'rose'
                  ? 'text-rose-200'
                  : 'text-white',
            )}
          >
            {value}
          </div>
        </div>
        <span
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-lg border',
            tone === 'emerald'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
              : tone === 'rose'
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                : 'border-border bg-white/[0.03] text-slate-300',
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Compose modal
// ---------------------------------------------------------------------------

interface FormValues {
  title: string;
  channel: CampaignChannel;
  message_body: string;
  segment: SegmentName;
  spent_min: string;
  send_now: boolean;
}

function NewCampaignModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}): JSX.Element {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      title: '',
      channel: 'whatsapp',
      message_body: 'Hi {name}, ',
      segment: 'all',
      spent_min: '',
      send_now: true,
    },
  });

  const channel = watch('channel');
  const segment = watch('segment');
  const spentMin = watch('spent_min');
  const [error, setError] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ['segment-preview', channel, segment, spentMin],
    queryFn: () =>
      previewSegment({
        channel,
        segment,
        spent_min: segment === 'spent_min' && spentMin ? spentMin : undefined,
      }),
    enabled: open,
  });

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const body: CampaignCreate = {
        title: values.title.trim(),
        channel: values.channel,
        message_body: values.message_body,
        segment: {
          segment: values.segment,
          spent_min:
            values.segment === 'spent_min' && values.spent_min
              ? values.spent_min
              : null,
        },
        send_now: values.send_now,
      };
      return createCampaign(body);
    },
    onSuccess: () => {
      reset();
      onCreated();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Failed to create campaign.'),
  });

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New campaign"
      description="Pick a channel + a segment, write your message, hit Send. Recipients fan out and status is tracked per person."
      size="lg"
    >
      <form className="space-y-4" onSubmit={handleSubmit((v) => save.mutate(v))}>
        <Input
          label="Title (internal)"
          placeholder="e.g. Weekend Flash Sale"
          error={errors.title?.message}
          {...register('title', { required: 'Title is required' })}
        />

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Channel"
            options={CHANNEL_OPTIONS}
            {...register('channel', { required: true })}
          />
          <Select
            label="Segment"
            options={SEGMENT_OPTIONS}
            {...register('segment', { required: true })}
          />
        </div>

        {segment === 'spent_min' && (
          <Input
            label="Minimum lifetime spend (₹)"
            type="number"
            step="0.01"
            min="0"
            placeholder="1000.00"
            {...register('spent_min', {
              required: 'Amount is required for this segment',
            })}
          />
        )}

        <div className="rounded-xl border border-cobalt-500/30 bg-cobalt-500/10 px-3 py-2 text-sm text-cobalt-100">
          <div className="flex items-center gap-2">
            <UsersIcon className="h-4 w-4" />
            <span>
              {preview.isFetching
                ? 'Counting…'
                : preview.data
                  ? `${preview.data.recipient_count} recipient${preview.data.recipient_count === 1 ? '' : 's'} will get this`
                  : 'Preview unavailable'}
            </span>
          </div>
        </div>

        <Textarea
          label="Message"
          rows={5}
          hint="Placeholders: {name}, {phone}, {email}"
          error={errors.message_body?.message}
          {...register('message_body', {
            required: 'Message is required',
            maxLength: { value: 2000, message: 'Under 2000 chars' },
          })}
        />

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" className="accent-cobalt-500" {...register('send_now')} />
          Send immediately (uncheck to save as draft)
        </label>

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={save.isPending}
            disabled={preview.data?.recipient_count === 0}
            leadingIcon={<Send className="h-4 w-4" />}
          >
            {watch('send_now') ? 'Send campaign' : 'Save draft'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
