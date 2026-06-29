import datetime
from datetime import timezone
from sqlalchemy import Column, Integer, String, Boolean, Date, DateTime, Numeric, ForeignKey, CheckConstraint, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

Base = declarative_base()


class Person(Base):
  __tablename__ = "persons"

  id = Column(Integer, primary_key=True, index=True)

  # Login info
  email = Column(String, unique=True, index=True, nullable=False)
  password_hash = Column(String, nullable=False)

  # Personal details
  full_name = Column(String)
  id_type = Column(String, default="ic")
  identification_no = Column(String)
  personal_tin = Column(String)
  citizenship = Column(String, default="MYS")
  gender = Column(String)
  date_of_birth = Column(Date)

  # Marital, dependants
  marital_status = Column(String, default="single")
  marital_event_date = Column(Date)
  spouse_name = Column(String)
  spouse_id_no = Column(String)
  spouse_dob = Column(Date)
  assessment_type = Column(String)
  number_of_children = Column(Integer, default=0)
  has_disabled_dependents = Column(Boolean, default=False)

  # Contact
  phone = Column(String)
  correspondence_address = Column(String)
  correspondence_postcode = Column(String)
  correspondence_city = Column(String)
  correspondence_state = Column(String)
  refund_method = Column(String, default="bank")      # 'bank' | 'duitnow'
  bank_name = Column(String)
  bank_account_no = Column(String)

  # Compliance
  record_keeping = Column(Boolean, default=True)
  has_foreign_accounts = Column(Boolean, default=False)
  rpgt_disposal = Column(Boolean, default=False)

  # Reliefs, deductions
  has_dependent_parents = Column(Boolean, default=False)
  has_epf_life_insurance = Column(Boolean, default=False)
  has_education_medical_insurance = Column(Boolean, default=False)
  has_lifestyle_purchases = Column(Boolean, default=False)
  has_sspn_ev_other = Column(Boolean, default=False)

  created_at = Column(DateTime, default=lambda: datetime.datetime.now(timezone.utc))

  # One person owns their business entities
  entities = relationship(
    "Entity", back_populates="person", cascade="all, delete-orphan"
  )


class Entity(Base):
  __tablename__ = "entities"

  id = Column(Integer, primary_key=True, index=True)
  person_id = Column(
    Integer, ForeignKey("persons.id", ondelete="CASCADE"), nullable=False
  )

  entity_type = Column(String, nullable=False)

  # Business info
  name = Column(String)
  business_code = Column(String)
  business_activity = Column(String)
  ssm_no = Column(String)
  tin = Column(String)

  # Business address
  address = Column(String)
  postcode = Column(String)
  city = Column(String)
  state = Column(String)

  # Financial
  sales_turnover = Column(Numeric)
  total_expenditure = Column(Numeric)
  net_profit_loss = Column(Numeric)
  total_assets = Column(Numeric)
  total_liabilities = Column(Numeric)

  # Income figures used for tax calculation
  monthly_income = Column(Numeric)
  annual_income = Column(Numeric)

  created_at = Column(DateTime, default=lambda: datetime.datetime.now(timezone.utc))

  person = relationship("Person", back_populates="entities")


class Document(Base):
  __tablename__ = "documents"

  id                 = Column(Integer, primary_key=True, index=True)
  user_id            = Column(String(128), nullable=True, index=True)
  file_name          = Column(String(255), nullable=False)
  file_path          = Column(String(512), nullable=False)
  status             = Column(String(50), default="pending")
  document_type      = Column(String(100), default="Unclassified")
  category           = Column(String(255), nullable=True)
  tax_status         = Column(String(50), nullable=True)
  year_of_assessment = Column(Integer, nullable=True, index=True)
  extracted_data     = Column(JSONB, nullable=True)
  created_at         = Column(DateTime, default=datetime.datetime.utcnow)

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
    Index("ix_document_user_ya", "user_id", "year_of_assessment"),
  )


class FormBProfile(Base):
  """
  Stores structured data extracted from a user's previously filed Form B.
  One record per user per year_of_assessment.
  Used to pre-populate the current-year tax profile overview and carry-forward awareness.
  """
  __tablename__ = "form_b_profiles"

  id                           = Column(Integer, primary_key=True, index=True)
  user_id                      = Column(String(128), nullable=True, index=True)
  year_of_assessment           = Column(Integer, nullable=False)
  source_document_id           = Column(Integer, nullable=True)

  # Aggregate income by ITA s.4 section
  statutory_income_4a          = Column(String(50), nullable=True)   # s.4(a) business income
  statutory_income_4b          = Column(String(50), nullable=True)   # s.4(b) employment income
  statutory_income_4c          = Column(String(50), nullable=True)   # s.4(c) dividends / interest
  statutory_income_4d          = Column(String(50), nullable=True)   # s.4(d) rental / royalties
  statutory_income_4e          = Column(String(50), nullable=True)   # s.4(e) pension / annuity
  statutory_income_4f          = Column(String(50), nullable=True)   # s.4(f) casual income
  aggregate_income             = Column(String(50), nullable=True)

  # Deductions & reliefs
  total_business_deductions    = Column(String(50), nullable=True)
  approved_donations           = Column(String(50), nullable=True)
  total_personal_reliefs       = Column(String(50), nullable=True)
  chargeable_income            = Column(String(50), nullable=True)

  # Tax computation
  tax_charged                  = Column(String(50), nullable=True)
  zakat_rebate                 = Column(String(50), nullable=True)
  tax_payable                  = Column(String(50), nullable=True)
  cp500_total_paid             = Column(String(50), nullable=True)
  balance_payable_refundable   = Column(String(50), nullable=True)

  # Carry-forward items
  unabsorbed_business_losses   = Column(String(50), nullable=True)
  unabsorbed_capital_allowance = Column(String(50), nullable=True)

  # Raw extraction
  raw_extracted                = Column(JSONB, nullable=True)
  confidence                   = Column(Integer, nullable=True)
  created_at                   = Column(DateTime, default=datetime.datetime.utcnow)

  __table_args__ = (
    Index("ix_formb_user_ya", "user_id", "year_of_assessment", unique=True),
  )