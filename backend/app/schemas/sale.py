"""Sale (invoice) DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field

from app.db.models.sale import PaymentMethod, SaleStatus
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
    notes: str | None = None
    # Client-generated idempotency key. When the Billing UI queues a bill
    # while offline, it stamps the same UUID on every retry — if the server
    # already stored a sale under this key it returns the existing row instead
    # of ringing it up twice.
    client_uuid: str | None = Field(default=None, max_length=64)


class SaleVoidRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=255)


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
    subtotal: Decimal
    discount_total: Decimal
    tax_total: Decimal
    grand_total: Decimal
    paid_total: Decimal
    change_due: Decimal
    balance_due: Decimal
    notes: str | None
    completed_at: datetime | None
    voided_at: datetime | None
    void_reason: str | None
    created_by_user_id: uuid.UUID | None
    salesperson_user_id: uuid.UUID | None
    client_uuid: str | None = None
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
