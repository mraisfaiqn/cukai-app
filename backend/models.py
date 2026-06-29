"""
Database models for cukai.ai.

Tables:
  persons        — individual users (login credentials + personal tax profile)
  entities       — business entities (sole-props, partnerships)
  entity_members — many-to-many join: which persons have access to which entities, with role
  documents      — uploaded documents queued for AI classification
  form_b_profiles — structured data extracted from previously filed Form B returns
"""

from datetime import datetime, timezone
from sqlalchemy import (
    Column, Integer, String, Boolean, Date, DateTime, Numeric,
    ForeignKey, CheckConstraint, Index, UniqueConstraint,
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
    marital_status        = Column(String, default="single")
    marital_event_date    = Column(Date)
    spouse_name           = Column(String)
    spouse_id_no          = Column(String)
    spouse_dob            = Column(Date)
    assessment_type       = Column(String)
    number_of_children    = Column(Integer, default=0)
    has_disabled_dependents = Column(Boolean, default=False)

    # Contact & refund details
    phone                    = Column(String)
    correspondence_address   = Column(String)
    correspondence_postcode  = Column(String)
    correspondence_city      = Column(String)
    correspondence_state     = Column(String)
    refund_method            = Column(String, default="bank")   # 'bank' | 'duitnow'
    bank_name                = Column(String)
    bank_account_no          = Column(String)

    # LHDN compliance flags
    record_keeping    = Column(Boolean, default=True)
    has_foreign_accounts = Column(Boolean, default=False)
    rpgt_disposal     = Column(Boolean, default=False)

    # Relief category flags — control which Part H questions appear during filing
    has_dependent_parents           = Column(Boolean, default=False)
    has_epf_life_insurance          = Column(Boolean, default=False)
    has_education_medical_insurance = Column(Boolean, default=False)
    has_lifestyle_purchases         = Column(Boolean, default=False)
    has_sspn_ev_other               = Column(Boolean, default=False)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Entities the person created/owns (they appear in entity_members as Owner too)
    owned_entities = relationship(
        "Entity", back_populates="owner", cascade="all, delete-orphan",
        foreign_keys="Entity.person_id",
    )

    # All entity memberships (owned + invited)
    memberships = relationship("EntityMember", back_populates="person", cascade="all, delete-orphan")


class Entity(Base):
    __tablename__ = "entities"

    id        = Column(Integer, primary_key=True, index=True)

    # Canonical owner — the person who created the entity.
    # All access control goes through entity_members; this field is the tiebreaker for Owner role.
    person_id = Column(Integer, ForeignKey("persons.id", ondelete="CASCADE"), nullable=False)

    entity_type = Column(String, nullable=False)   # 'sole-prop' | 'partnership'

    # Business registration details
    name              = Column(String)
    business_code     = Column(String)
    business_activity = Column(String)
    ssm_no            = Column(String, index=True)  # indexed for SSM lookup endpoint
    tin               = Column(String)

    # Business address
    address  = Column(String)
    postcode = Column(String)
    city     = Column(String)
    state    = Column(String)

    # Financial figures (Form N / Form B section 4a)
    sales_turnover    = Column(Numeric)
    total_expenditure = Column(Numeric)
    net_profit_loss   = Column(Numeric)
    total_assets      = Column(Numeric)
    total_liabilities = Column(Numeric)

    # Income figures used for tax dashboard calculations
    monthly_income = Column(Numeric)
    annual_income  = Column(Numeric)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    owner   = relationship("Person", back_populates="owned_entities", foreign_keys=[person_id])
    members = relationship("EntityMember", back_populates="entity", cascade="all, delete-orphan")


class EntityMember(Base):
    """
    Many-to-many join between persons and entities.

    One row per (person, entity) pair.  The owner of an entity gets an
    'owner' row here automatically when the entity is created.
    Invited users start with status='pending'; accepting the invite flips it to 'active'.
    Invited-but-unregistered users are tracked by invited_email until they sign up.
    """
    __tablename__ = "entity_members"

    id        = Column(Integer, primary_key=True, index=True)
    entity_id = Column(Integer, ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)
    person_id = Column(Integer, ForeignKey("persons.id",  ondelete="CASCADE"), nullable=True,  index=True)

    # Role within this entity
    role   = Column(String, nullable=False, default="viewer")  # owner|admin|editor|viewer
    status = Column(String, nullable=False, default="active")  # active|pending

    # For invites sent to emails that haven't registered yet
    invited_email = Column(String, nullable=True)

    invited_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    joined_at  = Column(DateTime, nullable=True)

    entity = relationship("Entity", back_populates="members")
    person = relationship("Person", back_populates="memberships")

    __table_args__ = (
        # A person can only have one membership row per entity
        UniqueConstraint("entity_id", "person_id", name="uq_entity_member"),
        CheckConstraint(
            "role IN ('owner', 'admin', 'editor', 'viewer')",
            name="ck_entity_member_role",
        ),
        CheckConstraint(
            "status IN ('active', 'pending')",
            name="ck_entity_member_status",
        ),
    )



class AuditLog(Base):
    """
    Immutable record of every team access change within an entity.
    Written server-side on every member add / role change / removal.
    Never deleted — forms the compliance trail.
    """
    __tablename__ = "audit_log"

    id        = Column(Integer, primary_key=True, index=True)
    entity_id = Column(Integer, ForeignKey("entities.id", ondelete="CASCADE"), nullable=False, index=True)

    # Who performed the action
    actor_id   = Column(Integer, ForeignKey("persons.id", ondelete="SET NULL"), nullable=True)
    actor_name = Column(String, nullable=True)   # snapshot in case person is deleted later

    # What happened
    action     = Column(String, nullable=False)  # 'invited' | 'removed' | 'role_changed' | 'joined'
    target_name  = Column(String, nullable=True) # name of the affected person
    target_email = Column(String, nullable=True)
    detail       = Column(String, nullable=True) # human-readable description e.g. "role changed from Viewer to Editor"

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_audit_entity", "entity_id", "created_at"),
    )


