"""Inventory intelligence — categorise stock levels and movement velocity.

Every method here is a read-only aggregate over existing tables:

- Stock alerts (out/low/healthy/overstock) come from `stock_balances` joined
  with the variant thresholds.
- Movement categories (fast/slow/dead) come from `sale_lines` velocity in a
  configurable window.
- Aging comes from the last inbound `stock_movements` row per (variant, store).

All computations respect an optional `store_id` filter; without it, they
aggregate across every store.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.inventory import MovementKind, StockBalance, StockMovement
from app.db.models.product import Product, ProductVariant
from app.db.models.sale import Sale, SaleLine, SaleStatus
from app.db.models.store import Store
from app.schemas.inventory_intelligence import (
    InventoryAgingRow,
    InventoryHealthSummary,
    InventoryValueRow,
    InventoryValueTotal,
    MovementCategory,
    MovementRow,
    StockAlertRow,
    StockCategory,
)


_ZERO = Decimal("0.00")


def _dec(v) -> Decimal:
    return Decimal(str(v or 0))


class InventoryIntelligenceService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # Stock alerts
    # ------------------------------------------------------------------
    async def stock_alerts(
        self,
        *,
        categories: set[StockCategory] | None = None,
        store_id: uuid.UUID | None = None,
        window_days: int = 30,
    ) -> list[StockAlertRow]:
        """Every (variant, store) balance labelled by threshold + suggested reorder."""
        stmt = (
            select(
                StockBalance.quantity,
                ProductVariant.id.label("variant_id"),
                ProductVariant.sku,
                ProductVariant.barcode,
                ProductVariant.reorder_point,
                ProductVariant.reorder_quantity,
                ProductVariant.overstock_point,
                Product.id.label("product_id"),
                Product.name.label("product_name"),
                Store.id.label("store_id"),
                Store.code.label("store_code"),
            )
            .join(ProductVariant, ProductVariant.id == StockBalance.variant_id)
            .join(Product, Product.id == ProductVariant.product_id)
            .join(Store, Store.id == StockBalance.store_id)
        )
        if store_id is not None:
            stmt = stmt.where(StockBalance.store_id == store_id)

        rows = (await self.db.execute(stmt)).mappings().all()

        # Velocity map — sold qty over the last N days per (variant, store).
        velocity = await self._velocity_map(window_days=window_days, store_id=store_id)

        alerts: list[StockAlertRow] = []
        for r in rows:
            qty = _dec(r["quantity"])
            reorder = _dec(r["reorder_point"])
            reorder_qty = _dec(r["reorder_quantity"])
            over = r["overstock_point"]
            category = self._categorise_stock(qty, reorder, over)

            if categories is not None and category not in categories:
                continue

            key = (r["variant_id"], r["store_id"])
            v = velocity.get(key, _ZERO)
            velocity_per_day = (v / Decimal(window_days)).quantize(Decimal("0.001"))
            days_of_cover = (
                (qty / velocity_per_day).quantize(Decimal("0.1"))
                if velocity_per_day > 0 and qty > 0
                else None
            )

            suggested = None
            if category in (StockCategory.OUT_OF_STOCK, StockCategory.LOW):
                # How much to buy to reach reorder_point + reorder_quantity buffer.
                need = reorder + reorder_qty - qty
                if need > 0:
                    suggested = need.quantize(Decimal("0.001"))

            alerts.append(
                StockAlertRow(
                    variant_id=r["variant_id"],
                    product_id=r["product_id"],
                    product_name=r["product_name"],
                    sku=r["sku"],
                    barcode=r["barcode"],
                    store_id=r["store_id"],
                    store_code=r["store_code"],
                    quantity=qty,
                    reorder_point=reorder,
                    reorder_quantity=reorder_qty,
                    overstock_point=_dec(over) if over is not None else None,
                    category=category,
                    days_of_cover=days_of_cover,
                    suggested_reorder_qty=suggested,
                )
            )
        # Sort: most urgent first (out → low → overstock → healthy).
        priority = {
            StockCategory.OUT_OF_STOCK: 0,
            StockCategory.LOW: 1,
            StockCategory.OVERSTOCK: 2,
            StockCategory.HEALTHY: 3,
        }
        alerts.sort(key=lambda a: (priority[a.category], a.product_name))
        return alerts

    # ------------------------------------------------------------------
    # Movement categorisation
    # ------------------------------------------------------------------
    async def movement_analysis(
        self,
        *,
        window_days: int = 30,
        store_id: uuid.UUID | None = None,
        fast_units_per_day: Decimal = Decimal("1.000"),
        slow_units_per_day: Decimal = Decimal("0.100"),
        dead_days: int = 60,
    ) -> list[MovementRow]:
        """Every active variant labelled fast / normal / slow / dead."""
        # Sold quantity + last sale per variant.
        end = date.today()
        start = end - timedelta(days=window_days)
        base_filter = [
            Sale.status == SaleStatus.COMPLETED,
            func.date(Sale.created_at).between(start, end),
        ]
        if store_id is not None:
            base_filter.append(Sale.store_id == store_id)

        sold_stmt = (
            select(
                SaleLine.variant_id,
                func.coalesce(func.sum(SaleLine.quantity), 0).label("sold"),
                func.max(func.date(Sale.created_at)).label("last_sale"),
            )
            .join(Sale, Sale.id == SaleLine.sale_id)
            .where(*base_filter)
            .group_by(SaleLine.variant_id)
        )
        sold_rows = (await self.db.execute(sold_stmt)).all()
        sold_by_variant: dict[uuid.UUID, tuple[Decimal, date | None]] = {}
        for r in sold_rows:
            last = r.last_sale
            if last and not isinstance(last, date):
                last = date.fromisoformat(str(last))
            sold_by_variant[r.variant_id] = (_dec(r.sold), last)

        # On-hand per variant (summed across stores unless filtered).
        oh_stmt = select(
            StockBalance.variant_id,
            func.coalesce(func.sum(StockBalance.quantity), 0).label("on_hand"),
        )
        if store_id is not None:
            oh_stmt = oh_stmt.where(StockBalance.store_id == store_id)
        oh_stmt = oh_stmt.group_by(StockBalance.variant_id)
        on_hand_by_variant = {
            r.variant_id: _dec(r.on_hand)
            for r in (await self.db.execute(oh_stmt)).all()
        }

        # Variant metadata for anything that appears in either map.
        variant_ids = set(sold_by_variant.keys()) | set(on_hand_by_variant.keys())
        if not variant_ids:
            return []
        meta_rows = (
            await self.db.execute(
                select(
                    ProductVariant.id,
                    ProductVariant.sku,
                    Product.name.label("product_name"),
                )
                .join(Product, Product.id == ProductVariant.product_id)
                .where(ProductVariant.id.in_(variant_ids))
            )
        ).all()
        meta = {r.id: (r.sku, r.product_name) for r in meta_rows}

        out: list[MovementRow] = []
        today = date.today()
        for vid in variant_ids:
            on_hand = on_hand_by_variant.get(vid, _ZERO)
            sold, last_sale = sold_by_variant.get(vid, (_ZERO, None))
            per_day = (sold / Decimal(window_days)).quantize(Decimal("0.001"))

            category: MovementCategory
            if on_hand > 0 and (
                last_sale is None or (today - last_sale).days >= dead_days
            ):
                category = MovementCategory.DEAD
            elif per_day >= fast_units_per_day:
                category = MovementCategory.FAST
            elif per_day > 0 and per_day <= slow_units_per_day:
                category = MovementCategory.SLOW
            else:
                category = MovementCategory.NORMAL

            sku, name = meta.get(vid, ("?", "?"))
            out.append(
                MovementRow(
                    variant_id=vid,
                    sku=sku,
                    product_name=name,
                    on_hand=on_hand,
                    sold_last_window=sold,
                    velocity_per_day=per_day,
                    last_sale_at=last_sale,
                    category=category,
                )
            )
        out.sort(key=lambda m: (m.category.value, -float(m.velocity_per_day)))
        return out

    # ------------------------------------------------------------------
    # Inventory value
    # ------------------------------------------------------------------
    async def inventory_value(
        self, *, store_id: uuid.UUID | None = None
    ) -> InventoryValueTotal:
        """Total ₹ value of on-hand stock, priced at variant.cost_price."""
        # Per-store breakdown.
        per_store_stmt = (
            select(
                Store.id,
                Store.code,
                Store.name,
                func.count(StockBalance.id).label("line_count"),
                func.coalesce(func.sum(StockBalance.quantity), 0).label("on_hand"),
                func.coalesce(
                    func.sum(StockBalance.quantity * ProductVariant.cost_price), 0
                ).label("value"),
            )
            .join(StockBalance, StockBalance.store_id == Store.id, isouter=True)
            .join(
                ProductVariant,
                ProductVariant.id == StockBalance.variant_id,
                isouter=True,
            )
            .group_by(Store.id, Store.code, Store.name)
            .order_by(Store.code)
        )
        if store_id is not None:
            per_store_stmt = per_store_stmt.where(Store.id == store_id)

        per_store: list[InventoryValueRow] = []
        for r in (await self.db.execute(per_store_stmt)).all():
            per_store.append(
                InventoryValueRow(
                    store_id=r.id,
                    store_code=r.code,
                    store_name=r.name,
                    line_count=int(r.line_count or 0),
                    on_hand_units=_dec(r.on_hand),
                    inventory_value=_dec(r.value),
                )
            )

        # Overall totals derived from the per-store rows so it's always consistent.
        total_lines = sum(s.line_count for s in per_store)
        total_units = sum((s.on_hand_units for s in per_store), start=_ZERO)
        total_value = sum((s.inventory_value for s in per_store), start=_ZERO)
        return InventoryValueTotal(
            line_count=total_lines,
            on_hand_units=total_units,
            inventory_value=total_value,
            per_store=per_store,
        )

    # ------------------------------------------------------------------
    # Aging — days since last inbound
    # ------------------------------------------------------------------
    async def aging(
        self, *, store_id: uuid.UUID | None = None, limit: int = 500
    ) -> list[InventoryAgingRow]:
        # Last inbound movement per (variant, store).
        inbound_kinds = [
            MovementKind.PURCHASE_RECEIPT,
            MovementKind.SALE_RETURN,
            MovementKind.TRANSFER_IN,
            MovementKind.OPENING_BALANCE,
        ]

        last_inbound = (
            select(
                StockMovement.variant_id,
                StockMovement.store_id,
                func.max(func.date(StockMovement.created_at)).label("last_in"),
            )
            .where(StockMovement.kind.in_([k for k in inbound_kinds]))
            .group_by(StockMovement.variant_id, StockMovement.store_id)
            .subquery()
        )

        stmt = (
            select(
                StockBalance.quantity,
                ProductVariant.id.label("variant_id"),
                ProductVariant.sku,
                Product.name.label("product_name"),
                Store.id.label("store_id"),
                Store.code.label("store_code"),
                last_inbound.c.last_in,
            )
            .join(ProductVariant, ProductVariant.id == StockBalance.variant_id)
            .join(Product, Product.id == ProductVariant.product_id)
            .join(Store, Store.id == StockBalance.store_id)
            .outerjoin(
                last_inbound,
                (last_inbound.c.variant_id == StockBalance.variant_id)
                & (last_inbound.c.store_id == StockBalance.store_id),
            )
            .where(StockBalance.quantity > 0)
            .limit(limit)
        )
        if store_id is not None:
            stmt = stmt.where(StockBalance.store_id == store_id)

        today = date.today()
        out: list[InventoryAgingRow] = []
        for r in (await self.db.execute(stmt)).mappings().all():
            last = r["last_in"]
            if last and not isinstance(last, date):
                last = date.fromisoformat(str(last))
            days = (today - last).days if last else None
            bucket = self._bucket_days(days)
            out.append(
                InventoryAgingRow(
                    variant_id=r["variant_id"],
                    sku=r["sku"],
                    product_name=r["product_name"],
                    store_id=r["store_id"],
                    store_code=r["store_code"],
                    quantity=_dec(r["quantity"]),
                    last_inbound_at=last,
                    days_since_inbound=days,
                    bucket=bucket,
                )
            )
        out.sort(key=lambda a: -(a.days_since_inbound or -1))
        return out

    # ------------------------------------------------------------------
    # Landing-page summary
    # ------------------------------------------------------------------
    async def health_summary(
        self,
        *,
        window_days: int = 30,
        dead_days: int = 60,
        store_id: uuid.UUID | None = None,
    ) -> InventoryHealthSummary:
        alerts = await self.stock_alerts(store_id=store_id, window_days=window_days)
        movement = await self.movement_analysis(
            window_days=window_days, store_id=store_id, dead_days=dead_days,
        )
        value = await self.inventory_value(store_id=store_id)

        return InventoryHealthSummary(
            total_skus_in_stock=sum(1 for a in alerts if a.quantity > 0),
            out_of_stock_count=sum(1 for a in alerts if a.category == StockCategory.OUT_OF_STOCK),
            low_stock_count=sum(1 for a in alerts if a.category == StockCategory.LOW),
            overstock_count=sum(1 for a in alerts if a.category == StockCategory.OVERSTOCK),
            dead_stock_count=sum(1 for m in movement if m.category == MovementCategory.DEAD),
            fast_movers_count=sum(1 for m in movement if m.category == MovementCategory.FAST),
            slow_movers_count=sum(1 for m in movement if m.category == MovementCategory.SLOW),
            total_inventory_value=value.inventory_value,
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _categorise_stock(
        self, qty: Decimal, reorder: Decimal, overstock: Decimal | None
    ) -> StockCategory:
        if qty <= 0:
            return StockCategory.OUT_OF_STOCK
        if reorder > 0 and qty <= reorder:
            return StockCategory.LOW
        if overstock is not None and qty > _dec(overstock):
            return StockCategory.OVERSTOCK
        return StockCategory.HEALTHY

    def _bucket_days(self, days: int | None) -> str:
        if days is None:
            return "unknown"
        if days <= 30:
            return "0-30"
        if days <= 60:
            return "31-60"
        if days <= 90:
            return "61-90"
        return "90+"

    async def _velocity_map(
        self, *, window_days: int, store_id: uuid.UUID | None
    ) -> dict[tuple[uuid.UUID, uuid.UUID], Decimal]:
        end = date.today()
        start = end - timedelta(days=window_days)
        stmt = (
            select(
                SaleLine.variant_id,
                Sale.store_id,
                func.coalesce(func.sum(SaleLine.quantity), 0).label("sold"),
            )
            .join(Sale, Sale.id == SaleLine.sale_id)
            .where(
                Sale.status == SaleStatus.COMPLETED,
                func.date(Sale.created_at).between(start, end),
            )
            .group_by(SaleLine.variant_id, Sale.store_id)
        )
        if store_id is not None:
            stmt = stmt.where(Sale.store_id == store_id)
        return {
            (r.variant_id, r.store_id): _dec(r.sold)
            for r in (await self.db.execute(stmt)).all()
        }
