"""Sale (invoice) DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.db.models.sale import PaymentMethod, SaleDocType, SaleStatus
from app.schemas.common import ORMModel

_ZERO = Decimal("0.00")


class SaleLineInput(BaseModel):
    variant_id: uuid.UUID
    quantity: Decimal = Field(gt=0, decimal_places=3, max_digits=14)
    unit_price: Decimal | None = Field(
        default=None,
        ge=0,
        decimal_places=2,
        max_digits=12,
        description="Overrides the variant's selling_price when supplied.",
    )
    discount_pct: Decimal = Field(default=_ZERO, ge=0, le=100, decimal_places=2, max_digits=5)
    salesperson_user_id: uuid.UUID | None = Field(
        default=None,
        description=(
            "Who sold this LINE. Two staff often split one bill, and commission "
            "is computed from it. Falls back to the bill's salesperson."
        ),
    )
    # ---- offline synchronisation (Phase 5B) --------------------------------
    # Both fields are OPTIONAL and default to None, so an online bill posted by
    # the Billing UI behaves exactly as it always has. They exist so a sale
    # completed OFFLINE can be recorded as the transaction that actually
    # happened, rather than as one the server re-derives from today's catalog.
    line_total: Decimal | None = Field(
        default=None,
        ge=0,
        decimal_places=2,
        max_digits=14,
        description=(
            "Authoritative amount charged for this line, from the offline "
            "receipt. Supplied because a shelf price is often a ROUNDED figure "
            "- MRP 343 less 30% is 240.10, but the customer is charged 240.00 - "
            "and the server has no other way to know what was actually taken. "
            "Validated against the derived value; never silently adjusted."
        ),
    )
    tax_rate: Decimal | None = Field(
        default=None,
        ge=0,
        le=100,
        decimal_places=2,
        max_digits=5,
        description=(
            "GST rate in force AT THE TIME OF SALE. Supplied so a later catalog "
            "tax-rate change cannot rewrite the tax on a historical bill that "
            "has already been printed and handed to a customer."
        ),
    )


class SalePaymentInput(BaseModel):
    method: PaymentMethod
    amount: Decimal = Field(gt=0, decimal_places=2, max_digits=14)
    reference: str | None = Field(default=None, max_length=128)


class SaleCreate(BaseModel):
    store_id: uuid.UUID
    customer_id: uuid.UUID | None = None
    # Staff member credited with the sale. Optional — falls back to the cashier
    # (created_by_user_id) for commission + performance attribution when unset.
    salesperson_user_id: uuid.UUID | None = None
    lines: list[SaleLineInput] = Field(min_length=1)
    # An empty list means "credit sale" — the whole grand_total becomes balance_due
    # and the bill can be collected against later via POST /sales/{id}/payments.
    payments: list[SalePaymentInput] = Field(default_factory=list)
    # ---- money off the whole bill -------------------------------------------
    # A plain "₹200 off", negotiated at the counter. Applied after the lines
    # are totalled and NOT spread across them, because allocating it would
    # change each line's taxable value and therefore its GST.
    bill_discount: Decimal = Field(default=_ZERO, ge=0, decimal_places=2, max_digits=14)
    bill_discount_reason: str | None = Field(default=None, max_length=255)
    # The coupon this discount came from, when it came from one. The AMOUNT
    # still arrives in `bill_discount` — the server re-validates the coupon and
    # refuses if the two disagree, so a tampered client cannot invent a
    # discount by naming a coupon.
    coupon_id: uuid.UUID | None = None
    # Round the final figure to the whole rupee, as a GST invoice conventionally
    # does. Off by default so no existing caller changes behaviour.
    round_off_enabled: bool = False
    # Loyalty points to spend on THIS bill. The server works out what they are
    # worth, adds it to the bill discount, and records the redemption in the
    # same transaction — so points can never be taken without the discount
    # appearing, or a discount given without the points being spent.
    redeem_points: Decimal = Field(default=_ZERO, ge=0, decimal_places=2, max_digits=14)

    notes: str | None = None
    # Client-generated idempotency key. When the Billing UI queues a bill
    # while offline, it stamps the same UUID on every retry — if the server
    # already stored a sale under this key it returns the existing row instead
    # of ringing it up twice.
    client_uuid: str | None = Field(default=None, max_length=64)

    # ---- explicit offline attribution (Phase 5E) ---------------------------
    # All three are OPTIONAL. Omit them and the endpoint behaves exactly as it
    # always has, which is what keeps the online Billing UI working untouched.
    day_session_id: uuid.UUID | None = Field(
        default=None,
        description=(
            "The session that was open WHEN THE SALE HAPPENED. Supplied by an "
            "offline terminal so a bill rung up last night is booked against "
            "last night's shift instead of whichever session happens to be "
            "open when the terminal reconnects. Validated against store "
            "ownership; may reference a CLOSED session, which triggers an "
            "audited restatement. Never inferred, never substituted."
        ),
    )
    occurred_at: datetime | None = Field(
        default=None,
        description=(
            "When the sale actually happened. Preserved verbatim and used for "
            "the invoice month, so a 31 March bill synced on 1 April keeps a "
            "March invoice number. Never used to infer the day session - "
            "attribution is explicit via day_session_id."
        ),
    )
    terminal_uuid: str | None = Field(
        default=None,
        min_length=8,
        max_length=64,
        pattern=r"^[A-Za-z0-9._:-]+$",
        description=(
            "Device identity of the till that rang the sale (the terminal's "
            "device_uuid). Recorded so per-terminal cash reconciliation is "
            "possible; two distinct devices are never normalised into one."
        ),
    )


class SaleVoidRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=255)


# ---------------------------------------------------------------------------
# Returns / credit notes
# ---------------------------------------------------------------------------
class SaleReturnLineInput(BaseModel):
    """One line coming back, identified by the ORIGINAL sale line.

    The caller names a line on the invoice and says how many units are being
    returned. Quantity is POSITIVE here — "two of these are coming back" is what
    a person means and what a UI collects. The service negates it on the way
    into storage. Keeping the sign conversion in exactly one place is what stops
    a caller from accidentally crediting a customer twice by sending -2.
    """

    sale_line_id: uuid.UUID
    quantity: Decimal = Field(
        gt=0,
        decimal_places=3,
        max_digits=14,
        description="Units coming back. Must not exceed what remains returnable on that line.",
    )


class SaleReturnCreate(BaseModel):
    """Body for `POST /sales/{sale_id}/returns`.

    Price, discount and tax are NOT accepted. They are copied from the original
    line so a credit note can never disagree with the invoice it reverses —
    which is the single most important property of a return.
    """

    lines: list[SaleReturnLineInput] = Field(min_length=1)
    refunds: list[SalePaymentInput] = Field(
        default_factory=list,
        description=(
            "Money going back to the customer, as POSITIVE amounts. Stored "
            "negative. May be empty when the credit is left on account rather "
            "than refunded."
        ),
    )
    reason: str = Field(min_length=1, max_length=255)
    notes: str | None = None
    client_uuid: str | None = Field(default=None, max_length=64)
    occurred_at: datetime | None = None
    terminal_uuid: str | None = Field(default=None, max_length=64)
    day_session_id: uuid.UUID | None = None


class SaleExchangeCreate(BaseModel):
    """Body for `POST /sales/{sale_id}/exchange`.

    Wrong size is the commonest reason a customer walks back into a garment
    shop, and the answer is never "here is your money" — it is "take the large
    instead". Done as two separate operations the cashier refunds cash out of
    the drawer and takes most of it straight back in, which is slower, wrong in
    the day book, and leaves the two documents unlinked if anything interrupts
    the pair.

    TWO DOCUMENTS COME OUT OF THIS, NOT ONE. A credit note for the goods
    returned and a full-value invoice for the goods taken. Under GST the return
    needs its own document and the replacement is a sale at its own price with
    its own tax; netting them into one discounted bill would understate the
    invoice and leave the return unrecorded.
    """

    #: What is coming back, by ORIGINAL sale line. Prices are never accepted —
    #: they are copied from the invoice being reversed, so a credit note cannot
    #: disagree with the bill it credits.
    lines: list[SaleReturnLineInput] = Field(min_length=1)

    #: What the customer is taking instead. Priced and taxed as any other sale,
    #: because it is one.
    new_lines: list[SaleLineInput] = Field(min_length=1)

    #: Anything paid ON TOP of the credit. Empty when the swap is even or the
    #: customer is owed money.
    payments: list[SalePaymentInput] = Field(default_factory=list)

    #: How to hand back the difference when the returned goods are worth MORE
    #: than the replacement.
    #:
    #: None leaves it as a balance on the credit note, which the customer can
    #: spend later — a real and common way for a shop to settle this, and the
    #: safer default: money is never pushed out of the drawer unless somebody
    #: asked for it.
    refund_excess_method: PaymentMethod | None = None

    reason: str = Field(min_length=1, max_length=255)

    #: Defaults to the original bill's store. Supplied only when the exchange
    #: is being done at the OTHER branch, which the two malls do routinely.
    store_id: uuid.UUID | None = None
    customer_id: uuid.UUID | None = None
    salesperson_user_id: uuid.UUID | None = None

    bill_discount: Decimal = Field(default=_ZERO, ge=0, decimal_places=2, max_digits=14)
    bill_discount_reason: str | None = Field(default=None, max_length=255)
    round_off_enabled: bool = False

    notes: str | None = None
    occurred_at: datetime | None = None
    terminal_uuid: str | None = Field(default=None, max_length=64)
    day_session_id: uuid.UUID | None = None


class SaleExchangeResult(BaseModel):
    """Both documents, and how the difference landed.

    Returned together because an exchange is not finished until the counter can
    see both: the credit note proves the goods came back, the invoice is what
    the customer walks out with.
    """

    credit_note: SaleRead
    sale: SaleRead
    #: Value of the returned goods spent on the new bill.
    credit_applied: Decimal
    #: Still owed by the customer. Zero on an even swap or when they paid the
    #: difference at the counter.
    balance_due: Decimal
    #: Owed TO the customer — the returned goods were worth more. Either
    #: refunded (when a method was given) or left on the credit note.
    credit_remaining: Decimal


class AdvanceCreate(BaseModel):
    """Body for `POST /sales/advances` — money in, no goods yet.

    A CUSTOMER IS REQUIRED. An advance held against nobody cannot be applied to
    a later bill or refunded, so it is money the shop can neither keep nor
    return. There is no sensible walk-in advance.
    """

    store_id: uuid.UUID
    customer_id: uuid.UUID
    payments: list[SalePaymentInput] = Field(
        min_length=1,
        description="How the money arrived. At least one — an advance with no payment is nothing.",
    )
    notes: str | None = None
    client_uuid: str | None = Field(default=None, max_length=64)
    occurred_at: datetime | None = None
    terminal_uuid: str | None = Field(default=None, max_length=64)
    day_session_id: uuid.UUID | None = None


class CustomerBalance(BaseModel):
    """What a customer owes, or is owed, right now."""

    customer_id: uuid.UUID
    # Positive = they owe the shop. Negative = the shop holds their money.
    net_balance: Decimal
    owed_by_customer: Decimal
    advance_held: Decimal


class SaleLineReturnable(BaseModel):
    """How much of one invoice line can still be credited."""

    sale_line_id: uuid.UUID
    variant_id: uuid.UUID
    product_name: str
    variant_name: str
    sku: str
    unit_price: Decimal
    sold_quantity: Decimal
    returned_quantity: Decimal
    returnable_quantity: Decimal


class SalePaymentCollect(BaseModel):
    """Body for `POST /sales/{sale_id}/payments` — collect against an outstanding bill."""

    method: PaymentMethod
    amount: Decimal = Field(gt=0, decimal_places=2, max_digits=14)
    reference: str | None = Field(default=None, max_length=128)


class SaleLineRead(ORMModel):
    id: uuid.UUID
    sale_id: uuid.UUID
    variant_id: uuid.UUID
    product_name: str
    variant_name: str
    sku: str
    hsn_code: str | None
    quantity: Decimal
    unit_price: Decimal
    mrp: Decimal | None = None
    salesperson_user_id: uuid.UUID | None = None
    discount_pct: Decimal
    discount_amount: Decimal
    tax_rate: Decimal
    subtotal: Decimal
    tax_amount: Decimal
    line_total: Decimal
    sort_order: int


class SalePaymentRead(ORMModel):
    id: uuid.UUID
    sale_id: uuid.UUID
    method: PaymentMethod
    amount: Decimal
    reference: str | None
    created_at: datetime


class SaleRead(ORMModel):
    id: uuid.UUID
    number: str
    store_id: uuid.UUID
    day_session_id: uuid.UUID
    customer_id: uuid.UUID | None
    status: SaleStatus
    # A credit note is the same shape with negative money. Clients must read
    # doc_type before presenting a figure, or a refund reads as a sale.
    doc_type: SaleDocType = SaleDocType.SALE
    original_sale_id: uuid.UUID | None = None
    subtotal: Decimal
    discount_total: Decimal
    tax_total: Decimal
    grand_total: Decimal
    paid_total: Decimal
    change_due: Decimal
    balance_due: Decimal
    bill_discount: Decimal = _ZERO
    bill_discount_reason: str | None = None
    round_off: Decimal = _ZERO
    coupon_id: uuid.UUID | None = None
    coupon_code: str | None = None
    notes: str | None
    completed_at: datetime | None
    voided_at: datetime | None
    void_reason: str | None
    created_by_user_id: uuid.UUID | None
    salesperson_user_id: uuid.UUID | None
    client_uuid: str | None = None
    occurred_at: datetime | None = None
    terminal_uuid: str | None = None
    # The free gift this bill earned, if any. `reward_label` is a snapshot, so
    # it still reads correctly after the scheme is renamed or deleted.
    reward_scheme_id: uuid.UUID | None = None
    reward_label: str | None = None
    print_count: int = 0
    lines: list[SaleLineRead] = Field(default_factory=list)
    payments: list[SalePaymentRead] = Field(default_factory=list)
    created_at: datetime


class SaleSummary(ORMModel):
    id: uuid.UUID
    number: str
    store_id: uuid.UUID
    customer_id: uuid.UUID | None
    salesperson_user_id: uuid.UUID | None = None
    status: SaleStatus
    grand_total: Decimal
    paid_total: Decimal
    balance_due: Decimal
    line_count: int
    completed_at: datetime | None
    created_at: datetime
