"""Product + variant + image endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import DbSession, require_elevation, require_min_role
from app.db.models.user import UserRole
from app.schemas.common import Page
from app.schemas.product import (
    ImageCreate,
    ImageRead,
    ProductCreate,
    ProductRead,
    ProductSummary,
    ProductUpdate,
    VariantCreate,
    VariantRead,
    VariantUpdate,
)
from app.schemas.product_import import ProductImportRequest, ProductImportResult
from app.services.product import ProductService
from app.services.product_import import ProductImportService

router = APIRouter(prefix="/products", tags=["products"])


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------


@router.get(
    "",
    response_model=Page[ProductSummary],
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def list_products(
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    search: str | None = Query(None, description="Case-insensitive name search"),
    category_id: uuid.UUID | None = None,
    brand_id: uuid.UUID | None = None,
    is_active: bool | None = None,
) -> Page[ProductSummary]:
    rows, total = await ProductService(db).list(
        page=page,
        page_size=page_size,
        search=search,
        category_id=category_id,
        brand_id=brand_id,
        is_active=is_active,
    )
    return Page[ProductSummary](items=rows, total=total, page=page, page_size=page_size)


@router.post(
    "",
    response_model=ProductRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def create_product(payload: ProductCreate, db: DbSession) -> ProductRead:
    product = await ProductService(db).create(payload)
    return ProductRead.model_validate(product)


@router.post(
    "/import",
    response_model=ProductImportResult,
    summary="Bulk-import a catalog from CSV. Dry run by default.",
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def import_products(
    payload: ProductImportRequest, db: DbSession
) -> ProductImportResult:
    """Import a shop's catalog.

    MANAGER and above, matching single-product creation — a cashier must not be
    able to rewrite the catalog they are selling from.

    Declared BEFORE `/{product_id}` on purpose: FastAPI matches routes in
    order, and a later declaration would make "import" be read as a product id.
    """
    return await ProductImportService(db).run(payload)


@router.get(
    "/{product_id}",
    response_model=ProductRead,
    dependencies=[Depends(require_min_role(UserRole.CASHIER))],
)
async def get_product(product_id: uuid.UUID, db: DbSession) -> ProductRead:
    product = await ProductService(db).get(product_id)
    return ProductRead.model_validate(product)


@router.patch(
    "/{product_id}",
    response_model=ProductRead,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def update_product(product_id: uuid.UUID, payload: ProductUpdate, db: DbSession) -> ProductRead:
    product = await ProductService(db).update(product_id, payload)
    return ProductRead.model_validate(product)


@router.delete(
    "/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_elevation), Depends(require_min_role(UserRole.OWNER))],
)
async def delete_product(product_id: uuid.UUID, db: DbSession) -> None:
    await ProductService(db).delete(product_id)


# ---------------------------------------------------------------------------
# Variants
# ---------------------------------------------------------------------------


@router.post(
    "/{product_id}/variants",
    response_model=VariantRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def add_variant(
    product_id: uuid.UUID, payload: VariantCreate, db: DbSession
) -> VariantRead:
    return VariantRead.model_validate(await ProductService(db).add_variant(product_id, payload))


@router.patch(
    "/variants/{variant_id}",
    response_model=VariantRead,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def update_variant(
    variant_id: uuid.UUID, payload: VariantUpdate, db: DbSession
) -> VariantRead:
    return VariantRead.model_validate(await ProductService(db).update_variant(variant_id, payload))


@router.delete(
    "/variants/{variant_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_elevation), Depends(require_min_role(UserRole.MANAGER))],
)
async def delete_variant(variant_id: uuid.UUID, db: DbSession) -> None:
    await ProductService(db).delete_variant(variant_id)


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------


@router.post(
    "/{product_id}/images",
    response_model=ImageRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_min_role(UserRole.MANAGER))],
)
async def add_image(product_id: uuid.UUID, payload: ImageCreate, db: DbSession) -> ImageRead:
    return ImageRead.model_validate(await ProductService(db).add_image(product_id, payload))


@router.delete(
    "/images/{image_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_elevation), Depends(require_min_role(UserRole.MANAGER))],
)
async def delete_image(image_id: uuid.UUID, db: DbSession) -> None:
    await ProductService(db).delete_image(image_id)
