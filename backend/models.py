"""
Database models for cukai.ai.

Tables:
  persons        — individual users (login credentials + personal tax profile)
  entities       — business entities owned by a person (sole-props)
  documents      — uploaded documents queued for AI classification
  form_b_profiles — structured data extracted from previously filed Form B returns

Design notes:
  - One person can own many entities (one-to-many via person_id FK on entities).
  - Entity switching is a UI-only concern tracked via localStorage('activeEntityId');
    it does not require a server-side column.
  - Documents are scoped to a user and optionally to a specific entity via entity_id.
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
    id_type           = Column(String, default="ic")
    identification_no = Column(String)
    personal_tin      = Column(String)
    citizenship       = Column(String, default="MYS")
    gender            = Column(String)
    date_of_birth     = Column(Date)

    # Marital status & dependants
    marital_status          = Column(String, default="single")
    marital_event_date      = Column(Date)
    spouse_name             = Column(String)
    spouse_id_no            = Column(String)
    spouse_dob              = Column(Date)
    assessment_type         = Column(String)
    number_of_children      = Column(Integer, default=0)
    has_disabled_dependents = Column(Boolean, default=False)

    # Contact & refund details
    phone                   = Column(String)
    correspondence_address  = Column(String)
    correspondence_postcode = Column(String)
    correspondence_city     = Column(String)
    correspondence_state    = Column(String)
    refund_method           = Column(String, default="bank")
    bank_name               = Column(String)
    bank_account_no         = Column(String)

    # LHDN compliance flags
    record_keeping       = Column(Boolean, default=True)
    has_foreign_accounts = Column(Boolean, default=False)
    rpgt_disposal        = Column(Boolean, default=False)

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
            "tax_status IS NULL OR tax_status IN ('income', 'deductible', 'mixed', 'not_applicable', 'relief', 'non_deductible', 'capital')",
            name="ck_document_tax_status",
        ),
        CheckConstraint(
            "year_of_assessment IS NULL OR (year_of_assessment >= 2000 AND year_of_assessment <= 2100)",
            name="ck_document_ya_range",
        ),
        Index("ix_document_user_ya",   "user_id",   "year_of_assessment"),
        Index("ix_document_entity_ya", "entity_id", "year_of_assessment"),
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


class FormBProfile(Base):
    """
    Structured data extracted from a previously filed Form B.
    One record per (user_id, entity_id, year_of_assessment) — each business
    entity keeps its own filed Form B for a given year, so a user with two
    entities can upload a Form B for the same year under each without one
    overwriting the other.
    """
    __tablename__ = "form_b_profiles"

    id                 = Column(Integer, primary_key=True, index=True)
    user_id            = Column(String(128), nullable=True, index=True)
    # Which business entity this filed Form B belongs to. Nullable so pre-entity
    # rows and Form Bs uploaded without an active entity are still valid.
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
        # Uniqueness is per (user, entity, year) so each entity can hold its own
        # filed Form B for a given YA. (Postgres treats NULL entity_id values as
        # distinct, so the app-level upsert in pipeline.py is what dedupes the
        # no-entity case.)
        Index("ix_formb_user_entity_ya", "user_id", "entity_id", "year_of_assessment", unique=True),
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

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    session = relationship("ChatSession", back_populates="messages")

    __table_args__ = (
        CheckConstraint("role IN ('user', 'assistant')", name="ck_chatmessage_role"),
        Index("ix_chatmessage_session_created", "session_id", "created_at"),
    )


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