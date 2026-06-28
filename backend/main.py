from fastapi import FastAPI, Depends, Path, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import Annotated
from datetime import date
import bcrypt # for security. hash password
import models
import schemas
from database import engine, get_db

app = FastAPI()
models.Base.metadata.create_all(bind=engine)
# for? create tables in database

app.add_middleware( ### to let frntend cakap dgn backend
  CORSMiddleware,
  allow_origins=["http://localhost:5173"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"]
)
#reusable. Utk any route that mau access database.
db_dependency = Annotated[Session, Depends(get_db)]


#for securitylah. password hashed. If no like, can removelah. 
def hash_password(plain):  
  return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def parse_date(value): #conditional trigger. special case for date. DOB, spouse DOB and etc.
  if not value: # if empty, return none. 
    return None
  return date.fromisoformat(value) 



###API endpoints test

# User registration: create a sole-proprietor profile from onboarding —
# one person + their business. Matches the POST /userReg.
@app.post("/userReg", response_model=schemas.PersonOut)
async def user_red(db:db_dependency, payload:schemas.ProfileIn):
  p = payload.person

 # for? prevent duplicate. mainly emails while registering
  if db.query(models.Person).filter(models.Person.email == p.email).first():
    raise HTTPException(status_code=400, detail="Email already registered")
  #if ada duplicate - 400:'email already registered' notice shown

  person = models.Person(
    email=p.email,
    password_hash=hash_password(p.password),
    full_name=p.full_name,
    id_type=p.id_type,
    identification_no=p.identification_no,
    personal_tin=p.personal_tin,
    citizenship=p.citizenship,
    gender=p.gender,
    date_of_birth=parse_date(p.date_of_birth),
    marital_status=p.marital_status,
    marital_event_date=parse_date(p.marital_event_date),
    spouse_name=p.spouse_name,
    spouse_id_no=p.spouse_id_no,
    spouse_dob=parse_date(p.spouse_dob),
    assessment_type=p.assessment_type,
    number_of_children=p.number_of_children,
    has_disabled_dependents=p.has_disabled_dependents,
    phone=p.phone,
    correspondence_address=p.correspondence_address,
    correspondence_postcode=p.correspondence_postcode,
    correspondence_city=p.correspondence_city,
    correspondence_state=p.correspondence_state,
    refund_method=p.refund_method,
    bank_name=p.bank_name,
    bank_account_no=p.bank_account_no,
    record_keeping=p.record_keeping,
    has_foreign_accounts=p.has_foreign_accounts,
    rpgt_disposal=p.rpgt_disposal,
    has_dependent_parents=p.has_dependent_parents,
    has_epf_life_insurance=p.has_epf_life_insurance,
    has_education_medical_insurance=p.has_education_medical_insurance,
    has_lifestyle_purchases=p.has_lifestyle_purchases,
    has_sspn_ev_other=p.has_sspn_ev_other,
  )

  e = payload.entity
  entity = models.Entity(
    entity_type="sole-prop",
    name=e.name,
    business_code=e.business_code,
    business_activity=e.business_activity,
    ssm_no=e.ssm_no,
    tin=e.tin,
    address=e.address,
    postcode=e.postcode,
    city=e.city,
    state=e.state,
    sales_turnover=e.sales_turnover,
    total_expenditure=e.total_expenditure,
    net_profit_loss=e.net_profit_loss,
    total_assets=e.total_assets,
    total_liabilities=e.total_liabilities,
    monthly_income=e.monthly_income,
    annual_income=e.annual_income,
  )

  person.entities.append(entity)
  db.add(person)
  db.commit()
  db.refresh(person)
  return person

#### to cari user by ID
@app.get("/userProfile/{person_id}", response_model=schemas.PersonOut)
async def get_profile(db:db_dependency, person_id:int=Path(gt=0)):
  person_result = db.query(models.Person).filter(models.Person.id == person_id).first()
  if person_result is not None:
    return person_result
  raise HTTPException(status_code=404, detail="Profile not found")
 
#### cari user by email & passwrod.
@app.get("/userLogin")
async def user_login(db:db_dependency,email: str, password: str):
  person_result = db.query(models.Person).filter(models.Person.email == email).first()

  if not person_result:
    raise HTTPException(status_code=404, detail="User not found")
  if not bcrypt.checkpw(password.encode(), person_result.password_hash.encode()):
    raise HTTPException(status_code=401, detail="Incorrect password")
  return {"id": person_result.id, "fullName": person_result.full_name}

### Ini for Manage Acc. Only GET personal details
@app.get("/personalDetails/{person_id}", response_model=schemas.PersonalDetailsOut)
async def get_personal_details(db: db_dependency, person_id:int=Path(gt=0)):
  person_result = db.query(models.Person).filter(models.Person.id == person_id).first()
  if person_result is not None:
    return person_result
  raise HTTPException(status_code=404, detail="Person not found")
  

#### Ini for Manage Acc. Only GET entity details.
@app.get("/companyDetails/{person_id}", response_model=schemas.EntityOut)
async def get_company_details(db: db_dependency, person_id: int = Path(gt=0)):
  person_result = db.query(models.Person).filter(models.Person.id == person_id).first()
  if not person_result:
    raise HTTPException(status_code=404, detail="Person not found")
  if not person_result.entities:
    raise HTTPException(status_code=404, detail="No company found for this person")
  return person_result.entities[0]


### to delete userrr
@app.delete("/userDelete/{person_id}")
async def delete_user(db: db_dependency, person_id: int = Path(gt=0)):
  user_result = db.query(models.Person).filter(models.Person.id == person_id).first()
  if user_result is None:
    raise HTTPException(status_code=404, detail="User not found")
  else:
    db.delete(user_result)
    db.commit()
    return {"message": "User successfully deleted"}
  
 