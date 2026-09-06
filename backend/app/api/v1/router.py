"""Aggregate every endpoint module into a single APIRouter mounted at ``/api/v1``.

Adding a new feature = adding a new file under `endpoints/` and one `include_router`
line here. The rest of the app doesn't have to know it exists.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.endpoints import (
    audit,
    auth,
    billing,
    brands,
    campaigns,
    categories,
    commissions,
    coupons,
    customers,
    bundles,
    loyalty,
    held_bills,
    stock_counts,
    payables,
    rewards,
    price_lists,
    dashboard,
    day_sessions,
    expenses,
    health,
    inventory,
    inventory_intelligence,
    notifications,
    products,
    purchase_analytics,
    purchases,
    reports,
    sales,
    staff,
    stores,
    suppliers,
    units,
    users,
)

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(stores.router)
api_router.include_router(units.router)
api_router.include_router(brands.router)
api_router.include_router(categories.router)
api_router.include_router(products.router)
api_router.include_router(suppliers.router)
api_router.include_router(customers.router)
api_router.include_router(price_lists.router)
api_router.include_router(bundles.router)
api_router.include_router(loyalty.router)
api_router.include_router(rewards.router)
api_router.include_router(payables.router)
api_router.include_router(held_bills.router)
api_router.include_router(stock_counts.router)
api_router.include_router(inventory.router)
api_router.include_router(purchases.router)
api_router.include_router(day_sessions.router)
api_router.include_router(sales.router)
api_router.include_router(billing.router)
api_router.include_router(reports.router)
api_router.include_router(dashboard.router)
api_router.include_router(commissions.router)
api_router.include_router(staff.router)
api_router.include_router(coupons.router)
api_router.include_router(campaigns.router)
api_router.include_router(inventory_intelligence.router)
api_router.include_router(purchase_analytics.router)
api_router.include_router(expenses.router)
api_router.include_router(notifications.router)
api_router.include_router(audit.audit_router)
api_router.include_router(audit.layout_router)
