"""Price list service — and the one function that decides what a thing costs.

`resolve` is the ONLY place a selling rate is chosen. Billing calls it, the
sale service calls it, and any future quotation or order must call it too. Two
implementations of "what does this cost for this customer" would eventually
disagree, and the disagreement would be a customer charged the wrong price with
both screens insisting they were right.

The rule, in order:

  1. The customer's own list has a rate for this variant  -> that rate
  2. The default list has a rate for this variant         -> that rate
  3. Otherwise                                            -> variant.selling_price

Step 2 is what makes a "Retail" default list useful without assigning it to
every walk-in customer explicitly.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.db.models.customer import Customer
from app.db.models.price_list import PriceList, PriceListItem
from app.db.models.product import Product, ProductVariant
from app.schemas.price_list import (
    PriceListCreate,
    PriceListItemInput,
    PriceListItemRead,
    PriceListUpdate,
    ResolvedPrice,
)


class PriceListService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # Resolution — the important part
    # ------------------------------------------------------------------
    async def resolve(
        self,
        *,
        variant_ids: list[uuid.UUID],
        customer_id: uuid.UUID | None,
    ) -> dict[uuid.UUID, ResolvedPrice]:
        """The rate for each variant, for this customer.

        Batched deliberately: billing resolves a whole cart at once, and a
        per-line query would turn one round trip into twenty.
        """
        if not variant_ids:
            return {}

        variants = {
            v.id: v
            for v in (
                await self.db.scalars(
                    select(ProductVariant).where(ProductVariant.id.in_(variant_ids))
                )
            ).all()
        }

        list_id = await self._list_for_customer(customer_id)

        overrides: dict[uuid.UUID, Decimal] = {}
        if list_id is not None:
            rows = await self.db.execute(
                select(PriceListItem.variant_id, PriceListItem.price).where(
                    PriceListItem.price_list_id == list_id,
                    PriceListItem.variant_id.in_(variant_ids),
                )
            )
            overrides = {vid: price for vid, price in rows.all()}

        out: dict[uuid.UUID, ResolvedPrice] = {}
        for vid in variant_ids:
            variant = variants.get(vid)
            if variant is None:
                continue
            override = overrides.get(vid)
            out[vid] = ResolvedPrice(
                variant_id=vid,
                price=override if override is not None else variant.selling_price,
                base_price=variant.selling_price,
                price_list_id=list_id if override is not None else None,
                # Says WHERE the number came from, so the UI can show "Wholesale
                # rate" rather than leaving a cashier guessing why the price on
                # screen differs from the shelf label.
                source="price_list" if override is not None else "variant",
            )
        return out

    async def resolve_one(
        self, *, variant: ProductVariant, customer_id: uuid.UUID | None
    ) -> Decimal:
        """Single-variant convenience. Same rule, no second implementation."""
        found = await self.resolve(variant_ids=[variant.id], customer_id=customer_id)
        entry = found.get(variant.id)
        return entry.price if entry else variant.selling_price

    async def _list_for_customer(self, customer_id: uuid.UUID | None) -> uuid.UUID | None:
        """The list this customer buys on, falling back to the default list."""
        if customer_id is not None:
            customer = await self.db.get(Customer, customer_id)
            if customer is not None and customer.price_list_id is not None:
                pl = await self.db.get(PriceList, customer.price_list_id)
                # An archived list must not keep quietly setting prices.
                if pl is not None and pl.is_active:
                    return pl.id

        default = await self.db.scalar(
            select(PriceList).where(
                PriceList.is_default.is_(True), PriceList.is_active.is_(True)
            )
        )
        return default.id if default else None

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------
    async def list_all(self, *, include_inactive: bool = False) -> list[PriceList]:
        stmt = select(PriceList).order_by(PriceList.name)
        if not include_inactive:
            stmt = stmt.where(PriceList.is_active.is_(True))
        return list((await self.db.scalars(stmt)).all())

    async def get(self, price_list_id: uuid.UUID) -> PriceList:
        pl = await self.db.get(PriceList, price_list_id)
        if pl is None:
            raise NotFoundError("Price list not found.", code="PRICE_LIST_NOT_FOUND")
        return pl

    async def create(self, payload: PriceListCreate) -> PriceList:
        existing = await self.db.scalar(
            select(PriceList).where(PriceList.code == payload.code)
        )
        if existing is not None:
            raise ConflictError(
                f"A price list with code {payload.code} already exists.",
                code="PRICE_LIST_CODE_TAKEN",
            )
        pl = PriceList(**payload.model_dump())
        self.db.add(pl)
        await self.db.flush()
        if pl.is_default:
            await self._clear_other_defaults(pl.id)
        return pl

    async def update(self, price_list_id: uuid.UUID, payload: PriceListUpdate) -> PriceList:
        pl = await self.get(price_list_id)
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(pl, field, value)
        await self.db.flush()
        if pl.is_default:
            await self._clear_other_defaults(pl.id)
        return pl

    async def _clear_other_defaults(self, keep_id: uuid.UUID) -> None:
        """At most one default list.

        Enforced here rather than by a partial unique index because Postgres
        supports one and SQLite does not — and a rule that holds in production
        but not in the tests is a rule nobody can trust.
        """
        others = await self.db.scalars(
            select(PriceList).where(
                PriceList.is_default.is_(True), PriceList.id != keep_id
            )
        )
        for other in others.all():
            other.is_default = False
        await self.db.flush()

    # ------------------------------------------------------------------
    # Items
    # ------------------------------------------------------------------
    async def set_items(
        self, price_list_id: uuid.UUID, items: list[PriceListItemInput]
    ) -> list[PriceListItem]:
        """Upsert rates onto a list.

        Upsert rather than replace: a wholesaler edits a handful of rates at a
        time, and a replace would silently wipe every rate not present in the
        request.
        """
        pl = await self.get(price_list_id)

        variant_ids = [i.variant_id for i in items]
        # select(ProductVariant.id) yields UUIDs, not ORM objects — taking .id
        # off them is what broke every price-list test on the first run.
        known = set(
            (
                await self.db.scalars(
                    select(ProductVariant.id).where(ProductVariant.id.in_(variant_ids))
                )
            ).all()
        )
        missing = set(variant_ids) - known
        if missing:
            raise ValidationError(
                f"Unknown variants: {sorted(str(m) for m in missing)}",
                code="VARIANT_NOT_FOUND",
            )

        existing = {
            row.variant_id: row
            for row in (
                await self.db.scalars(
                    select(PriceListItem).where(
                        PriceListItem.price_list_id == pl.id,
                        PriceListItem.variant_id.in_(variant_ids),
                    )
                )
            ).all()
        }

        touched: list[PriceListItem] = []
        for item in items:
            row = existing.get(item.variant_id)
            if row is None:
                row = PriceListItem(
                    price_list_id=pl.id, variant_id=item.variant_id, price=item.price
                )
                self.db.add(row)
            else:
                row.price = item.price
            touched.append(row)

        await self.db.flush()
        return touched

    async def remove_item(self, price_list_id: uuid.UUID, variant_id: uuid.UUID) -> None:
        """Drop an override so the variant falls back to its own price."""
        row = await self.db.scalar(
            select(PriceListItem).where(
                PriceListItem.price_list_id == price_list_id,
                PriceListItem.variant_id == variant_id,
            )
        )
        if row is None:
            raise NotFoundError(
                "That variant has no rate on this list.", code="PRICE_LIST_ITEM_NOT_FOUND"
            )
        await self.db.delete(row)
        await self.db.flush()

    async def items_for_display(self, price_list_id: uuid.UUID) -> list[PriceListItemRead]:
        """Rates joined to what they price.

        A rate row showing only a UUID is unusable, and resolving 9,000 variants
        client-side to fix that would be absurd. One join answers it.
        """
        await self.get(price_list_id)
        rows = await self.db.execute(
            select(
                PriceListItem,
                Product.name,
                ProductVariant.name,
                ProductVariant.sku,
                ProductVariant.selling_price,
            )
            .join(ProductVariant, ProductVariant.id == PriceListItem.variant_id)
            .join(Product, Product.id == ProductVariant.product_id)
            .where(PriceListItem.price_list_id == price_list_id)
            .order_by(Product.name, ProductVariant.sort_order)
        )
        return [
            PriceListItemRead(
                id=item.id,
                price_list_id=item.price_list_id,
                variant_id=item.variant_id,
                price=item.price,
                product_name=product_name,
                variant_name=variant_name,
                sku=sku,
                base_price=shelf,
            )
            for item, product_name, variant_name, sku, shelf in rows.all()
        ]

    async def items_for(self, price_list_id: uuid.UUID) -> list[PriceListItem]:
        await self.get(price_list_id)
        return list(
            (
                await self.db.scalars(
                    select(PriceListItem).where(
                        PriceListItem.price_list_id == price_list_id
                    )
                )
            ).all()
        )
