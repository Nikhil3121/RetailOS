import { apiRequest } from '@/lib/api';
import type { Paginated } from '@/lib/suppliers-api';

export type CampaignChannel = 'sms' | 'whatsapp' | 'email';
export type CampaignStatus = 'draft' | 'sending' | 'sent' | 'failed';
export type RecipientStatus = 'queued' | 'sent' | 'failed' | 'skipped';

export const CHANNEL_LABEL: Record<CampaignChannel, string> = {
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  email: 'Email',
};

export type SegmentName =
  | 'all'
  | 'active_30d'
  | 'active_90d'
  | 'birthday_month'
  | 'anniversary_month'
  | 'never_bought'
  | 'spent_min';

export const SEGMENT_LABEL: Record<SegmentName, string> = {
  all: 'All active customers',
  active_30d: 'Active in last 30 days',
  active_90d: 'Active in last 90 days',
  birthday_month: 'Birthday this month',
  anniversary_month: 'Anniversary this month',
  never_bought: 'Never bought',
  spent_min: 'Spent over ₹…',
};

export interface CampaignSummary {
  id: string;
  title: string;
  channel: CampaignChannel;
  status: CampaignStatus;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  sent_at: string | null;
  created_at: string;
}

export interface Campaign extends CampaignSummary {
  message_body: string;
  segment_json: Record<string, unknown>;
  scheduled_at: string | null;
  created_by_user_id: string | null;
  updated_at: string;
}

export interface CampaignRecipient {
  id: string;
  campaign_id: string;
  customer_id: string | null;
  phone: string | null;
  email: string | null;
  status: RecipientStatus;
  sent_at: string | null;
  error: string | null;
  created_at: string;
}

export interface CampaignCreate {
  title: string;
  channel: CampaignChannel;
  message_body: string;
  segment: {
    segment: SegmentName;
    spent_min?: string | null;
  };
  send_now: boolean;
}

export interface SegmentPreview {
  segment: SegmentName;
  spent_min: string | null;
  recipient_count: number;
}

export function listCampaigns(
  page = 1,
  pageSize = 100,
): Promise<Paginated<CampaignSummary>> {
  return apiRequest({
    path: `/campaigns?page=${page}&page_size=${pageSize}`,
    method: 'GET',
  });
}

export function getCampaign(id: string): Promise<Campaign> {
  return apiRequest({ path: `/campaigns/${id}`, method: 'GET' });
}

export function listRecipients(id: string): Promise<CampaignRecipient[]> {
  return apiRequest({
    path: `/campaigns/${id}/recipients`,
    method: 'GET',
  });
}

export function createCampaign(body: CampaignCreate): Promise<Campaign> {
  return apiRequest({ path: '/campaigns', method: 'POST', body });
}

export function sendCampaign(id: string): Promise<Campaign> {
  return apiRequest({ path: `/campaigns/${id}/send`, method: 'POST' });
}

export function previewSegment(params: {
  channel: CampaignChannel;
  segment: SegmentName;
  spent_min?: string | null;
}): Promise<SegmentPreview> {
  const qs = new URLSearchParams();
  qs.set('channel', params.channel);
  qs.set('segment', params.segment);
  if (params.spent_min) qs.set('spent_min', params.spent_min);
  return apiRequest({
    path: `/campaigns/preview?${qs.toString()}`,
    method: 'GET',
  });
}
