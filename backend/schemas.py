### for what? Pydantic
### the type of data when traveling frntend - bckend & vice versa.
#### Made everything 'Optional', so that user can still proceed with registration even if they dont fill all details.

from typing import Optional, List
from datetime import date, datetime
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

class Base(BaseModel):
  model_config = ConfigDict(
    alias_generator=to_camel,   ##for full name ah
    populate_by_name=True,      ##snake_case,camelCase in input boleh
    from_attributes=True,       ##ambik data terus from database
  )

##input - from frntend via onboarding to bckend
class EntityIn(Base):
  name: Optional[str] = None
  business_code: Optional[str] = None
  business_activity: Optional[str] = None
  ssm_no: Optional[str] = None
  tin: Optional[str] = None
  address: Optional[str] = None
  postcode: Optional[str] = None
  city: Optional[str] = None
  state: Optional[str] = None
  sales_turnover: Optional[float] = None
  total_expenditure: Optional[float] = None
  net_profit_loss: Optional[float] = None
  total_assets: Optional[float] = None
  total_liabilities: Optional[float] = None
  monthly_income: Optional[float] = None
  annual_income: Optional[float] = None

class PersonIn(Base):
  email: str
  password: str
  full_name: Optional[str] = None
  id_type: Optional[str] = "ic"
  identification_no: Optional[str] = None
  personal_tin: Optional[str] = None
  citizenship: Optional[str] = "MYS"
  gender: Optional[str] = None
  date_of_birth: Optional[str] = None
  marital_status: Optional[str] = "single"
  marital_event_date: Optional[str] = None
  spouse_name: Optional[str] = None
  spouse_id_no: Optional[str] = None
  spouse_dob: Optional[str] = None
  assessment_type: Optional[str] = None
  number_of_children: Optional[int] = 0
  has_disabled_dependents: Optional[bool] = False
  phone: Optional[str] = None
  correspondence_address: Optional[str] = None
  correspondence_postcode: Optional[str] = None
  correspondence_city: Optional[str] = None
  correspondence_state: Optional[str] = None
  refund_method: Optional[str] = "bank"
  bank_name: Optional[str] = None
  bank_account_no: Optional[str] = None
  record_keeping: Optional[bool] = True
  has_foreign_accounts: Optional[bool] = False
  rpgt_disposal: Optional[bool] = False
  has_dependent_parents: Optional[bool] = False
  has_epf_life_insurance: Optional[bool] = False
  has_education_medical_insurance: Optional[bool] = False
  has_lifestyle_purchases: Optional[bool] = False
  has_sspn_ev_other: Optional[bool] = False

class ProfileIn(Base):
  person: PersonIn
  entity: EntityIn

## for output. from bckend via database to frntend.
class EntityOut(Base):
  id: int
  name: Optional[str] = None
  business_code: Optional[str] = None
  business_activity: Optional[str] = None
  ssm_no: Optional[str] = None
  tin: Optional[str] = None
  address: Optional[str] = None
  postcode: Optional[str] = None
  city: Optional[str] = None
  state: Optional[str] = None
  sales_turnover: Optional[float] = None
  total_expenditure: Optional[float] = None
  net_profit_loss: Optional[float] = None
  total_assets: Optional[float] = None
  total_liabilities: Optional[float] = None
  monthly_income: Optional[float] = None
  annual_income: Optional[float] = None

class PersonOut(Base):
  id: int
  email: str
  full_name: Optional[str] = None
  id_type: Optional[str] = None
  identification_no: Optional[str] = None
  personal_tin: Optional[str] = None
  citizenship: Optional[str] = None
  gender: Optional[str] = None
  date_of_birth: Optional[date] = None
  marital_status: Optional[str] = None
  marital_event_date: Optional[date] = None
  spouse_name: Optional[str] = None
  spouse_id_no: Optional[str] = None
  spouse_dob: Optional[date] = None
  assessment_type: Optional[str] = None
  number_of_children: Optional[int] = None
  has_disabled_dependents: Optional[bool] = None
  phone: Optional[str] = None
  correspondence_address: Optional[str] = None
  correspondence_postcode: Optional[str] = None
  correspondence_city: Optional[str] = None
  correspondence_state: Optional[str] = None
  refund_method: Optional[str] = None
  bank_name: Optional[str] = None
  bank_account_no: Optional[str] = None
  record_keeping: Optional[bool] = None
  has_foreign_accounts: Optional[bool] = None
  rpgt_disposal: Optional[bool] = None
  has_dependent_parents: Optional[bool] = None
  has_epf_life_insurance: Optional[bool] = None
  has_education_medical_insurance: Optional[bool] = None
  has_lifestyle_purchases: Optional[bool] = None
  has_sspn_ev_other: Optional[bool] = None
  created_at: Optional[datetime] = None
  entities: List[EntityOut] = []


##for Manage Acc section - personal only
class PersonalDetailsOut(Base):
    id: int
    email: str
    full_name: Optional[str] = None
    id_type: Optional[str] = None
    identification_no: Optional[str] = None
    personal_tin: Optional[str] = None
    citizenship: Optional[str] = None
    gender: Optional[str] = None
    date_of_birth: Optional[date] = None
    marital_status: Optional[str] = None
    marital_event_date: Optional[date] = None
    spouse_name: Optional[str] = None
    spouse_id_no: Optional[str] = None
    spouse_dob: Optional[date] = None
    assessment_type: Optional[str] = None
    number_of_children: Optional[int] = None
    has_disabled_dependents: Optional[bool] = None
    phone: Optional[str] = None
    correspondence_address: Optional[str] = None
    correspondence_postcode: Optional[str] = None
    correspondence_city: Optional[str] = None
    correspondence_state: Optional[str] = None
    refund_method: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_no: Optional[str] = None
    record_keeping: Optional[bool] = None
    has_foreign_accounts: Optional[bool] = None
    rpgt_disposal: Optional[bool] = None
    has_dependent_parents: Optional[bool] = None
    has_epf_life_insurance: Optional[bool] = None
    has_education_medical_insurance: Optional[bool] = None
    has_lifestyle_purchases: Optional[bool] = None
    has_sspn_ev_other: Optional[bool] = None
    created_at: Optional[datetime] = None

class UserLogin(Base):
    email: str
    password: str