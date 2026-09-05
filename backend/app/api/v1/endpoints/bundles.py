"""Product bundle endpoints — the recipe behind a combo variant."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, require_elevation, require_min_role
from app.core.exceptions import NotFoundError, ValidationError
from app.db.models.bundle import ProductBundleItem
from app.db.models.product import Product, ProductVariant
from app.db.models.user import UserRole
from app.schemas.bundle import BundleComponentRead, BundleSet
from app.services.audit import AuditService

router = APIRouter(prefix="/bundles", tags=["bundles"])


@router.get(
    "/{bundle_variant_id}",
    response_model=list[BundleComponentRead],
    summary="What this bundle is made of. Empty means it is an ordinary product.",
)
async def get_bundle(
    bundle_variant_id: uuid.UUID, db: DbSession
) -> list[BundleComponentRead]:
    rows = await db.execute(
        select(ProductBundleItem, Product.name, ProductVariant.name, ProductVariant.sku)
        .join(ProductVariant, ProductVariant.id == ProductBundleItem.component_variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(ProductBundleItem.bundle_variant_id == bundle_variant_id)
    )
    return [
        BundleComponentRead(
            component_variant_id=item.component_variant_id,
            quantity=item.quantity,
            product_name=pname,
            variant_name=vname,
            sku=sku,
        )
        for item, pname, vname, sku in rows.all()
    ]


@router.put(
    "/{bundle_variant_id}",
    response_model=list[BundleComponentRead],
    summary="Replace this bundle's component list.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def set_bundle(
    bundle_variant_id: uuid.UUID,
    payload: BundleSet,
    db: DbSession,
    user: CurrentUser,
) -> list[BundleComponentRead]:
    """Replace, not upsert — a recipe is read as a whole.

    Leaving out a component means "this is no longer in the combo", which is the
    opposite of what an upsert would do.
    """
    bundle = await db.get(ProductVariant, bundle_variant_id)
    if bundle is None:
        raise NotFoundError("Bundle variant not found.", code="VARIANT_NOT_FOUND")

    ids = [c.component_variant_id for c in payload.components]
    if bundle_variant_id in ids:
        # Selling it would recurse forever, and the shop cannot own a box of
        # itself.
        raise ValidationError(
            "A bundle cannot contain itself.", code="BUNDLE_SELF_REFERENCE"
        )

    known = set(
        (await db.scalars(select(ProductVariant.id).where(ProductVariant.id.in_(ids)))).all()
    )
    missing = set(ids) - known
    if missing:
        raise ValidationError(
            f"Unknown components: {sorted(str(m) for m in missing)}",
            code="VARIANT_NOT_FOUND",
        )

    # A component that is itself a bundle would need recursive explosion at
    # sale time. Refused rather than half-supported.
    nested = set(
        (
            await db.scalars(
                select(ProductBundleItem.bundle_variant_id).where(
                    ProductBundleItem.bundle_variant_id.in_(ids)
                )
            )
        ).all()
    )
    if nested:
        raise ValidationError(
            "A bundle cannot contain another bundle.", code="BUNDLE_NESTED"
        )

    existing = (
        await db.scalars(
            select(ProductBundleItem).where(
                ProductBundleItem.bundle_variant_id == bundle_variant_id
            )
        )
    ).all()
    for row in existing:
        await db.delete(row)
    await db.flush()

    for c in payload.components:
        db.add(
            ProductBundleItem(
                bundle_variant_id=bundle_variant_id,
                component_variant_id=c.component_variant_id,
                quantity=c.quantity,
            )
        )
    await db.flush()

    await AuditService(db).log(
        action="bundle.updated",
        summary=f"Bundle {bundle.sku} set to {len(payload.components)} component(s)",
        entity_type="product_variant",
        entity_id=bundle_variant_id,
        actor=user,
        changes={"components": len(payload.components)},
    )
    return await get_bundle(bundle_variant_id, db)


@router.delete(
    "/{bundle_variant_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Stop this variant being a bundle. It becomes an ordinary product.",
    dependencies=[Depends(require_elevation), Depends(require_min_role(UserRole.MANAGER))],
)
async def clear_bundle(bundle_variant_id: uuid.UUID, db: DbSession) -> None:
    rows = (
        await db.scalars(
            select(ProductBundleItem).where(
                ProductBundleItem.bundle_variant_id == bundle_variant_id
            )
        )
    ).all()
    for row in rows:
        await db.delete(row)
    await db.flush()
