"""Inventory service — the *only* place that mutates stock.

Every write goes through :meth:`InventoryService.post_movement`. That method:

1. Locks/creates the `(variant, store)` balance row.
2. Applies the signed delta to the balance.
3. Rejects the write if the new balance would go negative (unless
   `allow_negative=True`, used for opening balances / one-off adjustments).
4. Inserts a `StockMovement` row carrying the balance snapshot.

Because callers hand it a live `AsyncSession`, all of this happens inside the
caller's transaction. If the caller's outer op fails, the ledger + balance
rollback together — the two never diverge.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Iterable

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.db.models.inventory import MovementKind, StockBalance, StockMovement
from app.db.models.product import Product, ProductVariant
from app.db.models.store import Store
from app.db.models.unit import Unit
from app.schemas.inventory import (
    StockAdjustmentLine,
    StockAdjustmentRequest,
    StockLevelRow,
    StockTransferRequest,
)


_ZERO = Decimal("0.000")


class InventoryService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # The one write path
    # ------------------------------------------------------------------
    async def post_movement(
        self,
        *,
        variant_id: uuid.UUID,
        store_id: uuid.UUID,
        delta: Decimal,
        kind: MovementKind,
        unit_cost: Decimal | None = None,
        reference_type: str | None = None,
        reference_id: uuid.UUID | None = None,
        reason: str | None = None,
        created_by_user_id: uuid.UUID | None = None,
        allow_negative: bool = False,
    ) -> StockMovement:
        """Apply a signed stock change. Callers never touch the ledger directly."""
        if delta == 0:
            raise ValidationError("Delta must be non-zero.", code="ZERO_DELTA")

        # Load or create the balance row for this pair. Kept inside the caller's
        # transaction so the read-modify-write is atomic. Under contention, wrap
        # in SELECT ... FOR UPDATE (Postgres) for multi-writer safety.
        balance = await self.db.scalar(
            select(StockBalance).where(
                StockBalance.variant_id == variant_id,
                StockBalance.store_id == store_id,
            )
        )
        if balance is None:
            balance = StockBalance(variant_id=variant_id, store_id=store_id, quantity=_ZERO)
            self.db.add(balance)
            await self.db.flush()

        new_qty = (balance.quantity or _ZERO) + delta
        if new_qty < 0 and not allow_negative:
            raise ConflictError(
                f"Insufficient stock. Current {balance.quantity}, requested {-delta}.",
                code="INSUFFICIENT_STOCK",
                details={"variant_id": str(variant_id), "store_id": str(store_id)},
            )

        balance.quantity = new_qty

        movement = StockMovement(
            variant_id=variant_id,
            store_id=store_id,
            kind=kind,
            delta=delta,
            balance_after=new_qty,
            unit_cost=unit_cost,
            reference_type=reference_type,
            reference_id=reference_id,
            reason=reason,
            created_by_user_id=created_by_user_id,
        )
        self.db.add(movement)
        await self.db.flush()
        return movement

    # ------------------------------------------------------------------
    # High-level operations
    # ------------------------------------------------------------------
    async def adjust(
        self,
        payload: StockAdjustmentRequest,
        *,
        user_id: uuid.UUID | None,
    ) -> list[StockMovement]:
        """Manual adjustment (breakage, cycle-count correction, opening balance).

        Adjustments may push balances negative *only* if the reason is prefixed
        with 'OPENING' — everything else is treated as a real-world count and must
        stay non-negative.
        """
        await self._resolve_or_raise(Store, payload.store_id, "STORE_NOT_FOUND", "Store not found.")
        allow_negative = payload.reason.upper().startswith("OPENING")

        movements: list[StockMovement] = []
        for line in payload.lines:
            await self._resolve_or_raise(
                ProductVariant, line.variant_id, "VARIANT_NOT_FOUND", "Variant not found."
            )
            movements.append(
                await self.post_movement(
                    variant_id=line.variant_id,
                    store_id=payload.store_id,
                    delta=line.delta,
                    kind=(
                        MovementKind.OPENING_BALANCE
                        if allow_negative
                        else MovementKind.ADJUSTMENT
                    ),
                    unit_cost=line.unit_cost,
                    reason=payload.reason,
                    created_by_user_id=user_id,
                    allow_negative=allow_negative,
                )
            )
        return movements

    async def transfer(
        self,
        payload: StockTransferRequest,
        *,
        user_id: uuid.UUID | None,
    ) -> list[StockMovement]:
        """Move stock from one store to another. Never crosses through negative."""
        if payload.from_store_id == payload.to_store_id:
            raise ValidationError("Source and destination must differ.", code="TRANSFER_SAME_STORE")

        await self._resolve_or_raise(
            Store, payload.from_store_id, "STORE_NOT_FOUND", "Source store not found."
        )
        await self._resolve_or_raise(
            Store, payload.to_store_id, "STORE_NOT_FOUND", "Destination store not found."
        )

        for line in payload.lines:
            if line.delta <= 0:
                raise ValidationError(
                    "Transfer quantities must be positive.", code="TRANSFER_NEGATIVE_QTY"
                )

        reason = payload.reason or f"Transfer to store {payload.to_store_id}"
        transfer_id = uuid.uuid4()  # links the OUT + IN legs on the ledger
        movements: list[StockMovement] = []

        for line in payload.lines:
            movements.append(
                await self.post_movement(
                    variant_id=line.variant_id,
                    store_id=payload.from_store_id,
                    delta=-line.delta,
                    kind=MovementKind.TRANSFER_OUT,
                    unit_cost=line.unit_cost,
                    reference_type="transfer",
                    reference_id=transfer_id,
                    reason=reason,
                    created_by_user_id=user_id,
                )
            )
            movements.append(
                await self.post_movement(
                    variant_id=line.variant_id,
                    store_id=payload.to_store_id,
                    delta=line.delta,
                    kind=MovementKind.TRANSFER_IN,
                    unit_cost=line.unit_cost,
                    reference_type="transfer",
                    reference_id=transfer_id,
                    reason=reason,
                    created_by_user_id=user_id,
                )
            )
        return movements

    # ------------------------------------------------------------------
    # Reads
    # ------------------------------------------------------------------
    async def balance_for(
        self, variant_id: uuid.UUID, store_id: uuid.UUID
    ) -> Decimal:
        row = await self.db.scalar(
            select(StockBalance.quantity).where(
                StockBalance.variant_id == variant_id,
                StockBalance.store_id == store_id,
            )
        )
        return row if row is not None else _ZERO

    async def stock_levels(
        self,
        *,
        store_id: uuid.UUID | None = None,
        search: str | None = None,
        low_stock_only: bool = False,
        out_of_stock_only: bool = False,
        in_stock_only: bool = False,
        include_inactive: bool = False,
        page: int = 1,
        page_size: int = 100,
    ) -> tuple[list[StockLevelRow], int]:
        """One row per (active variant × store).

        Uses a LEFT JOIN from ProductVariant to StockBalance so *every* variant
        appears — freshly-created products with no ledger activity still show
        up (quantity = 0) and can be received-into directly from the grid.

        When `store_id` is None we return one row per variant per known store
        by cross-joining Store; when it's set we scope to that store only.
        """
        page = max(page, 1)
        page_size = min(max(page_size, 1), 1000)

        # Start from Variant × Store so every combination materialises; the
        # balance is left-joined on both keys so its absence is a 0, not a
        # missing row.
        stmt = (
            select(
                ProductVariant.id.label("variant_id"),
                ProductVariant.name.label("variant_name"),
                ProductVariant.sku,
                ProductVariant.barcode,
                ProductVariant.reorder_point,
                ProductVariant.is_active.label("variant_active"),
                Product.id.label("product_id"),
                Product.name.label("product_name"),
                Product.is_active.label("product_active"),
                Store.id.label("store_id"),
                Store.code.label("store_code"),
                Unit.symbol.label("unit_symbol"),
                Unit.is_fractional.label("unit_is_fractional"),
                func.coalesce(StockBalance.quantity, _ZERO).label("quantity"),
            )
            .select_from(ProductVariant)
            .join(Product, Product.id == ProductVariant.product_id)
            .join(Unit, Unit.id == Product.unit_id)
            .join(Store, Store.is_active.is_(True))
            .join(
                StockBalance,
                (StockBalance.variant_id == ProductVariant.id)
                & (StockBalance.store_id == Store.id),
                isouter=True,
            )
        )

        if not include_inactive:
            stmt = stmt.where(ProductVariant.is_active.is_(True))
            stmt = stmt.where(Product.is_active.is_(True))
        if store_id is not None:
            stmt = stmt.where(Store.id == store_id)
        if search:
            like = f"%{search.strip()}%"
            stmt = stmt.where(
                (Product.name.ilike(like))
                | (ProductVariant.name.ilike(like))
                | (ProductVariant.sku.ilike(like))
                | (ProductVariant.barcode.ilike(like))
            )

        qty_expr = func.coalesce(StockBalance.quantity, _ZERO)
        if out_of_stock_only:
            stmt = stmt.where(qty_expr <= 0)
        elif in_stock_only:
            stmt = stmt.where(qty_expr > 0)
        elif low_stock_only:
            # Low = has some stock but at or below the reorder point (only
            # meaningful when reorder_point > 0).
            stmt = stmt.where(qty_expr > 0)
            stmt = stmt.where(ProductVariant.reorder_point > 0)
            stmt = stmt.where(qty_expr <= ProductVariant.reorder_point)

        total = await self.db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        stmt = stmt.order_by(
            Product.name, ProductVariant.sort_order, Store.code
        ).offset((page - 1) * page_size).limit(page_size)

        result = await self.db.execute(stmt)
        rows: list[StockLevelRow] = []
        for r in result.mappings().all():
            rows.append(
                StockLevelRow(
                    variant_id=r["variant_id"],
                    product_id=r["product_id"],
                    product_name=r["product_name"],
                    variant_name=r["variant_name"],
                    sku=r["sku"],
                    barcode=r["barcode"],
                    store_id=r["store_id"],
                    store_code=r["store_code"],
                    quantity=r["quantity"],
                    unit_symbol=r["unit_symbol"],
                    unit_is_fractional=r["unit_is_fractional"],
                    reorder_point=r["reorder_point"],
                    is_active=r["variant_active"] and r["product_active"],
                )
            )
        return rows, int(total)

    async def list_movements(
        self,
        *,
        variant_id: uuid.UUID | None = None,
        store_id: uuid.UUID | None = None,
        page: int = 1,
        page_size: int = 100,
    ) -> tuple[list[StockMovement], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 1000)

        base = select(StockMovement)
        if variant_id is not None:
            base = base.where(StockMovement.variant_id == variant_id)
        if store_id is not None:
            base = base.where(StockMovement.store_id == store_id)

        total = await self.db.scalar(select(func.count()).select_from(base.subquery())) or 0
        rows = (
            await self.db.scalars(
                base.order_by(StockMovement.created_at.desc())
                .options(selectinload(StockMovement.variant))
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return list(rows), int(total)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    async def _resolve_or_raise(self, model, id_: uuid.UUID, code: str, msg: str) -> None:
        row = await self.db.get(model, id_)
        if row is None:
            raise NotFoundError(msg, code=code)
