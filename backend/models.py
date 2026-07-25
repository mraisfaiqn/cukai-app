"""
Database models for cukai.ai.

Tables:
  persons        — individual users (login credentials + personal tax profile)
  children       — per-child records for H16 relief tiering (Phase 3)
  entities       — business entities owned by a person (sole-props)
  documents      — uploaded documents queued for AI classification
  capital_assets — Schedule 3 capital allowance registry (multi-year IA/AA schedule)
  breastfeeding_equipment_claims — H11 relief registry (multi-year "once every 2 YAs" gate)
  form_b_profiles — structured data extracted from previously filed Form B returns

Design notes:
  - One person can own many entities (one-to-many via person_id FK on entities).
  - One person can have many children (one-to-many via person_id FK on children) —
    see child_relief.py for the H16a/b/c tiering computed from these records.
  - Entity switching is a UI-only concern tracked via localStorage('activeEntityId');
    it does not require a server-side column.
  - Documents are scoped to a user and optionally to a specific entity via entity_id.
  - Part J (127(3)(b) incentive claims) was removed 14 Jul 2026 by product decision —
    out of scope going forward, same footing as B12/B16/B19/J2. There is no
    IncentiveClaim table anymore; see form-b-roadmap.md.
  - Business-loss (B5/M1) and capital-allowance (M2) carry-forward are auto-tracked
    multi-year schedules (Phase 3, 14 Jul 2026) — see carryforward.py. Entity carries
    only a one-time OPENING balance seed; everything after that is derived from actual
    computed business income/capital-allowance per year, never manually re-entered.
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Boolean, Date, DateTime, Numeric,
    ForeignKey, CheckConstraint, Index,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

Base = declarative_base()


class Person(Base):
    __tablename__ = "persons"

    id            = Column(Integer, primary_key=True, index=True)

    # Login credentials
    email         = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)

    # Personal details
    full_name         = Column(String)
    identification_no = Column(String)  # IC number
    passport_no       = Column(String)  # Passport number — independent of
                                         # identification_no, both optional.
                                         # Form B shows whichever the user has
                                         # actually entered, blank otherwise —
                                         # no "which type is primary" concept.
    personal_tin      = Column(String)
    citizenship       = Column(String, default="MYS")
    gender            = Column(String)
    date_of_birth     = Column(Date)

    # Marital status & dependants
    marital_status          = Column(String, default="single")
    marital_event_date      = Column(Date)
    spouse_name             = Column(String)
    spouse_id_no            = Column(String)
    spouse_passport_no      = Column(String)
    spouse_dob              = Column(Date)
    assessment_type         = Column(String)
    # number_of_children is kept for backward compatibility with profiles
    # created before Phase 3's per-child records existed. Once a person has
    # any `children` rows, the real records are authoritative for H16 and
    # this flat count is ignored — see child_relief.py / main.py's H16
    # computation. New profiles should populate `children` instead of this.
    number_of_children      = Column(Integer, default=0)
    # Disability flags split per person (Phase 3, 14 Jul 2026) — replaces the
    # old combined `has_disabled_dependents` toggle, which couldn't tell
    # "self" (H4, RM6,000) from "spouse" (H15, RM5,000) apart, and couldn't
    # express child disability at all (that's now per-child, see the Child
    # model's `is_disabled` — feeds H16c).
    is_disabled_self        = Column(Boolean, default=False)  # H4
    spouse_is_disabled      = Column(Boolean, default=False)  # H15 — only meaningful if married

    # Alimony to a former wife (H14), independent of CURRENT marital status —
    # a divorced filer can still be paying alimony. Combined with the
    # spouse-relief component of H14 under the same RM4,000 cap; see main.py.
    alimony_paid_myr = Column(Numeric, nullable=True)

    # Spouse's own total income, for joint-assessment aggregation (B21/B22).
    spouse_total_income_myr = Column(Numeric, nullable=True)

    # Bug fix (15 Jul 2026): H14's spouse-relief component (RM4,000) has its
    # own separate disqualifier LHDN added from YA2017 — "the deduction...
    # is NOT allowed if the [spouse] has gross income exceeding RM4,000
    # derived from sources OUTSIDE Malaysia" (subsections 45A(2)/47(6)),
    # UNLESS that spouse is disabled (spouse_is_disabled above already
    # covers the disability carve-out). This is deliberately a SEPARATE
    # field from spouse_total_income_myr — that field is the spouse's total
    # income for B21/B22 aggregation purposes and isn't restricted to
    # foreign-sourced amounts, whereas this test is specifically about
    # foreign-sourced income regardless of what (if anything) the spouse
    # earns domestically. Previously unmodelled entirely.
    spouse_foreign_income_myr = Column(Numeric, nullable=True)

    # Contact & refund details
    phone                   = Column(String)
    correspondence_address  = Column(String)
    correspondence_postcode = Column(String)
    correspondence_city     = Column(String)
    correspondence_state    = Column(String)
    refund_method           = Column(String, default="bank")  # "bank" | "duitnow"
    bank_name               = Column(String)
    bank_account_no         = Column(String)
    duitnow_id_type         = Column(String, default="ic")    # "ic" | "passport" — Form B D11a

    # Other Particulars (Form B Part D) — manually entered here, or (for
    # employer_tin) also populated from a Form EA upload once that pipeline
    # wiring exists; not yet connected, see formB.js's dataGaps.
    employer_tin           = Column(String)
    tax_borne_by_employer  = Column(Boolean, default=False)
    carries_on_ecommerce   = Column(Boolean, default=False)
    ecommerce_model        = Column(String)  # one of ECOMMERCE_MODEL keys in formB.js

    # Basic Particulars item 5 — passport number REGISTERED WITH LHDNM (the
    # last passport number LHDNM has on file, prior to the current one) —
    # distinct from `passport_no` (item 4, the CURRENT passport). Optional,
    # low priority (Phase 3).
    passport_no_lhdnm = Column(String)

    # LHDN compliance flags
    record_keeping       = Column(Boolean, default=True)
    has_foreign_accounts = Column(Boolean, default=False)
    rpgt_disposal        = Column(Boolean, default=False)
    disposal_declared    = Column(Boolean, default=False)  # Form B D12b — only meaningful when rpgt_disposal is True

    # Relief category flags — control which Part H questions appear during filing
    has_dependent_parents           = Column(Boolean, default=False)
    has_epf_life_insurance          = Column(Boolean, default=False)
    has_education_medical_insurance = Column(Boolean, default=False)
    has_lifestyle_purchases         = Column(Boolean, default=False)
    has_sspn_ev_other               = Column(Boolean, default=False)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # All entities this person owns
    entities = relationship(
        "Entity", back_populates="owner", cascade="all, delete-orphan",
    )
    # Per-child records (Phase 3) — replaces the flat number_of_children
    # count once populated. See Child model below.
    children = relationship(
        "Child", back_populates="parent", cascade="all, delete-orphan",
    )


class Child(Base):
    """
    Per-child record for Form B's H16 (child relief) tiering — replaces the
    old flat `Person.number_of_children` count, which could only ever
    support a single flat RM2,000-per-child estimate (H16a). Real H16a/b/c
    tiering needs each child's age, full-time-study status, disability
    status, and (for divorced/co-parenting filers) what percentage of the
    relief THIS filer is eligible to claim — none of which a flat count can
    express. See child_relief.py for the tiering computation.
    """
    __tablename__ = "children"

    id        = Column(Integer, primary_key=True, index=True)
    person_id = Column(Integer, ForeignKey("persons.id", ondelete="CASCADE"), nullable=False)

    name              = Column(String, nullable=False)
    identification_no = Column(String)  # IC or passport no.
    date_of_birth     = Column(Date, nullable=False)

    # H16c eligibility — a disabled child's relief (RM6,000, or RM14,000 if
    # also 18+ and in qualifying higher education) is independent of the
    # under/over-18 tiering that applies to a non-disabled child.
    is_disabled = Column(Boolean, default=False)

    # H16b/H16c's "+RM8,000 at 18+" tier requires BOTH full-time study AND
    # that the study itself meets the qualifying-institution/programme
    # criteria (local university/college excluding matriculation/pre-degree/
    # A-Level, or trade/professional articles, or a full degree programme
    # outside Malaysia) — a child who is 18+ and studying but NOT in a
    # qualifying programme (e.g. A-Levels, matriculation) only gets the base
    # RM2,000, not RM8,000. These are deliberately two separate flags rather
    # than one, since a filer can't always self-assess the second one
    # correctly without reading the Public Ruling — kept as two questions so
    # the UI can explain each precisely instead of overloading one checkbox.
    is_full_time_student = Column(Boolean, default=False)  # only asked/relevant if 18+
    is_higher_education   = Column(Boolean, default=False)  # only asked/relevant if 18+ and studying

    # Percentage of the computed relief THIS filer may claim for this child —
    # 100 for the ordinary case, 50 when two individuals (not a married
    # couple living together) are each entitled to claim half (e.g. divorced
    # co-parents each paying for the same child). Form B's own H16 sub-table
    # has exactly this "Eligibility 100% / Eligibility 50%" column per child.
    eligibility_pct = Column(Integer, default=100)

    # Bug fix (15 Jul 2026): subsection 48(5) ITA 1967 — "the deduction for
    # child is not allowed if the child is in receipt of his own income
    # whereby his total income exceeds the amount of deduction otherwise
    # due." This was previously unmodelled entirely — a child's own income
    # was never asked about at all. Two fields, not one: the child's own
    # total income (compared against the relief amount to decide whether
    # the disqualifier bites), and a separate flag for whether that income
    # is EXCLUSIVELY exempt-type income under Sch. 6 para 24 (scholarship/
    # grant/similar allowance) or employer-under-articles/indentures pay —
    # LHDN's own wording excludes exactly those two from counting as
    # disqualifying income, so a working scholarship-holder child shouldn't
    # be wrongly disqualified just because they receive a stipend.
    own_income_myr = Column(Numeric, nullable=True)
    own_income_is_exempt_type = Column(Boolean, default=False)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        CheckConstraint("eligibility_pct IN (50, 100)", name="ck_child_eligibility_pct"),
    )

    parent = relationship("Person", back_populates="children")


class Entity(Base):
    __tablename__ = "entities"

    id        = Column(Integer, primary_key=True, index=True)
    person_id = Column(Integer, ForeignKey("persons.id", ondelete="CASCADE"), nullable=False)

    entity_type = Column(String, nullable=False, default="sole-prop")

    # Business registration details
    name              = Column(String)
    business_code     = Column(String)
    business_activity = Column(String)
    ssm_no            = Column(String, index=True)
    tin               = Column(String)

    # Business address
    address  = Column(String)
    postcode = Column(String)
    city     = Column(String)
    state    = Column(String)

    # Financial figures
    sales_turnover    = Column(Numeric)
    total_expenditure = Column(Numeric)
    net_profit_loss   = Column(Numeric)
    total_assets      = Column(Numeric)
    total_liabilities = Column(Numeric)
    monthly_income    = Column(Numeric)
    annual_income     = Column(Numeric)

    # ── Opening carry-forward balances (Phase 3, 14 Jul 2026) ────────────
    # Seed values for the multi-year business-loss (B5/M1) and capital-
    # allowance (M2) carry-forward schedules in carryforward.py. Everything
    # AFTER opening_balance_year is auto-tracked from actual computed
    # business income/capital-allowance for each subsequent year that has
    # documents in this system — these three fields exist only because the
    # app can't retroactively know a user's exact pre-adoption history, the
    # same way an accountant entering opening balances into new software
    # would. Manually entered ONCE (or corrected if wrong); never
    # auto-updated afterward.
    opening_unabsorbed_business_loss_myr    = Column(Numeric, nullable=True)
    opening_unabsorbed_capital_allowance_myr = Column(Numeric, nullable=True)
    # The YA these two balances are "as of the end of" — i.e. the balance
    # brought INTO opening_balance_year + 1. Required if either balance
    # above is set; without it there's no anchor year for the 10-year
    # business-loss expiry clock or the forward walk's starting point.
    opening_balance_year = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    owner = relationship("Person", back_populates="entities")


class Document(Base):
    __tablename__ = "documents"

    id        = Column(Integer, primary_key=True, index=True)
    user_id   = Column(String(128), nullable=True, index=True)

    # Which entity this document belongs to — nullable so existing rows are unaffected.
    # All new uploads should populate this from localStorage('activeEntityId').
    entity_id = Column(Integer, ForeignKey("entities.id", ondelete="SET NULL"), nullable=True, index=True)

    file_name          = Column(String(255), nullable=False)
    file_path          = Column(String(512), nullable=False)
    # SHA-256 of the file's raw bytes at upload time, hex-encoded (64 chars).
    # Used by main.py's _check_upload_history (Tier 1) to answer "did I
    # upload this before?" via an exact-content lookup instead of a Mongo
    # similarity search. Required — every code path that creates a Document
    # (_save_and_queue, create_manual_document) computes and sets this.
    file_hash          = Column(String(64),  nullable=False, index=True)
    status             = Column(String(50),  default="pending")
    document_type      = Column(String(100), default="Unclassified")
    category           = Column(String(255), nullable=True)
    tax_status         = Column(String(50),  nullable=True)
    year_of_assessment = Column(Integer,     nullable=True, index=True)
    extracted_data     = Column(JSONB,       nullable=True)
    created_at         = Column(DateTime,    default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'processing', 'completed', 'failed', 'archived')",
            name="ck_document_status",
        ),
        CheckConstraint(
            "tax_status IS NULL OR tax_status IN ('income', 'deductible', 'mixed', 'not_applicable', 'relief', 'non_deductible', 'capital', 'donation', 'tax_installment', 'reference', 'rebate')",
            name="ck_document_tax_status",
        ),
        CheckConstraint(
            "year_of_assessment IS NULL OR (year_of_assessment >= 2000 AND year_of_assessment <= 2100)",
            name="ck_document_ya_range",
        ),
        Index("ix_document_user_ya",   "user_id",   "year_of_assessment"),
        Index("ix_document_entity_ya", "entity_id", "year_of_assessment"),
        # Supports the Tier 1 exact-match lookup in main.py._check_upload_history
        # (WHERE user_id = ? AND file_hash = ?) without a table scan.
        Index("ix_document_user_hash", "user_id", "file_hash"),
    )


class CapitalAsset(Base):
    """
    Registry of capital assets qualifying for Schedule 3 capital allowance
    (Initial Allowance + Annual Allowance). One row is created once, at the
    time the qualifying asset-purchase / renovation document is classified.

    This exists because capital allowance is inherently multi-year: an asset
    bought in YA2023 keeps generating Annual Allowance in YA2024, YA2025, etc.,
    with no new document uploaded in those later years. Re-deriving the
    allowance purely from documents present in a given year's query (the old
    approach) silently loses AA in every year after acquisition. The actual
    year-by-year schedule (IA, AA, written-down value, balancing
    allowance/charge on disposal) is computed deterministically from this
    record by compute_capital_allowance_for_year() in capital_allowance.py —
    nothing about the schedule itself is persisted here, only the facts an
    LLM extracted once from the source document.
    """
    __tablename__ = "capital_assets"

    id        = Column(Integer, primary_key=True, index=True)
    user_id   = Column(String(128), nullable=True, index=True)
    entity_id = Column(Integer, ForeignKey("entities.id", ondelete="SET NULL"), nullable=True, index=True)

    # One asset per source document — re-processing the same document (e.g. a
    # retry) upserts this row rather than creating a duplicate asset.
    source_document_id = Column(Integer, ForeignKey("documents.id", ondelete="SET NULL"), nullable=True, unique=True)

    asset_class      = Column(String(100), nullable=False)
    description      = Column(String(255), nullable=True)
    cost             = Column(Numeric,      nullable=False)
    acquisition_date = Column(Date,         nullable=True)
    acquisition_year = Column(Integer,      nullable=False, index=True)  # YA the asset was bought in
    ia_rate_pct      = Column(Integer,      nullable=False, default=0)
    aa_rate_pct      = Column(Integer,      nullable=False, default=0)

    # Populated only once the asset is sold / scrapped / disposed of.
    disposal_date     = Column(Date,    nullable=True)
    disposal_year     = Column(Integer, nullable=True, index=True)
    disposal_proceeds = Column(Numeric, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        CheckConstraint("cost >= 0", name="ck_capital_asset_cost_nonneg"),
        CheckConstraint(
            "acquisition_year >= 2000 AND acquisition_year <= 2100",
            name="ck_capital_asset_year_range",
        ),
        Index("ix_capital_asset_user_entity", "user_id", "entity_id"),
    )


class BreastfeedingEquipmentClaim(Base):
    """
    Registry of H11 (breastfeeding equipment relief, paragraph 46(1)(q) ITA
    1967) claims. One row is created once, at the time the qualifying
    document is classified, mirroring CapitalAsset's pattern.

    This exists (rather than a plain per-document Q4 relief cap) because
    H11's statutory rule is "allowed ONCE EVERY TWO YEARS OF ASSESSMENT" —
    a genuinely multi-year constraint a same-year cap can't express. Nothing
    about eligibility for a given year is stored here — it's re-derived on
    every call from the FULL claim history by
    compute_breastfeeding_relief_for_year() in breastfeeding_relief.py, so a
    correction to an earlier year's claim automatically corrects every later
    year's eligibility, same reasoning as CapitalAsset's schedule
    recomputation.
    """
    __tablename__ = "breastfeeding_equipment_claims"

    id        = Column(Integer, primary_key=True, index=True)
    user_id   = Column(String(128), nullable=True, index=True)
    entity_id = Column(Integer, ForeignKey("entities.id", ondelete="SET NULL"), nullable=True, index=True)

    # One claim per source document — re-processing the same document (e.g. a
    # retry) upserts this row rather than creating a duplicate claim.
    source_document_id = Column(Integer, ForeignKey("documents.id", ondelete="SET NULL"), nullable=True, unique=True)

    description        = Column(String(255), nullable=True)
    amount             = Column(Numeric,      nullable=False)
    year_of_assessment = Column(Integer,      nullable=False, index=True)  # YA the purchase falls in

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        CheckConstraint("amount >= 0", name="ck_breastfeeding_claim_amount_nonneg"),
        CheckConstraint(
            "year_of_assessment >= 2000 AND year_of_assessment <= 2100",
            name="ck_breastfeeding_claim_year_range",
        ),
        Index("ix_breastfeeding_claim_user_entity", "user_id", "entity_id"),
    )


class CP500Record(Base):
    """
    Registry of CP500 self-installment (s.107B ITA 1967) notices and
    payments. One row per source document, mirroring CapitalAsset /
    BreastfeedingEquipmentClaim's upsert-by-source-document pattern.

    Added 15 Jul 2026 to fix a real bug: B33's "Self-Installments / CP500"
    figure was previously computed by summing EVERY CP500-classified
    document's amount, with no distinction between LHDN's installment
    NOTICE (a schedule of what's due — not proof of payment) and a
    PAYMENT RECEIPT (proof an installment was actually paid). A user who
    uploaded only the notice had that scheduled-but-unpaid amount silently
    counted as if paid.

    This table separates the two by `record_type`, and — like
    CapitalAsset / BreastfeedingEquipmentClaim — stores only the facts an
    LLM extracted once from the source document. Nothing about a target
    year's B33 figure is computed or stored here; that's re-derived on
    every call by compute_cp500_for_year() in cp500.py from the FULL
    history, so a correction to a misclassified/misattributed document
    automatically corrects every affected year's figure.

    Deliberately NOT entity-scoped: a sole proprietor's CP500 installment
    scheme covers their aggregate estimated tax as an individual, not any
    single business — same reasoning Phase 1 already established for B1
    multi-entity aggregation.
    """
    __tablename__ = "cp500_records"

    id      = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(128), nullable=True, index=True)

    # One record per source document — re-processing the same document
    # (e.g. a retry) upserts this row rather than creating a duplicate.
    source_document_id = Column(Integer, ForeignKey("documents.id", ondelete="SET NULL"), nullable=True, unique=True)

    record_type = Column(String(16), nullable=False)  # 'notice' | 'payment'
    # The YA this notice/payment's installment scheme is FOR — NOT
    # necessarily the calendar year a payment date falls in (a late
    # installment for YA2024 paid in January 2025 is still FOR YA2024).
    year_of_assessment = Column(Integer, nullable=False, index=True)
    amount             = Column(Numeric, nullable=False)
    event_date         = Column(Date, nullable=True)         # due date (notice) or payment date (payment)
    reference_no       = Column(String(128), nullable=True)  # bank ref / LHDN bill number — payment only

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        CheckConstraint("amount >= 0", name="ck_cp500_amount_nonneg"),
        CheckConstraint("record_type IN ('notice', 'payment')", name="ck_cp500_record_type"),
        CheckConstraint(
            "year_of_assessment >= 2000 AND year_of_assessment <= 2100",
            name="ck_cp500_year_range",
        ),
        Index("ix_cp500_user_year", "user_id", "year_of_assessment"),
    )


class OneTimeReliefClaim(Base):
    """
    Registry for reliefs that may be claimed AT MOST ONCE within a specific
    multi-year eligibility window — a genuinely different shape from H11's
    "once every N years, recurring indefinitely" rule (BreastfeedingEquipmentClaim)
    or capital allowance's ongoing multi-year schedule (CapitalAsset).

    Added 15 Jul 2026 for Finance Act 2025 (Act 874) s.6(a)(vi)/(1A), which
    introduces exactly this shape THREE times at once: a food waste compost
    machine (claimable once across YA2025-2027), a food waste grinder
    machine (once across YA2026-2027), and a home CCTV system (once across
    YA2026-2027) — all three sharing one RM2,500 pool with EV charging
    equipment. Built generic (category + eligibility window supplied by the
    caller) rather than one bespoke table per item, since this exact shape
    is very likely to recur in future Finance Acts and shouldn't need a new
    migration each time.

    Nothing about a target year's eligibility is computed or stored here —
    that's re-derived on every call by one_time_relief.py from the FULL
    claim history, same "recompute fresh" reasoning as every other registry
    table in this codebase.
    """
    __tablename__ = "one_time_relief_claims"

    id      = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(128), nullable=True, index=True)

    source_document_id = Column(Integer, ForeignKey("documents.id", ondelete="SET NULL"), nullable=True, unique=True)

    category           = Column(String(128), nullable=False, index=True)  # e.g. "Q4 — Food Waste Compost Machine"
    year_of_assessment = Column(Integer, nullable=False, index=True)
    amount             = Column(Numeric, nullable=False)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        CheckConstraint("amount >= 0", name="ck_one_time_relief_amount_nonneg"),
        Index("ix_one_time_relief_user_category_year", "user_id", "category", "year_of_assessment"),
    )


class FinancialStatementProfile(Base):
    """
    Structured data extracted from uploaded P&L / Balance Sheet documents —
    Phase 6 (14 Jul 2026): feeds Part N (Financial Particulars) directly,
    since N28-N50 (the Statement of Financial Position) has no other
    derivation path. Unlike N3/N7/N8/N15/N26 etc., which formB.js already
    reconstructs client-side from the same classified Q1/Q3 transaction
    documents that feed B1 (see formB.js's N-line derivation block), a
    balance sheet's assets/liabilities/equity genuinely can't be inferred
    from individual income/expense receipts — it needs an actual uploaded
    financial statement.

    One record per (user_id, entity_id, year_of_assessment), same upsert
    pattern as FormBProfile — but unlike FormBProfile (which is written
    entirely by ONE document category), this record is filled in TWO HALVES
    by TWO DIFFERENT document categories:
      - "Q1 — Financial Statements (P&L)" populates the pl_* fields
      - "Q1 — Financial Statements (BS)"  populates the bs_* fields
    A user who has only uploaded one of the two ends up with a
    half-populated row (the other half's fields stay NULL, which is the
    correct "not available" signal — NOT the same as an uploaded document
    showing an actual RM0). See sync_financial_statement_profile() in
    pipeline.py for how each half is independently created/updated/cleared
    without clobbering the other.
    """
    __tablename__ = "financial_statement_profiles"

    id                 = Column(Integer, primary_key=True, index=True)
    user_id            = Column(String(128), nullable=True, index=True)
    entity_id          = Column(Integer, ForeignKey("entities.id", ondelete="SET NULL"), nullable=True, index=True)
    year_of_assessment = Column(Integer, nullable=False)

    # ── P&L half (Statement of Profit or Loss — N3-N27) ──────────────────
    # Only the lines with NO other derivation path (Phase 0's low-priority
    # gap: N4/N6/N9/N10/N12/N18/N20). N3/N7/N8/N15/N26 etc. are intentionally
    # NOT stored here — formB.js already derives those from classified
    # documents, which is more granular/reliable than a single summary
    # figure, and re-deriving them here would just create a second source
    # of truth to keep in sync. This table supplements the document-derived
    # P&L, it doesn't replace it.
    pl_source_document_id      = Column(Integer, nullable=True)
    pl_opening_inventory       = Column(Numeric, nullable=True)  # N4
    pl_closing_inventory       = Column(Numeric, nullable=True)  # N6
    pl_other_business_income   = Column(Numeric, nullable=True)  # N9
    pl_dividends               = Column(Numeric, nullable=True)  # N10
    pl_rents_royalties_premiums = Column(Numeric, nullable=True) # N12
    pl_contract_subcontracts   = Column(Numeric, nullable=True)  # N18
    pl_bad_debts               = Column(Numeric, nullable=True)  # N20
    # Also captured for the reconciliation check (replaces the old fuzzy
    # keyword search over free-text line_items — see main.py) even though
    # N3/N8/N26 themselves are still document-derived, not sourced from here.
    pl_stated_revenue          = Column(Numeric, nullable=True)
    pl_stated_net_profit       = Column(Numeric, nullable=True)
    pl_confidence              = Column(Integer, nullable=True)

    # ── BS half (Statement of Financial Position — N28-N50) ──────────────
    bs_source_document_id      = Column(Integer, nullable=True)
    # Non-current assets
    bs_land_buildings          = Column(Numeric, nullable=True)  # N28
    bs_plant_machinery         = Column(Numeric, nullable=True)  # N29
    bs_motor_vehicles          = Column(Numeric, nullable=True)  # N30
    bs_other_non_current_assets = Column(Numeric, nullable=True) # N31
    bs_investments             = Column(Numeric, nullable=True)  # N33
    # Current assets
    bs_inventory               = Column(Numeric, nullable=True)  # N34
    bs_trade_debtors           = Column(Numeric, nullable=True)  # N35
    bs_sundry_debtors          = Column(Numeric, nullable=True)  # N36
    bs_cash_in_hand            = Column(Numeric, nullable=True)  # N37
    bs_cash_at_bank            = Column(Numeric, nullable=True)  # N38
    bs_other_current_assets    = Column(Numeric, nullable=True)  # N39
    # Liabilities
    bs_loans_overdrafts        = Column(Numeric, nullable=True)  # N42
    bs_trade_creditors         = Column(Numeric, nullable=True)  # N43
    bs_sundry_creditors        = Column(Numeric, nullable=True)  # N44
    # Owner's equity
    bs_capital_account         = Column(Numeric, nullable=True)  # N46
    bs_current_account_bf      = Column(Numeric, nullable=True)  # N47
    bs_drawings_advance_net    = Column(Numeric, nullable=True)  # N49
    bs_confidence              = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_fsp_user_entity_ya", "user_id", "entity_id", "year_of_assessment", unique=True),
    )


class FormBProfile(Base):
    """
    Structured data extracted from a previously filed Form B.

    One record per (user_id, year_of_assessment) — a filed Form B is a
    whole-person, whole-return document (chargeable income, tax charged,
    tax payable, aggregate income, statutory income by s.4 section, etc.
    are all single figures for the ENTIRE return, not a per-business
    breakdown), so it can never correctly belong to one business entity
    over another. A user with several entities still files exactly ONE
    Form B per year covering all of them combined.

    entity_id is kept as a column purely as historical/debugging metadata
    (which entity happened to be active in the UI at the moment this
    document was uploaded, entirely unrelated to the document's actual
    content) — it is NOT part of this table's identity and must never be
    used to scope a lookup or upsert. See Ticket 5 (23 Jul 2026): this used
    to be entity-scoped, which was a genuine bug, not a deliberate
    multi-entity design — compare to CP500Record below, which correctly
    documents and implements the same person-level (not entity-level)
    reasoning for the same underlying kind of fact.
    """
    __tablename__ = "form_b_profiles"

    id                 = Column(Integer, primary_key=True, index=True)
    user_id            = Column(String(128), nullable=True, index=True)
    # Historical/debugging metadata only — see class docstring. NOT part of
    # this row's identity; never filtered on for a lookup or upsert.
    entity_id          = Column(Integer, ForeignKey("entities.id", ondelete="SET NULL"), nullable=True, index=True)
    year_of_assessment = Column(Integer, nullable=False)
    source_document_id = Column(Integer, nullable=True)

    # Statutory income by ITA s.4 section
    statutory_income_4a = Column(Numeric, nullable=True)
    statutory_income_4b = Column(Numeric, nullable=True)
    statutory_income_4c = Column(Numeric, nullable=True)
    statutory_income_4d = Column(Numeric, nullable=True)
    statutory_income_4e = Column(Numeric, nullable=True)
    statutory_income_4f = Column(Numeric, nullable=True)
    aggregate_income    = Column(Numeric, nullable=True)

    # Deductions & reliefs
    total_business_deductions = Column(Numeric, nullable=True)
    approved_donations        = Column(Numeric, nullable=True)
    total_personal_reliefs    = Column(Numeric, nullable=True)
    chargeable_income         = Column(Numeric, nullable=True)

    # Tax computation
    tax_charged                = Column(Numeric, nullable=True)
    zakat_rebate               = Column(Numeric, nullable=True)
    tax_payable                = Column(Numeric, nullable=True)
    cp500_total_paid           = Column(Numeric, nullable=True)
    balance_payable_refundable = Column(Numeric, nullable=True)

    # Carry-forward items
    unabsorbed_business_losses   = Column(Numeric, nullable=True)
    unabsorbed_capital_allowance = Column(Numeric, nullable=True)

    raw_extracted = Column(JSONB,    nullable=True)
    confidence    = Column(Integer,  nullable=True)
    created_at    = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        # Uniqueness is per (user, year) — see class docstring for why this
        # can never be per-entity. Ticket 5 (23 Jul 2026): was previously
        # (user_id, entity_id, year_of_assessment), which allowed the SAME
        # filed Form B to be silently duplicated once per entity a user
        # happened to have active across different uploads/re-uploads.
        Index("ix_formb_user_ya", "user_id", "year_of_assessment", unique=True),
    )


class ChatSession(Base):
    """
    A single CukaiBot conversation thread. One user can have several sessions
    open at once (mirrors a WhatsApp chat-thread model) — session_id is what
    scopes ChatMessage rows together, separate from user_id, which just
    records who owns the thread.

    Scoped to an entity the same way Document/CapitalAsset/FormBProfile are,
    so switching the active entity in the UI swaps to that entity's own
    conversation (see getInitialMessagesForEntity in CukaiBot.jsx, which this
    table replaces).
    """
    __tablename__ = "chat_sessions"

    id         = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(64), unique=True, nullable=False, index=True)
    user_id    = Column(String(128), nullable=True, index=True)
    entity_id  = Column(Integer, ForeignKey("entities.id", ondelete="SET NULL"), nullable=True, index=True)

    title      = Column(String(255), nullable=True)  # short label, e.g. first user message truncated
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # ── Sidebar customization (pin / rename / folder) ──
    # pinned sessions are surfaced in their own "Pinned" group above the
    # normal Today/Yesterday/... recency groups, mirroring Claude's own
    # sidebar. `title` above doubles as the user-renamable label — a manual
    # rename just overwrites the AI-generated title in place, and
    # title_locked prevents any later auto-title logic from clobbering it.
    # `folder` is a free-text label rather than its own table: folders here
    # are simple per-user tags, not shared/nested structures, so a plain
    # nullable string is enough to group sessions by without a join.
    #
    # There's no separate `pinned` boolean column — pinned_at is the single
    # source of truth: NULL means not pinned, a timestamp means pinned (and
    # is also the sort key for the "Pinned" group / pinned-within-folder
    # ordering). Set to "now" the moment a session is pinned, and cleared
    # back to NULL on unpin (see update_chat_session, the only place this
    # gets written). It's a *separate* signal from updated_at on purpose:
    # pin/unpin is sidebar bookkeeping, not conversation activity, so it
    # must never influence the Today/Yesterday/... recency buckets. Every
    # API response derives a `pinned` boolean from this with `is not None`
    # rather than storing one, so the two can never drift out of sync.
    pinned_at    = Column(DateTime, nullable=True)
    title_locked = Column(Boolean, nullable=False, default=False, server_default="false")
    folder       = Column(String(120), nullable=True, index=True)

    messages = relationship(
        "ChatMessage", back_populates="session", cascade="all, delete-orphan",
        order_by="ChatMessage.created_at",
    )

    __table_args__ = (
        Index("ix_chatsession_user_entity", "user_id", "entity_id"),
    )


class ChatMessage(Base):
    """
    One turn in a ChatSession. role is 'user' or 'assistant'. citations stores
    the MongoDB chunks (receipt/tax-law snippets) that were retrieved and used
    to ground an assistant reply — kept as JSONB so the frontend's existing
    CitationCard shape (tag/title/snippet/verified) can be persisted verbatim
    without a schema migration every time that shape changes.
    """
    __tablename__ = "chat_messages"

    id         = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(64), ForeignKey("chat_sessions.session_id", ondelete="CASCADE"), nullable=False, index=True)
    user_id    = Column(String(128), nullable=True, index=True)

    role       = Column(String(20), nullable=False)
    content    = Column(String, nullable=False)
    citations  = Column(JSONB, nullable=True)
    # AI-suggested follow-up questions for this turn (assistant messages only) —
    # e.g. ["What about Section 38A entertainment caps?", ...]. Generated by
    # the same Gemini call that writes `content` (see _generate_chat_answer_with_
    # retrieval / _classify_and_maybe_answer's direct_answer path in main.py),
    # so persisting them here means a reloaded conversation (get_chat_history)
    # shows the exact same chips it showed live, instead of recomputing them
    # or falling back to the generic static prompt list. Null for user
    # messages, and for older assistant messages saved before this column
    # existed.
    followups  = Column(JSONB, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    session     = relationship("ChatSession", back_populates="messages")
    attachments = relationship("ChatAttachment", cascade="all, delete-orphan", order_by="ChatAttachment.created_at")

    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant')", name="ck_chatmessage_role"),
        Index("ix_chatmessage_session_created", "session_id", "created_at"),
    )


class ChatAttachment(Base):
    """
    A file the user attached to a chat message — sent to Gemini as inline
    multimodal input (image/PDF/etc. bytes alongside the question) so the
    model can read it directly, and kept on disk so the chat bubble can
    offer the same click-to-preview experience as a citation.

    Deliberately NOT part of the Document/document_chunks/RAG pipeline:
    - No OCR, no LLM classification, no MongoDB embedding, no Q1-Q4
      category, no Form B aggregation. It exists only to be attached to a
      single conversational turn.
    - Gemini only ever sees the raw bytes of an attachment on the turn it
      was sent on (see main.py's post_chat_message) — older attachments are
      not re-sent as bytes on every later turn, only their presence is
      visible in reloaded history via this table, so a long conversation
      doesn't balloon its per-turn payload with every file ever attached.

    `session_id`/`message_id` are both nullable because the frontend
    uploads the file the moment it's picked (so the user sees an attached
    chip immediately) — before the message is sent and before a session
    may even exist yet for a brand-new conversation. Both are backfilled by
    post_chat_message once the ChatMessage row is created for that turn.
    An attachment left with message_id=NULL (uploaded, then the user
    navigated away without sending) is inert — harmless orphaned storage,
    not linked into any conversation history.
    """
    __tablename__ = "chat_attachments"

    id         = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(64), ForeignKey("chat_sessions.session_id", ondelete="CASCADE"), nullable=True, index=True)
    message_id = Column(Integer, ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=True, index=True)
    user_id    = Column(String(128), nullable=True, index=True)

    file_name  = Column(String(255), nullable=False)   # original filename, shown in the UI
    file_path  = Column(String(512), nullable=False)    # on-disk path under STORAGE_DIR (see main.py)
    mime_type  = Column(String(127), nullable=False)    # sent to Gemini verbatim as the media block's mime_type
    file_size  = Column(Integer, nullable=False)         # bytes — shown in the UI, not currently enforced beyond upload-time validation

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)


class ExternalResource(Base):
    """
    Registry of official external reference documents (LHDN Public Rulings,
    the Income Tax Act 1967, e-Invoice Guidelines, etc.) downloaded and
    ingested for CukaiBot's RAG retrieval.

    This is the Postgres "library catalog" half of the external-resource
    pipeline — one row per source document, tracking where it came from and
    whether it's been embedded yet. The actual embedded text chunks live in
    MongoDB's separate `external_resource_chunks` collection (see mongo.py),
    keyed back to this table via external_resource_id. Splitting it this way
    mirrors the existing Document/document_chunks split: Postgres owns
    structured bookkeeping (what do we have, where did it come from, is it
    current), MongoDB owns the embedded content used for similarity search.

    Distinct from Document (which is a user's own uploaded receipt/invoice):
    an ExternalResource is a shared, authoritative reference text that
    applies to every user, not something any one user uploaded.
    """
    __tablename__ = "external_resources"

    id = Column(Integer, primary_key=True, index=True)

    # Catalog metadata
    title           = Column(String(500), nullable=False)
    resource_type   = Column(String(50),  nullable=False)   # "act" | "public_ruling" | "guideline"
    reference_no    = Column(String(50),  nullable=True)    # e.g. "PR No. 4/2015", "Act 53"
    category        = Column(String(255), nullable=True)    # human-readable topic, e.g. "Entertainment Expense"
    source_url      = Column(String(1000), nullable=False)
    date_issued     = Column(Date,   nullable=True)         # publication date per LHDN, when known
    superseded_by   = Column(String(50),  nullable=True)    # reference_no of the ruling that replaced this one, if any

    # Ingestion bookkeeping
    local_path      = Column(String(1000), nullable=True)   # where the downloaded PDF is cached on disk
    status          = Column(String(20), default="pending") # "pending" | "downloaded" | "embedded" | "failed"
    chunk_count     = Column(Integer, nullable=True)         # how many chunks this resource produced in Mongo
    error_message   = Column(String, nullable=True)
    downloaded_at   = Column(DateTime, nullable=True)
    embedded_at     = Column(DateTime, nullable=True)
    created_at      = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        CheckConstraint(
            "resource_type IN ('act', 'public_ruling', 'guideline')",
            name="ck_externalresource_type",
        ),
        CheckConstraint(
            "status IN ('pending', 'downloaded', 'embedded', 'failed')",
            name="ck_externalresource_status",
        ),
        Index("ix_externalresource_reference_no", "reference_no", unique=True),
    )