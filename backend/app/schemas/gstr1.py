"""GSTR-1 DTOs — the monthly outward-supplies return, as a working paper."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# GSTR-1
# ---------------------------------------------------------------------------


class Gstr1RateLine(BaseModel):
    """One tax rate within a document or a summary bucket."""

    rate: Decimal
    taxable_value: Decimal
    #: Split for presentation only. Intra-state supplies carry CGST+SGST,
    #: inter-state carries IGST, and exactly one pair is non-zero on any row.
    cgst: Decimal
    sgst: Decimal
    igst: Decimal


class Gstr1B2bInvoice(BaseModel):
    """An invoice to a registered person — reported invoice by invoice.

    GSTR-1 wants these individually because the recipient claims input credit
    against each one; a summary would leave them nothing to match.
    """

    invoice_number: str
    invoice_date: date
    customer_gstin: str
    customer_name: str
    invoice_value: Decimal
    #: Two-digit state code of the recipient, taken from their GSTIN. The GST
    #: number encodes it, so it cannot disagree with the number itself the way
    #: a separately-typed state field can.
    place_of_supply: str
    reverse_charge: bool = False
    lines: list[Gstr1RateLine]


class Gstr1B2csRow(BaseModel):
    """Counter sales, summarised.

    Unregistered customers are not reported invoice-wise — there is nobody to
    claim credit — so they collapse to one row per (place of supply, rate).
    """

    place_of_supply: str
    rate: Decimal
    taxable_value: Decimal
    cgst: Decimal
    sgst: Decimal
    igst: Decimal
    #: How many bills are behind this row. Not part of the return, but the
    #: figure an accountant checks first when a total looks wrong.
    invoice_count: int


class Gstr1CreditNote(BaseModel):
    """A credit note issued against an invoice.

    Reported POSITIVE. The return has its own sign convention — a credit note
    reduces the liability by being a credit note, not by carrying a negative
    number — whereas this system stores returns as negative money. Flipping it
    here rather than at the filing desk is what stops a return being deducted
    twice.
    """

    note_number: str
    note_date: date
    original_invoice_number: str | None
    customer_gstin: str | None
    customer_name: str | None
    place_of_supply: str
    note_value: Decimal
    lines: list[Gstr1RateLine]


class Gstr1HsnRow(BaseModel):
    """The HSN summary. Mandatory, and the section most often left blank."""

    hsn_code: str
    description: str
    uqc: str
    quantity: Decimal
    taxable_value: Decimal
    cgst: Decimal
    sgst: Decimal
    igst: Decimal


class Gstr1DocumentRange(BaseModel):
    """Documents issued in the period, by series.

    The portal asks for the range and how many were cancelled. A gap in an
    invoice series is the first thing an officer looks for, so the range is
    reported from the numbers actually allocated rather than counted.
    """

    document_type: str
    from_number: str
    to_number: str
    total_count: int
    cancelled_count: int


class Gstr1Return(BaseModel):
    """A GSTR-1 WORKING PAPER for one period and one GSTIN.

    NOT A PORTAL UPLOAD. This is the arithmetic, laid out the way the return
    is laid out, so the person filing can tie their figures to the books
    without re-adding a month of bills by hand. It is deliberately not
    presented as portal-ready JSON: that format is versioned by GSTN, and
    software that claims to produce it without ever having been validated
    against the portal is how a wrong return gets filed with confidence.

    ONE GSTIN AT A TIME. The two malls file separately, so a store must be
    named — a combined figure is not a return anybody can file.
    """

    gstin: str
    store_name: str
    from_date: date
    to_date: date

    b2b: list[Gstr1B2bInvoice]
    b2cs: list[Gstr1B2csRow]
    credit_notes: list[Gstr1CreditNote]
    hsn: list[Gstr1HsnRow]
    documents: list[Gstr1DocumentRange]

    #: Totals, for tying back to the books before anything is filed.
    total_taxable_value: Decimal
    total_tax: Decimal
    total_invoice_value: Decimal

    #: Bills the return could not classify, and why.
    #:
    #: Never silently dropped. A missing HSN code or an unparseable GSTIN
    #: means a line is absent from a section of the return, and an accountant
    #: who is not told will file it short.
    warnings: list[str] = []
