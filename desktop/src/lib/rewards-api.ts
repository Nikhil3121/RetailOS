/** Typed clients for `/api/v1/rewards/*` — bill-value gift schemes. */

import { apiRequest } from '@/lib/api';

export interface RewardScheme {
  id: string;
  name: string;
  /** Bill total at or above which the gift is earned. */
  min_bill_amount: string;
  /** What the customer is handed. Free text — these are not stock items. */
  gift_label: string;
  /** null = runs at every branch. */
  store_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
  notes: string | null;
}

export interface RewardSchemeBody {
  name: string;
  min_bill_amount: string;
  gift_label: string;
  store_id?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  is_active?: boolean;
  notes?: string | null;
}

/**
 * What a bill of this size earns, and what it is short of.
 *
 * `amount_to_next` is the figure worth putting on screen. "Unlocked" arrives
 * after the money is committed; "₹180 more for a steel glass" can still change
 * the sale.
 */
export interface RewardPreview {
  earned: RewardScheme | null;
  next_scheme: RewardScheme | null;
  amount_to_next: string;
}

export interface RewardGiven {
  reward_scheme_id: string | null;
  gift_label: string;
  times_given: number;
  total_bill_value: string;
}

export function listRewards(params: {
  storeId?: string | null;
  includeInactive?: boolean;
} = {}): Promise<RewardScheme[]> {
  const q = new URLSearchParams();
  if (params.storeId) q.set('store_id', params.storeId);
  if (params.includeInactive) q.set('include_inactive', 'true');
  const qs = q.toString();
  return apiRequest<RewardScheme[]>({
    path: `/rewards${qs ? `?${qs}` : ''}`,
    method: 'GET',
  });
}

export function createReward(body: RewardSchemeBody): Promise<RewardScheme> {
  return apiRequest<RewardScheme>({ path: '/rewards', method: 'POST', body });
}

export function updateReward(
  id: string,
  body: Partial<RewardSchemeBody>,
): Promise<RewardScheme> {
  return apiRequest<RewardScheme>({ path: `/rewards/${id}`, method: 'PATCH', body });
}

export function deleteReward(id: string): Promise<void> {
  return apiRequest<void>({ path: `/rewards/${id}`, method: 'DELETE' });
}

/** Called by billing as the cart changes. Spends nothing, awards nothing. */
export function previewReward(storeId: string, amount: string): Promise<RewardPreview> {
  return apiRequest<RewardPreview>({
    path: `/rewards/preview/${storeId}?amount=${encodeURIComponent(amount)}`,
    method: 'GET',
  });
}

export function giftsGiven(params: {
  storeId?: string | null;
  from?: string;
  to?: string;
} = {}): Promise<RewardGiven[]> {
  const q = new URLSearchParams();
  if (params.storeId) q.set('store_id', params.storeId);
  if (params.from) q.set('from_date', params.from);
  if (params.to) q.set('to_date', params.to);
  const qs = q.toString();
  return apiRequest<RewardGiven[]>({
    path: `/rewards/reports/given${qs ? `?${qs}` : ''}`,
    method: 'GET',
  });
}
