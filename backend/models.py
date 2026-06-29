## for what? database table. Person/Company.

from datetime import datetime, timezone
from sqlalchemy import (
  Column, Integer, String, Boolean, Date, DateTime, Numeric, ForeignKey
)
from sqlalchemy.orm import relationship

from database import Base


class Person(Base):
  __tablename__ = "persons"

  id = Column(Integer, primary_key=True, index=True) #unique id per person

  #Login info
  email = Column(String, unique=True, index=True, nullable=False)
  password_hash = Column(String, nullable=False)

### Personal details stuff
  full_name = Column(String)
  id_type = Column(String, default="ic")              
  identification_no = Column(String)
  personal_tin = Column(String)
  citizenship = Column(String, default="MYS")
  gender = Column(String)
  date_of_birth = Column(Date)

 ### Marital, dependants stuff
  marital_status = Column(String, default="single")
  marital_event_date = Column(Date)
  spouse_name = Column(String)
  spouse_id_no = Column(String)
  spouse_dob = Column(Date)
  assessment_type = Column(String)
  number_of_children = Column(Integer, default=0)
  has_disabled_dependents = Column(Boolean, default=False)

### contact stuff
  phone = Column(String)
  correspondence_address = Column(String)
  correspondence_postcode = Column(String)
  correspondence_city = Column(String)
  correspondence_state = Column(String)
  refund_method = Column(String, default="bank")      # 'bank' | 'duitnow'
  bank_name = Column(String)
  bank_account_no = Column(String)

### compliance purposes
  record_keeping = Column(Boolean, default=True)
  has_foreign_accounts = Column(Boolean, default=False)
  rpgt_disposal = Column(Boolean, default=False)

### Reliefs, deductions
  has_dependent_parents = Column(Boolean, default=False)
  has_epf_life_insurance = Column(Boolean, default=False)
  has_education_medical_insurance = Column(Boolean, default=False)
  has_lifestyle_purchases = Column(Boolean, default=False)
  has_sspn_ev_other = Column(Boolean, default=False)

  created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

  #### One person owns their business entities
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

  ### Business info
  name = Column(String)
  business_code = Column(String)
  business_activity = Column(String)
  ssm_no = Column(String)
  tin = Column(String)

  ### Business address info
  address = Column(String)
  postcode = Column(String)
  city = Column(String)
  state = Column(String)

  # Financial $$$ stuff
  sales_turnover = Column(Numeric)
  total_expenditure = Column(Numeric)
  net_profit_loss = Column(Numeric)
  total_assets = Column(Numeric)
  total_liabilities = Column(Numeric)

  #### Income figures used for tax calculation
  monthly_income = Column(Numeric)
  annual_income = Column(Numeric)

  created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

  person = relationship("Person", back_populates="entities")
