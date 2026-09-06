/**
 * Turn a committed sale into the lines a thermal printer puts on paper.
 *
 * ── THE ONE RULE ───────────────────────────────────────────────────────────
 * This module RENDERS. It never calculates. Every figure comes from the sale
 * as it was stored in SQLite, and the only arithmetic performed anywhere here
 * is inserting a decimal point into an integer number of paise.
 *
 * That is what keeps the Phase 5 invariant intact:
 *
 *     RECEIPT = SQLITE = POSTGRESQL
 *
 * A formatter that re-derived a total "for display" would eventually print a
 * number that disagrees with the books, and the paper is the copy the customer
 * keeps. So: no division, no floats, no re-deriving tax from a rate.
 *
 * ── WIDTHS ─────────────────────────────────────────────────────────────────
 * Thermal paper is measured in millimetres but printed in characters. At the
 * standard Font A the two common rolls give:
 *
 *     58mm -> 32 columns
 *     80mm -> 48 columns
 *
 * Everything below lays out against a column count, so a third width only
 * needs a number rather than a new code path.
 */

export type PaperWidth = '58mm' | '80mm';

export const COLUMNS: Record<PaperWidth, number> = {
  '58mm': 32,
  '80mm': 48,
};

/** Money as it is stored: integer paise, rendered without ever dividing. */
export function paise(value: number): string {
  const negative = value < 0;
  const digits = String(Math.abs(Math.trunc(value))).padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Basis points as a percentage: 3000 -> "30", 1250 -> "12.5". */
export function basisPoints(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const frac = Math.abs(bp % 100);
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

/** Quantity, trimmed of pointless trailing zeros: 1 -> "1", 2.5 -> "2.5". */
export function quantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

/** A line with text pushed to both edges: "Total          240.00". */
export function twoColumn(left: string, right: string, width: number): string {
  const gap = width - left.length - right.length;
  if (gap >= 1) return `${left}${' '.repeat(gap)}${right}`;
  // Never let the amount be the thing that gets cut — money must stay legible.
  const room = Math.max(0, width - right.length - 1);
  return `${left.slice(0, room)} ${right}`;
}

export function centre(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const pad = Math.floor((width - text.length) / 2);
  return `${' '.repeat(pad)}${text}`;
}

export function rule(width: number, char = '-'): string {
  return char.repeat(width);
}

/**
 * Wrap text that is too long for the roll.
 *
 * Product names routinely exceed 32 characters on a 58mm receipt. Truncating
 * them would leave a customer unable to tell what they bought, so they wrap.
 */
export function wrap(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > width) {
      // A single unbreakable token (a long SKU) is hard-split rather than
      // allowed to overflow the roll.
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
      continue;
    }
    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ---------------------------------------------------------------------------

/** Exactly the fields a receipt needs. Mirrors SaleRecord; nothing derived. */
export interface ReceiptSale {
  id: string;
  localReference: string | null;
  invoiceNumber: string | null;
  occurredAt: string | null;
  createdAt: string;
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  /** Money off the whole bill, apart from the per-line discounts. */
  billDiscountPaise?: number;
  billDiscountReason?: string | null;
  couponCode?: string | null;
  /** Loyalty points spent. Printed so the customer can see them go. */
  redeemPoints?: number;
  /** Signed rounding to the whole rupee. */
  roundOffPaise?: number;
  notes: string | null;
  terminalUuid: string | null;
  items: {
    productName: string;
    sku: string | null;
    hsnCode?: string | null;
    quantity: number;
    mrpPaise?: number;
    unitPricePaise: number;
    discountPctBp: number;
    discountPaise: number;
    taxRateBp: number;
    taxPaise: number;
    lineTotalPaise: number;
  }[];
  payments: { method: string; amountPaise: number; reference: string | null }[];
}

export interface ShopDetails {
  name: string;
  addressLines?: string[];
  gstin?: string | null;
  phone?: string | null;
  footer?: string;
}

export interface FormatOptions {
  width?: PaperWidth;
  shop?: ShopDetails;
  /** Marks the copy as provisional when the server has not numbered it yet. */
  showOfflineNotice?: boolean;
}

const DEFAULT_SHOP: ShopDetails = { name: 'RetailOS' };

/**
 * Render the receipt.
 *
 * Returns plain text lines. ESC/POS byte encoding is a separate concern
 * (escpos.ts) so the layout can be read, diffed and tested as text — which is
 * how a formatting mistake gets caught before it reaches paper.
 */
export function formatReceipt(sale: ReceiptSale, options: FormatOptions = {}): string[] {
  const width = COLUMNS[options.width ?? '80mm'];
  const shop = options.shop ?? DEFAULT_SHOP;
  const out: string[] = [];

  // ---- header ----
  out.push(centre(shop.name.toUpperCase(), width));
  for (const line of shop.addressLines ?? []) {
    out.push(...wrap(line, width).map((l) => centre(l, width)));
  }
  if (shop.gstin) out.push(centre(`GSTIN: ${shop.gstin}`, width));
  if (shop.phone) out.push(centre(`Ph: ${shop.phone}`, width));
  out.push(rule(width, '='));

  // The server-issued GST number when it exists; the offline reference until
  // then. Both are shown when both exist — they identify the same sale in two
  // different systems and staff need to match them up.
  if (sale.invoiceNumber) out.push(twoColumn('Invoice', sale.invoiceNumber, width));
  if (sale.localReference) out.push(twoColumn('Ref', sale.localReference, width));

  const when = sale.occurredAt ?? sale.createdAt;
  out.push(twoColumn('Date', new Date(when).toLocaleString('en-IN'), width));
  out.push(rule(width));

  // ---- lines ----
  for (const item of sale.items) {
    out.push(...wrap(item.productName, width));

    const detail: string[] = [];
    if (item.sku) detail.push(item.sku);
    if (item.hsnCode) detail.push(`HSN ${item.hsnCode}`);
    if (detail.length > 0) out.push(...wrap(detail.join('  '), width));

    // MRP is printed whenever the customer actually got a saving.
    //
    // Comparing MRP against unit_price alone was wrong for how this shop
    // prices: the label's MRP IS the unit price, and the saving is expressed
    // as a discount percentage on the line. That test never fired, so MRP
    // never printed on precisely the bills where it mattered most.
    if (item.mrpPaise && (item.discountPaise > 0 || item.mrpPaise > item.unitPricePaise)) {
      out.push(twoColumn('  MRP', paise(item.mrpPaise), width));
    }

    out.push(
      twoColumn(
        `  ${quantity(item.quantity)} x ${paise(item.unitPricePaise)}`,
        paise(item.lineTotalPaise),
        width,
      ),
    );

    if (item.discountPaise > 0) {
      out.push(
        twoColumn(
          `  Discount ${basisPoints(item.discountPctBp)}%`,
          `-${paise(item.discountPaise)}`,
          width,
        ),
      );
    }
    if (item.taxPaise > 0) {
      out.push(
        twoColumn(`  GST ${basisPoints(item.taxRateBp)}%`, paise(item.taxPaise), width),
      );
    }
  }

  // ---- totals ----
  out.push(rule(width));
  out.push(twoColumn('Taxable value', paise(sale.subtotalPaise), width));
  if (sale.discountPaise > 0) {
    out.push(twoColumn('Discount', `-${paise(sale.discountPaise)}`, width));
  }

  // CGST and SGST are a presentation split of the tax already stored. They are
  // derived so they ALWAYS sum back to it exactly: half rounded down, and the
  // remainder to the other, so an odd number of paise cannot go missing.
  if (sale.taxPaise > 0) {
    const half = Math.floor(sale.taxPaise / 2);
    out.push(twoColumn('CGST', paise(half), width));
    out.push(twoColumn('SGST', paise(sale.taxPaise - half), width));
  }

  // Whole-bill adjustments, each on its own line.
  //
  // A customer who was given ₹100 off looks for the ₹100 on the paper. Folding
  // it into the total silently is what makes someone ask at the counter
  // whether the discount was actually applied.
  const billDiscount = sale.billDiscountPaise ?? 0;
  if (billDiscount > 0) {
    const label = sale.couponCode
      ? `Bill discount (${sale.couponCode})`
      : sale.billDiscountReason
        ? `Bill discount (${sale.billDiscountReason})`
        : 'Bill discount';
    out.push(twoColumn(label, `-${paise(billDiscount)}`, width));
  }
  if ((sale.redeemPoints ?? 0) > 0) {
    // Points, not rupees — their value is already inside the discount above,
    // and printing it again would read as a second reduction.
    out.push(twoColumn('Points redeemed', String(sale.redeemPoints), width));
  }
  const roundOff = sale.roundOffPaise ?? 0;
  if (roundOff !== 0) {
    out.push(
      twoColumn(
        'Round off',
        `${roundOff > 0 ? '+' : '-'}${paise(Math.abs(roundOff))}`,
        width,
      ),
    );
  }

  out.push(rule(width, '='));
  out.push(twoColumn('TOTAL', paise(sale.totalPaise), width));
  out.push(rule(width, '='));

  // ---- payments ----
  const paid = sale.payments.reduce((sum, p) => sum + p.amountPaise, 0);
  for (const payment of sale.payments) {
    out.push(twoColumn(payment.method.toUpperCase(), paise(payment.amountPaise), width));
    if (payment.reference) out.push(...wrap(`  Ref: ${payment.reference}`, width));
  }

  // Integer comparison — no rounding, so "balance due" cannot appear because
  // of a floating-point remainder.
  if (paid > sale.totalPaise) {
    out.push(twoColumn('Change', paise(paid - sale.totalPaise), width));
  } else if (paid < sale.totalPaise) {
    out.push(twoColumn('Balance due', paise(sale.totalPaise - paid), width));
  }

  if (sale.notes) {
    out.push(rule(width));
    out.push(...wrap(sale.notes, width));
  }

  if (options.showOfflineNotice && !sale.invoiceNumber) {
    out.push(rule(width));
    out.push(...wrap('Saved on this terminal. GST invoice number follows once synced.', width));
  }

  out.push(rule(width));
  out.push(centre(shop.footer ?? 'Thank you', width));

  return out;
}

/** The rendered receipt as one printable string. */
export function formatReceiptText(sale: ReceiptSale, options: FormatOptions = {}): string {
  return formatReceipt(sale, options).join('\n');
}
