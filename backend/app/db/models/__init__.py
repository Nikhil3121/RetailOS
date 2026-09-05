"""ORM models package.

Every model must be imported here so Alembic's autogenerate sees it on
`Base.metadata`. Missing an import here means missing tables in migrations.
"""

from app.db.models.audit import AuditLog, UserDashboardLayout
from app.db.models.brand import Brand
from app.db.models.campaign import (
    Campaign,
    CampaignChannel,
    CampaignRecipient,
    CampaignStatus,
    RecipientStatus,
)
from app.db.models.category import Category
from app.db.models.commission import (
    CommissionRule,
    CommissionScope,
    CommissionType,
    StaffTarget,
    TargetPeriod,
)
from app.db.models.coupon import Coupon, CouponDiscountType, CouponRedemption
from app.db.models.bundle import ProductBundleItem
from app.db.models.customer import Customer
from app.db.models.price_list import PriceList, PriceListItem
from app.db.models.day_session import DaySession, DayStatus
from app.db.models.expense import Expense, ExpenseCategory, ExpenseStatus
from app.db.models.inventory import MovementKind, StockBalance, StockMovement
from app.db.models.loyalty import (
    CustomerLoyalty,
    LoyaltyKind,
    LoyaltyLedger,
    LoyaltyProgram,
    MembershipTier,
)
from app.db.models.notification import (
    Notification,
    NotificationChannel,
    NotificationKind,
    NotificationRule,
    NotificationSeverity,
)
from app.db.models.product import Product, ProductImage, ProductVariant
from app.db.models.purchase import (
    PurchaseOrder,
    PurchaseOrderLine,
    PurchaseOrderStatus,
)
from app.db.models.sale import (
    PaymentMethod,
    Sale,
    SaleLine,
    SaleNumberSequence,
    SalePayment,
    SaleStatus,
)
from app.db.models.store import Store
from app.db.models.supplier import Supplier
from app.db.models.unit import Unit
from app.db.models.user import RefreshToken, User, UserRole

__all__ = [
    "AuditLog",
    "Brand",
    "CustomerLoyalty",
    "LoyaltyKind",
    "LoyaltyLedger",
    "LoyaltyProgram",
    "MembershipTier",
    "Campaign",
    "CampaignChannel",
    "CampaignRecipient",
    "CampaignStatus",
    "Category",
    "RecipientStatus",
    "CommissionRule",
    "CommissionScope",
    "CommissionType",
    "Coupon",
    "CouponDiscountType",
    "CouponRedemption",
    "Customer",
    "ProductBundleItem",
    "PriceList",
    "PriceListItem",
    "DaySession",
    "DayStatus",
    "Expense",
    "ExpenseCategory",
    "ExpenseStatus",
    "MovementKind",
    "Notification",
    "NotificationChannel",
    "NotificationKind",
    "NotificationRule",
    "NotificationSeverity",
    "PaymentMethod",
    "Product",
    "ProductImage",
    "ProductVariant",
    "PurchaseOrder",
    "PurchaseOrderLine",
    "PurchaseOrderStatus",
    "RefreshToken",
    "Sale",
    "SaleLine",
    "SaleNumberSequence",
    "SalePayment",
    "SaleStatus",
    "StaffTarget",
    "StockBalance",
    "StockMovement",
    "Store",
    "Supplier",
    "TargetPeriod",
    "Unit",
    "User",
    "UserDashboardLayout",
    "UserRole",
]
