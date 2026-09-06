/**
 * Money off the whole bill, and the coupon box.
 *
 * Both write to the SAME figure. A coupon is not a separate mechanism — it is
 * a discount whose amount the server works out from the coupon's own rules,
 * which is why applying one fills the discount box rather than sitting beside
 * it. Two independent "money off" numbers on one bill is how a total stops
 * matching what anyone can explain at the counter.
 *
 * The amount is still sent with the sale and RE-CHECKED server-side against
 * the coupon, so a modified client cannot invent a discount by naming a code.
 */

import { useState } from 'react';
import { BadgePercent, Check, TicketPercent, X } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ApiError } from '@/lib/api';
import { validateCoupon } from '@/lib/coupons-api';
import { formatMoney } from '@/lib/money';

export interface BillDiscountState {
  amount: string;
  reason: string;
  couponId: string | null;
  couponCode: string | null;
}

export const EMPTY_DISCOUNT: BillDiscountState = {
  amount: '',
  reason: '',
  couponId: null,
  couponCode: null,
};

export function BillDiscount({
  billTotal,
  customerId,
  value,
  onChange,
  disabled,
}: {
  /** The bill BEFORE any discount, as a decimal string. */
  billTotal: string;
  customerId: string | null;
  value: BillDiscountState;
  onChange: (next: BillDiscountState) => void;
  disabled?: boolean;
}): JSX.Element {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function applyCoupon(): Promise<void> {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setChecking(true);
    setError(null);
    try {
      const res = await validateCoupon({
        code: trimmed,
        bill_amount: billTotal,
        customer_id: customerId ?? undefined,
      });
      if (!res.valid || !res.coupon) {
        // The server's own words. It knows why — expired, under the minimum,
        // already used up — and guessing here would tell the customer the
        // wrong story.
        setError(res.reason ?? 'That coupon cannot be used on this bill.');
        return;
      }
      onChange({
        amount: res.computed_discount,
        reason: `Coupon ${res.coupon.code}`,
        couponId: res.coupon.id,
        couponCode: res.coupon.code,
      });
      setCode('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check that coupon.');
    } finally {
      setChecking(false);
    }
  }

  function clear(): void {
    onChange(EMPTY_DISCOUNT);
    setError(null);
  }

  const applied = Number(value.amount) > 0;

  return (
    <div className="space-y-2 border-t border-border pt-3">
      {value.couponId ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
          <Check className="h-4 w-4 shrink-0 text-emerald-400" />
          <span className="min-w-0 flex-1 truncate text-emerald-200">
            <span className="font-semibold">{value.couponCode}</span> applied —{' '}
            {formatMoney(value.amount)} off
          </span>
          <button
            type="button"
            onClick={clear}
            aria-label="Remove coupon"
            className="rounded p-1 text-emerald-300 hover:bg-emerald-500/20"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="Coupon code"
              placeholder="DIWALI200"
              value={code}
              disabled={disabled}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void applyCoupon();
                }
              }}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            className="mb-0.5"
            loading={checking}
            disabled={disabled || !code.trim()}
            leadingIcon={<TicketPercent className="h-4 w-4" />}
            onClick={() => void applyCoupon()}
          >
            Apply
          </Button>
        </div>
      )}

      {/* The manual box stays available even with a coupon applied — but
          editing it detaches the coupon, because the amount would then no
          longer be the one the server can verify. */}
      <div className="flex items-end gap-2">
        <div className="w-36">
          <Input
            label="Discount ₹"
            inputMode="decimal"
            placeholder="0"
            disabled={disabled}
            value={value.amount}
            onChange={(e) => {
              const amount = e.target.value.replace(/[^\d.]/g, '');
              onChange({
                ...value,
                amount,
                // Typing over a coupon's amount detaches it rather than
                // silently sending a figure the coupon does not justify.
                couponId: null,
                couponCode: null,
                reason: value.couponId ? '' : value.reason,
              });
            }}
          />
        </div>
        <div className="flex-1">
          <Input
            label="Reason"
            placeholder="Regular customer"
            disabled={disabled || Boolean(value.couponId)}
            value={value.reason}
            onChange={(e) => onChange({ ...value, reason: e.target.value })}
          />
        </div>
      </div>

      {applied && (
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <BadgePercent className="h-3.5 w-3.5" />
          {formatMoney(value.amount)} off {formatMoney(billTotal)}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
        >
          {error}
        </div>
      )}
    </div>
  );
}