class Document(Base):
    __tablename__ = "documents"

    id            = Column(Integer, primary_key=True, index=True)
    user_id       = Column(String(128), nullable=True, index=True)

    # Entity context — nullable so existing rows are not broken; populated going forward
    entity_id     = Column(Integer, ForeignKey("entities.id", ondelete="SET NULL"), nullable=True, index=True)

    file_name          = Column(String(255), nullable=False)
    file_path          = Column(String(512), nullable=False)
    status             = Column(String(50),  default="pending")
    document_type      = Column(String(100), default="Unclassified")
    category           = Column(String(255), nullable=True)
    tax_status         = Column(String(50),  nullable=True)
    year_of_assessment = Column(Integer,     nullable=True, index=True)
    extracted_data     = Column(JSONB,        nullable=True)
    created_at         = Column(DateTime,    default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'processing', 'completed', 'failed')",
            name="ck_document_status",
        ),
        CheckConstraint(
            "tax_status IS NULL OR tax_status IN ('income', 'deductible', 'mixed', 'not_applicable', 'relief', 'non_deductible')",
            name="ck_document_tax_status",
        ),
        CheckConstraint(
            "year_of_assessment IS NULL OR (year_of_assessment >= 2000 AND year_of_assessment <= 2100)",
            name="ck_document_ya_range",
        ),
        Index("ix_document_user_ya",    "user_id",    "year_of_assessment"),
        Index("ix_document_entity_ya",  "entity_id",  "year_of_assessment"),
    )


class FormBProfile(Base):
    """
    Structured data extracted from a previously filed Form B.
    One record per (user_id, year_of_assessment).
    """
    __tablename__ = "form_b_profiles"

    id                   = Column(Integer, primary_key=True, index=True)
    user_id              = Column(String(128), nullable=True, index=True)
    year_of_assessment   = Column(Integer, nullable=False)
    source_document_id   = Column(Integer, nullable=True)

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