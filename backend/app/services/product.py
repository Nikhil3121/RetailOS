"""Product + variant + image orchestration.

The heavy lifting is:

- SKU/barcode uniqueness is enforced *before* insert (nicer error messages) and
  again by the DB unique index (defence in depth).
- Simple products auto-materialise a single default variant so downstream code
  (inventory, POS) can always assume `product.variants[0]` exists.
- List endpoints return a `ProductSummary` (one row per product) via a single
  aggregate query — no N+1 across variants.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.exceptions import ConflictError, NotFoundError
from app.db.models.brand import Brand
from app.db.models.category import Category
from app.db.models.product import Product, ProductImage, ProductVariant
from app.db.models.supplier_ledger import PriceChange
from app.db.models.unit import Unit
from app.schemas.product import (
    ImageCreate,
    ProductCreate,
    ProductSummary,
    ProductUpdate,
    VariantCreate,
    VariantUpdate,
)
from app.services._slug import slugify


class ProductService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # Product-level operations
    # ------------------------------------------------------------------
    async def create(self, payload: ProductCreate) -> Product:
        # Validate all referenced FKs up-front so we fail fast with a clean error.
        await self._resolve_or_raise(Unit, payload.unit_id, "UNIT_NOT_FOUND", "Unit not found.")
        if payload.purchase_unit_id is not None:
            await self._resolve_or_raise(
                Unit, payload.purchase_unit_id, "UNIT_NOT_FOUND", "Purchase unit not found."
            )
        if payload.brand_id is not None:
            await self._resolve_or_raise(Brand, payload.brand_id, "BRAND_NOT_FOUND", "Brand not found.")
        if payload.category_id is not None:
            await self._resolve_or_raise(
                Category, payload.category_id, "CATEGORY_NOT_FOUND", "Category not found."
            )

        variants = payload.variants or [self._default_variant(payload.name)]
        await self._assert_sku_barcode_unique(variants)

        product = Product(
            name=payload.name,
            description=payload.description,
            hsn_code=payload.hsn_code,
            tax_rate=payload.tax_rate,
            brand_id=payload.brand_id,
            category_id=payload.category_id,
            unit_id=payload.unit_id,
            purchase_unit_id=payload.purchase_unit_id,
            # Always 1 when no purchase unit is set, so an unconfigured product
            # converts 1:1 and behaves exactly as it did before.
            purchase_conversion=(
                payload.purchase_conversion if payload.purchase_unit_id else Decimal("1")
            ),
            is_active=payload.is_active,
        )
        product.variants = [self._variant_from_payload(v) for v in variants]
        product.images = [self._image_from_payload(i) for i in payload.images]

        self.db.add(product)
        await self.db.flush()
        return await self._reload(product.id)

    async def get(self, product_id: uuid.UUID) -> Product:
        stmt = (
            select(Product)
            .where(Product.id == product_id)
            .options(selectinload(Product.variants), selectinload(Product.images))
        )
        product = await self.db.scalar(stmt)
        if product is None:
            raise NotFoundError("Product not found.", code="PRODUCT_NOT_FOUND")
        return product

    async def list(
        self,
        *,
        page: int = 1,
        page_size: int = 50,
        search: str | None = None,
        category_id: uuid.UUID | None = None,
        brand_id: uuid.UUID | None = None,
        is_active: bool | None = None,
        origin_store_id: uuid.UUID | None = None,
    ) -> tuple[list[ProductSummary], int]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 1000)

        base = select(Product)

        if origin_store_id is not None:
            # Which branch's RANGE the SKU came from — not where its stock is.
            # Matched with EXISTS on the variants because one product can carry
            # SKUs from both ranges: in the legacy export, "COAT PANT" has three
            # SKUs in the MS1 series and the rest in MS2's.
            base = base.where(
                select(ProductVariant.id)
                .where(
                    ProductVariant.product_id == Product.id,
                    ProductVariant.origin_store_id == origin_store_id,
                )
                .exists()
            )
        if search:
            # Match on any field a shopkeeper is likely to type into the
            # search box: product name, HSN code, or the variant's SKU /
            # barcode. Scanner input lands as the raw barcode string;
            # numeric SKUs like "300100" are how staff refer to items in
            # the daily bill flow.
            like = f"%{search.strip()}%"
            variant_hit = (
                select(ProductVariant.id)
                .where(
                    ProductVariant.product_id == Product.id,
                    or_(
                        ProductVariant.sku.ilike(like),
                        ProductVariant.barcode.ilike(like),
                    ),
                )
                .exists()
            )
            base = base.where(
                or_(
                    Product.name.ilike(like),
                    Product.hsn_code.ilike(like),
                    variant_hit,
                )
            )
        if category_id is not None:
            base = base.where(Product.category_id == category_id)
        if brand_id is not None:
            base = base.where(Product.brand_id == brand_id)
        if is_active is not None:
            base = base.where(Product.is_active == is_active)

        total = await self.db.scalar(
            select(func.count()).select_from(base.subquery())
        ) or 0

        rows = (
            await self.db.scalars(
                base.options(selectinload(Product.variants))
                .order_by(Product.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()

        summaries = [self._to_summary(p) for p in rows]
        return summaries, int(total)

    async def update(self, product_id: uuid.UUID, payload: ProductUpdate) -> Product:
        product = await self.get(product_id)
        data = payload.model_dump(exclude_unset=True)

        if "unit_id" in data and data["unit_id"] is not None:
            await self._resolve_or_raise(Unit, data["unit_id"], "UNIT_NOT_FOUND", "Unit not found.")
        if "brand_id" in data and data["brand_id"] is not None:
            await self._resolve_or_raise(Brand, data["brand_id"], "BRAND_NOT_FOUND", "Brand not found.")
        if "category_id" in data and data["category_id"] is not None:
            await self._resolve_or_raise(
                Category, data["category_id"], "CATEGORY_NOT_FOUND", "Category not found."
            )

        for field, value in data.items():
            setattr(product, field, value)
        await self.db.flush()
        return await self._reload(product.id)

    async def delete(self, product_id: uuid.UUID) -> None:
        product = await self.get(product_id)
        await self.db.delete(product)
        await self.db.flush()

    # ------------------------------------------------------------------
    # Variant-level operations
    # ------------------------------------------------------------------
    async def add_variant(self, product_id: uuid.UUID, payload: VariantCreate) -> ProductVariant:
        await self.get(product_id)  # 404 if missing
        await self._assert_sku_barcode_unique([payload])
        variant = self._variant_from_payload(payload)
        variant.product_id = product_id
        self.db.add(variant)
        await self.db.flush()
        return variant

    async def update_variant(self, variant_id: uuid.UUID, payload: VariantUpdate) -> ProductVariant:
        variant = await self.db.get(ProductVariant, variant_id)
        if variant is None:
            raise NotFoundError("Variant not found.", code="VARIANT_NOT_FOUND")
        data = payload.model_dump(exclude_unset=True)

        if "sku" in data and data["sku"] and data["sku"] != variant.sku:
            clash = await self.db.scalar(
                select(ProductVariant).where(ProductVariant.sku == data["sku"])
            )
            if clash and clash.id != variant.id:
                raise ConflictError("SKU already in use.", code="VARIANT_SKU_TAKEN")

        if "barcode" in data and data["barcode"]:
            clash = await self.db.scalar(
                select(ProductVariant).where(ProductVariant.barcode == data["barcode"])
            )
            if clash and clash.id != variant.id:
                raise ConflictError("Barcode already in use.", code="VARIANT_BARCODE_TAKEN")

        # ---- repricing history ---------------------------------------------
        #
        # Captured BEFORE the fields are overwritten, because after the loop
        # the old values are gone. Only written when a price actually moved —
        # a row for every edit would bury the price changes in noise about
        # renamed variants.
        priced = ("cost_price", "mrp", "selling_price")
        moved = {
            f: (getattr(variant, f), data[f])
            for f in priced
            if f in data and data[f] is not None and getattr(variant, f) != data[f]
        }

        for field, value in data.items():
            setattr(variant, field, value)

        if moved:
            self.db.add(
                PriceChange(
                    variant_id=variant.id,
                    old_cost_price=moved.get("cost_price", (None, None))[0],
                    new_cost_price=moved.get("cost_price", (None, None))[1],
                    old_mrp=moved.get("mrp", (None, None))[0],
                    new_mrp=moved.get("mrp", (None, None))[1],
                    old_selling_price=moved.get("selling_price", (None, None))[0],
                    new_selling_price=moved.get("selling_price", (None, None))[1],
                )
            )

        await self.db.flush()
        return variant

    async def delete_variant(self, variant_id: uuid.UUID) -> None:
        variant = await self.db.get(ProductVariant, variant_id)
        if variant is None:
            raise NotFoundError("Variant not found.", code="VARIANT_NOT_FOUND")
        # Prevent orphaning a product: refuse to delete the last variant.
        count = await self.db.scalar(
            select(func.count(ProductVariant.id)).where(
                ProductVariant.product_id == variant.product_id
            )
        ) or 0
        if count <= 1:
            raise ConflictError(
                "A product must retain at least one variant.",
                code="LAST_VARIANT",
            )
        await self.db.delete(variant)
        await self.db.flush()

    # ------------------------------------------------------------------
    # Image-level operations
    # ------------------------------------------------------------------
    async def add_image(self, product_id: uuid.UUID, payload: ImageCreate) -> ProductImage:
        await self.get(product_id)
        image = self._image_from_payload(payload)
        image.product_id = product_id
        self.db.add(image)
        await self.db.flush()
        return image

    async def delete_image(self, image_id: uuid.UUID) -> None:
        image = await self.db.get(ProductImage, image_id)
        if image is None:
            raise NotFoundError("Image not found.", code="IMAGE_NOT_FOUND")
        await self.db.delete(image)
        await self.db.flush()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    async def _reload(self, product_id: uuid.UUID) -> Product:
        return await self.get(product_id)

    def _default_variant(self, product_name: str) -> VariantCreate:
        base_sku = slugify(product_name, max_length=48).upper().replace("-", "")
        return VariantCreate(
            name=product_name,
            sku=f"{base_sku[:40]}-{uuid.uuid4().hex[:6].upper()}",
        )

    def _variant_from_payload(self, payload: VariantCreate) -> ProductVariant:
        return ProductVariant(
            name=payload.name,
            sku=payload.sku,
            barcode=payload.barcode,
            attributes=payload.attributes,
            cost_price=payload.cost_price,
            mrp=payload.mrp,
            selling_price=payload.selling_price,
            reorder_point=payload.reorder_point,
            reorder_quantity=payload.reorder_quantity,
            overstock_point=payload.overstock_point,
            sort_order=payload.sort_order,
            is_active=payload.is_active,
            origin_store_id=payload.origin_store_id,
        )

    def _image_from_payload(self, payload: ImageCreate) -> ProductImage:
        return ProductImage(
            url=str(payload.url),
            alt_text=payload.alt_text,
            sort_order=payload.sort_order,
        )

    async def _assert_sku_barcode_unique(self, variants: list[VariantCreate]) -> None:
        skus = [v.sku for v in variants]
        # Duplicate check within the payload first — cheap and points to user error.
        if len(skus) != len(set(skus)):
            raise ConflictError("Duplicate SKU inside payload.", code="VARIANT_SKU_DUPLICATE")

        barcodes = [v.barcode for v in variants if v.barcode]
        if len(barcodes) != len(set(barcodes)):
            raise ConflictError("Duplicate barcode inside payload.", code="VARIANT_BARCODE_DUPLICATE")

        # Then check the DB.
        clash = await self.db.scalar(
            select(ProductVariant.sku).where(ProductVariant.sku.in_(skus))
        )
        if clash is not None:
            raise ConflictError(f"SKU '{clash}' already in use.", code="VARIANT_SKU_TAKEN")

        if barcodes:
            clash_bc = await self.db.scalar(
                select(ProductVariant.barcode).where(ProductVariant.barcode.in_(barcodes))
            )
            if clash_bc is not None:
                raise ConflictError(
                    f"Barcode '{clash_bc}' already in use.", code="VARIANT_BARCODE_TAKEN"
                )

    async def _resolve_or_raise(self, model, id_: uuid.UUID, code: str, msg: str) -> None:
        row = await self.db.get(model, id_)
        if row is None:
            raise NotFoundError(msg, code=code)

    def _to_summary(self, p: Product) -> ProductSummary:
        primary = p.variants[0] if p.variants else None
        return ProductSummary(
            id=p.id,
            name=p.name,
            hsn_code=p.hsn_code,
            tax_rate=p.tax_rate,
            brand_id=p.brand_id,
            category_id=p.category_id,
            unit_id=p.unit_id,
            is_active=p.is_active,
            variant_count=len(p.variants),
            primary_sku=primary.sku if primary else None,
            primary_selling_price=primary.selling_price if primary else Decimal("0.00"),
            created_at=p.created_at,
            updated_at=p.updated_at,
        )
