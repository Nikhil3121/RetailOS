export type PaymentMethod = 'cash' | 'card' | 'upi' | 'other';

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  upi: 'UPI',
  other: 'Other',
};

export type SaleStatus = 'completed' | 'voided';

export interface SaleLine {
  id: string;
  variant_id: string;
  product_name: string;
  variant_name: string;
  sku: string;
  hsn_code: string | null;
  quantity: string;
  unit_price: string;
  discount_pct: string;
  discount_amount: string;
  tax_rate: string;
  subtotal: string;
  tax_amount: string;
  line_total: string;
  sort_order: number;
}

export interface SalePayment {
  id: string;
  method: PaymentMethod;
  amount: string;
  reference: string | null;
  created_at: string;
}

export interface Sale {
  id: string;
  number: string;
  store_id: string;
  customer_id: string | null;
  salesperson_user_id: string | null;
  status: SaleStatus;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  grand_total: string;
  paid_total: string;
  change_due: string;
  balance_due: string;
  notes: string | null;
  completed_at: string | null;
  lines: SaleLine[];
  payments: SalePayment[];
  created_at: string;
}

export interface SaleSummary {
  id: string;
  number: string;
  store_id: string;
  customer_id: string | null;
  status: SaleStatus;
  grand_total: string;
  paid_total: string;
  balance_due: string;
  line_count: number;
  completed_at: string | null;
  created_at: string;
}

// -- Write shapes (POST /api/v1/sales) --------------------------------------
export interface SaleLineInput {
  variant_id: string;
  quantity: number;
  discount_pct: number;
  unit_price?: string;
}

export interface SalePaymentInput {
  method: PaymentMethod;
  amount: string;
  reference: string | null;
}

export interface SaleCreate {
  store_id: string;
  customer_id: string | null;
  salesperson_user_id: string | null;
  notes: string | null;
  lines: SaleLineInput[];
  payments: SalePaymentInput[];
  client_uuid?: string;
}
