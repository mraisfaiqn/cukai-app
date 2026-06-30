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


class FormBProfile(Base):
    """
    Structured data extracted from a previously filed Form B.
    One record per (user_id, year_of_assessment).
    """
    __tablename__ = "form_b_profiles"

    id                 = Column(Integer, primary_key=True, index=True)
    user_id            = Column(String(128), nullable=True, index=True)
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
        Index("ix_formb_user_ya", "user_id", "year_of_assessment", unique=True),
    )