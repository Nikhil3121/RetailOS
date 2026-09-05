/** Typed clients for `/api/v1/loyalty/*` — reward points, tiers, statement. */

import { apiRequest } from '@/lib/api';

export type LoyaltyKind = 'earn' | 'redeem' | 'reversal' | 'adjustment' | 'expiry';

export interface LoyaltyProgram {
  id: string;
  name: string;
  is_active: boolean;
  /** Points granted per rupee spent. 0.01 = one point per ₹100. */
  points_per_rupee: string;
  /** Rupees one point is worth. 0.25 = four points to the rupee. */
  redemption_rate: string;
  expiry_days: number | null;
}

export interface MembershipTier {
  id: string;
  name: string;
  min_lifetime_spend: string;
  points_multiplier: string;
  default_discount_pct: string;
  color: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface LoyaltyBalance {
  customer_id: string;
  membership_tier_id: string | null;
  points_balance: string;
  wallet_balance: string;
  lifetime_spend: string;
  lifetime_earned: string;
  lifetime_redeemed: string;
  last_activity_at: string | null;
  tier: MembershipTier | null;
}

export interface LoyaltyEntry {
  id: string;
  customer_id: string;
  kind: LoyaltyKind;
  /** Signed — positive on earn, negative on redeem, reversal and expiry. */
  points_delta: string;
  points_balance_after: string;
  sale_id: string | null;
  reason: string | null;
  expires_at: string | null;
  created_at: string;
}

export function getProgram(): Promise<LoyaltyProgram | null> {
  return apiRequest<LoyaltyProgram | null>({ path: '/loyalty/program', method: 'GET' });
}

export function saveProgram(body: {
  name: string;
  points_per_rupee: string;
  redemption_rate: string;
  expiry_days: number | null;
  is_active: boolean;
}): Promise<LoyaltyProgram> {
  return apiRequest<LoyaltyProgram>({ path: '/loyalty/program', method: 'PUT', body });
}

export function listTiers(): Promise<MembershipTier[]> {
  return apiRequest<MembershipTier[]>({ path: '/loyalty/tiers', method: 'GET' });
}

export function createTier(body: {
  name: string;
  min_lifetime_spend: string;
  points_multiplier: string;
  default_discount_pct: string;
  color?: string | null;
}): Promise<MembershipTier> {
  return apiRequest<MembershipTier>({ path: '/loyalty/tiers', method: 'POST', body });
}

export function getBalance(customerId: string): Promise<LoyaltyBalance> {
  return apiRequest<LoyaltyBalance>({ path: `/loyalty/${customerId}`, method: 'GET' });
}

export function getStatement(customerId: string, limit = 50): Promise<LoyaltyEntry[]> {
  return apiRequest<LoyaltyEntry[]>({
    path: `/loyalty/${customerId}/statement?limit=${limit}`,
    method: 'GET',
  });
}

/**
 * What these points are worth, WITHOUT spending them.
 *
 * Separate from `redeem` on purpose: a screen that spent points merely by
 * showing their value would be a disaster at a busy counter.
 */
export function quoteRedemption(
  customerId: string,
  points: string,
): Promise<{ points: string; rupees: string }> {
  return apiRequest({
    path: `/loyalty/${customerId}/quote`,
    method: 'POST',
    body: { points },
  });
}

export function redeem(
  customerId: string,
  points: string,
  reason?: string,
): Promise<{ points_spent: string; rupees_granted: string; points_balance: string }> {
  return apiRequest({
    path: `/loyalty/${customerId}/redeem`,
    method: 'POST',
    body: { points, reason },
  });
}

export function adjustPoints(
  customerId: string,
  points: string,
  reason: string,
): Promise<LoyaltyEntry> {
  return apiRequest<LoyaltyEntry>({
    path: `/loyalty/${customerId}/adjust`,
    method: 'POST',
    body: { points, reason },
  });
}
