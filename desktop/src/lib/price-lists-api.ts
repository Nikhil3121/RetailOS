/**
 * Price lists — wholesale, retail, dealer rate cards.
 *
 * The rate a customer pays is decided by ONE function on the server. This
 * module never computes a price; it asks. `resolvePrices` is the same code path
 * the sale service runs when it writes the line, so what the cashier sees and
 * what lands on the bill cannot diverge.
 */

import { apiRequest } from '@/lib/api';

export interface PriceList {
  id: string;
  code: string;
  name: string;
  description: string | null;
  /** The list used for a customer who has none of their own. At most one. */
  is_default: boolean;
  is_active: boolean;
}

export interface PriceListCreateBody {
  code: string;
  name: string;
  description?: string | null;
  is_default?: boolean;
  is_active?: boolean;
}

export type PriceListUpdateBody = Partial<Omit<PriceListCreateBody, 'code'>>;

export interface PriceListItem {
  id: string;
  price_list_id: string;
  variant_id: string;
  price: string;
  /** Joined server-side — a rate row showing only a UUID is unusable. */
  sku: string | null;
  product_name: string | null;
  variant_name: string | null;
  /** The variant's own selling_price, to show what this rate replaces. */
  base_price: string | null;
}

/**
 * What one variant costs for one customer, and WHERE that came from.
 *
 * `source` is what lets the UI say "Wholesale ₹700" beside a struck-through
 * ₹899 rather than leaving a cashier wondering why the screen disagrees with
 * the shelf label.
 */
export interface ResolvedPrice {
  variant_id: string;
  price: string;
  /** The variant's own selling_price — the shelf rate. */
  base_price: string;
  price_list_id: string | null;
  source: 'price_list' | 'variant';
}

export function listPriceLists(includeInactive = false): Promise<PriceList[]> {
  return apiRequest({
    path: `/price-lists?include_inactive=${includeInactive}`,
    method: 'GET',
  });
}

export function createPriceList(body: PriceListCreateBody): Promise<PriceList> {
  return apiRequest({ path: '/price-lists', method: 'POST', body });
}

export function updatePriceList(
  id: string,
  body: PriceListUpdateBody,
): Promise<PriceList> {
  return apiRequest({ path: `/price-lists/${id}`, method: 'PATCH', body });
}

export function listPriceListItems(id: string): Promise<PriceListItem[]> {
  return apiRequest({ path: `/price-lists/${id}/items`, method: 'GET' });
}

/** Upsert. Rates not named in the body are left alone, never wiped. */
export function setPriceListItems(
  id: string,
  items: { variant_id: string; price: string }[],
): Promise<PriceListItem[]> {
  return apiRequest({ path: `/price-lists/${id}/items`, method: 'PUT', body: { items } });
}

/** Drop an override so the variant falls back to its own selling price. */
export function removePriceListItem(id: string, variantId: string): Promise<void> {
  return apiRequest({
    path: `/price-lists/${id}/items/${variantId}`,
    method: 'DELETE',
  });
}

/** The rate for these variants, for this customer. Batched for a whole cart. */
export function resolvePrices(
  variantIds: string[],
  customerId: string | null,
): Promise<ResolvedPrice[]> {
  return apiRequest({
    path: '/price-lists/resolve',
    method: 'POST',
    body: { customer_id: customerId, variant_ids: variantIds },
  });
}
