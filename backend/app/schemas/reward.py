"""Gift scheme DTOs."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import ORMModel


class RewardSchemeBase(BaseModel):
    name: str = Field(min_length=1, max_length=128, description="e.g. 'Diwali Dhamaka'")
    min_bill_amount: Decimal = Field(
        gt=0,
        decimal_places=2,
        max_digits=14,
        description="Bill total at or above which the gift is earned.",
    )
    gift_label: str = Field(
        min_length=1,
        max_length=128,
        description="What the customer is handed, e.g. 'Water bottle'. Free text — not a SKU.",
    )
    store_id: uuid.UUID | None = Field(
        default=None, description="Leave empty to run the scheme at every branch."
    )
    valid_from: date | None = None
    valid_to: date | None = None
    is_active: bool = True
    notes: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def _dates_in_order(self) -> "RewardSchemeBase":
        """A scheme that ends before it starts can never fire.

        Caught here rather than left to be discovered by a manager wondering
        why the festival offer never appeared on a single bill.
        """
        if self.valid_from and self.valid_to and self.valid_to < self.valid_from:
            raise ValueError("The end date is before the start date.")
        return self


class RewardSchemeCreate(RewardSchemeBase):
    pass


class RewardSchemeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    min_bill_amount: Decimal | None = Field(
        default=None, gt=0, decimal_places=2, max_digits=14
    )
    gift_label: str | None = Field(default=None, min_length=1, max_length=128)
    store_id: uuid.UUID | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    is_active: bool | None = None
    notes: str | None = Field(default=None, max_length=255)


class RewardSchemeRead(ORMModel):
    id: uuid.UUID
    name: str
    min_bill_amount: Decimal
    gift_label: str
    store_id: uuid.UUID | None
    valid_from: date | None
    valid_to: date | None
    is_active: bool
    notes: str | None


class RewardPreview(BaseModel):
    """What a bill of this size earns, and what it is short of.

    Billing calls this as the cart changes. `amount_to_next` is the number
    worth showing — an "unlocked" message arrives after the money is already
    committed, whereas "₹180 more for a steel glass" can still change the sale.
    """

    earned: RewardSchemeRead | None = None
    next_scheme: RewardSchemeRead | None = None
    amount_to_next: Decimal = Decimal("0.00")


class RewardGiven(BaseModel):
    """One line of the giveaway report."""

    reward_scheme_id: uuid.UUID | None
    gift_label: str
    times_given: int
    total_bill_value: Decimal
