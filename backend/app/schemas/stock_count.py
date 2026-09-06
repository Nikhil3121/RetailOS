"""Physical stock audit DTOs."""

from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel, Field

from app.db.models.stock_count import StockCountStatus
from app.schemas.common import ORMModel

_ZERO = Decimal("0")


class StockCountCreate(BaseModel):
    store_id: uuid.UUID
    reference: str = Field(
        min_length=1,
        max_length=64,
        description="Handle for the sheet, e.g. 'COUNT-2026-03-14-SAREES'.",
    )
    scope: str | None = Field(
        default=None,
        max_length=255,
        description="What is being counted — 'Sarees, ground floor', 'Rack 4'.",
    )
    is_blind: bool = Field(
        default=True,
        description=(
            "Hide the expected quantity from whoever is counting. On by default: "
            "shown the figure, a tired person writes it down instead of counting."
        ),
    )
    notes: str | None = None


class StockCountUpdate(BaseModel):
    reference: str | None = Field(default=None, min_length=1, max_length=64)
    scope: str | None = Field(default=None, max_length=255)
    is_blind: bool | None = None
    notes: str | None = None


class StockCountLineInput(BaseModel):
    """One counted variant.

    `system_qty` is NOT accepted from the client. The server reads the balance
    at the moment the line is saved and snapshots it — a client-supplied figure
    could be stale, hand-edited, or simply wrong, and it is the number the
    entire variance calculation rests on.
    """

    variant_id: uuid.UUID
    counted_qty: Decimal = Field(
        ge=0,
        decimal_places=3,
        max_digits=14,
        description="What was physically found. Never negative — a shelf cannot hold −2.",
    )
    reason: str | None = Field(
        default=None,
        max_length=255,
        description="Why it differs, when known: '2 damaged', 'found behind rack'.",
    )


class StockCountLinesUpsert(BaseModel):
    """Save a batch of counted lines.

    Batched because a counter enters a rack at a time from a sheet, and one
    request per line would make a 200-item section 200 round trips on a shop's
    connection.
    """

    lines: list[StockCountLineInput] = Field(min_length=1, max_length=500)


class StockCountLineRead(ORMModel):
    id: uuid.UUID
    variant_id: uuid.UUID
    #: What the books said when the line was entered. Withheld (null) while a
    #: blind count is still open — see StockCountRead.
    system_qty: Decimal | None
    counted_qty: Decimal
    #: counted − system. Also withheld on an open blind count, because it
    #: gives the expected figure straight back.
    variance: Decimal | None
    reason: str | None
    #: Denormalised for the count sheet, which is useless without them.
    sku: str | None = None
    product_name: str | None = None
    variant_label: str | None = None


class StockCountRead(ORMModel):
    id: uuid.UUID
    store_id: uuid.UUID
    reference: str
    scope: str | None
    status: StockCountStatus
    is_blind: bool
    notes: str | None
    counted_by_user_id: uuid.UUID | None
    posted_by_user_id: uuid.UUID | None
    posted_at: str | None
    lines: list[StockCountLineRead] = []

    #: Totals a manager actually looks at before accepting a sheet.
    line_count: int = 0
    #: Lines whose count did not match. Null on an open blind count.
    variance_line_count: int | None = None
    #: Net units gained or lost. Null on an open blind count.
    net_variance: Decimal | None = None


class StockCountSummary(ORMModel):
    """List row. Deliberately without lines — a sheet can hold hundreds."""

    id: uuid.UUID
    store_id: uuid.UUID
    reference: str
    scope: str | None
    status: StockCountStatus
    is_blind: bool
    line_count: int = 0
    created_at: str | None = None
    posted_at: str | None = None


class StockCountPostResult(BaseModel):
    """What posting actually did."""

    count_id: uuid.UUID
    status: StockCountStatus
    #: Lines that moved the ledger. A zero variance posts nothing — there is
    #: no movement to record, and an empty ledger row is noise in an audit.
    movements_posted: int
    net_variance: Decimal
    #: Lines whose balance changed between counting and posting.
    #:
    #: Not an error and not blocked: the variance is applied on top of the
    #: real movement, which is the correct outcome. Reported because a manager
    #: reviewing a big discrepancy deserves to know the shelf was being sold
    #: from while it was counted.
    drifted_variant_ids: list[uuid.UUID] = []
