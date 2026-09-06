"""Which mall's range a SKU belongs to, and the legacy code that says so

WHAT THIS IS FOR
----------------
M.S. Mall runs two branches and each keeps its own product series. In the
outgoing Richie Retail system the series lives on the item as
`LAMC_SCOMPANYCODE`: "1" for MS MALL (Thana Road), "3" for MS MALL 2 (GT Road).
The bill series carries the same idea — every bill in the MS2 export reads
`MS2/26-27/...`.

RetailOS had nowhere to record that, so once both branches are on one database
there is no way to answer the question the owner actually asks: how much of
what we sold today came from the other mall's range.

WHY THE VARIANT AND NOT THE PRODUCT
-----------------------------------
The obvious place is the product. The data says otherwise: in the MS2 export,
LAM product 360 ("COAT PANT") has three SKUs marked series 1 and the rest
series 3. Series is a property of the individual SKU, so putting it on the
product would force a wrong answer for any product that straddles both ranges.

WHAT ORIGIN IS NOT
------------------
It is NOT where the stock is, and nothing here changes stock posting. Stock
lives in `stock_balances(variant_id, store_id)` and a sale always deducts from
the store that billed it. Origin is provenance — a label saying which range the
SKU came from — and it is used for reporting only.

That distinction matters because branch transfers are coming next. Once a
transfer moves goods from MS1 to MS2 the stock IS at MS2, and deducting from
the origin branch instead would take the same garment out twice.

stores.legacy_code
    The branch's identifier in the old system ("1", "3"). Written during import
    so legacy rows can be matched to a branch, and kept afterwards so a re-run
    or a later reconciliation can find its way back.

stores.sku_prefix
    The branch's product series label, for defaulting the origin of a SKU
    created by hand later.

Everything is NULLABLE and nothing is backfilled. A SKU with no origin behaves
exactly as it does today.

Revision ID: 20270105_0022
Revises: 20261222_0021
Create Date: 2027-01-05
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20270105_0022"
down_revision: Union[str, None] = "20261222_0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # batch_alter_table so this also runs on SQLite, which cannot ALTER a
    # column in place and needs a table rebuild.
    with op.batch_alter_table("stores") as batch:
        batch.add_column(sa.Column("legacy_code", sa.String(length=32), nullable=True))
        batch.add_column(sa.Column("sku_prefix", sa.String(length=16), nullable=True))

    with op.batch_alter_table("product_variants") as batch:
        batch.add_column(sa.Column("origin_store_id", sa.Uuid(), nullable=True))
        # SET NULL rather than CASCADE: deleting a branch must never delete the
        # SKUs that came from its range. The goods still exist.
        batch.create_foreign_key(
            "fk_product_variants_origin_store_id_stores",
            "stores",
            ["origin_store_id"],
            ["id"],
            ondelete="SET NULL",
        )

    with op.batch_alter_table("sale_lines") as batch:
        # Snapshotted onto the LINE, beside mrp and tax_rate and for the same
        # reason: it is what was true when the bill was printed. Re-assigning a
        # SKU to another range later must not rewrite history.
        #
        # On the line rather than the sale because one customer can buy from
        # both ranges on one bill and will not sort their basket by branch.
        batch.add_column(sa.Column("origin_store_id", sa.Uuid(), nullable=True))
        batch.create_foreign_key(
            "fk_sale_lines_origin_store_id_stores",
            "stores",
            ["origin_store_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # The cross-branch report groups by (billing store, line origin). Without
    # these it is a sequential scan of every line ever sold.
    op.create_index(
        "ix_sale_lines_origin_store_id", "sale_lines", ["origin_store_id"], unique=False
    )
    op.create_index(
        "ix_product_variants_origin_store_id",
        "product_variants",
        ["origin_store_id"],
        unique=False,
    )
    op.create_index("ix_stores_legacy_code", "stores", ["legacy_code"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_stores_legacy_code", table_name="stores")
    op.drop_index("ix_product_variants_origin_store_id", table_name="product_variants")
    op.drop_index("ix_sale_lines_origin_store_id", table_name="sale_lines")

    with op.batch_alter_table("sale_lines") as batch:
        batch.drop_constraint("fk_sale_lines_origin_store_id_stores", type_="foreignkey")
        batch.drop_column("origin_store_id")

    with op.batch_alter_table("product_variants") as batch:
        batch.drop_constraint(
            "fk_product_variants_origin_store_id_stores", type_="foreignkey"
        )
        batch.drop_column("origin_store_id")

    with op.batch_alter_table("stores") as batch:
        batch.drop_column("sku_prefix")
        batch.drop_column("legacy_code")
