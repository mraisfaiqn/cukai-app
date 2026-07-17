import asyncio
import concurrent.futures
import datetime
import logging
import os
import re
import uuid
import bcrypt
from contextlib import asynccontextmanager
from datetime import date
from decimal import Decimal, ROUND_DOWN
from typing import Optional
from dotenv import load_dotenv

from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Query, Request, Path
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sqlalchemy.orm import Session
from sqlalchemy import or_, func

from database import init_db, SessionLocal
import models
from models import Document, FormBProfile, CapitalAsset, BreastfeedingEquipmentClaim, FinancialStatementProfile, Child, CP500Record, OneTimeReliefClaim
from capital_allowance import compute_capital_allowance_for_year
from carryforward import compute_multi_year_carryforward, MAX_LOSS_CARRYFORWARD_YEARS
from child_relief import compute_h16_for_children
from cp500 import compute_cp500_for_year
from one_time_relief import compute_one_time_relief_for_year, compute_departure_levy_rebate_for_year
from utils import parse_amount, money
from pipeline import (
  run_document_pipeline, validate_upload,
  CATEGORY_STATUS_MAP, ALL_Q1, ALL_Q2, ALL_Q3, ALL_Q4,
  REVIEW_CATEGORY, NON_TAX_CATEGORY, VALID_STATUSES,
  derive_document_role, derive_aggregation_state,
  APPORTIONED_CATEGORIES, resolve_deductible_pct,
  sync_capital_asset_registry, sync_breastfeeding_claim_registry, sync_financial_statement_profile,
  sync_cp500_registry, sync_one_time_relief_registry,
)
from breastfeeding_relief import compute_breastfeeding_relief_for_year, H11_CAP_MYR

_pipeline_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="pipeline")

load_dotenv()
logger = logging.getLogger("uvicorn.error")

STORAGE_DIR = "./stored_documents"
MAX_BATCH_FILES = 10
MAX_BATCH_BYTES = 100 * 1024 * 1024  # 100 MB


def _requeue_interrupted_documents() -> None:
  """Re-queue documents left mid-flight by a previous process (status
  'processing' or 'pending'). Without this, a restart during OCR leaves a
  document stuck forever, since the retry endpoint only accepts 'failed'.
  Runs once at startup, before the app serves traffic."""
  db = SessionLocal()
  try:
    stuck = db.query(Document).filter(Document.status.in_(["processing", "pending"])).all()
    requeued = orphaned = 0
    for doc in stuck:
      if doc.file_path and os.path.isfile(doc.file_path):
        doc.status = "pending"
        db.commit()
        _pipeline_executor.submit(run_document_pipeline, doc.id, doc.file_path, SessionLocal)
        requeued += 1
      else:
        doc.status = "failed"
        doc.extracted_data = {
          "error_message": "Processing was interrupted and the stored file is no "
                           "longer available. Please re-upload."
        }
        db.commit()
        orphaned += 1
    if requeued or orphaned:
      logger.info(f"[Startup] Re-queued {requeued} interrupted document(s); "
                  f"marked {orphaned} orphaned as failed.")
  except Exception as e:
    logger.error(f"[Startup] Failed to re-queue interrupted documents: {e}")
    db.rollback()
  finally:
    db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
  # ── Startup ──
  init_db()
  os.makedirs(STORAGE_DIR, exist_ok=True)
  app.mount("/files", StaticFiles(directory=STORAGE_DIR), name="stored_documents")
  _requeue_interrupted_documents()
  try:
    yield
  finally:
    # ── Shutdown ── stop accepting new pipeline work and wind the pool down.
    _pipeline_executor.shutdown(wait=False, cancel_futures=True)


# slowapi = a rate limiting library
limiter = Limiter(key_func=get_remote_address)
app = FastAPI(
  title="Cukai.ai — LHDN Document Classification Engine",
  version="2.0.0",
  lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173")
ALLOWED_ORIGINS: list[str] = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
  CORSMiddleware,
  allow_origins=ALLOWED_ORIGINS,
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)


def get_db():
  db = SessionLocal()
  try:
    yield db
  finally:
    db.close()


# ── Data scoping ─────────────────────────────────────────────────────────────
# TEMPORARY scoping layer. There is no session/token auth yet, so `user_id`
# (and, where relevant, `entity_id`) arrive as request parameters. This is NOT
# real authorization — a caller can still pass any user_id — but it does close
# the far worse hole where OMITTING the parameter silently returned or mutated
# data across ALL users. Every data endpoint now REQUIRES user_id, so a query
# is always scoped to exactly one user. Replace this with a dependency that
# derives the user from a verified session token when auth lands (see the
# "detailed auth" pass) — every call site already funnels through here, so that
# swap is localised.

def _verify_entity_owned(db: Session, user_id: str, entity_id: Optional[int]) -> None:
  """When an entity_id is supplied, ensure it belongs to user_id. String-compares
  to sidestep the int(Person.id)/str(Document.user_id) mismatch in the schema."""
  if entity_id is None:
    return
  entity = db.query(models.Entity).filter(models.Entity.id == entity_id).first()
  if not entity:
    raise HTTPException(status_code=404, detail="Entity not found.")
  if str(entity.person_id) != str(user_id):
    raise HTTPException(status_code=403, detail="This entity does not belong to the requesting user.")


def _scoped_document_or_404(
  db: Session, doc_id: int, user_id: str, entity_id: Optional[int]
) -> Document:
  """Fetch a single document, scoped to its owner (and entity when supplied).
  A document that exists but belongs to someone else 404s exactly like a missing
  one, so IDs can't be probed for existence."""
  q = db.query(Document).filter(Document.id == doc_id, Document.user_id == user_id)
  if entity_id is not None:
    q = q.filter(Document.entity_id == entity_id)
  doc = q.first()
  if not doc:
    raise HTTPException(status_code=404, detail=f"Document ID {doc_id} not found.")
  return doc


def _scoped_entity_or_404(db: Session, entity_id: int, person_id: int) -> "models.Entity":
  """
  Fetch a single entity, scoped to the person who owns it — same pattern as
  _scoped_document_or_404 (404 whether missing or belongs to someone else).

  Security fix (14 Jul 2026, production-readiness audit): update_entity and
  delete_entity previously took only entity_id with no ownership check at
  all — any caller who knew or guessed an entity_id could rename, edit the
  financials of, or permanently delete ANOTHER user's business entity
  (including all its documents, capital assets, and filed Form B profiles
  via delete_entity's cascade). Found while fixing the same gap in the new
  Child endpoints and generalized here for consistency, since it's the same
  underlying issue.
  """
  entity = (
    db.query(models.Entity)
    .filter(models.Entity.id == entity_id, models.Entity.person_id == person_id)
    .first()
  )
  if not entity:
    raise HTTPException(status_code=404, detail=f"Entity ID {entity_id} not found.")
  return entity


def hash_password(plain: str) -> str:
  return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def parse_date(value):
  """Return a date object or None for blank/missing values."""
  if not value:
    return None
  return date.fromisoformat(value)


# ── Serialisers ─────────────────────────────────────────────────────────────

def _serialize_person(person: models.Person) -> dict:
  return {
    "id":                          person.id,
    "email":                       person.email,
    "fullName":                    person.full_name,
    "identificationNo":            person.identification_no,
    "passportNo":                  person.passport_no,
    "personalTin":                 person.personal_tin,
    "citizenship":                 person.citizenship,
    "gender":                      person.gender,
    "dateOfBirth":                 person.date_of_birth.isoformat() if person.date_of_birth else None,
    "maritalStatus":               person.marital_status,
    "maritalEventDate":            person.marital_event_date.isoformat() if person.marital_event_date else None,
    "spouseName":                  person.spouse_name,
    "spouseIdNo":                  person.spouse_id_no,
    "spousePassportNo":            person.spouse_passport_no,
    "spouseDob":                   person.spouse_dob.isoformat() if person.spouse_dob else None,
    "assessmentType":              person.assessment_type,
    "numberOfChildren":            person.number_of_children,
    "isDisabledSelf":              person.is_disabled_self,
    "spouseIsDisabled":            person.spouse_is_disabled,
    "alimonyPaidMyr":              float(person.alimony_paid_myr) if person.alimony_paid_myr is not None else None,
    "spouseTotalIncomeMyr":        float(person.spouse_total_income_myr) if person.spouse_total_income_myr is not None else None,
    "spouseForeignIncomeMyr":      float(person.spouse_foreign_income_myr) if person.spouse_foreign_income_myr is not None else None,
    "passportNoLhdnm":             person.passport_no_lhdnm,
    "phone":                       person.phone,
    "correspondenceAddress":       person.correspondence_address,
    "correspondencePostcode":      person.correspondence_postcode,
    "correspondenceCity":          person.correspondence_city,
    "correspondenceState":         person.correspondence_state,
    "refundMethod":                person.refund_method,
    "bankName":                    person.bank_name,
    "bankAccountNo":               person.bank_account_no,
    "duitnowIdType":               person.duitnow_id_type,
    "employerTin":                 person.employer_tin,
    "taxBorneByEmployer":          person.tax_borne_by_employer,
    "carriesOnEcommerce":          person.carries_on_ecommerce,
    "ecommerceModel":              person.ecommerce_model,
    "recordKeeping":               person.record_keeping,
    "hasForeignAccounts":          person.has_foreign_accounts,
    "rpgtDisposal":                person.rpgt_disposal,
    "disposalDeclared":            person.disposal_declared,
    "hasDependentParents":         person.has_dependent_parents,
    "hasEpfLifeInsurance":         person.has_epf_life_insurance,
    "hasEducationMedicalInsurance":person.has_education_medical_insurance,
    "hasLifestylePurchases":       person.has_lifestyle_purchases,
    "hasSspnEvOther":              person.has_sspn_ev_other,
    "createdAt":                   person.created_at.isoformat() if person.created_at else None,
    "entities":                    [_serialize_entity(e) for e in person.entities],
    "children":                    [_serialize_child(c) for c in person.children],
  }


def _serialize_child(child: "models.Child") -> dict:
  return {
    "id":                 child.id,
    "personId":           child.person_id,
    "name":               child.name,
    "identificationNo":   child.identification_no,
    "dateOfBirth":        child.date_of_birth.isoformat() if child.date_of_birth else None,
    "isDisabled":         child.is_disabled,
    "isFullTimeStudent":  child.is_full_time_student,
    "isHigherEducation":  child.is_higher_education,
    "ownIncomeMyr":       float(child.own_income_myr) if child.own_income_myr is not None else None,
    "ownIncomeIsExemptType": child.own_income_is_exempt_type,
    "eligibilityPct":     child.eligibility_pct,
    "createdAt":          child.created_at.isoformat() if child.created_at else None,
  }


def _serialize_entity(entity: models.Entity) -> dict:
  return {
    "id":               entity.id,
    "entityType":       entity.entity_type,
    "name":             entity.name,
    "businessCode":     entity.business_code,
    "businessActivity": entity.business_activity,
    "ssmNo":            entity.ssm_no,
    "tin":              entity.tin,
    "address":          entity.address,
    "postcode":         entity.postcode,
    "city":             entity.city,
    "state":            entity.state,
    "salesTurnover":    float(entity.sales_turnover)    if entity.sales_turnover    else None,
    "totalExpenditure": float(entity.total_expenditure) if entity.total_expenditure else None,
    "netProfitLoss":    float(entity.net_profit_loss)   if entity.net_profit_loss   else None,
    "totalAssets":      float(entity.total_assets)      if entity.total_assets      else None,
    "totalLiabilities": float(entity.total_liabilities) if entity.total_liabilities else None,
    "monthlyIncome":    float(entity.monthly_income)    if entity.monthly_income    else None,
    "annualIncome":     float(entity.annual_income)     if entity.annual_income     else None,
    "openingUnabsorbedBusinessLossMyr":     float(entity.opening_unabsorbed_business_loss_myr) if entity.opening_unabsorbed_business_loss_myr is not None else None,
    "openingUnabsorbedCapitalAllowanceMyr": float(entity.opening_unabsorbed_capital_allowance_myr) if entity.opening_unabsorbed_capital_allowance_myr is not None else None,
    "openingBalanceYear":                   entity.opening_balance_year,
  }


def _serialize_doc(doc: Document) -> dict:
  ed = doc.extracted_data or {}
  # Basename of the stored file so the frontend can build a preview URL
  # (${API}/files/<basename>) for ANY document — not just ones still holding a
  # session blob. Fixes previews going blank after retry or page reload.
  file_basename = os.path.basename(doc.file_path) if doc.file_path else None
  return {
    "id":                doc.id,
    "userId":            doc.user_id,
    "entityId":          doc.entity_id,
    "fileName":          doc.file_name,
    "status":            doc.status,
    "documentType":      doc.document_type,
    "category":          doc.category,
    "taxStatus":         doc.tax_status,
    "yearOfAssessment":  doc.year_of_assessment,
    "quadrant":          ed.get("quadrant"),
    "itaSection":        ed.get("ita_section"),
    "documentRole":      ed.get("document_role"),
    "aggregationState":  ed.get("aggregation_state"),
    "fileBasename":      file_basename,
    "extractedData":     doc.extracted_data,
    "uploadedAt":        doc.created_at.strftime("%Y-%m-%d %H:%M:%S"),
  }


# ── Auth & profile endpoints ─────────────────────────────────────────────────

@app.post("/userReg")
async def user_reg(payload: dict, db: Session = Depends(get_db)):
  """
  Register a new user and their first business entity in a single transaction.
  Expects { person: {...}, entity: {...} } with camelCase field names.
  Returns the created Person record including their new entities.
  """
  p = payload.get("person", {})
  e = payload.get("entity", {})

  if db.query(models.Person).filter(models.Person.email == p["email"]).first():
    raise HTTPException(status_code=400, detail="Email already registered")

  person = models.Person(
    email=p["email"],
    password_hash=hash_password(p["password"]),
    full_name=p.get("fullName") or p.get("full_name"),
    identification_no=p.get("identificationNo"),
    passport_no=p.get("passportNo"),
    personal_tin=p.get("personalTin"),
    citizenship=p.get("citizenship", "MYS"),
    gender=p.get("gender"),
    date_of_birth=parse_date(p.get("dateOfBirth")),
    marital_status=p.get("maritalStatus", "single"),
    marital_event_date=parse_date(p.get("maritalEventDate")),
    spouse_name=p.get("spouseName"),
    spouse_id_no=p.get("spouseIdNo"),
    spouse_passport_no=p.get("spousePassportNo"),
    spouse_dob=parse_date(p.get("spouseDob")),
    assessment_type=p.get("assessmentType"),
    number_of_children=p.get("numberOfChildren", 0),
    is_disabled_self=p.get("isDisabledSelf", False),
    spouse_is_disabled=p.get("spouseIsDisabled", False),
    alimony_paid_myr=p.get("alimonyPaidMyr"),
    spouse_total_income_myr=p.get("spouseTotalIncomeMyr"),
    spouse_foreign_income_myr=p.get("spouseForeignIncomeMyr"),
    passport_no_lhdnm=p.get("passportNoLhdnm"),
    phone=p.get("phone"),
    correspondence_address=p.get("correspondenceAddress"),
    correspondence_postcode=p.get("correspondencePostcode"),
    correspondence_city=p.get("correspondenceCity"),
    correspondence_state=p.get("correspondenceState"),
    refund_method=p.get("refundMethod", "bank"),
    bank_name=p.get("bankName"),
    bank_account_no=p.get("bankAccountNo"),
    duitnow_id_type=p.get("duitnowIdType", "ic"),
    employer_tin=p.get("employerTin"),
    tax_borne_by_employer=p.get("taxBorneByEmployer", False),
    carries_on_ecommerce=p.get("carriesOnEcommerce", False),
    ecommerce_model=p.get("ecommerceModel"),
    record_keeping=p.get("recordKeeping", True),
    has_foreign_accounts=p.get("hasForeignAccounts", False),
    rpgt_disposal=p.get("rpgtDisposal", False),
    disposal_declared=p.get("disposalDeclared", False),
    has_dependent_parents=p.get("hasDependentParents", False),
    has_epf_life_insurance=p.get("hasEpfLifeInsurance", False),
    has_education_medical_insurance=p.get("hasEducationMedicalInsurance", False),
    has_lifestyle_purchases=p.get("hasLifestylePurchases", False),
    has_sspn_ev_other=p.get("hasSspnEvOther", False),
  )

  entity = models.Entity(
    entity_type="sole-prop",
    name=e.get("name"),
    business_code=e.get("businessCode"),
    business_activity=e.get("businessActivity"),
    ssm_no=e.get("ssmNo"),
    tin=e.get("tin"),
    address=e.get("address"),
    postcode=e.get("postcode"),
    city=e.get("city"),
    state=e.get("state"),
    sales_turnover=e.get("salesTurnover"),
    total_expenditure=e.get("totalExpenditure"),
    net_profit_loss=e.get("netProfitLoss"),
    total_assets=e.get("totalAssets"),
    total_liabilities=e.get("totalLiabilities"),
    monthly_income=e.get("monthlyIncome"),
    annual_income=e.get("annualIncome"),
  )
  person.entities.append(entity)
  db.add(person)
  db.commit()
  db.refresh(person)
  return _serialize_person(person)


@app.post("/userLogin")
async def user_login(payload: dict, db: Session = Depends(get_db)):
  """Authenticate a user by email and password. Returns { id, fullName }."""
  person = db.query(models.Person).filter(models.Person.email == payload["email"]).first()
  if not person:
    raise HTTPException(status_code=404, detail="User not found")
  if not bcrypt.checkpw(payload["password"].encode(), person.password_hash.encode()):
    raise HTTPException(status_code=401, detail="Incorrect password")
  return {"id": person.id, "fullName": person.full_name}


@app.get("/userProfile/{person_id}")
async def get_profile(person_id: int = Path(gt=0), db: Session = Depends(get_db)):
  person = db.query(models.Person).filter(models.Person.id == person_id).first()
  if not person:
    raise HTTPException(status_code=404, detail="Profile not found")
  return _serialize_person(person)


@app.get("/personalDetails/{person_id}")
async def get_personal_details(person_id: int = Path(gt=0), db: Session = Depends(get_db)):
  person = db.query(models.Person).filter(models.Person.id == person_id).first()
  if not person:
    raise HTTPException(status_code=404, detail="Person not found")
  return _serialize_person(person)


@app.get("/companyDetails/{person_id}")
async def get_company_details(person_id: int = Path(gt=0), db: Session = Depends(get_db)):
  person = db.query(models.Person).filter(models.Person.id == person_id).first()
  if not person:
    raise HTTPException(status_code=404, detail="Person not found")
  if not person.entities:
    raise HTTPException(status_code=404, detail="No company found for this person")
  return _serialize_entity(person.entities[0])


@app.delete("/userDelete/{person_id}")
async def delete_user(person_id: int = Path(gt=0), db: Session = Depends(get_db)):
  person = db.query(models.Person).filter(models.Person.id == person_id).first()
  if not person:
    raise HTTPException(status_code=404, detail="User not found")
  db.delete(person)
  db.commit()
  return {"message": "User successfully deleted"}


@app.put("/userProfile/{person_id}")
async def update_profile(person_id: int, payload: dict, db: Session = Depends(get_db)):
  """Update personal profile fields for a given person."""
  person = db.query(models.Person).filter(models.Person.id == person_id).first()
  if not person:
    raise HTTPException(status_code=404, detail="Person not found")

  # Apply every field that arrives in the payload; ignore unknown keys
  field_map = {
    "fullName":                    "full_name",
    "identificationNo":            "identification_no",
    "passportNo":                  "passport_no",
    "personalTin":                 "personal_tin",
    "citizenship":                 "citizenship",
    "gender":                      "gender",
    "dateOfBirth":                 None,   # handled below
    "maritalStatus":               "marital_status",
    "maritalEventDate":            None,   # handled below
    "spouseName":                  "spouse_name",
    "spouseIdNo":                  "spouse_id_no",
    "spousePassportNo":            "spouse_passport_no",
    "spouseDob":                   None,   # handled below
    "assessmentType":              "assessment_type",
    "numberOfChildren":            "number_of_children",
    "isDisabledSelf":              "is_disabled_self",
    "spouseIsDisabled":            "spouse_is_disabled",
    "alimonyPaidMyr":              "alimony_paid_myr",
    "spouseTotalIncomeMyr":        "spouse_total_income_myr",
    "spouseForeignIncomeMyr":      "spouse_foreign_income_myr",
    "passportNoLhdnm":             "passport_no_lhdnm",
    "phone":                       "phone",
    "correspondenceAddress":       "correspondence_address",
    "correspondencePostcode":      "correspondence_postcode",
    "correspondenceCity":          "correspondence_city",
    "correspondenceState":         "correspondence_state",
    "refundMethod":                "refund_method",
    "bankName":                    "bank_name",
    "bankAccountNo":               "bank_account_no",
    "duitnowIdType":               "duitnow_id_type",
    "employerTin":                 "employer_tin",
    "taxBorneByEmployer":          "tax_borne_by_employer",
    "carriesOnEcommerce":          "carries_on_ecommerce",
    "ecommerceModel":              "ecommerce_model",
    "recordKeeping":               "record_keeping",
    "hasForeignAccounts":          "has_foreign_accounts",
    "rpgtDisposal":                "rpgt_disposal",
    "disposalDeclared":            "disposal_declared",
    "hasDependentParents":         "has_dependent_parents",
    "hasEpfLifeInsurance":         "has_epf_life_insurance",
    "hasEducationMedicalInsurance":"has_education_medical_insurance",
    "hasLifestylePurchases":       "has_lifestyle_purchases",
    "hasSspnEvOther":              "has_sspn_ev_other",
  }
  for camel, snake in field_map.items():
    if camel in payload:
      if camel == "dateOfBirth":
        person.date_of_birth = parse_date(payload[camel])
      elif camel == "maritalEventDate":
        person.marital_event_date = parse_date(payload[camel])
      elif camel == "spouseDob":
        person.spouse_dob = parse_date(payload[camel])
      else:
        setattr(person, snake, payload[camel])

  db.commit()
  db.refresh(person)
  return _serialize_person(person)


@app.get("/entities/{person_id}")
async def get_all_entities(person_id: int = Path(gt=0), db: Session = Depends(get_db)):
  """Return all entities belonging to a person."""
  person = db.query(models.Person).filter(models.Person.id == person_id).first()
  if not person:
    raise HTTPException(status_code=404, detail="Person not found")
  return [_serialize_entity(e) for e in person.entities]


@app.post("/entities/{person_id}", status_code=201)
async def create_entity(person_id: int, payload: dict, db: Session = Depends(get_db)):
  """Create a new entity under a person."""
  person = db.query(models.Person).filter(models.Person.id == person_id).first()
  if not person:
    raise HTTPException(status_code=404, detail="Person not found")

  # Guard against the same business being registered twice under one profile.
  # Compared case-/whitespace-insensitively on whichever of name / SSM no. is
  # actually provided, so two entities that both happen to leave SSM no. blank
  # don't get flagged as a false-positive match.
  new_name = (payload.get("name") or "").strip().lower()
  new_ssm = (payload.get("ssmNo") or "").strip().lower()
  for existing in person.entities:
    existing_name = (existing.name or "").strip().lower()
    existing_ssm = (existing.ssm_no or "").strip().lower()
    name_clash = bool(new_name) and new_name == existing_name
    ssm_clash = bool(new_ssm) and new_ssm == existing_ssm
    if name_clash or ssm_clash:
      raise HTTPException(
        status_code=409,
        detail="Business already created — an entity with this name or SSM number already exists on your profile.",
      )

  entity = models.Entity(
    person_id=person_id,
    entity_type=payload.get("entityType", "sole-prop"),
    name=payload.get("name"),
    business_code=payload.get("businessCode"),
    business_activity=payload.get("businessActivity"),
    ssm_no=payload.get("ssmNo"),
    tin=payload.get("tin"),
    address=payload.get("premiseAddress") or payload.get("address"),
    postcode=payload.get("premisePostcode") or payload.get("postcode"),
    city=payload.get("premiseCity") or payload.get("city"),
    state=payload.get("premiseState") or payload.get("state"),
    sales_turnover=payload.get("salesTurnover"),
    total_expenditure=payload.get("totalExpenditure"),
    net_profit_loss=payload.get("netProfitLoss"),
    total_assets=payload.get("totalAssets"),
    total_liabilities=payload.get("totalLiabilities"),
    monthly_income=payload.get("monthlyIncome"),
    annual_income=payload.get("annualIncome"),
    opening_unabsorbed_business_loss_myr=payload.get("openingUnabsorbedBusinessLossMyr"),
    opening_unabsorbed_capital_allowance_myr=payload.get("openingUnabsorbedCapitalAllowanceMyr"),
    opening_balance_year=payload.get("openingBalanceYear"),
  )
  db.add(entity)
  db.commit()
  db.refresh(entity)
  return _serialize_entity(entity)


@app.put("/entities/{entity_id}")
async def update_entity(
  entity_id: int,
  payload: dict,
  person_id: int = Query(..., description="Owner of the entity — required so an entity can't be edited by ID alone."),
  db: Session = Depends(get_db),
):
  """Update an existing entity. Scoped to person_id — see _scoped_entity_or_404."""
  entity = _scoped_entity_or_404(db, entity_id, person_id)

  simple_fields = {
    "entityType": "entity_type", "name": "name",
    "businessCode": "business_code", "businessActivity": "business_activity",
    "ssmNo": "ssm_no", "tin": "tin",
    "salesTurnover": "sales_turnover", "totalExpenditure": "total_expenditure",
    "netProfitLoss": "net_profit_loss", "totalAssets": "total_assets",
    "totalLiabilities": "total_liabilities",
    "monthlyIncome": "monthly_income", "annualIncome": "annual_income",
    "openingUnabsorbedBusinessLossMyr": "opening_unabsorbed_business_loss_myr",
    "openingUnabsorbedCapitalAllowanceMyr": "opening_unabsorbed_capital_allowance_myr",
    "openingBalanceYear": "opening_balance_year",
  }
  for camel, snake in simple_fields.items():
    if camel in payload:
      setattr(entity, snake, payload[camel])

  # Accept both premiseX (ManageProfile) and flat (legacy) address keys
  if "premiseAddress" in payload or "address" in payload:
    entity.address   = payload.get("premiseAddress") or payload.get("address")
  if "premisePostcode" in payload or "postcode" in payload:
    entity.postcode  = payload.get("premisePostcode") or payload.get("postcode")
  if "premiseCity" in payload or "city" in payload:
    entity.city      = payload.get("premiseCity") or payload.get("city")
  if "premiseState" in payload or "state" in payload:
    entity.state     = payload.get("premiseState") or payload.get("state")

  db.commit()
  db.refresh(entity)
  return _serialize_entity(entity)


@app.delete("/entities/{entity_id}")
async def delete_entity(
  entity_id: int = Path(gt=0),
  person_id: int = Query(..., description="Owner of the entity — required so an entity can't be deleted by ID alone."),
  db: Session = Depends(get_db),
):
  """
  Delete an entity and, persistently, everything scoped to it.

  entity_id is an ondelete=SET NULL foreign key on documents, capital_assets and
  form_b_profiles, so a bare `db.delete(entity)` would leave those rows behind
  with a null entity_id — their figures would keep driving the summary / prior-
  year charts and their uploaded files would linger on disk. Mirroring the
  explicit-cleanup pattern used in delete_document(), we remove all of this
  entity's data in the same transaction (documents + their files, capital
  assets, filed Form B profiles) before deleting the entity itself, so nothing
  is orphaned.

  Refuses to delete a person's only remaining entity.
  """
  entity = _scoped_entity_or_404(db, entity_id, person_id)

  sibling_count = (
    db.query(models.Entity)
    .filter(models.Entity.person_id == entity.person_id)
    .count()
  )
  if sibling_count <= 1:
    raise HTTPException(status_code=400, detail="Cannot delete your only entity")

  # Gather this entity's documents first so their files can be removed from disk
  # once the DB deletions commit.
  docs = db.query(Document).filter(Document.entity_id == entity_id).all()
  doc_ids = [d.id for d in docs]
  file_paths = [d.file_path for d in docs if d.file_path]

  # Capital assets tied to the entity — both those scoped directly by entity_id
  # and any sourced from one of the entity's documents (covers rows created
  # before entity_id was populated).
  ca_conditions = [CapitalAsset.entity_id == entity_id]
  if doc_ids:
    ca_conditions.append(CapitalAsset.source_document_id.in_(doc_ids))
  ca_deleted = (
    db.query(CapitalAsset)
    .filter(or_(*ca_conditions))
    .delete(synchronize_session=False)
  )

  # Filed Form B profiles tied to the entity (or to one of its documents).
  fb_conditions = [FormBProfile.entity_id == entity_id]
  if doc_ids:
    fb_conditions.append(FormBProfile.source_document_id.in_(doc_ids))
  fb_deleted = (
    db.query(FormBProfile)
    .filter(or_(*fb_conditions))
    .delete(synchronize_session=False)
  )

  # The entity's documents themselves.
  doc_deleted = (
    db.query(Document)
    .filter(Document.entity_id == entity_id)
    .delete(synchronize_session=False)
  )

  db.delete(entity)
  db.commit()

  # Remove files only after the transaction commits, so a rolled-back delete
  # never leaves the DB pointing at files we've already unlinked.
  removed_files = 0
  for fp in file_paths:
    try:
      if os.path.isfile(fp):
        os.remove(fp)
        removed_files += 1
    except OSError as e:
      logger.warning(f"[DeleteEntity] Could not remove file '{fp}': {e}")

  logger.info(
    f"[DeleteEntity] Entity {entity_id} deleted with {doc_deleted} document(s), "
    f"{ca_deleted} capital asset(s), {fb_deleted} Form B profile(s); "
    f"{removed_files} file(s) removed from disk."
  )
  return {
    "deleted": True,
    "id": entity_id,
    "documentsDeleted": doc_deleted,
    "capitalAssetsDeleted": ca_deleted,
    "formBProfilesDeleted": fb_deleted,
  }


@app.get("/entities/detail/{entity_id}")
async def get_entity_by_id(
  entity_id: int = Path(gt=0),
  user_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  """
  Fetch a single entity by its database ID.
  Used by the dashboard pages to load the currently active entity's data
  from localStorage('activeEntityId').

  If user_id is supplied, the entity must belong to that person — this guards
  against a stale/foreign activeEntityId in localStorage (e.g. left over from
  a previous account in the same browser) silently leaking another user's
  business data into the dashboard. user_id is optional for now since there's
  no session/auth layer yet, but every frontend call should pass it.
  """
  entity = db.query(models.Entity).filter(models.Entity.id == entity_id).first()
  if not entity:
    raise HTTPException(status_code=404, detail="Entity not found")
  if user_id is not None and entity.person_id != user_id:
    raise HTTPException(status_code=403, detail="This entity does not belong to the requesting user")
  return _serialize_entity(entity)


@app.get("/entities/{entity_id}/opening-balance-suggestion")
async def suggest_opening_balance(
  entity_id: int = Path(gt=0),
  target_year: int = Query(..., description="The YA this entity's opening balance would need to cover, e.g. 2024"),
  user_id: Optional[str] = Query(default=None),   # was Optional[int] — match the app-wide string convention
  db: Session = Depends(get_db),
):
  entity = db.query(models.Entity).filter(models.Entity.id == entity_id).first()
  if not entity:
    raise HTTPException(status_code=404, detail="Entity not found")
  if user_id is not None and str(entity.person_id) != user_id:   # cast entity.person_id to str for the ownership check
    raise HTTPException(status_code=403, detail="This entity does not belong to the requesting user")

  prior_year = target_year - 1
  prior_filing = (
    db.query(FormBProfile)
    .filter(
      FormBProfile.user_id == str(entity.person_id),   # was entity.person_id (int) — cast to match the varchar column
      FormBProfile.entity_id == entity.id,
      FormBProfile.year_of_assessment == prior_year,
    )
    .first()
  )

  if not prior_filing or (
    prior_filing.unabsorbed_business_losses is None
    and prior_filing.unabsorbed_capital_allowance is None
  ):
    return {"available": False}

  return {
    "available":   True,
    "sourceYear":   prior_year,
    "suggestedOpeningUnabsorbedBusinessLossMyr":     prior_filing.unabsorbed_business_losses,
    "suggestedOpeningUnabsorbedCapitalAllowanceMyr": prior_filing.unabsorbed_capital_allowance,
    "suggestedOpeningBalanceYear": prior_year,
    "note": (
      f"Extracted from your uploaded YA{prior_year} Form B. Confirm these figures match your "
      "actual filed return before applying — this becomes the starting point for every "
      "subsequent year's carry-forward calculation."
    ),
  }


# ── Children (Form B H16 relief records) ─────────────────────────────────────
# Phase 3 (14 Jul 2026): replaces the flat Person.number_of_children count.
# See models.py's Child docstring and child_relief.py for why per-child
# age/study/disability/eligibility facts are needed for correct H16a/b/c
# tiering, instead of a single flat RM2,000-per-child estimate.

def _child_payload_kwargs(payload: dict) -> dict:
  kwargs = {}
  if "name" in payload:
    kwargs["name"] = payload["name"]
  if "identificationNo" in payload:
    kwargs["identification_no"] = payload["identificationNo"]
  if "dateOfBirth" in payload:
    kwargs["date_of_birth"] = parse_date(payload["dateOfBirth"])
  if "isDisabled" in payload:
    kwargs["is_disabled"] = payload["isDisabled"]
  if "isFullTimeStudent" in payload:
    kwargs["is_full_time_student"] = payload["isFullTimeStudent"]
  if "isHigherEducation" in payload:
    kwargs["is_higher_education"] = payload["isHigherEducation"]
  if "ownIncomeMyr" in payload:
    kwargs["own_income_myr"] = payload["ownIncomeMyr"]
  if "ownIncomeIsExemptType" in payload:
    kwargs["own_income_is_exempt_type"] = payload["ownIncomeIsExemptType"]
  if "eligibilityPct" in payload:
    pct = payload["eligibilityPct"]
    if pct not in (50, 100):
      raise HTTPException(status_code=400, detail="eligibilityPct must be 50 or 100.")
    kwargs["eligibility_pct"] = pct
  return kwargs


def _scoped_child_or_404(db: Session, child_id: int, person_id: int) -> "models.Child":
  """
  Fetch a single child record, scoped to the person who owns it — mirrors
  _scoped_document_or_404's pattern exactly (same 404 whether the record is
  missing or belongs to someone else, so IDs can't be probed for existence).

  Security fix (14 Jul 2026, production-readiness audit): update_child and
  delete_child originally took only `child_id` with no ownership check at
  all — any caller who knew or guessed a child_id could edit or delete
  ANOTHER user's child record. This app's other mutation endpoints
  (e.g. delete_document) all require the caller to identify themselves and
  scope the lookup accordingly; the Child endpoints below now match that
  pattern instead of being the one exception to it.
  """
  child = (
    db.query(models.Child)
    .filter(models.Child.id == child_id, models.Child.person_id == person_id)
    .first()
  )
  if not child:
    raise HTTPException(status_code=404, detail=f"Child record ID {child_id} not found.")
  return child


@app.get("/children/{person_id}")
async def list_children(person_id: int = Path(gt=0), db: Session = Depends(get_db)):
  """List every child record for a person, for the ManageProfile children editor."""
  person = db.query(models.Person).filter(models.Person.id == person_id).first()
  if not person:
    raise HTTPException(status_code=404, detail="Person not found")
  return [_serialize_child(c) for c in person.children]


@app.post("/children/{person_id}")
async def create_child(person_id: int = Path(gt=0), payload: dict = None, db: Session = Depends(get_db)):
  """Add a new child record under a person."""
  person = db.query(models.Person).filter(models.Person.id == person_id).first()
  if not person:
    raise HTTPException(status_code=404, detail="Person not found")
  payload = payload or {}
  if not payload.get("name") or not payload.get("dateOfBirth"):
    raise HTTPException(status_code=400, detail="name and dateOfBirth are required to add a child record.")

  child = models.Child(person_id=person_id, **_child_payload_kwargs(payload))
  db.add(child)
  db.commit()
  db.refresh(child)
  return _serialize_child(child)


@app.put("/children/{child_id}")
async def update_child(
  child_id: int = Path(gt=0),
  person_id: int = Query(..., description="Owner of the child record — required so a child can't be edited by ID alone."),
  payload: dict = None,
  db: Session = Depends(get_db),
):
  """Update an existing child record. Scoped to person_id — see _scoped_child_or_404."""
  child = _scoped_child_or_404(db, child_id, person_id)
  payload = payload or {}
  for k, v in _child_payload_kwargs(payload).items():
    setattr(child, k, v)
  db.commit()
  db.refresh(child)
  return _serialize_child(child)


@app.delete("/children/{child_id}")
async def delete_child(
  child_id: int = Path(gt=0),
  person_id: int = Query(..., description="Owner of the child record — required so a child can't be deleted by ID alone."),
  db: Session = Depends(get_db),
):
  """Remove a child record — e.g. entered in error, or no longer eligible. Scoped to person_id."""
  child = _scoped_child_or_404(db, child_id, person_id)
  db.delete(child)
  db.commit()
  return {"deleted": True, "id": child_id}



# ── Document upload helpers ──────────────────────────────────────────────────

def _save_and_queue(file_content: bytes, original_name: str, user_id: Optional[str], entity_id: Optional[int], db: Session) -> dict:
  is_valid, error_msg = validate_upload(
    filename=original_name,
    content_type="",
    file_size_bytes=len(file_content),
  )
  if not is_valid:
    raise HTTPException(status_code=422, detail=f"{original_name}: {error_msg}")

  from datetime import timedelta
  # Naive UTC to match the (tz-naive) Document.created_at column. utcnow() is
  # deprecated in 3.12, so derive the same value from an aware clock.
  recent_cutoff = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) - timedelta(hours=24)
  # Duplicate check is scoped to the USER, not the entity: the same file should
  # not be uploaded twice across a user's entities either (a receipt belongs to
  # one business, not several). entity_id is deliberately NOT in the filter.
  # "archived" is included alongside "pending"/"processing"/"completed" —
  # archiving only declutters the list, the document (and its amount) still
  # counts, so re-uploading the same file after archiving it would otherwise
  # silently double-count it with no duplicate warning at all.
  duplicate = db.query(Document).filter(
    Document.file_name == original_name,
    Document.user_id == user_id,
    Document.created_at >= recent_cutoff,
    Document.status.in_(["pending", "processing", "completed", "archived"]),
  ).first()
  if duplicate:
    raise HTTPException(status_code=409, detail=f"DUPLICATE:{duplicate.id}:{original_name}")

  safe_filename  = f"{uuid.uuid4().hex}_{os.path.basename(original_name)}"
  safe_file_path = os.path.join(STORAGE_DIR, safe_filename)

  if not os.path.realpath(safe_file_path).startswith(os.path.realpath(STORAGE_DIR)):
    raise HTTPException(status_code=400, detail=f"{original_name}: Invalid file path.")

  with open(safe_file_path, "wb") as buf:
    buf.write(file_content)

  db_doc = Document(file_name=original_name, file_path=safe_file_path, user_id=user_id, entity_id=entity_id)
  db.add(db_doc)
  db.commit()
  db.refresh(db_doc)

  # Submit straight to the thread pool rather than going through
  # asyncio.get_event_loop().run_in_executor(...) — the latter requires an
  # event loop to already exist on the *calling* thread, which breaks (as of
  # Python 3.12) whenever this is invoked from a sync endpoint that FastAPI
  # runs in a worker thread. ThreadPoolExecutor.submit() needs no event loop
  # at all, so this works regardless of which thread calls it from.
  _pipeline_executor.submit(run_document_pipeline, db_doc.id, safe_file_path, SessionLocal)

  return {"document_id": db_doc.id, "file_name": original_name, "status": "pending"}


# ── Document endpoints ───────────────────────────────────────────────────────

@app.post("/api/documents/upload", status_code=202)
@limiter.limit("30/minute")
async def upload_document(
  request: Request,
  file: UploadFile = File(...),
  user_id: str = Query(..., description="Owner the uploaded document is attributed to."),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  _verify_entity_owned(db, user_id, entity_id)
  file_content = await file.read()
  # Validation happens inside _save_and_queue; no need to repeat it here.
  result = _save_and_queue(file_content, file.filename, user_id, entity_id, db)
  return {"message": "Document uploaded and queued for classification.", **result}


@app.post("/api/documents/batch-upload", status_code=202)
@limiter.limit("10/minute")
async def batch_upload_documents(
  request: Request,
  files: list[UploadFile] = File(...),
  user_id: str = Query(..., description="Owner the uploaded documents are attributed to."),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  _verify_entity_owned(db, user_id, entity_id)
  if not files:
    raise HTTPException(status_code=422, detail="No files provided.")
  if len(files) > MAX_BATCH_FILES:
    raise HTTPException(status_code=422, detail=f"Maximum {MAX_BATCH_FILES} files per batch. Received {len(files)}.")

  file_contents: list[tuple[str, bytes]] = []
  total_bytes = 0
  for f in files:
    content = await f.read()
    total_bytes += len(content)
    file_contents.append((f.filename, content))

  if total_bytes > MAX_BATCH_BYTES:
    raise HTTPException(
      status_code=422,
      detail=f"Total batch size {total_bytes / (1024*1024):.1f} MB exceeds the {MAX_BATCH_BYTES // (1024*1024)} MB limit.",
    )

  results, errors = [], []
  for original_name, content in file_contents:
    try:
      results.append(_save_and_queue(content, original_name, user_id, entity_id, db))
    except HTTPException as e:
      errors.append({"file_name": original_name, "error": e.detail})
    except Exception as e:
      logger.error(f"[Batch Upload] Unexpected error for '{original_name}': {e}", exc_info=True)
      errors.append({"file_name": original_name, "error": "Unexpected server error."})

  return {
    "message":      f"{len(results)} of {len(file_contents)} file(s) queued for classification.",
    "queued":       results,
    "errors":       errors,
    "total_queued": len(results),
    "total_failed": len(errors),
  }


def _quadrant_for_category(category: str) -> str | None:
  if category in ALL_Q1: return "Q1"
  if category in ALL_Q2: return "Q2"
  if category in ALL_Q3: return "Q3"
  if category in ALL_Q4: return "Q4"
  if category == NON_TAX_CATEGORY: return "NonTax"
  return None


def _business_totals_for_year(db: Session, user_id: str, entity_id: int, year: int) -> dict:
  """
  Lightweight, ENTITY-SCOPED recompute of (business income before capital
  allowance) and (capital allowance) for an arbitrary year — used by the
  carryforward engine (carryforward.py) to walk through years OTHER than
  the current filing year, which the main per-document loop in
  get_tax_profile_summary() never touches (it only ever queries the target
  filing year and year-1 for trend purposes).

  Deliberately much lighter than get_tax_profile_summary()'s main loop: no
  per-document annotation, no mixed-pending flagging, no N-line breakdown —
  just the two numbers compute_year_business_result() needs. Reuses the SAME
  category-status/aggregation-state logic (via derive_document_role,
  derive_aggregation_state) and reads the already-resolved deductible_pct
  directly from extracted_data exactly like the main loop's Q3 branch does,
  so it can never silently drift from how the main loop classifies and
  apportions the same documents.
  """
  docs = (
    db.query(Document)
    .filter(Document.user_id == user_id, Document.entity_id == entity_id, Document.year_of_assessment == year)
    .all()
  )

  total_q1 = Decimal("0")
  total_q3_deductible = Decimal("0")
  for doc in docs:
    ed = doc.extracted_data or {}
    tax_status = doc.tax_status or ""
    category = doc.category or ""
    quadrant = _quadrant_for_category(category)
    document_role = ed.get("document_role") or derive_document_role(category)
    aggregation_state = ed.get("aggregation_state") or derive_aggregation_state(category, tax_status)

    if document_role == "summary_statement" or aggregation_state != "resolved":
      continue

    if quadrant == "Q1":
      total_q1 += parse_amount(ed.get("amount"))
    elif quadrant == "Q3" and tax_status != "capital":
      # Mirrors the main per-document loop's logic exactly (see the "Q3"
      # branch inside _build_year_summary): a document that has reached
      # aggregation_state == "resolved" already has its final deductible_pct
      # stored in extracted_data (set at classification/confirmation time) —
      # read it directly rather than re-resolving it. resolve_deductible_pct
      # is for deciding a NEW percentage when a document is first classified
      # or reclassified, not for re-deriving an already-resolved one, and
      # returns a 3-tuple (pct, ok, error) rather than a plain number.
      _ded_pct = ed.get("deductible_pct")
      amt = parse_amount(ed.get("amount"))
      total_q3_deductible += money(amt * Decimal(_ded_pct) / Decimal(100)) if _ded_pct is not None else amt

  assets_q = (
    db.query(CapitalAsset)
    .filter(CapitalAsset.entity_id == entity_id, CapitalAsset.acquisition_year <= year)
    .filter((CapitalAsset.disposal_year.is_(None)) | (CapitalAsset.disposal_year >= year))
  )
  total_ca = Decimal("0")
  for asset in assets_q.all():
    schedule = compute_capital_allowance_for_year(asset, year)
    total_ca += (
      schedule["totalAllowanceThisYearMyr"]
      + schedule["balancingAllowanceMyr"]
      - schedule["balancingChargeMyr"]
    )

  return {
    "businessIncomePreCaMyr": money(total_q1 - total_q3_deductible),
    "capitalAllowanceMyr":    money(total_ca),
  }


def _earliest_document_year(db: Session, user_id: str, entity_id: int) -> Optional[int]:
  """Earliest year_of_assessment with any document on record for this
  entity — used to decide how far back the carryforward walk needs to go
  when no opening balance has been set (see get_tax_profile_summary)."""
  row = (
    db.query(func.min(Document.year_of_assessment))
    .filter(Document.user_id == user_id, Document.entity_id == entity_id, Document.year_of_assessment.isnot(None))
    .first()
  )
  return row[0] if row and row[0] is not None else None


def _entity_carryforward_schedule(db: Session, user_id: str, entity, target_year: int, cache: Optional[dict] = None) -> dict:
  """
  Build the year_business_data walk for ONE entity and run
  compute_multi_year_carryforward() over it. Shared by the current-year
  business-income split (B1/B14/M2) and the standalone B5/M1/M2 schedule —
  both need exactly the same walk, so there is only ever one place this
  logic lives.

  `cache` (added 14 Jul 2026): a plain dict, created ONCE per request by the
  caller (get_tax_profile_summary) and threaded through every call this
  request makes — current year, prior year, and every year in the trend
  loop all overlap heavily in the years they need (e.g. requesting the
  trend for 5 years re-walks the SAME opening-year..target-year history 5
  separate times without this). Keyed on (entity_id, year); memoizes
  _business_totals_for_year's result, which is the expensive part (a
  Document query plus a capital-allowance recompute per asset). Passing
  None (the default) falls back to an unmemoized per-call dict, so this
  function still works correctly if ever called standalone.
  """
  opening_year = entity.opening_balance_year
  earliest_doc_cache_key = ("earliest_doc_year", entity.id)
  if cache is not None and earliest_doc_cache_key in cache:
    earliest_doc_year = cache[earliest_doc_cache_key]
  else:
    earliest_doc_year = _earliest_document_year(db, user_id, entity.id)
    if cache is not None:
      cache[earliest_doc_cache_key] = earliest_doc_year

  if opening_year is not None:
    start_year = opening_year + 1
  elif earliest_doc_year is not None:
    start_year = earliest_doc_year
  else:
    start_year = target_year

  start_year = min(start_year, target_year)
  year_business_data = {}
  for y in range(start_year, target_year + 1):
    cache_key = (entity.id, y)
    if cache is not None and cache_key in cache:
      year_business_data[y] = cache[cache_key]
    else:
      result = _business_totals_for_year(db, user_id, entity.id, y)
      year_business_data[y] = result
      if cache is not None:
        cache[cache_key] = result
  return compute_multi_year_carryforward(entity, year_business_data, target_year)


def _generate_manual_receipt_text(payload: dict, line_items: list[dict], total: float) -> str:
  """
  Render a plain-text receipt for manually-entered documents. Keeps the
  Document row's file_path requirement satisfied with a real, viewable file,
  without pulling in a new PDF/image dependency.
  """
  lines = [
    f"{payload.get('document_type', 'Document')}".upper(),
    "=" * 50,
    f"Vendor:        {payload.get('vendor', '')}",
  ]
  if payload.get("vendor_addr"):
    lines.append(f"Address:       {payload['vendor_addr']}")
  lines += [
    f"Document No.:  {payload.get('doc_no', '')}",
    f"Date:          {payload.get('date', '')}",
    "-" * 50,
    f"{'Description':<35}{'Amount (RM)':>15}",
    "-" * 50,
  ]
  for li in line_items:
    desc = str(li.get("desc", ""))[:34]
    amt  = float(li.get("amt", 0) or 0)
    lines.append(f"{desc:<35}{amt:>15,.2f}")
  lines += [
    "-" * 50,
    f"{'TOTAL':<35}{total:>15,.2f}",
    "=" * 50,
  ]
  if payload.get("notes"):
    lines += ["", f"Notes: {payload['notes']}"]
  lines += ["", "This document was manually entered by the user (no OCR was performed)."]
  return "\n".join(lines)


@app.post("/api/documents/manual", status_code=201)
@limiter.limit("30/minute")
def create_manual_document(
  request: Request,
  payload: dict,
  user_id:   str            = Query(..., description="Owner the manual document is attributed to."),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  """
  Persist a document the user entered by hand (no file, no OCR pipeline).
  Used by the "Manually add a document" flow when a receipt can't be
  uploaded as a file. A plain-text receipt is generated and stored on disk
  so the record behaves consistently with every other Document row.
  """
  _verify_entity_owned(db, user_id, entity_id)
  vendor    = (payload.get("vendor") or "").strip()
  doc_no    = (payload.get("doc_no") or "").strip()
  doc_date  = (payload.get("date") or "").strip()
  category  = payload.get("category") or REVIEW_CATEGORY
  doc_type  = (payload.get("document_type") or "Manual Entry").strip()
  line_items = payload.get("line_items") or []

  if not vendor:
    raise HTTPException(status_code=422, detail="Vendor is required.")
  if not doc_no:
    raise HTTPException(status_code=422, detail="Document number is required.")
  if not re.match(r"^\d{4}-\d{2}-\d{2}$", doc_date):
    raise HTTPException(status_code=422, detail=f"Invalid date '{doc_date}'. Expected YYYY-MM-DD.")
  if not line_items or not all(
    isinstance(li, dict) and str(li.get("desc", "")).strip() and float(li.get("amt", 0) or 0) > 0
    for li in line_items
  ):
    raise HTTPException(status_code=422, detail="At least one line item with a description and amount > 0 is required.")
  if category not in CATEGORY_STATUS_MAP:
    raise HTTPException(status_code=422, detail=f"Unknown category '{category}'.")

  total = sum(float(li.get("amt", 0) or 0) for li in line_items)
  tax_status = CATEGORY_STATUS_MAP[category]
  quadrant   = _quadrant_for_category(category)

  receipt_text = _generate_manual_receipt_text(payload, line_items, total)
  safe_filename  = f"{uuid.uuid4().hex}_manual_{doc_no.replace(' ', '_')}.txt"
  safe_file_path = os.path.join(STORAGE_DIR, safe_filename)
  if not os.path.realpath(safe_file_path).startswith(os.path.realpath(STORAGE_DIR)):
    raise HTTPException(status_code=400, detail="Invalid file path.")
  with open(safe_file_path, "w", encoding="utf-8") as buf:
    buf.write(receipt_text)

  display_name = f"{doc_type.replace(' ', '_')}_{vendor.replace(' ', '_')}_{doc_date}.txt"

  extracted_data = {
    "is_tax_relevant": True,
    "file_kind": "manual",
    "quadrant": quadrant,
    "ita_section": None,
    "vendor": vendor,
    "vendor_addr": payload.get("vendor_addr"),
    "doc_no": doc_no,
    "date": doc_date,
    "date_precision": "day",
    "date_raw": doc_date,
    "tax_year": doc_date[:4],
    "amount": total,
    "currency": "MYR",
    "note": payload.get("notes") or "Manually entered by user.",
    "confidence": 100,
    "line_items": [
      {"desc": li.get("desc", ""), "amt": float(li.get("amt", 0) or 0)}
      for li in line_items
    ],
    "manual_entry": True,
  }

  db_doc = Document(
    user_id=user_id,
    entity_id=entity_id,
    file_name=display_name,
    file_path=safe_file_path,
    status="completed",
    document_type=doc_type,
    category=category,
    tax_status=tax_status,
    year_of_assessment=int(doc_date[:4]),
    extracted_data=extracted_data,
  )
  db.add(db_doc)
  db.commit()
  db.refresh(db_doc)

  # Manual entries bypass run_document_pipeline entirely, so if the user
  # picked a capital or breastfeeding-equipment category by hand, nothing
  # would otherwise ever create the CapitalAsset/BreastfeedingEquipmentClaim
  # registry row it needs to actually generate an allowance/claim figure.
  # Asset-class fields aren't collected by this form, so these fall back to
  # the "unrecognised/needs review" paths inside each sync function rather
  # than silently guessing — expected for a manual entry, not a bug.
  sync_capital_asset_registry(db, db_doc, category, tax_status, db_doc.year_of_assessment, extracted_data, doc_type, db_doc.id)
  sync_breastfeeding_claim_registry(db, db_doc, category, db_doc.year_of_assessment, extracted_data, doc_type, db_doc.id)
  sync_financial_statement_profile(db, db_doc, category, db_doc.year_of_assessment, extracted_data, doc_type, db_doc.id)
  sync_cp500_registry(db, db_doc, category, db_doc.year_of_assessment, extracted_data, db_doc.id)
  sync_one_time_relief_registry(db, db_doc, category, db_doc.year_of_assessment, extracted_data, db_doc.id)

  return _serialize_doc(db_doc)


@app.get("/api/documents")
def get_all_documents(
  user_id:   str            = Query(..., description="Owner of the documents — required so results are scoped to one user."),
  entity_id: Optional[int] = Query(default=None, description="Active entity; when supplied, restricts to that entity's documents."),
  year:      Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  _verify_entity_owned(db, user_id, entity_id)
  q = db.query(Document).filter(Document.user_id == user_id).order_by(Document.id.desc())
  if entity_id is not None:
    q = q.filter(Document.entity_id == entity_id)
  if year:
    q = q.filter(Document.year_of_assessment == year)
  return [_serialize_doc(doc) for doc in q.all()]


@app.get("/api/documents/{doc_id}/status")
def get_document_status(
  doc_id: int,
  user_id:   str            = Query(..., description="Owner of the document."),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  doc = _scoped_document_or_404(db, doc_id, user_id, entity_id)

  payload: dict = {"id": doc.id, "status": doc.status}
  if doc.status == "completed":
    payload.update({
      "documentType":     doc.document_type,
      "category":         doc.category,
      "taxStatus":        doc.tax_status,
      "yearOfAssessment": doc.year_of_assessment,
      "quadrant":         doc.extracted_data.get("quadrant")    if doc.extracted_data else None,
      "itaSection":       doc.extracted_data.get("ita_section") if doc.extracted_data else None,
      "confidence":       doc.extracted_data.get("confidence")  if doc.extracted_data else None,
    })
  elif doc.status == "failed":
    payload["error"] = doc.extracted_data.get("error_message") if doc.extracted_data else "Unknown error."
  return payload


@app.get("/api/documents/{doc_id}")
def get_document(
  doc_id: int,
  user_id:   str            = Query(..., description="Owner of the document."),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  doc = _scoped_document_or_404(db, doc_id, user_id, entity_id)
  return _serialize_doc(doc)


@app.delete("/api/documents/{doc_id}", status_code=200)
def delete_document(
  doc_id: int,
  user_id:   str            = Query(..., description="Owner of the document."),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  doc = _scoped_document_or_404(db, doc_id, user_id, entity_id)
  file_path = doc.file_path

  # A filed Form B document also created a FormBProfile row, linked back to this
  # document via source_document_id. That column is a plain integer, not a
  # cascading FK, so deleting the document would otherwise ORPHAN the profile —
  # leaving its figures driving the summary and prior-year bar chart for a
  # document the user just removed. Delete the linked profile in the same
  # transaction. (Matching on source_document_id means a profile that a LATER
  # Form B upload re-pointed to a different document is correctly left alone.)
  fb_deleted = (
    db.query(FormBProfile)
    .filter(FormBProfile.source_document_id == doc_id, FormBProfile.user_id == user_id)
    .delete(synchronize_session=False)
  )
  if fb_deleted:
    logger.info(f"[Delete] Removed {fb_deleted} FormBProfile row(s) linked to document ID {doc_id}.")

  # A capital-asset document likewise created a CapitalAsset registry row
  # (source_document_id is a unique FK to this document, one asset per document).
  # Its FK is ondelete=SET NULL, so a raw delete would leave the asset behind
  # with a null source. We remove it here so deleting the purchase document also
  # removes the asset. NOTE: capital allowance is MULTI-YEAR — this asset also
  # drives Annual Allowance in every subsequent year until it's fully written
  # down, so deleting it removes those future years' allowance too, not just the
  # acquisition year's. Deleting the source document is treated as "this asset
  # shouldn't exist", which is what the user intends here.
  ca_deleted = (
    db.query(CapitalAsset)
    .filter(CapitalAsset.source_document_id == doc_id, CapitalAsset.user_id == user_id)
    .delete(synchronize_session=False)
  )
  if ca_deleted:
    logger.info(f"[Delete] Removed {ca_deleted} CapitalAsset row(s) linked to document ID {doc_id}.")

  # Same reasoning as CapitalAsset above, for H11 breastfeeding equipment
  # claims: deleting the source document should remove the claim, not leave
  # it behind silently affecting a future year's 2-year eligibility gate
  # with a null source.
  bc_deleted = (
    db.query(BreastfeedingEquipmentClaim)
    .filter(BreastfeedingEquipmentClaim.source_document_id == doc_id, BreastfeedingEquipmentClaim.user_id == user_id)
    .delete(synchronize_session=False)
  )
  if bc_deleted:
    logger.info(f"[Delete] Removed {bc_deleted} BreastfeedingEquipmentClaim row(s) linked to document ID {doc_id}.")

  # Phase 6: FinancialStatementProfile is shared between up to TWO documents
  # (one owning the pl_* half, a different one owning the bs_* half), so —
  # unlike the two bulk deletes above — deleting this document must only
  # clear the half IT owned, never the whole row (the other half may belong
  # to a still-valid document). Delete the row entirely only once both
  # halves are empty.
  fsp_pl_row = db.query(FinancialStatementProfile).filter(FinancialStatementProfile.pl_source_document_id == doc_id).first()
  if fsp_pl_row:
    for _col in (
      "pl_opening_inventory", "pl_closing_inventory", "pl_other_business_income", "pl_dividends",
      "pl_rents_royalties_premiums", "pl_contract_subcontracts", "pl_bad_debts",
      "pl_stated_revenue", "pl_stated_net_profit",
    ):
      setattr(fsp_pl_row, _col, None)
    fsp_pl_row.pl_source_document_id = None
    fsp_pl_row.pl_confidence = None
    logger.info(f"[Delete] Cleared P&L half of FinancialStatementProfile (id={fsp_pl_row.id}) linked to document ID {doc_id}.")

  fsp_bs_row = db.query(FinancialStatementProfile).filter(FinancialStatementProfile.bs_source_document_id == doc_id).first()
  if fsp_bs_row:
    for _col in (
      "bs_land_buildings", "bs_plant_machinery", "bs_motor_vehicles", "bs_other_non_current_assets",
      "bs_investments", "bs_inventory", "bs_trade_debtors", "bs_sundry_debtors", "bs_cash_in_hand",
      "bs_cash_at_bank", "bs_other_current_assets", "bs_loans_overdrafts", "bs_trade_creditors",
      "bs_sundry_creditors", "bs_capital_account", "bs_current_account_bf", "bs_drawings_advance_net",
    ):
      setattr(fsp_bs_row, _col, None)
    fsp_bs_row.bs_source_document_id = None
    fsp_bs_row.bs_confidence = None
    logger.info(f"[Delete] Cleared BS half of FinancialStatementProfile (id={fsp_bs_row.id}) linked to document ID {doc_id}.")

  db.flush()
  for _row in {id(r): r for r in (fsp_pl_row, fsp_bs_row) if r is not None}.values():
    if _row.pl_source_document_id is None and _row.bs_source_document_id is None:
      db.delete(_row)
      logger.info(f"[Delete] Removed empty FinancialStatementProfile row (id={_row.id}) — both halves cleared.")

  db.delete(doc)
  db.commit()
  try:
    if file_path and os.path.isfile(file_path):
      os.remove(file_path)
  except OSError as e:
    logger.warning(f"[Delete] Could not remove file '{file_path}': {e}")
  return {"message": f"Document ID {doc_id} deleted.", "document_id": doc_id}


@app.patch("/api/documents/{doc_id}/retry", status_code=202)
def retry_document(
  doc_id: int,
  user_id:   str            = Query(..., description="Owner of the document."),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  """
  Re-run the OCR/classification pipeline on a previously failed document,
  using the file already stored on disk — no re-upload required.
  """
  doc = _scoped_document_or_404(db, doc_id, user_id, entity_id)
  if doc.status != "failed":
    raise HTTPException(status_code=422, detail=f"Document ID {doc_id} is not in a failed state (status: {doc.status}).")
  if not doc.file_path or not os.path.isfile(doc.file_path):
    raise HTTPException(status_code=410, detail=f"Stored file for document ID {doc_id} is missing — please re-upload.")

  doc.status = "pending"
  doc.document_type = "Unclassified"
  doc.category = None
  doc.tax_status = None
  doc.year_of_assessment = None
  doc.extracted_data = None
  db.commit()

  # Same fix as _save_and_queue: submit directly to the thread pool. This
  # endpoint is a sync `def`, so FastAPI runs it in a worker thread that has
  # no event loop of its own — asyncio.get_event_loop() raises here on
  # Python 3.12 ("no current event loop in thread"). submit() sidesteps the
  # event loop requirement entirely.
  _pipeline_executor.submit(run_document_pipeline, doc.id, doc.file_path, SessionLocal)

  return {"message": f"Document ID {doc_id} re-queued for classification.", "document_id": doc_id, "status": "pending"}


@app.patch("/api/documents/{doc_id}/archive", status_code=200)
def archive_document(
  doc_id: int,
  user_id:   str            = Query(..., description="Owner of the document."),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  doc = _scoped_document_or_404(db, doc_id, user_id, entity_id)

  # A document that still needs the user's input (apportionment %, mixed
  # classification confirmation, etc.) can't be archived — archiving is for
  # decluttering things you've already dealt with, not a way to make an
  # outstanding action item disappear without resolving it. Resolve it
  # (reclassify/confirm) first, then archive.
  ed = doc.extracted_data or {}
  aggregation_state = ed.get("aggregation_state")
  if aggregation_state in ("needs_apportionment", "needs_user_confirmation"):
    raise HTTPException(
      status_code=409,
      detail="This document still needs review before it can be archived. Resolve it first.",
    )

  doc.status = "archived"
  db.commit()
  return {"message": f"Document ID {doc_id} archived.", "document_id": doc_id, "status": "archived"}


@app.patch("/api/documents/{doc_id}/unarchive", status_code=200)
def unarchive_document(
  doc_id: int,
  user_id:   str            = Query(..., description="Owner of the document."),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  """
  Restore an archived document back to the main list. Archiving is only ever
  offered on a fully-resolved document (completed or failed — see the
  isPipeline check on the frontend), so 'completed' is always the correct
  status to return to: there's no in-flight classification state to resume,
  and any document that reaches the archived list already has whatever
  category/amount data it's going to have.
  """
  doc = _scoped_document_or_404(db, doc_id, user_id, entity_id)
  doc.status = "completed"
  db.commit()
  return {"message": f"Document ID {doc_id} unarchived.", "document_id": doc_id, "status": "completed"}


@app.patch("/api/documents/{doc_id}/reclassify", status_code=200)
def reclassify_document(
  doc_id: int,
  payload: dict,
  user_id:   str            = Query(..., description="Owner of the document."),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  doc = _scoped_document_or_404(db, doc_id, user_id, entity_id)

  new_status   = payload.get("status")
  new_category = payload.get("category")
  new_amount   = payload.get("amount")
  new_date     = payload.get("date")
  new_deductible_pct = payload.get("deductible_pct")
  # Reuse the SAME canonical status set the pipeline itself validates
  # against, rather than a hand-duplicated literal here — a second copy is
  # exactly how this drifted out of sync before (it was missing 'donation'
  # after Phase 2 added that status, silently 422-ing any manual
  # reclassification to an Approved Donations category).
  if new_status and new_status not in VALID_STATUSES:
    raise HTTPException(status_code=422, detail=f"Invalid status '{new_status}'.")
  if new_amount is not None:
    try:
      new_amount = float(new_amount)
      if new_amount < 0:
        raise ValueError()
    except (TypeError, ValueError):
      raise HTTPException(status_code=422, detail=f"Invalid amount '{payload.get('amount')}'.")
  if new_date is not None:
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(new_date)):
      raise HTTPException(status_code=422, detail=f"Invalid date '{new_date}'. Expected YYYY-MM-DD.")

  # Reject amount/date edits on documents whose role makes a single amount/date
  # meaningless — a balance sheet / P&L / prior Form B (summary_statement) or a
  # bank statement (ledger_source) is an aggregate or a ledger, not one dated
  # line item. Gate on the document's ORIGINAL role (the same signal the UI uses
  # to hide the inputs), so the two never disagree.
  _existing_ed = doc.extracted_data or {}
  _original_role = _existing_ed.get("document_role") or derive_document_role(doc.category or "")

  # Amount is only meaningful for a single-transaction document. A summary
  # statement (P&L, balance sheet, prior Form B — the REFERENCE_ONLY categories)
  # or a bank-statement ledger is an aggregate, not one line item, so its amount
  # is never user-editable here.
  if new_amount is not None and _original_role not in ("transaction", "schedule_source"):
    raise HTTPException(
      status_code=422,
      detail=(
        f"This document is a '{_original_role}' and doesn't carry a single editable amount. "
        "Edit the underlying documents it summarises instead."
      ),
    )
  # A DATE, unlike an amount, IS meaningful for a summary statement (e.g. the
  # year a prior Form B relates to), so those documents may have their date
  # edited even though their amount can't. Only roles with genuinely no single
  # date (bank-statement ledger, bare supporting evidence) reject a date edit.
  if new_date is not None and _original_role not in ("transaction", "schedule_source", "summary_statement"):
    raise HTTPException(
      status_code=422,
      detail=f"This document is a '{_original_role}' and doesn't carry a single editable date.",
    )

  # Capture the ORIGINAL (LLM-derived) values BEFORE mutating anything, so a
  # later "reset" can restore them. doc.category/tax_status are overwritten just
  # below, so this must happen first.
  _pre_edit_ed = doc.extracted_data or {}
  _original_snapshot = {
    "category":           doc.category,
    "tax_status":         doc.tax_status,
    "year_of_assessment": doc.year_of_assessment,
    "amount":             _pre_edit_ed.get("amount"),
    "date":               _pre_edit_ed.get("date"),
    "date_precision":     _pre_edit_ed.get("date_precision"),
    "document_role":      _pre_edit_ed.get("document_role"),
    "aggregation_state":  _pre_edit_ed.get("aggregation_state"),
    "quadrant":           _pre_edit_ed.get("quadrant"),
  }

  if new_status:
    doc.tax_status = new_status
  if new_category:
    doc.category = new_category
  doc.status = "completed"

  ed = dict(doc.extracted_data or {})
  # Written once and never overwritten, so it always reflects the LLM's output.
  if "_original" not in ed:
    ed["_original"] = _original_snapshot
  ed["user_reclassified"] = True
  ed["user_reclassified_status"]   = new_status
  ed["user_reclassified_category"] = new_category
  if new_amount is not None:
    ed["amount"] = new_amount
    ed["user_entered_amount"] = True
  if new_date is not None:
    ed["date"] = new_date
    ed["date_precision"] = "day"
    ed["user_entered_date"] = True
    # Keep the indexed YA column in sync so the year-scoped overview/summary
    # actually reflect the corrected date — previously only extracted_data.date
    # changed, so moving a document's date never moved its year of assessment.
    try:
      new_ya = int(str(new_date)[:4])
      if 2000 <= new_ya <= 2100:
        doc.year_of_assessment = new_ya
    except (TypeError, ValueError):
      pass

  # A manual correction changes which category/status this document carries,
  # so document_role and aggregation_state must be recomputed off the FINAL
  # values — otherwise a user resolving a "needs apportionment" item (e.g.
  # confirming the deductible portion of a hire purchase statement) would
  # still have it silently excluded from the totals because the stored
  # aggregation_state was never refreshed.
  final_category = doc.category
  final_status   = new_status or doc.tax_status
  ed["document_role"]     = derive_document_role(final_category or "")
  ed["aggregation_state"] = derive_aggregation_state(final_category or "", final_status or "")
  # The tax-profile summary buckets each document into an income/deduction/relief
  # pie by extracted_data["quadrant"], NOT by category. So a correction that moves
  # a document across quadrants (e.g. Business Income → Business Expense) must
  # refresh the stored quadrant too, otherwise the document keeps showing under
  # its OLD pie (as a stray segment) instead of moving to the new one.
  ed["quadrant"] = _quadrant_for_category(final_category or "")
  # A user-confirmed correction is, by definition, resolved — unless they're
  # explicitly re-flagging it as mixed/relief-non-deductible/etc., in which
  # case the derived state above already reflects that.
  if new_status and new_status not in ("mixed", "not_applicable", "non_deductible") and ed["aggregation_state"] != "reference_only":
    ed["aggregation_state"] = "resolved"

  # Apportioned Q3 categories (client entertainment, gifts, mixed-use vehicle,
  # hire purchase) are only PARTIALLY deductible. A user confirming such a
  # category is resolving it — we store the deductible percentage and mark it
  # resolved so aggregation sums ONLY that portion into the deduction total
  # (never the full amount). Statutory categories ignore any requested pct;
  # 'required' ones (vehicle/HP) reject the confirmation until a pct is supplied.
  if final_category in APPORTIONED_CATEGORIES:
    pct, ok, err = resolve_deductible_pct(final_category, new_deductible_pct)
    if not ok:
      raise HTTPException(status_code=422, detail=err)
    ed["deductible_pct"] = pct
    ed["aggregation_state"] = "resolved"
  else:
    # Category moved off an apportioned one (e.g. entertainment → plain expense);
    # drop any stale split so the full amount is deductible again.
    ed.pop("deductible_pct", None)

  doc.extracted_data = ed
  db.commit()

  # Keep the CapitalAsset / BreastfeedingEquipmentClaim registries in sync
  # with whatever category this document ends up with — without this,
  # reclassifying INTO a capital or breastfeeding-equipment category
  # silently never created the registry row (so it would never generate
  # allowance/claim figures), and reclassifying AWAY from one left a stale
  # row still generating them. Both functions handle the "not this category
  # (any more)" case as a cleanup no-op internally.
  sync_capital_asset_registry(db, doc, final_category, final_status, doc.year_of_assessment, ed, doc.document_type, doc_id)
  sync_breastfeeding_claim_registry(db, doc, final_category, doc.year_of_assessment, ed, doc.document_type, doc_id)
  sync_financial_statement_profile(db, doc, final_category, doc.year_of_assessment, ed, doc.document_type, doc_id)
  sync_cp500_registry(db, doc, final_category, doc.year_of_assessment, ed, doc_id)
  sync_one_time_relief_registry(db, doc, final_category, doc.year_of_assessment, ed, doc_id)

  return _serialize_doc(doc)


@app.patch("/api/documents/{doc_id}/reset", status_code=200)
def reset_document_classification(
  doc_id: int,
  user_id:   str            = Query(..., description="Owner of the document."),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  """
  Revert a user-edited document to the LLM's ORIGINAL classification (category,
  status, amount, date, year of assessment). Only possible once the document has
  been edited at least once (the original was snapshotted on the first edit).
  """
  doc = _scoped_document_or_404(db, doc_id, user_id, entity_id)
  ed = dict(doc.extracted_data or {})
  orig = ed.get("_original")
  if not orig:
    raise HTTPException(status_code=400, detail="This document hasn't been edited — there's nothing to reset.")

  doc.category   = orig.get("category")
  doc.tax_status = orig.get("tax_status")
  if orig.get("year_of_assessment") is not None:
    doc.year_of_assessment = orig["year_of_assessment"]

  ed["amount"]            = orig.get("amount")
  ed["date"]              = orig.get("date")
  ed["date_precision"]    = orig.get("date_precision")
  ed["document_role"]     = orig.get("document_role") or derive_document_role(doc.category or "")
  ed["aggregation_state"] = orig.get("aggregation_state") or derive_aggregation_state(doc.category or "", doc.tax_status or "")
  # Fall back to re-deriving quadrant for snapshots taken before this field
  # was captured, rather than leaving a stale quadrant from the edit being
  # reverted — that would silently keep the document in the wrong
  # income/expense pie even after "undoing" the reclassification.
  ed["quadrant"] = orig.get("quadrant") or _quadrant_for_category(doc.category or "")

  # If restoring the ORIGINAL classification brings back a needs-review
  # state, an archived document must come back into view too — otherwise
  # reset could recreate exactly the "archived but still needs review"
  # inconsistency that the archive endpoint itself refuses to create in the
  # first place. Unlike archiving (flatly blocked while unresolved), reset
  # has a legitimate reason to run on an archived document (comparing
  # against the AI's original read), so the fix here is to surface it again
  # rather than reject the reset outright.
  if doc.status == "archived" and ed["aggregation_state"] in ("needs_apportionment", "needs_user_confirmation"):
    doc.status = "completed"

  # Clear every user-edit marker so the document looks pristine again. Keep the
  # _original snapshot so a fresh round of edits can still be reset.
  for k in (
    "user_reclassified", "user_reclassified_status", "user_reclassified_category",
    "user_entered_amount", "user_entered_date", "ca_rate_note", "ca_rate_needs_review",
    "deductible_pct",
  ):
    ed.pop(k, None)

  doc.extracted_data = ed
  db.commit()

  # Same registry-sync reasoning as reclassify above — reverting a document
  # back to (say) a non-capital category must also remove any CapitalAsset/
  # BreastfeedingEquipmentClaim row the reclassification had created, and
  # reverting BACK to a capital/breastfeeding-equipment category must
  # recreate one if the reclassification had removed it.
  sync_capital_asset_registry(db, doc, doc.category, doc.tax_status, doc.year_of_assessment, ed, doc.document_type, doc_id)
  sync_breastfeeding_claim_registry(db, doc, doc.category, doc.year_of_assessment, ed, doc.document_type, doc_id)
  sync_financial_statement_profile(db, doc, doc.category, doc.year_of_assessment, ed, doc.document_type, doc_id)
  sync_cp500_registry(db, doc, doc.category, doc.year_of_assessment, ed, doc_id)
  sync_one_time_relief_registry(db, doc, doc.category, doc.year_of_assessment, ed, doc_id)

  return _serialize_doc(doc)


# ── Tax profile endpoints ────────────────────────────────────────────────────

# ── LHDN statutory relief caps (Schedule 9, ITA 1967) — fallback values used
# only when a document's own `relief_cap_myr` wasn't extracted by the LLM.
# Kept here (not in pipeline.py) since this is where caps get ENFORCED.
RELIEF_CAPS_FALLBACK_MYR = {
  "Q4 — Life Insurance & Takaful Relief":         3000,
  "Q4 — EPF Personal Contribution":               4000,
  # "Q4 — Parent Medical Care" removed (14 Jul 2026) — H2(i)/(ii) split into
  # 2 categories sharing one RM8,000 pool, with H2(ii)'s own RM1,000
  # sub-cap. A flat per-category cap can't express that; see
  # RELIEF_CAP_GROUPS below.
  # "Q4 — Self/Spouse/Child Medical" removed (14 Jul 2026) — H6/H7/H8 split
  # into 9 real sub-line categories with a genuine 3-level nested cap
  # structure (individual sub-caps, shared sub-pools, and the RM10,000
  # outer pool) that a flat per-category cap can't express. See
  # RELIEF_CAP_GROUPS below.
  # "Q4 — Lifestyle Relief" removed (14 Jul 2026) — H9(i)/(ii)/(iii)/(iv)
  # split into 4 categories sharing one RM2,500 pool, none with its own
  # sub-cap. See RELIEF_CAP_GROUPS below.
  "Q4 — Childcare Fees":                          3000,   # H12
  "Q4 — SSPN Net Deposit":                        8000,   # H13 (net of withdrawals — computed before capping, see below)
  "Q4 — Medical Equipment Relief":                6000,   # H3
  "Q4 — Private Retirement Scheme (PRS)":         3000,   # H18
  # Bug fix (14 Jul 2026, post-Phase-5 audit): was RM250 — LHDN's own
  # explanatory notes and skeleton form both say "A deduction not exceeding
  # RM350 is allowed" for H20. RM250 silently under-relieved every filer
  # with RM250-350 of personal SOCSO/EIS contributions by up to RM100.
  "Q4 — SOCSO Personal Contribution":             350,    # H20
  "Q4 — Domestic Tourism Relief":                 1000,
  "Q4 — Tourist Attraction & Cultural Programme":  1000,
  "Q4 — EV Charging Equipment":                   2500,   # H21
  "Q4 — Education & Medical Insurance":           3000,   # H19
  # "Q4 — Sports & Fitness Relief" removed (14 Jul 2026) — H10(i)/(ii)/(iii)/(iv)
  # split into 4 categories sharing one RM1,000 pool, none with its own
  # sub-cap. See RELIEF_CAP_GROUPS below.
  # "Q4 — Education Relief (Non-Postgraduate/Postgraduate)" and "Q4 —
  # Upskilling / Self-Enhancement Course" are deliberately absent here —
  # they share ONE combined RM7,000 cap (H5), with an additional RM2,000
  # inner sub-cap on the upskilling category alone. A flat per-category cap
  # can't express that, so they're handled instead via RELIEF_CAP_GROUPS below.
  # "Q4 — Zakat" is deliberately absent — zakat is a tax REBATE, not a
  # capped relief, and is handled separately below.
  # "Q4 — Approved Donations" is deliberately absent — it isn't a fixed-amount
  # personal relief at all (10% of B11, not a ringgit cap) and isn't part of
  # the H-code relief pool — see the donation handling in _build_year_summary.
}

# Relief categories whose statutory cap applies to the COMBINED total across
# more than one pipeline category, with additional inner caps on subsets of
# that group. Two shapes of inner cap exist:
#   - `sub_caps`: an INDIVIDUAL cap on ONE member category by itself (e.g.
#     H5's upskilling course, or H6's vaccination/dental lines).
#   - `sub_pools`: a SHARED cap across a SUBSET of member categories
#     TOGETHER, not each individually (e.g. H7's three sub-lines share one
#     RM1,000 pool between them; H8's two sub-lines share one RM4,000 pool).
# Both can coexist in the same group, as H6/H7/H8 needs: H6(iii)/(iv) each
# get their OWN RM1,000 (a `sub_cap`), while H7's three lines and H8's two
# lines each share ONE pooled cap between their members (`sub_pools`) — and
# the combined total of everything is still capped by `group_cap`.
#
# _cap_reliefs emits ONE breakdown row PER MEMBER CATEGORY (not a single
# merged group row) — so `display_category` here is only an internal
# bookkeeping key (used for the processed_groups de-dupe check as this
# function walks by_category), not something the frontend ever actually
# sees or maps from anymore.
RELIEF_CAP_GROUPS = [
  {
    # H9(i)/(ii)/(iii)/(iv) split (14 Jul 2026) — simpler than H2/H5/H6/H7/H8's
    # groups: no member has its own sub-cap or shares a smaller sub-pool,
    # they all just share ONE flat RM2,500 pool equally. sub_caps/sub_pools
    # both omitted — Stage 1/2 of the waterfall become no-ops, leaving
    # Stage 3 (the outer group_cap) as the only real constraint.
    "display_category": "Q4 — Lifestyle Relief (Group)",
    "categories": [
      "Q4 — Books & Publications",         # H9(i)
      "Q4 — Personal Computer & Devices",  # H9(ii)
      "Q4 — Internet Subscription",        # H9(iii)
      "Q4 — Personal Enrichment Course",   # H9(iv)
    ],
    "group_cap": Decimal("2500"),
  },
  {
    # H10(i)/(ii)/(iii)/(iv) split (14 Jul 2026) — same shape as H9's group
    # above: one flat shared pool, no individual sub-caps.
    "display_category": "Q4 — Sports & Fitness Relief (Group)",
    "categories": [
      "Q4 — Sports Equipment",       # H10(i)
      "Q4 — Sports Facility Fee",    # H10(ii)
      "Q4 — Sports Competition Fee", # H10(iii)
      "Q4 — Gym & Sports Training",  # H10(iv)
    ],
    "group_cap": Decimal("1000"),
  },
  {
    # H2(i)/(ii) split (14 Jul 2026) — same shape as H5's group below:
    # H2(ii) (complete medical exam) gets its own RM1,000 sub-cap, while
    # both share the RM8,000 outer pool.
    "display_category": "Q4 — Parent Medical Care (Group)",
    "categories": [
      "Q4 — Parent Medical Care",                          # H2(i)
      "Q4 — Parent Medical Care (Complete Examination)",    # H2(ii)
    ],
    "group_cap": Decimal("8000"),
    "sub_caps": {"Q4 — Parent Medical Care (Complete Examination)": Decimal("1000")},
  },
  {
    "display_category": "Q4 — Education Relief",
    # H5(i)/(ii) split (14 Jul 2026) — non-postgraduate and postgraduate
    # education fees are now their own categories (previously merged into
    # one "Q4 — Education Relief" that couldn't distinguish the two real
    # LHDN sub-lines). Neither has an individual sub-cap of its own — they
    # simply share the RM7,000 pool with H5(iii)'s upskilling category,
    # which keeps its RM2,000 sub-cap.
    "categories":  [
      "Q4 — Education Relief (Non-Postgraduate)",  # H5(i)
      "Q4 — Education Relief (Postgraduate)",       # H5(ii)
      "Q4 — Upskilling / Self-Enhancement Course",  # H5(iii)
    ],
    "group_cap":   Decimal("7000"),
    "sub_caps":    {"Q4 — Upskilling / Self-Enhancement Course": Decimal("2000")},
  },
  {
    # H6/H7/H8 granularity split (14 Jul 2026) — see pipeline.py's category
    # list for the same 3-level structure explained from the extraction
    # side. Rendered on the printed form as "Q4 — Self/Spouse/Child
    # Medical" so the existing H6 line mapping in formB.js's
    # Q4_TO_H_LINE-equivalent grouping still has a combined figure to show
    # if it ever needs one, even though each sub-line is now ALSO exposed
    # individually via q4ReliefsBreakdown for the H6/H7/H8 rows.
    "display_category": "Q4 — Self/Spouse/Child Medical",
    "categories": [
      "Q4 — Serious Disease Treatment",        # H6(i) — no individual sub-cap
      "Q4 — Fertility Treatment",              # H6(ii) — no individual sub-cap
      "Q4 — Vaccination",                      # H6(iii) — own RM1,000 sub-cap
      "Q4 — Dental Examination & Treatment",   # H6(iv) — own RM1,000 sub-cap
      "Q4 — Complete Medical Examination",     # H7(i) ┐
      "Q4 — COVID-19 Detection Test",          # H7(ii)├─ share ONE RM1,000 pool
      "Q4 — Mental Health Examination",        # H7(iii)┘
      "Q4 — Learning Disability Diagnosis",           # H8(i) ┐ share ONE RM4,000 pool
      "Q4 — Learning Disability Early Intervention",  # H8(ii)┘
    ],
    "group_cap": Decimal("10000"),
    "sub_caps": {
      "Q4 — Vaccination":                    Decimal("1000"),
      "Q4 — Dental Examination & Treatment": Decimal("1000"),
    },
    "sub_pools": [
      {
        "categories": ["Q4 — Complete Medical Examination", "Q4 — COVID-19 Detection Test", "Q4 — Mental Health Examination"],
        "pool_cap": Decimal("1000"),
      },
      {
        "categories": ["Q4 — Learning Disability Diagnosis", "Q4 — Learning Disability Early Intervention"],
        "pool_cap": Decimal("4000"),  # base figure, applies for YA2024 and earlier — see cap_overrides_from_year below
        # Bug fix (16 Jul 2026): the RM4,000-vs-RM6,000 discrepancy flagged
        # in the production-readiness audit is now resolved — Budget 2025
        # (confirmed via search, effective YA2025) explicitly raised this
        # from RM4,000 to RM6,000, which is exactly the missing
        # intermediate step between our YA2024 Explanatory Notes source
        # (RM4,000) and Finance Act 2025/Act 874's own "before" text
        # ("six thousand ringgit", i.e. RM6,000) that couldn't be
        # reconciled before. Three correct figures in sequence, not a
        # contradiction: RM4,000 (≤YA2024) → RM6,000 (YA2025 only) →
        # RM10,000 (YA2026 onward, Act 874 s.6(a)(iii)).
        #
        # cap_overrides_from_year is a list of (threshold_year, cap) pairs,
        # evaluated in order — the LAST entry whose threshold_year the
        # target year has reached or passed wins, falling back to pool_cap
        # above if the target year is earlier than every threshold. This
        # generalises the single-override mechanism used elsewhere in this
        # file (e.g. PRS's lapse) to support more than one step change,
        # which a flat (year, cap) tuple couldn't express.
        "cap_overrides_from_year": [
          (2025, Decimal("6000")),
          (2026, Decimal("10000")),
        ],
      },
    ],
  },
]

# Bug fix (14 Jul 2026, post-Phase-5 audit): "Q4 — Domestic Tourism Relief"
# (the PENJANA-era qualifying-hotel/tour-package relief) lapsed after YA2022
# — it doesn't appear anywhere in the current (2024) explanatory notes at
# all. The category was kept only for back-processing OLDER documents, but
# nothing was actually gating it by year: RELIEF_CAPS_FALLBACK_MYR granted
# its RM1,000 cap unconditionally, so a YA2024+ hotel/tourism receipt was
# silently reducing chargeable income for a relief that no longer exists —
# and the frontend deliberately hides this category from Part H display
# (see formB.js's Q4_TO_H_LINE comment), so the reduction was invisible to
# the user, not just under-explained. See _cap_reliefs' year gate below.
DOMESTIC_TOURISM_LAST_ELIGIBLE_YA = 2022

# Bug fix (15 Jul 2026): H18 (Private Retirement Scheme + deferred annuity,
# RM3,000) is explicitly time-boxed by LHDN's own explanatory notes —
# "This deduction is effective from the Year of Assessment 2012 until
# 2025" — but nothing enforced that cutoff, same class of bug as Domestic
# Tourism Relief above (a relief silently granted past its own expiry).
# Given the app's current filing year can already be at or past this
# boundary, this wasn't a hypothetical future bug.
H18_PRS_LAST_ELIGIBLE_YA = 2025

# Finance Act 2025 (Act 874), s.6(a)(i)-(ii), effective YA2026 onward (s.3(1)):
# H6(iii) vaccination relief expands from a fixed list to ANY NPRA-registered
# vaccine. Before this year, only the historical fixed list qualifies — kept
# here rather than in pipeline.py's guidance alone, since the code needs to
# actually ENFORCE the year-dependent scope, not just describe it to the LLM.
H6_VACCINATION_NPRA_EXPANSION_YA = 2026
H6_VACCINATION_PRE_2026_FIXED_LIST = (
  "pneumococcal", "hpv", "human papillomavirus", "influenza", "flu",
  "rotavirus", "varicella", "chickenpox", "meningococcal", "tdap",
  "tetanus-diphtheria", "covid-19", "covid19", "covid",
)

# Finance Act 2025 (Act 874), s.6(a)(iv), effective YA2026 onward (s.3(1)):
# H12 childcare relief gains a second age band (7-12, Care Centres Act 1993
# registration) sharing the same RM3,000 pool as the existing ≤6 band.
H12_CARE_CENTRE_BAND_YA = 2026

# Finance Act 2025 (Act 874), s.6(a)(v), s.3(2): new relief, YA2026 ONLY.
TOURIST_ATTRACTION_ELIGIBLE_YA = 2026

# Finance Act 2025 (Act 874) s.6(a)(vi), s.3(1)/(3): EV charging equipment's
# own eligible years are 2023-2027 inclusive (per the Act's explicit list);
# within that, YA2026-2027 specifically share a combined RM2,500 pool with
# three new one-time reliefs (see one_time_relief.py + _cap_reliefs above).
EV_CHARGING_FIRST_YA = 2023
EV_CHARGING_LAST_YA  = 2027
EV_HOME_IMPROVEMENT_POOL_FIRST_YA = 2026
EV_HOME_IMPROVEMENT_POOL_LAST_YA  = 2027

# Eligible windows for the three new one-time reliefs (Finance Act 2025,
# Act 874, s.6(a)(vi)) — each claimable ONCE across its own window, enforced
# by one_time_relief.compute_one_time_relief_for_year() using the
# OneTimeReliefClaim registry, not by a simple per-year cap.
FOOD_WASTE_COMPOST_WINDOW = (2025, 2027)
FOOD_WASTE_GRINDER_WINDOW = (2026, 2027)
HOME_CCTV_WINDOW          = (2026, 2027)

# Finance Act 2025 (Act 874) s.7, effective YA2026 onward (s.3(1)): H17 life
# insurance extends to a policy on the taxpayer's CHILD's life, not just
# self/spouse. Before this year, ITA 1967 explicitly excluded a child-life
# policy — a pre-existing gap this fix also closes, since nothing enforced
# that exclusion either, before or after this Act.
H17_CHILD_LIFE_INSURANCE_YA = 2026

# INDIVIDUAL_SELF_RELIEF_MYR, LOW_INCOME_REBATE_THRESHOLD_MYR, and
# LOW_INCOME_REBATE_MYR now live in tax_brackets.py (Phase 7 extraction,
# see the import block immediately below) rather than being defined twice.


# Tax bracket computation (Phase 7, 14 Jul 2026): extracted to tax_brackets.py
# so it's unit-testable without a live DB connection — see that module's
# docstring. Aliased back to the original private names here so every
# existing call site in this file (_estimate_tax(...), _bracket_breakdown(...),
# etc.) keeps working unchanged.
from tax_brackets import (
  TAX_BRACKETS_BY_YA, INDIVIDUAL_SELF_RELIEF_MYR,
  LOW_INCOME_REBATE_THRESHOLD_MYR, LOW_INCOME_REBATE_MYR,
  brackets_for_year as _brackets_for_year,
  estimate_tax as _estimate_tax,
  bracket_breakdown as _bracket_breakdown,
  bracket_headroom as _bracket_headroom,
)


@app.get("/api/profile/summary")
def get_tax_profile_summary(
  year:      int            = Query(..., description="Year of assessment e.g. 2024"),
  user_id:   str            = Query(..., description="Logged-in user — required so totals are scoped to one user."),
  entity_id: Optional[int] = Query(
    default=None,
    description=(
      "Active business entity. When supplied, business DOCUMENTS and CAPITAL ASSETS "
      "are scoped to it so a user with multiple sole-props doesn't see their entities' "
      "figures merged. Form B (a per-person return) stays user-scoped by design."
    ),
  ),
  db: Session = Depends(get_db),
):
  _verify_entity_owned(db, user_id, entity_id)
  # Use the shared currency parser (utils.parse_amount) rather than a local copy.
  _parse_amount = parse_amount

  def _num_or_none(v):
    """Decimal-or-None → float-or-None. Distinct from _parse_amount (which
    coerces a missing/unparseable value to Decimal("0")) because a NULL
    FinancialStatementProfile field means 'not on the uploaded document at
    all', which must stay distinguishable from an uploaded document that
    genuinely shows RM0 — collapsing both to 0 here would silently make
    Phase 6's 'no balance sheet uploaded' case look identical to 'balance
    sheet uploaded, all figures are zero'."""
    return float(v) if v is not None else None

  # ── Profile data for flat/derived reliefs (H4 / H14 / H15 / H16) ──────────
  # Bug fix (14 Jul 2026): these used to be computed ONLY in formB.js for
  # display, disconnected from the tax computation — so a user with disabled
  # dependents, a joint-assessment election, or children on their profile saw
  # a "Total Relief" (B23) on the printed draft that didn't match what was
  # actually used to compute chargeable income (B24) / tax payable (B31).
  # This endpoint is now authoritative for these reliefs too — formB.js reads
  # the amounts back from `totals.profileReliefs` instead of recomputing them.
  #
  # Person/children are fetched ONCE here (they don't vary by year), but the
  # actual RELIEF AMOUNTS are computed inside _build_year_summary() per its
  # own target_year — H16 in particular is genuinely age-dependent (a child
  # ages up through the H16a/b/c tiers year over year), so a single
  # once-per-request calculation here would have been wrong for the
  # prior-year / multi-year-trend calls this function also makes below.
  #
  # user_id arrives as a string (it's compared against Document.user_id,
  # which is a String column) but Person.id is an integer PK — guard the cast
  # rather than letting a bad value 500 the whole summary.
  person = None
  try:
    person = db.query(models.Person).filter(models.Person.id == int(user_id)).first()
  except (TypeError, ValueError):
    person = None
  children = list(person.children) if person else []

  # Request-scoped memoization for the carryforward engine (14 Jul 2026,
  # performance fix). This endpoint calls _build_year_summary up to
  # (2 + number of distinct document years) times per request — current
  # year, prior year, and once per year in the trend loop — and each call
  # independently needs the SAME entity/year business totals whenever their
  # year ranges overlap (which they always do, since they all walk back to
  # the same opening year). Without this cache, a user with N years of
  # history triggers O(N²) redundant Document queries + capital-allowance
  # recomputation. Keyed on (entity_id, year) or ("earliest_doc_year",
  # entity_id) — see _entity_carryforward_schedule.
  _carryforward_cache: dict = {}

  def _resolve_pool_cap(pool: dict, target_year: int):
    """
    A sub_pool's effective cap for target_year — either its flat `pool_cap`
    (the ordinary case), or the correct step in its `cap_overrides_from_year`
    list if it has one (e.g. H8's RM4,000 → RM6,000 → RM10,000 progression).

    `cap_overrides_from_year` is a list of (threshold_year, cap) pairs in
    ascending year order — this returns the cap from the LAST entry whose
    threshold_year the target year has reached or passed, falling back to
    the pool's base `pool_cap` if target_year is earlier than every
    threshold. This is a genuine generalisation of the single-override
    mechanism this file already uses elsewhere (e.g. PRS's lapse, via
    H18_PRS_LAST_ELIGIBLE_YA) — a flat (year, cap) tuple can express one
    step change, but H8's real progression needed two.
    """
    overrides = pool.get("cap_overrides_from_year")
    if not overrides:
      return pool["pool_cap"]
    effective_cap = pool["pool_cap"]
    for threshold_year, cap in overrides:
      if target_year >= threshold_year:
        effective_cap = cap
    return effective_cap

  def _cap_reliefs(relief_entries: list, target_year: int) -> tuple[float, list, list]:
    """
    Group relief entries by category, sum within each, and cap each
    category's total at its statutory limit (Sch. 9 ITA 1967).
    Uses the per-document `relief_cap_myr` extracted by the LLM where
    available (falls back to RELIEF_CAPS_FALLBACK_MYR otherwise) so the
    cap logic stays driven by the same source the pipeline already trusts.

    Categories listed in RELIEF_CAP_GROUPS are handled differently: their
    raw totals are summed ACROSS the group (after applying any inner
    sub-cap on individual member categories), and only the combined result
    is capped against the group's shared limit — this is what correctly
    enforces H5's RM7,000 pool with its RM2,000 H5(iii) sub-cap, instead of
    letting each category consume the full RM7,000 independently.

    `target_year` is needed for the one category whose eligibility is
    year-dependent rather than a flat ringgit cap: "Q4 — Domestic Tourism
    Relief" lapsed after YA2022 (bug fix, 14 Jul 2026 — see
    DOMESTIC_TOURISM_LAST_ELIGIBLE_YA's comment). For any later year, that
    category's effective cap is forced to 0 regardless of a document's own
    extracted relief_cap_myr, so an old cached extraction can't reopen a
    relief that's actually lapsed for the year being computed.

    Returns (capped_total, capped_breakdown_by_category, raw_entries_annotated).
    """
    by_category: dict[str, dict] = {}
    for e in relief_entries:
      cat = e.get("category") or "Uncategorised Relief"
      bucket = by_category.setdefault(cat, {"rawTotal": Decimal("0"), "cap": None, "entries": []})
      bucket["rawTotal"] += e["amountNumeric"]
      bucket["entries"].append(e)
      doc_cap = e.get("reliefCapMyr")
      if doc_cap is not None and bucket["cap"] is None:
        bucket["cap"] = _parse_amount(doc_cap)

    category_to_group = {}
    for group in RELIEF_CAP_GROUPS:
      for cat in group["categories"]:
        category_to_group[cat] = group

    capped_total = Decimal("0")
    breakdown = []
    annotated_entries = []
    processed_groups = set()

    # Finance Act 2025 (Act 874) s.6(a)(vi)/(b), effective YA2026-2027 ONLY
    # (s.3(3)): EV charging equipment shares ONE RM2,500 pool with three new
    # one-time reliefs (food waste compost/grinder machine, home CCTV) for
    # exactly these two years — outside this window, EV charging reverts to
    # its own OLD standalone RM2,500 cap (YA2023-2025, per the Act's own
    # listed years for that sub-item), and the three new items simply have
    # no eligible amount to contribute (already excluded upstream by
    # one_time_relief.py before reaching this function). This can't be
    # expressed as a normal static RELIEF_CAP_GROUPS entry, since EV
    # charging's membership in the group is itself year-conditional rather
    # than fixed — so it's handled as its own explicit pre-pass here, with
    # its categories marked "already handled" so the main loop below skips
    # them rather than double-processing.
    _HOME_IMPROVEMENT_POOL_CATEGORIES = [
      "Q4 — EV Charging Equipment",
      "Q4 — Food Waste Compost Machine",
      "Q4 — Food Waste Grinder Machine",
      "Q4 — Home CCTV",
    ]
    already_handled_standalone = set()

    if EV_HOME_IMPROVEMENT_POOL_FIRST_YA <= target_year <= EV_HOME_IMPROVEMENT_POOL_LAST_YA:
      pool_cap_remaining = Decimal("2500")
      pool_raw_total = Decimal("0")
      pool_capped_total = Decimal("0")
      for member_cat in _HOME_IMPROVEMENT_POOL_CATEGORIES:
        member_bucket = by_category.get(member_cat)
        member_raw = member_bucket["rawTotal"] if member_bucket else Decimal("0")
        pool_raw_total += member_raw
        member_take = min(member_raw, pool_cap_remaining)
        pool_cap_remaining -= member_take
        pool_capped_total += member_take
        member_was_capped = member_raw > member_take
        breakdown.append({
          "category":     member_cat,
          "rawTotal":     money(member_raw),
          "cap":          Decimal("2500"),
          "cappedTotal":  money(member_take),
          "wasCapped":    member_was_capped,
          "lapsedForYear": False,
          "sharedPoolWith": [c for c in _HOME_IMPROVEMENT_POOL_CATEGORIES if c != member_cat],
        })
        if member_bucket:
          for e in member_bucket["entries"]:
            annotated_entries.append({**e, "categoryCapMyr": Decimal("2500"), "categoryWasCapped": member_was_capped})
        already_handled_standalone.add(member_cat)
      capped_total += pool_capped_total
    else:
      is_ev_charging_out_of_years = not (EV_CHARGING_FIRST_YA <= target_year <= EV_CHARGING_LAST_YA)
      if is_ev_charging_out_of_years:
        ev_bucket = by_category.get("Q4 — EV Charging Equipment")
        if ev_bucket:
          breakdown.append({
            "category":     "Q4 — EV Charging Equipment",
            "rawTotal":     money(ev_bucket["rawTotal"]),
            "cap":          Decimal("0"),
            "cappedTotal":  Decimal("0.00"),
            "wasCapped":    True,
            "lapsedForYear": True,
          })
          for e in ev_bucket["entries"]:
            annotated_entries.append({**e, "categoryCapMyr": Decimal("0"), "categoryWasCapped": True, "categoryLapsedForYear": True})
        already_handled_standalone.add("Q4 — EV Charging Equipment")
      # else: outside the 2026-2027 pool window but within EV charging's own
      # eligible years (2023-2025) — fall through to the ordinary
      # simple-category path below, unaffected by this whole block.

    for cat, bucket in by_category.items():
      if cat in already_handled_standalone:
        continue
      group = category_to_group.get(cat)

      if group is not None:
        group_key = group["display_category"]
        if group_key in processed_groups:
          continue  # this group's categories are all handled together, once
        processed_groups.add(group_key)

        sub_caps = group.get("sub_caps", {})
        sub_pools = group.get("sub_pools", [])
        group_cap = group["group_cap"]

        # ── Stage 0: raw total per member category ──────────────────────
        raw_by_member = {}
        for member_cat in group["categories"]:
          member_bucket = by_category.get(member_cat)
          raw_by_member[member_cat] = member_bucket["rawTotal"] if member_bucket else Decimal("0")

        # ── Stage 1: individual sub_caps (e.g. H6's vaccination/dental,
        # each capped on its own regardless of anything else in the group) ──
        stage1 = {cat: min(raw_by_member[cat], sub_caps[cat]) if cat in sub_caps else raw_by_member[cat]
                  for cat in group["categories"]}

        # ── Stage 2: sub_pools — a SHARED cap across a SUBSET of member
        # categories together (e.g. H7's three lines sharing one RM1,000
        # pool, H8's two lines sharing one RM4,000 pool). Bug fix (14 Jul
        # 2026): this stage didn't exist at all before — H7/H8's members
        # were flowing through completely uncapped at the pool level, only
        # ever bounded by the much larger outer group_cap. Applied as a
        # waterfall in the pool's own listed order: deterministic, and
        # consistent with how this codebase already resolves other
        # shared-limited-pool situations (e.g. carryforward.py's FIFO loss
        # absorption) rather than an arbitrary proportional split.
        for pool in sub_pools:
          effective_pool_cap = _resolve_pool_cap(pool, target_year)
          remaining_pool = effective_pool_cap
          for member_cat in pool["categories"]:
            take = min(stage1[member_cat], remaining_pool)
            stage1[member_cat] = take
            remaining_pool -= take

        # ── Stage 3: the outer group_cap — a waterfall across ALL member
        # categories in the group's listed order, applied on top of
        # whatever stage 1/2 already produced. This is what correctly
        # enforces (e.g.) H6+H7+H8's combined RM10,000 ceiling instead of
        # letting each category/pool consume its own inner cap independently
        # of everything else in the group.
        remaining_group = group_cap
        final_by_member = {}
        for member_cat in group["categories"]:
          take = min(stage1[member_cat], remaining_group)
          final_by_member[member_cat] = take
          remaining_group -= take

        group_raw_total = sum(raw_by_member.values())
        group_capped_total = sum(final_by_member.values())
        capped_total += group_capped_total

        # Per-member cap shown for display/review purposes: an individual
        # sub_cap if it has one, else its pool's cap if it belongs to one,
        # else the outer group_cap (the only ceiling that actually applies
        # to it) — never silently show the big outer cap for a category
        # that's actually bounded by a much smaller pool.
        pool_cap_by_member = {}
        for pool in sub_pools:
          pool_cap_display = _resolve_pool_cap(pool, target_year)
          for member_cat in pool["categories"]:
            pool_cap_by_member[member_cat] = pool_cap_display

        for member_cat in group["categories"]:
          member_bucket = by_category.get(member_cat)
          member_raw = raw_by_member[member_cat]
          member_capped = final_by_member[member_cat]
          member_cap = sub_caps.get(member_cat, pool_cap_by_member.get(member_cat, group_cap))
          member_was_capped = member_capped < member_raw
          breakdown.append({
            "category":      member_cat,
            "rawTotal":      money(member_raw),
            "cap":           member_cap,
            "cappedTotal":   money(member_capped),
            "wasCapped":     member_was_capped,
            "lapsedForYear": False,
            # Extra context (Phase — H6/H7/H8 split, 14 Jul 2026): which
            # shared group this category's cap ultimately comes from, so a
            # confused "why is my vaccination capped at RM1,000 but only
            # RM600 of RM10,000 group room was left" question is answerable
            # from the API response alone, not just the UI copy.
            "groupCategory": group_key,
            "groupCapMyr":   group_cap,
          })
          if member_bucket:
            for e in member_bucket["entries"]:
              annotated_entries.append({
                **e,
                "categoryCapMyr":    member_cap,
                "categoryWasCapped": member_was_capped,
              })
        continue

      is_lapsed_domestic_tourism = (
        cat == "Q4 — Domestic Tourism Relief" and target_year > DOMESTIC_TOURISM_LAST_ELIGIBLE_YA
      )
      is_lapsed_prs = (
        cat == "Q4 — Private Retirement Scheme (PRS)" and target_year > H18_PRS_LAST_ELIGIBLE_YA
      )
      # Finance Act 2025 (Act 874) s.3(2): the new Tourist Attraction &
      # Cultural Programme relief applies for YA2026 ONLY — an exact-year
      # match, not a "before/after" cutoff like the two lapse guards above,
      # since it never existed before YA2026 and isn't stated to continue
      # after it either.
      is_out_of_year_tourist_attraction = (
        cat == "Q4 — Tourist Attraction & Cultural Programme" and target_year != TOURIST_ATTRACTION_ELIGIBLE_YA
      )
      if is_lapsed_domestic_tourism or is_lapsed_prs or is_out_of_year_tourist_attraction:
        # Force to 0 regardless of any doc-extracted or fallback cap — this
        # relief doesn't exist for this year at all, not just a smaller cap.
        cap = Decimal("0")
      else:
        cap = bucket["cap"]
        if cap is None:
          fallback = RELIEF_CAPS_FALLBACK_MYR.get(cat)
          cap = Decimal(fallback) if fallback is not None else None
      capped_amount = min(bucket["rawTotal"], cap) if cap is not None else bucket["rawTotal"]
      was_capped = cap is not None and bucket["rawTotal"] > cap
      capped_total += capped_amount
      is_out_of_year = is_lapsed_domestic_tourism or is_lapsed_prs or is_out_of_year_tourist_attraction
      breakdown.append({
        "category":     cat,
        "rawTotal":     money(bucket["rawTotal"]),
        "cap":          cap,
        "cappedTotal":  money(capped_amount),
        "wasCapped":    was_capped,
        "lapsedForYear": is_out_of_year,
      })
      for e in bucket["entries"]:
        annotated_entries.append({**e, "categoryCapMyr": cap, "categoryWasCapped": was_capped, "categoryLapsedForYear": is_out_of_year})

    return money(capped_total), breakdown, annotated_entries

  def _build_year_summary(docs: list, target_year: int, form_b_record=None) -> dict:
    income_q1, income_q2, deductions_q3 = [], [], []
    reliefs_q4, non_deductible_q4 = [], []
    zakat_entries, mixed_pending, cp500_installments = [], [], []
    section110_entries, section107d_entries = [], []
    k_disclosures = []

    # Finance Act 2025 (Act 874) one-time reliefs (15 Jul 2026): computed
    # ONCE per category here, from the full multi-year OneTimeReliefClaim
    # history, rather than per-document — the "claim once within window"
    # test is inherently a category-level question (see one_time_relief.py),
    # not something a single document can answer about itself.
    _one_time_relief_claims = db.query(OneTimeReliefClaim).filter(OneTimeReliefClaim.user_id == user_id).all()
    _one_time_relief_results = {
      "Q4 — Food Waste Compost Machine": compute_one_time_relief_for_year(
        _one_time_relief_claims, "Q4 — Food Waste Compost Machine", target_year, FOOD_WASTE_COMPOST_WINDOW),
      "Q4 — Food Waste Grinder Machine": compute_one_time_relief_for_year(
        _one_time_relief_claims, "Q4 — Food Waste Grinder Machine", target_year, FOOD_WASTE_GRINDER_WINDOW),
      "Q4 — Home CCTV": compute_one_time_relief_for_year(
        _one_time_relief_claims, "Q4 — Home CCTV", target_year, HOME_CCTV_WINDOW),
    }

    # Donations (Part G) — one bucket per G-line, since they're subject to
    # DIFFERENT caps (Phase 5, 14 Jul 2026) — see the category list's
    # comment in pipeline.py and the tiered-cap computation below.
    donation_entries_by_gline = {g: [] for g in ("g1", "g2a", "g2b", "g2c", "g2d", "g3", "g4", "g5", "g6", "g7")}
    DONATION_CATEGORY_TO_GLINE = {
      "Q4 — Donation: Government/Local Authority": "g1",
      "Q4 — Donation: Approved Institution":       "g2a",
      "Q4 — Donation: Approved Sports Activity":   "g2b",
      "Q4 — Donation: National Interest Project":  "g2c",
      "Q4 — Donation: Wakaf/Endowment":            "g2d",
      "Q4 — Donation: Artefacts to Government":    "g3",
      "Q4 — Donation: Library Facilities":         "g4",
      "Q4 — Donation: Disabled Facilities":        "g5",
      "Q4 — Donation: Medical Equipment":          "g6",
      "Q4 — Donation: Paintings to Art Gallery":   "g7",
    }
    reference_documents = []
    bank_statement_reviews = []
    total_confidence = 0

    for doc in docs:
      ed         = doc.extracted_data or {}
      quadrant   = ed.get("quadrant", "")
      tax_status = doc.tax_status or ""
      amount     = ed.get("amount")
      confidence = ed.get("confidence", 0) or 0
      total_confidence += confidence

      # Second & third classification dimensions. Fall back to deriving them
      # for documents processed before these fields existed, so existing rows
      # behave correctly without requiring a full reclassification pass.
      document_role     = ed.get("document_role")     or derive_document_role(doc.category or "")
      aggregation_state = ed.get("aggregation_state")  or derive_aggregation_state(doc.category or "", tax_status)
      is_pending_review = aggregation_state in ("needs_apportionment", "needs_user_confirmation")

      entry = {
        "documentId":        doc.id,
        "entityId":          doc.entity_id,
        "fileName":          doc.file_name,
        "documentType":      doc.document_type,
        "category":          doc.category,
        "amount":            amount,
        "amountNumeric":     _parse_amount(amount),
        "currency":          ed.get("currency", "MYR"),
        "vendor":            ed.get("vendor"),
        "date":              ed.get("date"),
        "itaSection":        ed.get("ita_section"),
        "confidence":        confidence,
        "ocrQuality":        ed.get("ocr_quality"),
        "note":              ed.get("note"),
        "documentRole":      document_role,
        "aggregationState":  aggregation_state,
        "needsReview":       is_pending_review,
      }

      # Display-only list of CP500 documents for this year — kept for the UI
      # (e.g. the document list in CukaiAccount.jsx), but this is NOT where
      # B33's actual figure comes from any more (see total_cp500 below,
      # computed from the full multi-year CP500Record registry via
      # cp500.py). A document appearing here with recordType "notice" must
      # never be mistaken for a paid amount — that distinction is exactly
      # the bug this split fixes.
      if doc.category == "Q3 — CP500 Instalment Notice" and ed.get("total_scheduled_amount") is not None:
        cp500_installments.append({
          **entry,
          "recordType":     "notice",
          "amount":         ed.get("total_scheduled_amount"),
          "amountNumeric":  _parse_amount(ed.get("total_scheduled_amount")),
        })
      elif doc.category == "Q3 — CP500 Payment Receipt" and ed.get("amount") is not None:
        cp500_installments.append({
          **entry,
          "recordType":     "payment",
          "amount":         ed.get("amount"),
          "amountNumeric":  _parse_amount(ed.get("amount")),
          "referenceNo":    ed.get("reference_no"),
        })

      # Bank statements carry per-line matches, not one pending amount — give
      # them their own review bucket instead of a confusing RM0 entry in the
      # generic mixed-pending list.
      if document_role == "ledger_source":
        line_items = ed.get("line_items", [])
        bank_statement_reviews.append({
          **entry,
          "summary": ed.get("bank_statement_summary"),
          "unmatchedLines": [
            li for li in line_items
            if li.get("matchStatus") in ("unmatched_credit", "unmatched_debit", "unmatched")
          ],
        })
        continue

      # Summary statements (P&L, balance sheet, prior Form B) are derived
      # aggregates, not independent transactions — including their amount in
      # totals double-counts income/expenses already captured by the
      # individual documents that make them up. Route them to a reference
      # bucket for reconciliation display instead of the totals.
      #
      # Capital gains (s.4(aa)) documents share this same bucket for a
      # DIFFERENT reason (bug fix, 14 Jul 2026) — not because they're a
      # derived aggregate, but because they're a genuinely separate class of
      # income that must never be summed into ordinary B1 business income.
      # Attach the specific disposal/acquisition/gain-loss fields so the
      # figures needed for that SEPARATE s.4(aa) filing are still visible to
      # the user, not just a generic reference entry with no real detail.
      if doc.category == "Q1 — Capital Gains (s.4aa)":
        reference_documents.append({
          **entry, "quadrant": quadrant,
          "cgtDisposalConsideration": ed.get("cgt_disposal_consideration"),
          "cgtAcquisitionCost":       ed.get("cgt_acquisition_cost"),
          "cgtGainLoss":              ed.get("cgt_gain_loss"),
        })
      elif doc.category == "Q1 — Voluntary Disclosure (Prior Year Income)":
        # Part K (16 Jul 2026 fix): captured separately from the generic
        # reference_documents bucket below, since K needs its own
        # income_type/disclosed_ya fields for the printed K1/K2 table —
        # never summed into THIS year's B1/aggregate income (that's what
        # document_role="summary_statement" already guarantees).
        k_disclosures.append({
          **entry,
          "incomeType":   ed.get("income_type"),
          "disclosedYa":  ed.get("disclosed_ya"),
        })
      elif document_role == "summary_statement":
        reference_documents.append({**entry, "quadrant": quadrant, "lineItems": ed.get("line_items", [])})
      elif quadrant == "Q1":
        if aggregation_state == "resolved":
          income_q1.append(entry)
      elif quadrant == "Q2":
        if aggregation_state == "resolved":
          income_q2.append({**entry, "formEa": ed.get("form_ea"), "fsiSourceCountry": ed.get("fsi_source_country")})
      elif quadrant == "Q3":
        if tax_status == "capital":
          # Handled via the CapitalAsset registry below, not per-document —
          # an asset bought in a prior year still generates Annual Allowance
          # this year even with no document in THIS year's query.
          pass
        elif aggregation_state == "resolved":
          # Apportioned categories (entertainment/gifts/vehicle/HP) are only
          # partially deductible: sum deductible_pct% of the amount, never the
          # full value. Non-apportioned expenses deduct in full.
          _ded_pct = ed.get("deductible_pct")
          if _ded_pct is not None:
            _deductible = money(_parse_amount(amount) * Decimal(_ded_pct) / Decimal(100))
          else:
            _deductible = _parse_amount(amount)
          deductions_q3.append({**entry, "deductibleNumeric": _deductible, "deductiblePct": _ded_pct})
      elif quadrant == "Q4":
        if tax_status == "donation":
          # Approved donations (Part G / B17) are deducted from aggregate
          # income before chargeable income is derived — NOT a capped
          # personal relief, so they never enter reliefs_q4 / _cap_reliefs.
          # Their caps (10%-of-B11 pool for some G-lines, individual
          # RM20,000 for others, uncapped for others) can only be applied
          # once total income for the year is known (see the tiered-cap
          # block below), not per-document.
          gline = DONATION_CATEGORY_TO_GLINE.get(doc.category)
          if gline and aggregation_state == "resolved":
            donation_entries_by_gline[gline].append({**entry, "reliefCapMyr": ed.get("relief_cap_myr")})
        elif tax_status == "relief":
          relief_entry = {**entry, "reliefCapMyr": ed.get("relief_cap_myr"), "zakatAmount": ed.get("zakat_amount")}
          # Zakat is a REBATE against tax payable (s.6A ITA), not a relief that
          # reduces chargeable income — keep it out of the capped-relief pool.
          if doc.category == "Q4 — Zakat":
            if aggregation_state == "resolved":
              zakat_entries.append(relief_entry)
          elif doc.category == "Q4 — Section 110 Withholding (Others)":
            if aggregation_state == "resolved":
              section110_entries.append(relief_entry)
          elif doc.category == "Q4 — Section 107D Withholding":
            if aggregation_state == "resolved":
              section107d_entries.append(relief_entry)
          elif doc.category == "Q4 — SSPN Net Deposit":
            # H13 only allows the NET amount deposited this basis year
            # (deposits minus withdrawals) — never the gross deposit figure
            # alone, and never a brought-forward balance. Recompute the
            # entry's amount from the two extracted fields rather than
            # trusting `amount`, since the LLM may have extracted a gross
            # deposit figure into `amount` even when a withdrawal also
            # appears on the same statement.
            sspn_deposit    = _parse_amount(ed.get("sspn_deposit_myr"))
            sspn_withdrawal = _parse_amount(ed.get("sspn_withdrawal_myr"))
            sspn_net        = max(Decimal("0"), sspn_deposit - sspn_withdrawal)
            if aggregation_state == "resolved":
              reliefs_q4.append({
                **relief_entry,
                "amountNumeric": sspn_net,
                "sspnDepositMyr": money(sspn_deposit),
                "sspnWithdrawalMyr": money(sspn_withdrawal),
              })
          elif doc.category == "Q4 — Breastfeeding Equipment":
            # Handled via the BreastfeedingEquipmentClaim registry below, not
            # per-document — H11's "once every 2 years of assessment" rule
            # needs claim history across YEARS (see breastfeeding_relief.py),
            # which a plain per-document sum can't express. Same pattern as
            # J1 used to be (now removed) and capital assets still are.
            # Explicit no-op, not an oversight.
            pass
          elif doc.category == "Q4 — Departure Levy (Umrah/Religious Travel)":
            # Handled via the OneTimeReliefClaim registry below, not
            # per-document — the 2-trips-IN-A-LIFETIME cap needs the full
            # claim history across every year ever filed (see
            # compute_departure_levy_rebate_for_year in one_time_relief.py).
            # Explicit no-op, not an oversight.
            pass
          elif doc.category == "Q4 — Medical Equipment Relief":
            # Bug fix (15 Jul 2026): H3 previously had no special handling at
            # all — it fell straight into the generic branch below with no
            # review flag, despite LHDN's own rule being an absolute
            # disqualifier ("NOT allowed if the disabled individual... is not
            # registered with DSW") that no purchase receipt can prove either
            # way. Every other multi-fact relief in this codebase (H11's
            # mother/child-age facts, the gender-direction checks on H14/B21)
            # gets an explicit review flag rather than silent trust — H3 is
            # the one relief that had fallen through that pattern. It's
            # included in the total either way (excluding it outright would
            # be just as wrong as including it silently, since most claims
            # ARE genuine), but always flagged so the fact gets confirmed
            # before filing, same philosophy as H11.
            dsw = (ed.get("dsw_registered") or "unclear").lower()
            dsw_note = {
              "yes":     "The document indicates DSW registration — confirm this matches your actual DSW/JKM registration before filing.",
              "no":      "The document indicates the disabled person is NOT registered with DSW — this relief is not allowed unless DSW registration is confirmed. Excluded pending correction.",
              "unclear": "This relief requires the disabled person (self/spouse/child/parent) to be registered with the Department of Social Welfare (DSW) — a purchase receipt alone can't confirm this. Confirm registration before filing.",
            }.get(dsw, "Confirm DSW registration for the disabled person before filing.")
            if dsw == "no":
              # An explicit "not registered" is a hard disqualifier per LHDN's
              # own wording — unlike the ambiguous "unclear" case, this isn't
              # a fact to confirm, it's already known to fail the test.
              non_deductible_q4.append({**entry, "reason": dsw_note})
              mixed_pending.append({
                **entry, "amount": str(entry["amountNumeric"]), "needsReview": True, "reason": dsw_note,
                "question": "This claim is currently excluded — confirm DSW registration to include it.",
              })
            elif aggregation_state == "resolved":
              reliefs_q4.append({**relief_entry, "needsReview": True, "reason": dsw_note})
              mixed_pending.append({
                **entry, "amount": str(entry["amountNumeric"]), "needsReview": True, "reason": dsw_note,
                "question": "Confirm DSW/JKM registration for the disabled person before filing.",
              })
          elif doc.category == "Q4 — Childcare Fees":
            # Bug fix (15 Jul 2026): the classification prompt already routes
            # an EXPLICITLY unregistered provider to the non-deductible
            # category, but left the ordinary "receipt just doesn't say
            # either way" case silently trusted as a valid H12 claim. Flag
            # that ambiguity instead of guessing.
            #
            # Also: Finance Act 2025 (Act 874) s.6(a)(iv), effective YA2026
            # onward, adds a second age band (7-12, Care Centres Act 1993
            # registration) sharing the SAME RM3,000 pool as the existing
            # ≤6 band — before this fix, that band didn't exist in the code
            # at all.
            reg = (ed.get("provider_registration_status") or "unclear").lower()
            age_band = (ed.get("child_age_band") or "unclear").lower()

            if age_band == "over 12":
              non_deductible_q4.append({**entry, "reason": "Child is over 12 — H12 does not apply at any age above 12, even from YA2026."})
            elif age_band == "7 to 12" and target_year < H12_CARE_CENTRE_BAND_YA:
              non_deductible_q4.append({
                **entry,
                "reason": f"The 7-12 age band for H12 only applies from YA{H12_CARE_CENTRE_BAND_YA} onward (Finance Act 2025) — not eligible for this filing year.",
              })
            elif aggregation_state == "resolved":
              entry_out = {**relief_entry}
              if reg == "unclear":
                reason = (
                  "Could not confirm from this receipt whether the provider is registered "
                  "(DSW/MOE for a child 6 or under, or under the Care Centres Act 1993 for a "
                  "child aged 7-12 from YA2026 onward), which H12 requires — confirm before filing."
                )
                entry_out["needsReview"] = True
                entry_out["reason"] = reason
                mixed_pending.append({
                  **entry, "amount": str(entry["amountNumeric"]), "needsReview": True, "reason": reason,
                  "question": "Confirm this childcare provider is registered.",
                })
              reliefs_q4.append(entry_out)
          elif doc.category == "Q4 — Vaccination":
            # Bug fix (15 Jul 2026): Finance Act 2025 (Act 874) s.6(a)(i)-(ii)
            # expands this relief to ANY NPRA-registered vaccine from YA2026
            # onward — before that, only the historical fixed list qualifies.
            # Previously this category had no year-awareness at all.
            vaccine_name = (ed.get("vaccine_name") or "").lower()
            npra = (ed.get("npra_registered") or "unclear").lower()
            if target_year >= H6_VACCINATION_NPRA_EXPANSION_YA:
              # Any vaccine qualifies YA2026 onward, unless the document
              # explicitly says it's NOT NPRA-registered — a known-ineligible
              # fact, not just an unconfirmed one.
              if npra == "no":
                non_deductible_q4.append({
                  **entry,
                  "reason": "This vaccine is explicitly stated as not NPRA-registered — not eligible even under the expanded YA2026+ rule.",
                })
              elif aggregation_state == "resolved":
                entry_out = {**relief_entry}
                if npra == "unclear":
                  reason = (
                    "Could not confirm NPRA registration for this vaccine from the receipt — any "
                    "NPRA-registered vaccine qualifies from YA2026 onward, but confirm before filing."
                  )
                  entry_out["needsReview"] = True
                  entry_out["reason"] = reason
                  mixed_pending.append({
                    **entry, "amount": str(entry["amountNumeric"]), "needsReview": True, "reason": reason,
                    "question": "Confirm this vaccine is NPRA-registered.",
                  })
                reliefs_q4.append(entry_out)
            else:
              # Before YA2026: only the historical fixed list qualifies. A
              # missing vaccine_name isn't treated as a failure — that would
              # be punishing an extraction gap, not enforcing the actual
              # rule — so it passes through as the ordinary case, same as
              # before this fix existed (no regression for existing data).
              matches_old_list = any(v in vaccine_name for v in H6_VACCINATION_PRE_2026_FIXED_LIST)
              if not vaccine_name or matches_old_list:
                if aggregation_state == "resolved":
                  reliefs_q4.append(relief_entry)
              else:
                reason = (
                  f"'{ed.get('vaccine_name')}' is not on the pre-YA2026 eligible vaccination list "
                  "(pneumococcal, HPV, influenza, rotavirus, varicella, meningococcal, Tdap, COVID-19) "
                  "— the expansion to any NPRA-registered vaccine only applies from YA2026 onward."
                )
                non_deductible_q4.append({**entry, "reason": reason})
                mixed_pending.append({
                  **entry, "amount": str(entry["amountNumeric"]), "needsReview": True, "reason": reason,
                  "question": "This vaccine isn't on the eligible list for this filing year — confirm or reclassify.",
                })
          elif doc.category == "Q4 — Life Insurance & Takaful Relief":
            # Bug fix (15 Jul 2026): a policy on the taxpayer's CHILD's life
            # was never actually excluded pre-2026 despite ITA 1967 saying so
            # explicitly — this closes that pre-existing gap AND applies
            # Finance Act 2025 (Act 874) s.7's YA2026 extension permitting it
            # from that year onward.
            life_insured = (ed.get("policy_life_insured") or "unclear").lower()
            if life_insured == "child" and target_year < H17_CHILD_LIFE_INSURANCE_YA:
              non_deductible_q4.append({
                **entry,
                "reason": f"A life insurance policy on a child's life only qualifies for H17 from YA{H17_CHILD_LIFE_INSURANCE_YA} onward (Finance Act 2025) — not eligible for this filing year.",
              })
            elif aggregation_state == "resolved":
              reliefs_q4.append(relief_entry)
          elif doc.category in _one_time_relief_results:
            # Finance Act 2025 (Act 874) one-time reliefs (15 Jul 2026):
            # eligibility was already decided once per category, above, from
            # the FULL multi-year claim history — this branch just routes
            # each document according to that pre-computed result rather
            # than deciding anything itself.
            #
            # Bug fix, found in final pre-production review: these three
            # categories have NO entry in RELIEF_CAPS_FALLBACK_MYR, because
            # their only confirmed cap is the RM2,500 pool shared with EV
            # charging — which only exists for YA2026-2027. Food waste
            # compost machine's own eligible window starts a year earlier,
            # YA2025, when it existed on its own with no pool and (from the
            # sources available) no confirmed standalone cap either. Without
            # this guard, such a claim would reach _cap_reliefs' simple
            # per-category path, find no cap anywhere (cap stays None), and
            # pass through completely UNCAPPED — a real leak, not a
            # hypothetical one.
            otr_result = _one_time_relief_results[doc.category]
            is_standalone_unconfirmed_year = (
              otr_result["isEligibleYear"]
              and not (EV_HOME_IMPROVEMENT_POOL_FIRST_YA <= target_year <= EV_HOME_IMPROVEMENT_POOL_LAST_YA)
            )
            if is_standalone_unconfirmed_year:
              reason = (
                f"YA{target_year} is within this relief's own eligible window, but the shared RM2,500 "
                f"pool with EV charging only applies from YA{EV_HOME_IMPROVEMENT_POOL_FIRST_YA} onward — "
                "no confirmed standalone cap is available for this year from current sources. Excluded "
                "pending confirmation rather than applied uncapped."
              )
              non_deductible_q4.append({**entry, "reason": reason})
              mixed_pending.append({
                **entry, "amount": str(entry["amountNumeric"]), "needsReview": True, "reason": reason,
                "question": "Confirm the correct cap for this relief in this filing year before including it.",
              })
            elif otr_result["isEligibleYear"] and aggregation_state == "resolved":
              reliefs_q4.append(relief_entry)
            else:
              non_deductible_q4.append({**entry, "reason": otr_result["note"] or "Not eligible for this filing year."})
              if otr_result["needsReview"]:
                mixed_pending.append({
                  **entry, "amount": str(entry["amountNumeric"]), "needsReview": True,
                  "reason": otr_result["note"],
                  "question": "Confirm this one-time relief's eligible year before relying on this claim.",
                })
          elif aggregation_state == "resolved":
            reliefs_q4.append(relief_entry)
        else:
          non_deductible_q4.append(entry)

      if is_pending_review:
        mixed_pending.append({**entry, "reason": ed.get("reason"), "question": ed.get("question"), "source": ed.get("source")})

    # ── Capital allowance (Schedule 3 ITA 1967) ─────────────────────────
    # Pulled from the persisted CapitalAsset registry, NOT from documents in
    # this year's query — an asset bought in YA2023 must still generate
    # Annual Allowance in YA2025 even though no document was uploaded this
    # year. See capital_allowance.py for the year-by-year schedule logic
    # (straight-line IA/AA, written-down value, balancing allowance/charge).
    assets_q = db.query(CapitalAsset).filter(
      CapitalAsset.acquisition_year <= target_year,
    ).filter(
      (CapitalAsset.disposal_year.is_(None)) | (CapitalAsset.disposal_year >= target_year)
    ).filter(CapitalAsset.user_id == user_id)
    # entity_id is closed over from the endpoint; scope capital assets to the
    # active entity so one sole-prop's assets don't inflate another's allowance.
    if entity_id is not None:
      assets_q = assets_q.filter(CapitalAsset.entity_id == entity_id)

    capital_assets_annotated = []
    total_capital_allowance = Decimal("0")
    for asset in assets_q.all():
      schedule = compute_capital_allowance_for_year(asset, target_year)
      total_capital_allowance += (
        schedule["totalAllowanceThisYearMyr"]
        + schedule["balancingAllowanceMyr"]
        - schedule["balancingChargeMyr"]
      )
      if schedule["balancingChargeMyr"]:
        mixed_pending.append({
          "documentId":       asset.source_document_id,
          "fileName":         schedule["description"],
          "documentType":     "Capital Asset — Disposal",
          "category":         "Q3 — Capital Assets & Equipment",
          "amount":           str(schedule["balancingChargeMyr"]),
          "amountNumeric":    schedule["balancingChargeMyr"],
          "needsReview":      True,
          "reason":           schedule["note"],
          "question":         "Confirm the disposal proceeds and whether this was a related-party transfer before filing.",
        })
      capital_assets_annotated.append({**schedule, "entityId": asset.entity_id})
    total_capital_allowance = money(total_capital_allowance)

    # ── Financial statements (P&L / Balance Sheet) — Phase 6, 14 Jul 2026 ──
    # Pulled from the persisted FinancialStatementProfile registry, keyed by
    # (user_id, entity_id, target_year) — unlike capital assets/H11 above,
    # THIS year's row only ever comes from THIS year's own uploaded P&L/BS
    # documents (no multi-year carry-forward logic applies to a balance
    # sheet snapshot). Exposed as a per-entity list (entityId-tagged, same
    # convention as capital_assets_annotated) rather than pre-merged to one
    # entity here, because Part N is "main business only" and which entity
    # counts as "main" (highest turnover) is decided client-side in
    # formB.js — see its filterToMainEntity/mainEntity logic. Raw fields
    # only; the derived N-line sums (N32/N40/N41/N45/N50) are assembled in
    # formB.js alongside the rest of Part N, not duplicated here.
    fsp_q = db.query(FinancialStatementProfile).filter(
      FinancialStatementProfile.user_id == user_id,
      FinancialStatementProfile.year_of_assessment == target_year,
    )
    if entity_id is not None:
      fsp_q = fsp_q.filter(FinancialStatementProfile.entity_id == entity_id)

    financial_statements_annotated = []
    for fsp in fsp_q.all():
      financial_statements_annotated.append({
        "entityId": fsp.entity_id,
        "pl": {
          "sourceDocumentId":        fsp.pl_source_document_id,
          "openingInventoryMyr":     _num_or_none(fsp.pl_opening_inventory),
          "closingInventoryMyr":     _num_or_none(fsp.pl_closing_inventory),
          "otherBusinessIncomeMyr":  _num_or_none(fsp.pl_other_business_income),
          "dividendsMyr":            _num_or_none(fsp.pl_dividends),
          "rentsRoyaltiesPremiumsMyr": _num_or_none(fsp.pl_rents_royalties_premiums),
          "contractSubcontractsMyr": _num_or_none(fsp.pl_contract_subcontracts),
          "badDebtsMyr":             _num_or_none(fsp.pl_bad_debts),
          "statedRevenueMyr":        _num_or_none(fsp.pl_stated_revenue),
          "statedNetProfitMyr":      _num_or_none(fsp.pl_stated_net_profit),
          "confidence":              fsp.pl_confidence,
        },
        "bs": {
          "sourceDocumentId":       fsp.bs_source_document_id,
          "landBuildingsMyr":       _num_or_none(fsp.bs_land_buildings),
          "plantMachineryMyr":      _num_or_none(fsp.bs_plant_machinery),
          "motorVehiclesMyr":       _num_or_none(fsp.bs_motor_vehicles),
          "otherNonCurrentAssetsMyr": _num_or_none(fsp.bs_other_non_current_assets),
          "investmentsMyr":         _num_or_none(fsp.bs_investments),
          "inventoryMyr":           _num_or_none(fsp.bs_inventory),
          "tradeDebtorsMyr":        _num_or_none(fsp.bs_trade_debtors),
          "sundryDebtorsMyr":       _num_or_none(fsp.bs_sundry_debtors),
          "cashInHandMyr":          _num_or_none(fsp.bs_cash_in_hand),
          "cashAtBankMyr":          _num_or_none(fsp.bs_cash_at_bank),
          "otherCurrentAssetsMyr":  _num_or_none(fsp.bs_other_current_assets),
          "loansOverdraftsMyr":     _num_or_none(fsp.bs_loans_overdrafts),
          "tradeCreditorsMyr":      _num_or_none(fsp.bs_trade_creditors),
          "sundryCreditorsMyr":     _num_or_none(fsp.bs_sundry_creditors),
          "capitalAccountMyr":      _num_or_none(fsp.bs_capital_account),
          "currentAccountBfMyr":    _num_or_none(fsp.bs_current_account_bf),
          "drawingsAdvanceNetMyr":  _num_or_none(fsp.bs_drawings_advance_net),
          "confidence":             fsp.bs_confidence,
        },
      })

    # ── H11 breastfeeding equipment relief (added 14 Jul 2026) ─────────────
    # Pulled from the persisted BreastfeedingEquipmentClaim registry, NOT
    # from documents in this year's query — mirrors the capital-allowance
    # pattern above, because the "once every 2 years of assessment" rule
    # needs claim history across years, not just this year's documents. See
    # breastfeeding_relief.py. (This registry replaced the Part J
    # IncentiveClaim registry, which was removed by product decision on this
    # date — Part J is now permanently out of scope; see form-b-roadmap.md.)
    breastfeeding_claims_q = db.query(BreastfeedingEquipmentClaim).filter(BreastfeedingEquipmentClaim.user_id == user_id)
    if entity_id is not None:
      breastfeeding_claims_q = breastfeeding_claims_q.filter(BreastfeedingEquipmentClaim.entity_id == entity_id)
    all_breastfeeding_claims = breastfeeding_claims_q.all()

    h11_relief = compute_breastfeeding_relief_for_year(all_breastfeeding_claims, target_year)
    total_h11_relief = h11_relief["amountClaimedMyr"]
    if h11_relief["isClaimYear"] and h11_relief["needsReview"]:
      # Surface eligibility caveats (mother/child-age facts, or the 2-year
      # gate blocking this year's claim) in the same review queue as every
      # other flagged item, rather than only in the relief breakdown note.
      mixed_pending.append({
        "documentId":    None,
        "fileName":      h11_relief["label"],
        "documentType":  "Breastfeeding Equipment Relief (H11)",
        "category":      "Q4 — Breastfeeding Equipment",
        "amount":        str(h11_relief["amountPurchasedMyr"]),
        "amountNumeric": h11_relief["amountPurchasedMyr"],
        "needsReview":   True,
        "reason":        h11_relief["note"],
        "question":      "Confirm the breastfeeding-mother / child-age-2-or-under eligibility facts before filing.",
      })

    doc_count = len(docs)
    avg_conf  = round(total_confidence / doc_count) if doc_count else 0

    total_q1    = sum(d["amountNumeric"] for d in income_q1)
    total_q2    = sum(d["amountNumeric"] for d in income_q2)
    total_q3    = sum(d["deductibleNumeric"] for d in deductions_q3)
    # Bug fix (15 Jul 2026): total_cp500 used to be summed straight from
    # cp500_installments — every CP500-classified document in THIS year's
    # docs, regardless of whether it was an unpaid instalment NOTICE or an
    # actual PAYMENT receipt. That silently counted scheduled-but-unpaid
    # amounts as if paid, corrupting B33 and (via B31/B32) the tax
    # payable/refund figure. compute_cp500_for_year() re-derives the
    # correct figure from the FULL CP500Record registry (every notice and
    # payment on file across all years, not just this year's documents),
    # counting ONLY payments, and correctly attributing each payment to
    # the YA its instalment scheme was actually for — see cp500.py.
    cp500_records = db.query(CP500Record).filter(CP500Record.user_id == user_id).all()
    cp500_result  = compute_cp500_for_year(cp500_records, target_year)
    total_cp500   = cp500_result["totalPaidMyr"]

    # B33ii — Section 107D withholding: economically the same role as MTD
    # or CP500 — a payment already made on the proprietor's behalf, reducing
    # the final BALANCE of tax payable, not tax payable itself (unlike B29
    # above). Previously unmodeled entirely (16 Jul 2026 fix). Same-year
    # sum, no multi-year registry needed — unlike CP500, there's no
    # notice-vs-payment distinction here, every document IS a completed
    # withholding.
    total_section107d = money(sum(e["amountNumeric"] for e in section107d_entries))

    # B27iii — departure levy (16 Jul 2026 fix): queries the FULL lifetime
    # history (no year filter), since the 2-trips cap has no window to
    # bound it — see compute_departure_levy_rebate_for_year's own docstring
    # for why this is always flagged for review regardless of outcome.
    departure_levy_claims = db.query(OneTimeReliefClaim).filter(
      OneTimeReliefClaim.user_id == user_id,
      OneTimeReliefClaim.category == "Q4 — Departure Levy (Umrah/Religious Travel)",
    ).all()
    departure_levy_result = compute_departure_levy_rebate_for_year(departure_levy_claims, target_year)
    departure_levy_rebate = departure_levy_result["amountMyr"]
    if departure_levy_result["tripsClaimedThisYear"] > 0 or departure_levy_result["tripsBlockedThisYear"] > 0:
      mixed_pending.append({
        "documentId":    None,
        "fileName":      "Departure Levy Rebate (B27iii)",
        "documentType":  "Departure Levy Lifetime-Cap Reconciliation",
        "category":      "Q4 — Departure Levy (Umrah/Religious Travel)",
        "amount":        str(departure_levy_rebate),
        "amountNumeric": departure_levy_rebate,
        "needsReview":   True,
        "reason":        departure_levy_result["note"],
        "question":      "Confirm this is genuinely within your 2-trips-in-a-lifetime allowance before filing.",
      })

    # Bug fix (16 Jul 2026, production-readiness audit): balancePayableMyr
    # never included MTD (Monthly Tax Deductions withheld by an employer)
    # at all — only CP500 and (as of this session) Section 107D. This
    # wasn't a hypothetical gap: the frontend computes its OWN correct
    # mtdWithheld from Form EA data and includes it in B33/B34 when this
    # backend value is UNAVAILABLE, but PREFERS this backend value whenever
    # it exists (`totals.balancePayableMyr ?? (b31 - b33)` in formB.js) — so
    # for any real user with employment income, the wrong (overstated)
    # figure is what actually displayed, not the frontend's own correct
    # fallback. Computed here from the same Form EA data already attached
    # to income_q2 entries, so it can never drift from what formB.js itself
    # would compute if left to derive it independently.
    total_mtd = money(sum(
      _parse_amount((e.get("formEa") or {}).get("pcb_deducted"))
      for e in income_q2
      if e.get("category") == "Q2 — Employment Income (s.4b)"
    ))

    if cp500_result["needsReview"]:
      mixed_pending.append({
        "documentId":    None,
        "fileName":      "CP500 Self-Instalments (B33iii)",
        "documentType":  "CP500 Instalment Reconciliation",
        "category":      "Q3 — CP500 Payment Receipt",
        "amount":        str(cp500_result["totalPaidMyr"]),
        "amountNumeric": cp500_result["totalPaidMyr"],
        "needsReview":   True,
        "reason":        cp500_result["note"],
        "question":      "Confirm the CP500 notice/payment figures above before relying on B33.",
      })

    # ── Business-loss (B5/B14/M1) and capital-allowance (M2) carry-forward ──
    # Phase 3 (14 Jul 2026): a business's statutory income can never be
    # negative — previously, if Q3 deductions + capital allowance exceeded
    # Q1 income, the excess was silently absorbed into est_chargeable
    # anyway (capital allowance that couldn't actually be used this year was
    # incorrectly allowed to offset OTHER income like employment, and no
    # current-year loss or unabsorbed-CA balance was ever tracked). This
    # block runs the full multi-year carryforward engine (carryforward.py)
    # per entity in scope, then sums the results — mirroring how capital
    # allowance / H11 already work per-entity-then-summed. Computed early
    # (right after the raw Q1/Q2/Q3 totals) since total_inc below — and
    # therefore the donations cap, which is 10% of it — now depends on the
    # NET, loss-aware business income rather than raw gross Q1 revenue.
    if entity_id is not None:
      _scope_entity = db.query(models.Entity).filter(models.Entity.id == entity_id).first()
      entities_in_scope = [_scope_entity] if _scope_entity else []
    else:
      try:
        entities_in_scope = db.query(models.Entity).filter(models.Entity.person_id == int(user_id)).all()
      except (TypeError, ValueError):
        entities_in_scope = []

    b1_total = Decimal("0")
    ca_absorbed_total = Decimal("0")
    current_year_loss_total = Decimal("0")
    b5_brought_forward_total = Decimal("0")
    b5_absorbed_total = Decimal("0")
    b5_carried_forward_total = Decimal("0")
    m2_unabsorbed_total = Decimal("0")
    per_entity_carryforward = []
    vintages_by_year = {}  # yearArose -> merged {originalMyr, absorbedMyr, remainingMyr, expiresAfterYa}
    for ent in entities_in_scope:
      sched = _entity_carryforward_schedule(db, user_id, ent, target_year, cache=_carryforward_cache)
      b1_total                  += sched["b1Myr"]
      ca_absorbed_total          += sched["capitalAllowanceAbsorbedThisYearMyr"]
      current_year_loss_total    += sched["b14CurrentYearLossMyr"]
      b5_brought_forward_total  += sched["b5BroughtForwardMyr"]
      b5_absorbed_total          += sched["b5AbsorbedMyr"]
      b5_carried_forward_total  += sched["b5CarriedForwardMyr"]
      m2_unabsorbed_total        += sched["m2UnabsorbedCapitalAllowanceMyr"]
      per_entity_carryforward.append({"entityId": ent.id, "entityName": ent.name, **sched})
      for v in sched["lossVintagesRemaining"]:
        yr = v["yearArose"]
        merged = vintages_by_year.setdefault(yr, {
          "yearArose": yr, "originalMyr": Decimal("0"), "absorbedMyr": Decimal("0"),
          "remainingMyr": Decimal("0"), "expiresAfterYa": v["expiresAfterYa"],
        })
        merged["originalMyr"]  += v["originalMyr"]
        merged["absorbedMyr"]  += v["absorbedMyr"]
        merged["remainingMyr"] += v["remainingMyr"]
    b1_total = money(b1_total)
    ca_absorbed_total = money(ca_absorbed_total)
    current_year_loss_total = money(current_year_loss_total)
    b5_brought_forward_total = money(b5_brought_forward_total)
    b5_absorbed_total = money(b5_absorbed_total)
    b5_carried_forward_total = money(b5_carried_forward_total)
    m2_unabsorbed_total = money(m2_unabsorbed_total)

    # B6-equivalent: this year's own business income, after brought-forward
    # losses (B5) are absorbed against it, restricted so B5 never exceeds B4
    # (already guaranteed by the engine, since a vintage can't absorb more
    # than remaining_income_for_bf_losses) — never negative.
    business_income_after_bf_losses = money(max(Decimal("0"), b1_total - b5_absorbed_total))

    # total_inc now correctly reflects NET business income (after Q3
    # deductions, capital allowance, brought-forward losses, all floored at
    # 0) plus other personal income — previously this was GROSS Q1 revenue
    # plus Q2, which both overstated the donations cap (10% of this figure)
    # and let a business loss/excess-CA silently offset other income
    # without ever being tracked as B14/M2.
    total_inc = money(business_income_after_bf_losses + total_q2)

    # Real utilised business-side deduction for THIS year (Q3 + only the
    # CAPITAL ALLOWANCE ACTUALLY ABSORBED, not the full statutory amount —
    # the unabsorbed portion is in M2, never subtracted here). Kept as
    # `total_deductions` for the tax-savings estimate and Part-N display,
    # even though est_chargeable below no longer subtracts it directly
    # (it's already embedded in business_income_after_bf_losses).
    total_deductions = money(total_q3 + ca_absorbed_total)

    # ── H4 / H14 / H15 / H16 — profile-derived reliefs ──────────────────
    # Computed HERE (inside _build_year_summary, using ITS OWN target_year)
    # rather than once per request, because H16 is genuinely age-dependent —
    # a child ages through the H16a→H16b tiers year over year, so the SAME
    # amount can't be reused across this endpoint's current/prior/trend-year
    # calls. H4/H15 are static per person but harmless to recompute per call.
    h4_disabled_individual = Decimal("6000") if (person and person.is_disabled_self) else Decimal("0")
    is_married = bool(person and person.marital_status == "married")
    is_divorced = bool(person and person.marital_status == "divorced-widowed")

    # Bug fix (15 Jul 2026): H6(ii) fertility treatment is restricted by
    # LHDN's own wording to "self or spouse" AND requires the taxpayer to be
    # married — the classification prompt already tells the LLM about the
    # marriage requirement, but nothing downstream ever cross-checked it
    # against the profile's actual marital status. is_married isn't known
    # yet at the point the per-document loop runs (it depends on `person`,
    # resolved later in this function), so this is a post-processing pass
    # over reliefs_q4 rather than a branch inside that loop, done here as
    # soon as is_married becomes available and before _cap_reliefs sums
    # anything. An unmarried filer's fertility-treatment claim is excluded
    # entirely (not just flagged) — unlike H3/H12's "unclear" cases above,
    # marital status is already known with certainty from the profile, so
    # there's nothing left to "confirm before filing".
    if not is_married:
      _fertility_entries = [e for e in reliefs_q4 if e.get("category") == "Q4 — Fertility Treatment"]
      if _fertility_entries:
        reliefs_q4 = [e for e in reliefs_q4 if e.get("category") != "Q4 — Fertility Treatment"]
        for e in _fertility_entries:
          non_deductible_q4.append({**e, "reason": "H6(ii) fertility treatment relief requires the taxpayer to be married — excluded based on your current profile marital status."})
          mixed_pending.append({
            **e, "amount": str(e["amountNumeric"]), "needsReview": True,
            "reason": "Excluded: H6(ii) fertility treatment relief requires the taxpayer to be married, and your profile's marital status is not currently set to married.",
            "question": "If your marital status is out of date, update it in Basic Particulars — this claim will be re-evaluated automatically.",
          })

    # Gender-aware joint-assessment direction check, computed HERE (rather
    # than only in the B21/B22 block below) because H14's own eligibility
    # depends on it too — see the H14 fix note just below.
    #
    # Gated on is_married as a defensive measure (Phase 4 review, 14 Jul
    # 2026): the ManageProfile UI only shows the joint-assessment dropdown
    # while married, but changing marital status away from "married" doesn't
    # clear an already-selected assessment_type — it just stops rendering
    # the field. Without this gate, a person who divorced after having
    # elected 'joint-husband'/'joint-wife' could still have that stale value
    # silently trigger spouse-income aggregation and the H14 spouse relief,
    # neither of which should apply once no longer married.
    assessment_type_raw = (person.assessment_type or "") if person else ""
    filer_gender = (person.gender or "") if person else ""
    is_joint_election = is_married and assessment_type_raw in ("joint-husband", "joint-wife")
    is_aggregating_this_return = is_joint_election and (
      (assessment_type_raw == "joint-husband" and filer_gender == "male") or
      (assessment_type_raw == "joint-wife" and filer_gender == "female")
    )
    # A joint election was made, but we can't tell which return should
    # aggregate without knowing the filer's own gender — flagged rather than
    # guessed, since guessing wrong would either silently drop real income
    # or silently double it onto the wrong return.
    b21_needs_gender = is_joint_election and filer_gender not in ("male", "female")

    # H14 spouse-relief component: married AND EITHER jointly assessed in
    # this filer's name OR the spouse has no income/is tax-exempt.
    #
    # Bug fix round 1 (14 Jul 2026, production-readiness review): this
    # previously only checked for 'joint-husband'/'joint-wife', silently
    # missing the very common 'self-spouse-no-income' case (Form B code 4).
    #
    # Bug fix round 2 (14 Jul 2026, Phase 4 review): for the two JOINT
    # codes specifically, LHDN's own wording grants each relief component to
    # a SPECIFIC spouse, not either one interchangeably — "(i) a deduction
    # for HUSBAND... given to the WIFE if... the husband has elected for
    # joint assessment in the name of his wife" and "(ii) a deduction for
    # WIFE... given to the HUSBAND who... the wife has elected for joint
    # assessment in the name of her husband." In other words: this relief
    # only belongs on the return that's actually RECEIVING the transferred
    # income — exactly the same gender-direction check B21/B22 already
    # needs. Without this, a filer whose spouse's return is the one
    # aggregating (not this one) would have incorrectly still claimed H14 on
    # their own return. 'self-spouse-no-income' is NOT gender-restricted in
    # LHDN's wording (it's framed generically as "self"), so it keeps
    # applying regardless of gender, unlike the two joint codes.
    h14_joint_eligible = (
      is_aggregating_this_return
      if is_joint_election
      else assessment_type_raw == "self-spouse-no-income"
    )
    # Bug fix (15 Jul 2026): H14's spouse-relief component has its own
    # disqualifier LHDN added from YA2017 — "the deduction... is NOT
    # allowed if the [spouse] has gross income exceeding RM4,000 derived
    # from sources outside Malaysia", UNLESS that spouse is disabled
    # (subsections 45A(2)/47(6)). Previously unchecked entirely — this
    # relief would have been granted regardless of the spouse's foreign
    # income. Checked here, before h14_spouse_component is set, so a
    # disqualified case never reaches the RM4,000 grant below.
    spouse_foreign_income = Decimal(person.spouse_foreign_income_myr or 0) if person else Decimal("0")
    h14_foreign_income_disqualifies = (
      h14_joint_eligible
      and not (person and person.spouse_is_disabled)
      and spouse_foreign_income > Decimal("4000")
    )
    h14_spouse_component = (
      Decimal("4000") if (is_married and h14_joint_eligible and not h14_foreign_income_disqualifies) else Decimal("0")
    )
    # H14 alimony component: independent of CURRENT marital status in
    # principle, but only meaningful for a divorced filer paying alimony to
    # a FORMER wife.
    h14_alimony_component = (
      min(Decimal(person.alimony_paid_myr or 0), Decimal("4000")) if (is_divorced and person and person.alimony_paid_myr) else Decimal("0")
    )
    # Combined cap: "total deduction for a wife living together and alimony
    # payments to the former wife is restricted to RM4,000" — the two
    # components are mutually exclusive in practice (married vs divorced)
    # but the combined cap is enforced regardless, per LHDN's own wording.
    h14_spouse_or_alimony = money(min(h14_spouse_component + h14_alimony_component, Decimal("4000")))
    h15_disabled_spouse = Decimal("5000") if (is_married and person and person.spouse_is_disabled) else Decimal("0")

    # H16: real per-child tiering when Child records exist; falls back to
    # the old flat per-count estimate ONLY for profiles that haven't
    # migrated to real child records yet (see models.py's Child docstring).
    h16_schedule = compute_h16_for_children(children, target_year) if children else None
    if h16_schedule:
      h16a_myr = h16_schedule["totalsByLine"]["H16a"]
      h16b_myr = h16_schedule["totalsByLine"]["H16b"]
      h16c_myr = h16_schedule["totalsByLine"]["H16c"]
      child_relief_source = "records"
    else:
      h16a_myr = Decimal("2000") * Decimal(person.number_of_children or 0) if person else Decimal("0")
      h16b_myr = Decimal("0")
      h16c_myr = Decimal("0")
      child_relief_source = "flat_estimate" if (person and person.number_of_children) else "none"

    total_profile_reliefs = money(
      h4_disabled_individual + h14_spouse_or_alimony + h15_disabled_spouse + h16a_myr + h16b_myr + h16c_myr
    )

    # ── B21/B22 — joint-assessment income aggregation (Phase 4, 14 Jul 2026) ──
    # LHDN fills B21/B22 ONLY on the return in whose name the joint
    # assessment is actually raised — per the explanatory notes: "Items B21
    # and B22 NEED NOT be filled if... the individual elects for joint
    # assessment to be raised in the name of his/her spouse." This app only
    # generates ONE filer's return at a time, so whether THIS return
    # aggregates depends on whether THIS filer's own gender matches the
    # direction of the election (joint-husband + male filer, or joint-wife +
    # female filer) — if the couple elected the OTHER direction, the
    # spouse's OWN return does the aggregating instead, not this one.
    # (is_aggregating_this_return / is_joint_election / b21_needs_gender are
    # computed earlier, alongside H14, since H14's own eligibility needs the
    # same gender-direction check — see the H14 block above.)
    b21_spouse_income_transferred = Decimal("0")
    b21_needs_review = False
    b21_note = None
    if is_aggregating_this_return:
      if person and person.spouse_total_income_myr:
        b21_spouse_income_transferred = money(Decimal(person.spouse_total_income_myr))
        b21_needs_review = True
        b21_note = (
          "Spouse's income is transferred from the profile's manually-entered figure "
          "(Person.spouse_total_income_myr) — confirm this still matches the spouse's own "
          "current-year total income before filing; it is not independently verified against "
          "any of the spouse's own documents."
        )
      else:
        b21_note = (
          "Joint assessment is raised in this filer's name, but no spouse income figure is on "
          "file — B21 is treated as 0. If the spouse has income, enter it in the profile so "
          "it's correctly aggregated."
        )
    elif b21_needs_gender:
      b21_note = (
        "A joint-assessment election is on file, but this filer's gender isn't set, so it's "
        "not possible to determine whether THIS return or the spouse's return should aggregate "
        "the household's income (B21/B22 are only filled on the return in whose name the joint "
        "assessment is raised). Set gender in the profile to resolve this."
      )
      b21_needs_review = True
    elif is_joint_election:
      b21_note = (
        "Joint assessment is raised in the spouse's name, not this filer's — per LHDN's own "
        "instructions, B21/B22 are correctly left blank on this return; the spouse's return is "
        "the one that aggregates household income."
      )

    if b21_needs_review:
      # mixed_pending (and the pendingReviewAmountMyr total it feeds) means
      # "amount EXCLUDED from the totals above, pending confirmation" — that
      # description only fits the b21_needs_gender case (aggregation is
      # skipped defensively until gender is known, so any spouse income
      # really is being held out right now). It does NOT fit the
      # is_aggregating_this_return case: that income is already correctly
      # included in est_chargeable — the note there is a periodic "please
      # keep this figure current" reminder, not an excluded amount, so it's
      # surfaced via totals.jointAssessment.note only, not double-counted
      # into the pending-review amount as if it were still unapplied.
      if b21_needs_gender:
        # Show the actual spouse-income figure potentially being held out
        # pending gender confirmation — NOT b21_spouse_income_transferred,
        # which stays 0 in this branch (it's only ever set once we already
        # know this return is the aggregating one, which we don't yet here).
        # Bug fix (Phase 4 final review, 14 Jul 2026): previously always
        # showed RM0 for this review item even when a real spouse income
        # figure was on file, understating what's actually at stake.
        b21_amount_at_stake = (
          money(Decimal(person.spouse_total_income_myr))
          if (person and person.spouse_total_income_myr)
          else Decimal("0")
        )
        mixed_pending.append({
          "documentId":    None,
          "fileName":      "Joint Assessment Income Transfer (B21/B22)",
          "documentType":  "Profile Setting",
          "category":      "B21/B22",
          "amount":        str(b21_amount_at_stake),
          "amountNumeric": b21_amount_at_stake,
          "needsReview":   True,
          "reason":        b21_note,
          "question":      "Set gender in the profile to resolve which return should aggregate joint income.",
        })

    # ── Reconciliation against reference documents ──────────────────────
    # A P&L's stated revenue SHOULD roughly equal the sum of the sales/
    # service invoices the user has actually uploaded (total_q1). If it
    # doesn't, that's a real signal — missing invoices, or a P&L including
    # income outside this platform — worth surfacing, not silently ignoring
    # in either direction.
    #
    # Bug fix (Phase 6, 14 Jul 2026): this used to ONLY search the P&L's
    # free-text line_items for a description containing a revenue-ish
    # keyword — fragile against any phrasing the extraction didn't
    # anticipate, and gave up entirely ("could not find a clear revenue
    # figure") on documents that phrased it differently. Now prefers the
    # structured pl_stated_revenue field from the FinancialStatementProfile
    # registry (see sync_financial_statement_profile in pipeline.py), which
    # is a named field the LLM fills directly rather than a label it has to
    # get exactly right. The keyword search is kept ONLY as a fallback for
    # documents processed before this structured field existed.
    def _find_line_item_amount(line_items: list, keywords: list[str]) -> Optional[float]:
      for li in (line_items or []):
        desc = (li.get("desc") or "").lower()
        if any(kw in desc for kw in keywords):
          return _parse_amount(li.get("amt"))
      return None

    revenue_keywords = [
      "revenue", "sales", "turnover", "gross income",
      "jualan", "pendapatan", "hasil", "perolehan",  # Malay equivalents
    ]
    _fsp_revenue_by_doc_id = {
      fsp["pl"]["sourceDocumentId"]: fsp["pl"]["statedRevenueMyr"]
      for fsp in financial_statements_annotated
      if fsp["pl"]["sourceDocumentId"] is not None and fsp["pl"]["statedRevenueMyr"] is not None
    }
    reconciliation = []
    for ref in reference_documents:
      if ref["category"] != "Q1 — Financial Statements (P&L)":
        continue
      stated_revenue = _fsp_revenue_by_doc_id.get(ref["documentId"])
      used_structured_field = stated_revenue is not None
      if stated_revenue is None:
        stated_revenue = _find_line_item_amount(ref["lineItems"], revenue_keywords)
      if stated_revenue is None:
        reconciliation.append({
          "documentId":   ref["documentId"],
          "fileName":     ref["fileName"],
          "statedRevenueMyr":     None,
          "documentedIncomeMyr": money(total_q1),
          "deltaMyr":     None,
          "flagged":      False,
          "note":         "Could not find a clear revenue figure on this P&L — check it manually.",
        })
        continue
      stated_revenue = Decimal(str(stated_revenue))
      delta = money(stated_revenue - total_q1)
      flagged = abs(delta) > max(Decimal("100"), stated_revenue * Decimal("0.05"))
      reconciliation.append({
        "documentId":          ref["documentId"],
        "fileName":            ref["fileName"],
        "statedRevenueMyr":    stated_revenue,
        "documentedIncomeMyr": money(total_q1),
        "deltaMyr":            delta,
        "flagged":             flagged,
        "note": (
          f"Your P&L states revenue of RM{stated_revenue:,.2f}, but only "
          f"RM{total_q1:,.2f} is backed by uploaded income documents — you may be "
          "missing invoices or other income records."
          if flagged else
          "Uploaded income documents are consistent with your P&L's revenue figure."
        ) + ("" if used_structured_field else " (matched via keyword search on an older extraction — re-upload this document to refresh it.)"),
      })


    # ── Personal reliefs — grouped, capped per statutory limit ──────────
    total_q4_capped, q4_relief_breakdown, reliefs_q4_annotated = _cap_reliefs(reliefs_q4, target_year)

    # H11 breastfeeding equipment is merged in separately since it needs the
    # multi-year eligibility registry above (see compute_breastfeeding_relief_for_year),
    # not a per-document cap like every other entry _cap_reliefs handles.
    if total_h11_relief > 0:
      q4_relief_breakdown.append({
        "category":    "Q4 — Breastfeeding Equipment",
        "rawTotal":    h11_relief["amountPurchasedMyr"],
        "cap":         H11_CAP_MYR,
        "cappedTotal": total_h11_relief,
        "wasCapped":   h11_relief["wasCapped"],
      })
      total_q4_capped = money(total_q4_capped + total_h11_relief)

    # ── Zakat — tracked separately as a rebate, never as a deduction ────
    total_zakat = money(sum(z["amountNumeric"] for z in zakat_entries))

    # ── Approved donations (Part G / B17) — NOT a personal relief. Deducted
    # from aggregate income BEFORE chargeable income is derived. Phase 5 (14
    # Jul 2026): the combined 10%-of-B11 cap only actually applies to G1 +
    # G2a + G2b + G2c + G2d ("Pool A") — G4 and G6 each have their OWN
    # individual RM20,000 cap instead (s.44(8) / s.44(10)), and G3/G5/G7 are
    # uncapped (s.44(6A) / s.44(9) / s.44(11)). Treating all ten as one pool
    # would have been wrong in both directions: it could under-cap Pool A
    # (letting G4/G6 amounts eat into headroom that should be independent)
    # or over-cap G3/G5/G7 (which should never be capped at all).
    #
    # B11 isn't modeled as its own line, but since B2/B3/B10/B12/B14/B16/B19
    # are all currently 0 or out of scope for a domestic sole prop, total_inc
    # is the correct stand-in for B11 today — this will need revisiting if
    # any of those line items go live later.
    def _gline_raw(g):
      return money(sum(d["amountNumeric"] for d in donation_entries_by_gline[g]))

    g1_raw, g2a_raw, g2b_raw, g2c_raw, g2d_raw = (
      _gline_raw("g1"), _gline_raw("g2a"), _gline_raw("g2b"), _gline_raw("g2c"), _gline_raw("g2d")
    )
    g3_raw = _gline_raw("g3")
    g4_raw = _gline_raw("g4")
    g5_raw = _gline_raw("g5")
    g6_raw = _gline_raw("g6")
    g7_raw = _gline_raw("g7")

    DONATION_INDIVIDUAL_CAP_MYR = Decimal("20000")

    # Pool A: G1 + G2a + G2b + G2c + G2d, capped COMBINED at 10% of B11.
    pool_a_raw = money(g1_raw + g2a_raw + g2b_raw + g2c_raw + g2d_raw)
    donations_cap = money(total_inc * Decimal("0.10"))
    pool_a_capped = money(min(pool_a_raw, donations_cap))
    pool_a_was_capped = pool_a_raw > donations_cap
    # Capped amount is apportioned back across G1/G2a-d proportionally to
    # each one's share of the raw pool, so the individual G-lines shown on
    # the printed form still sum to the capped G2 subtotal — LHDN's own
    # skeleton shows each of G1/G2a/G2b/G2c/G2d individually AND a "G2"
    # subtotal line, so an all-or-nothing cap on just one sub-line would
    # misrepresent which specific gift got reduced (the statute caps the
    # POOL, not any single gift, so proportional apportionment is the most
    # defensible way to still show a per-line figure).
    #
    # Bug fix (14 Jul 2026, Phase 5 review): naively rounding each line's
    # share independently (money(pool_a_capped * raw/pool_a_raw) per line)
    # can drift by a cent or more from pool_a_capped once summed back up —
    # e.g. three RM333.33 gifts capped to RM700 total independently round to
    # RM233.33 each, summing to RM699.99, one cent short. That's not just a
    # cosmetic display mismatch: G8 is built FROM these apportioned lines, so
    # the shortfall would silently understate the actual deduction applied.
    # Fixed using the largest-remainder method (Hamilton's method): round
    # every line DOWN first, then hand out the few leftover cents one at a
    # time to whichever lines had the largest fractional remainder, so the
    # parts always sum to EXACTLY pool_a_capped, never a cent off either way.
    def _apportion_exact(pool_capped: Decimal, raw_shares: dict) -> dict:
      raw_total = sum(raw_shares.values())
      if raw_total <= 0 or pool_capped <= 0:
        return {k: Decimal("0.00") for k in raw_shares}
      exact = {k: (pool_capped * v / raw_total) for k, v in raw_shares.items()}
      floored = {k: v.quantize(Decimal("0.01"), rounding=ROUND_DOWN) for k, v in exact.items()}
      remainder_cents = int(money(pool_capped - sum(floored.values())) * 100)
      # Distribute the leftover cents to whichever lines had the largest
      # fractional part first (ties broken by dict insertion order, which is
      # stable/deterministic here since raw_shares is built in a fixed order).
      order = sorted(raw_shares.keys(), key=lambda k: (exact[k] - floored[k]), reverse=True)
      result = dict(floored)
      for k in order[:remainder_cents]:
        result[k] = money(result[k] + Decimal("0.01"))
      return result

    _pool_a_parts = _apportion_exact(pool_a_capped, {
      "g1": g1_raw, "g2a": g2a_raw, "g2b": g2b_raw, "g2c": g2c_raw, "g2d": g2d_raw,
    })
    g1_capped, g2a_capped, g2b_capped, g2c_capped, g2d_capped = (
      _pool_a_parts["g1"], _pool_a_parts["g2a"], _pool_a_parts["g2b"], _pool_a_parts["g2c"], _pool_a_parts["g2d"]
    )

    # G4 / G6: each its OWN individual RM20,000 cap, independent of Pool A
    # and of each other.
    g4_capped = money(min(g4_raw, DONATION_INDIVIDUAL_CAP_MYR))
    g4_was_capped = g4_raw > DONATION_INDIVIDUAL_CAP_MYR
    g6_capped = money(min(g6_raw, DONATION_INDIVIDUAL_CAP_MYR))
    g6_was_capped = g6_raw > DONATION_INDIVIDUAL_CAP_MYR

    # G3 / G5 / G7: uncapped — full value, subject only to needing an
    # official valuation (flagged per-document during classification, not
    # re-derived here).
    g3_capped, g5_capped, g7_capped = g3_raw, g5_raw, g7_raw

    # NOTE: LHDN's own skeleton actually defines "G2" as the subtotal of ONLY
    # G2a+G2b+G2c+G2d (not G1) — G1 is its own separate line feeding G8
    # directly. Since G1 shares the SAME 10%-of-B11 pool as G2a-d for capping
    # purposes (per the bracket spanning G1 through G2d in the skeleton),
    # but the "G2" subtotal display itself should NOT include G1, it's
    # computed directly from the capped G2a-d parts rather than reusing
    # pool_a_capped (which would incorrectly include G1's share).
    g2_subtotal_capped = money(g2a_capped + g2b_capped + g2c_capped + g2d_capped)

    total_donations_raw = money(g1_raw + g2a_raw + g2b_raw + g2c_raw + g2d_raw + g3_raw + g4_raw + g5_raw + g6_raw + g7_raw)
    total_donations_capped = money(
      g1_capped + g2_subtotal_capped + g3_capped + g4_capped + g5_capped + g6_capped + g7_capped
    )
    donations_was_capped = pool_a_was_capped or g4_was_capped or g6_was_capped

    fb_income = Decimal("0")
    fb_deductions = Decimal("0")
    if form_b_record and (form_b_record.chargeable_income or form_b_record.aggregate_income or form_b_record.tax_payable):
      # A previously filed Form B is ground truth — trust LHDN's own figures
      # rather than re-deriving them from documents. A Form-B-only year has no
      # itemised receipts to sum, so the income/deduction TOTALS must come from
      # the filed figures too, otherwise the year shows blank in trend views.
      est_chargeable   = _parse_amount(form_b_record.chargeable_income)
      tax_charged      = _parse_amount(form_b_record.tax_charged) or _parse_amount(form_b_record.tax_payable)
      est_tax          = _parse_amount(form_b_record.tax_payable)
      fb_income        = _parse_amount(form_b_record.aggregate_income)
      fb_deductions    = _parse_amount(form_b_record.total_business_deductions)
      individual_relief_applied = None
      low_income_rebate_applied = None
      spouse_rebate_applied     = None
      zakat_rebate_applied      = _parse_amount(form_b_record.zakat_rebate)
      departure_levy_rebate_applied = None
      section110_rebate_applied = None
      source = "filed_form_b"
      # B25a/B25b aren't stored on a filed Form B (LHDN doesn't retain the
      # bracket-by-bracket split, only the final tax_charged/tax_payable) —
      # recomputed here from the filed chargeable income against our own
      # bracket table, which is the best available reconstruction. This can
      # only ever disagree with what was actually filed if a different
      # bracket table applied that year or the original filing itself had an
      # error — flagged as a recomputed/estimated figure in the response
      # rather than presented as if LHDN confirmed it.
      bracket_breakdown = _bracket_breakdown(est_chargeable, target_year)
    else:
      # Document-derived estimate — apply the same relief mechanics LHDN does:
      # 1. Net business profit (after Q3 deductions, capital allowance, and
      #    brought-forward losses — see business_income_after_bf_losses
      #    above) + other income = total_inc (~B13-before-current-year-loss)
      # 2. Less this year's OWN business loss (B14), capped at what's left
      #    of total_inc — a loss can offset OTHER income (e.g. employment)
      #    but never create a negative aggregate income on its own.
      # 3. Less approved donations (B17) → ~B18/B20 (B16/B19 not modeled)
      # 4. Plus spouse's transferred income (B21), if this return is the one
      #    aggregating a joint assessment (see the B21/B22 block above) → B22
      # 5. Less capped personal reliefs (document-derived Q4 categories)
      # 6. Less profile-toggle flat reliefs (H4/H14/H15/H16 — see the
      #    total_profile_reliefs block above)
      # 7. Less automatic individual self relief (Sch. 9 para 1)
      # 8. Tax charged via progressive brackets
      # 9. Less low-income rebate (s.6D), if eligible
      # 10. Less zakat rebate (s.6A), capped at remaining tax payable
      #
      # NOTE: total_deductions (Q3 + absorbed capital allowance) is NOT
      # subtracted again here — it's already embedded in total_inc via
      # business_income_after_bf_losses. Re-subtracting it would double-
      # count the same deduction.
      individual_relief_applied = INDIVIDUAL_SELF_RELIEF_MYR
      current_year_loss_applied = money(min(current_year_loss_total, max(Decimal("0"), total_inc)))
      aggregate_after_current_year_loss = money(max(Decimal("0"), total_inc - current_year_loss_applied))
      # ~B20: total income (self), before any joint-assessment aggregation.
      total_income_self = money(max(Decimal("0"), aggregate_after_current_year_loss - total_donations_capped))
      # ~B22: aggregate of total income, after adding the spouse's transferred
      # income IF this return is the one doing the aggregating (B21 is 0
      # otherwise — see the block above for why).
      aggregate_total_income = money(total_income_self + b21_spouse_income_transferred)
      est_chargeable = max(
        Decimal("0"),
        aggregate_total_income - total_q4_capped
        - total_profile_reliefs - individual_relief_applied,
      )
      tax_charged = _estimate_tax(est_chargeable, target_year)
      # B25a/B25b band-by-band breakdown for display — see _bracket_breakdown's
      # own docstring for why it deliberately re-walks the same brackets table
      # rather than deriving B25a from a second _estimate_tax() call: this
      # guarantees B25a+B25b can never numerically drift from tax_charged.
      bracket_breakdown = _bracket_breakdown(est_chargeable, target_year)

      low_income_rebate_applied = (
        LOW_INCOME_REBATE_MYR if est_chargeable <= LOW_INCOME_REBATE_THRESHOLD_MYR and tax_charged > 0 else Decimal("0")
      )
      # B27ii — Husband/Wife rebate: a SEPARATE RM400 rebate (on top of the
      # Self rebate above — both can apply together) when chargeable income
      # doesn't exceed RM35,000 AND a RM4,000 spouse deduction was actually
      # granted (h14_spouse_component, computed earlier alongside H14/H15) —
      # per LHDN's own wording (paragraph 6A(2)(b)/(c)). Deliberately keyed
      # off h14_spouse_component specifically, NOT the combined
      # h14_spouse_or_alimony figure — the alimony-to-former-wife component
      # isn't mentioned anywhere in LHDN's B27 rebate wording, so it must not
      # trigger this rebate.
      spouse_rebate_applied = (
        LOW_INCOME_REBATE_MYR
        if (est_chargeable <= LOW_INCOME_REBATE_THRESHOLD_MYR and h14_spouse_component > 0 and tax_charged > 0)
        else Decimal("0")
      )
      after_low_income_rebate = max(Decimal("0"), tax_charged - low_income_rebate_applied - spouse_rebate_applied)

      # B27iii — departure levy: same B27-level rebate step as self/spouse
      # above and zakat below, applied in the form's own ordering (Self,
      # Husband/wife, Departure Levy, Zakat). Previously unmodeled entirely
      # (16 Jul 2026 fix) — departure_levy_rebate computed earlier in this
      # function from the full lifetime claim history.
      departure_levy_rebate_applied = money(min(departure_levy_rebate, after_low_income_rebate))
      after_departure_levy = money(max(Decimal("0"), after_low_income_rebate - departure_levy_rebate_applied))

      zakat_rebate_applied = money(min(total_zakat, after_departure_levy))
      after_zakat = money(max(Decimal("0"), after_departure_levy - zakat_rebate_applied))

      # B29 — Section 110 tax deduction (others): reduces TAX PAYABLE (same
      # computational step B30 would occupy if it weren't out of scope),
      # not the final balance the way B33ii/CP500/MTD do below. Previously
      # unmodeled entirely (16 Jul 2026 fix).
      total_section110 = money(sum(e["amountNumeric"] for e in section110_entries))
      section110_rebate_applied = money(min(total_section110, after_zakat))
      est_tax = money(max(Decimal("0"), after_zakat - section110_rebate_applied))
      source = "document_derived"

    # Amount currently held out of the totals above, pending the user's input
    # (apportionment split or a direct answer) — surfaced so nothing is
    # silently dropped from the numbers the user sees. Computed HERE (not
    # right after the per-document loop) so it correctly reflects every
    # mixed_pending push made anywhere in this function, including the B21
    # gender-ambiguity flag added further down — computing it too early
    # silently missed later pushes (bug caught in the Phase 4 review).
    total_pending_review = money(sum(e["amountNumeric"] for e in mixed_pending))

    # ── D3 employer TIN auto-population from Form EA ──────────────────────
    # LHDN's own instruction for D3: "Enter the LATEST employer's E reference
    # number" — not just any employer found. Bug fix (14 Jul 2026): the
    # original Phase 7 version took the first Q2 entry found in query order,
    # which is arbitrary, not date-based. Now picks the entry whose
    # employment_end_date_this_ya is latest — treating "still employed
    # through 31 Dec" (a null end date) as LATER than any specific end date,
    # since an ongoing employment is definitionally the most recent one.
    #
    # This still can't perfectly resolve every case: if the filer had TWO
    # employers both still ongoing at 31 Dec (rare, but possible — e.g. a
    # side employment alongside a main one), there's no date-based way to
    # break the tie, so the first such entry found is used and
    # hasMultipleEmployers still fires so the person is told to verify.
    _SENTINEL_STILL_EMPLOYED = date(9999, 12, 31)  # sorts after any real end date

    def _employment_end_key(form_ea_dict):
      raw = (form_ea_dict or {}).get("employment_end_date_this_ya")
      if not raw:
        return _SENTINEL_STILL_EMPLOYED
      try:
        return date.fromisoformat(str(raw)[:10])
      except (ValueError, TypeError):
        # Unparseable date string — don't let a malformed extraction crash
        # the sort or silently win/lose the "latest" comparison in a
        # misleading way; treat as unknown, which sorts EARLIEST (never
        # picked over a real date) rather than accidentally sorting latest.
        return date.min

    employer_tin_from_form_ea = None
    employer_tin_source_doc_id = None
    latest_key_seen = None
    for q2_entry in income_q2:
      fe = q2_entry.get("formEa") or {}
      if not fe.get("employer_e_number"):
        continue
      this_key = _employment_end_key(fe)
      if latest_key_seen is None or this_key > latest_key_seen:
        latest_key_seen = this_key
        employer_tin_from_form_ea = fe["employer_e_number"]
        employer_tin_source_doc_id = q2_entry.get("documentId")

    distinct_employer_e_numbers = {
      (q2_entry.get("formEa") or {}).get("employer_e_number")
      for q2_entry in income_q2
      if (q2_entry.get("formEa") or {}).get("employer_e_number")
    }

    # ── B7a suggested employment count ─────────────────────────────────────
    # LHDN's B7a is a count of employment PERIODS, not employer TINs — its
    # own worked examples include a case where the SAME employer counts
    # TWICE (two separate non-contiguous stints, e.g. Mr. Sami: GHI Jan-Apr,
    # HIL May-Nov, GHI again Dec) and a case where TWO different legal
    # entities count ONCE (secondment within a group, one employer
    # continuing to pay throughout, e.g. Mrs. Edith — though this second
    # case mostly resolves itself naturally as long as the seconding
    # employer never issues its own separate Form EA, since there's then
    # only ever one document to count in the first place).
    #
    # Groups Form EA entries by employer_e_number and, for any employer with
    # MORE than one entry this year, checks whether the entries' employment
    # periods are genuinely separate (a real gap between them) or actually
    # continuous/overlapping (e.g. a reissued/duplicate EA for one ongoing
    # stint) — merging the latter back into a single period instead of
    # over-counting it. A >30-day gap between one stint's end and the next
    # stint's start is treated as a genuinely separate period; anything
    # tighter is treated as the same continuous employment.
    #
    # Still not perfect: if any entry for a multi-entry employer is missing
    # a start or end date, there's no reliable basis to judge contiguity, so
    # that employer conservatively counts as ONE period (the previous
    # behavior) and gets flagged via has_undated_multi_entry_employer so the
    # dataGap can say exactly which situation still needs a human check,
    # rather than silently guessing either direction.
    GAP_THRESHOLD_DAYS = 30

    def _parse_ea_date(raw):
      if not raw:
        return None
      try:
        return date.fromisoformat(str(raw)[:10])
      except (ValueError, TypeError):
        return None

    employer_entries: dict[str, list[dict]] = {}
    for q2_entry in income_q2:
      fe = q2_entry.get("formEa") or {}
      en = fe.get("employer_e_number")
      if en:
        employer_entries.setdefault(en, []).append(fe)

    b7a_suggested_count = 0
    has_undated_multi_entry_employer = False
    for employer_number, entries in employer_entries.items():
      if len(entries) == 1:
        b7a_suggested_count += 1
        continue
      parsed = [
        (_parse_ea_date(fe.get("employment_start_date_this_ya")),
         _parse_ea_date(fe.get("employment_end_date_this_ya")) or _SENTINEL_STILL_EMPLOYED)
        for fe in entries
      ]
      if any(start is None for start, _ in parsed):
        # Can't determine contiguity without a start date for every entry —
        # conservatively count as one period rather than guessing.
        b7a_suggested_count += 1
        has_undated_multi_entry_employer = True
        continue
      parsed.sort(key=lambda pair: pair[0])
      merged_periods = [parsed[0]]
      for start, end in parsed[1:]:
        last_start, last_end = merged_periods[-1]
        gap_days = (start - last_end).days if last_end != _SENTINEL_STILL_EMPLOYED else None
        if gap_days is not None and gap_days > GAP_THRESHOLD_DAYS:
          merged_periods.append((start, end))
        else:
          # Contiguous or overlapping — treat as one continuous period,
          # extending its end date if this entry runs later.
          merged_periods[-1] = (last_start, max(last_end, end))
      b7a_suggested_count += len(merged_periods)

    # Exposed as a SUGGESTION the person must confirm, not a silently-trusted
    # figure — see b7aSuggestion's dataGap in formB.js.

    return {
      "documentCount":      doc_count,
      "averageConfidence":  avg_conf,
      "completenessWarning": len(mixed_pending) > 0,
      "pendingReviewCount": len(mixed_pending),
      "pendingReviewAmountMyr": total_pending_review,
      "totals": {
        "q1BusinessIncome":          money(total_q1),
        "q2PersonalIncome":          money(total_q2),
        "totalIncome":               money(fb_income if (source == "filed_form_b" and fb_income) else total_inc),
        "q3Deductions":              money(total_q3),
        "q3CapitalAllowance":        total_capital_allowance,
        "q3CapitalAllowanceAbsorbed": ca_absorbed_total,
        "q3TotalDeductions":         money(fb_deductions if (source == "filed_form_b" and fb_deductions) else total_deductions),
        "approvedDonationsRaw":      total_donations_raw,
        "approvedDonationsMyr":      total_donations_capped,
        "approvedDonationsCapMyr":   donations_cap,
        "approvedDonationsWasCapped": donations_was_capped,
        # Part G per-line breakdown (Phase 5, 14 Jul 2026) — see the tiered-
        # cap block above for why G1/G2a-d, G4, G6, and G3/G5/G7 each have
        # genuinely different capping rules.
        "donationsByLine": {
          "g1":  {"rawMyr": g1_raw,  "cappedMyr": g1_capped},
          "g2a": {"rawMyr": g2a_raw, "cappedMyr": g2a_capped},
          "g2b": {"rawMyr": g2b_raw, "cappedMyr": g2b_capped},
          "g2c": {"rawMyr": g2c_raw, "cappedMyr": g2c_capped},
          "g2d": {"rawMyr": g2d_raw, "cappedMyr": g2d_capped},
          "g2Subtotal": g2_subtotal_capped,
          "g3":  {"rawMyr": g3_raw, "cappedMyr": g3_capped},
          "g4":  {"rawMyr": g4_raw, "cappedMyr": g4_capped, "capMyr": DONATION_INDIVIDUAL_CAP_MYR, "wasCapped": g4_was_capped},
          "g5":  {"rawMyr": g5_raw, "cappedMyr": g5_capped},
          "g6":  {"rawMyr": g6_raw, "cappedMyr": g6_capped, "capMyr": DONATION_INDIVIDUAL_CAP_MYR, "wasCapped": g6_was_capped},
          "g7":  {"rawMyr": g7_raw, "cappedMyr": g7_capped},
          "g8":  total_donations_capped,
        },
        "q4Reliefs":                 total_q4_capped,
        "q4ReliefsBreakdown":        q4_relief_breakdown,
        # Bug fix (14 Jul 2026): H4/H14/H15/H16 used to be computed only in
        # formB.js for display (H4/H14/H16a), or not modelled at all (H15),
        # disconnected from est_chargeable below. Exposed here so the
        # frontend's "Total Relief" (B23) always matches what was actually
        # subtracted for chargeable income (B24) — see the
        # total_profile_reliefs block above. appliedToChargeableIncome is
        # False for a filed-Form-B year: that year's chargeable income is
        # LHDN's own ground-truth figure, so these flat reliefs (which may
        # not even reflect the filer's CURRENT profile) are shown for
        # reference only, not re-subtracted.
        "profileReliefs": {
          "h4DisabledIndividualMyr":   money(h4_disabled_individual),
          "h14SpouseOrAlimonyMyr":     money(h14_spouse_or_alimony),
          "h14ForeignIncomeDisqualified": h14_foreign_income_disqualifies,
          "h15DisabledSpouseMyr":      money(h15_disabled_spouse),
          "h16aMyr":                   money(h16a_myr),
          "h16bMyr":                   money(h16b_myr),
          "h16cMyr":                   money(h16c_myr),
          "totalMyr":                  total_profile_reliefs,
          "appliedToChargeableIncome": source == "document_derived",
          "childReliefSource":         child_relief_source,
          "childReliefDetail":         h16_schedule["perChild"] if h16_schedule else None,
        },
        # Business-loss (B5/Part M1) and unabsorbed-capital-allowance (Part
        # M2) carry-forward — Phase 3 (14 Jul 2026), see carryforward.py.
        # Summed across every entity in scope; per-entity detail is in
        # perEntityCarryforward below for a multi-entity breakdown.
        "businessIncomeB1Myr":       b1_total,
        "currentYearBusinessLossMyr": current_year_loss_total,
        "currentYearBusinessLossAppliedMyr": (
          current_year_loss_applied if source == "document_derived" else Decimal("0.00")
        ),
        "businessLossCarryforward": {
          "broughtForwardMyr": b5_brought_forward_total,
          "absorbedMyr":       b5_absorbed_total,
          "carriedForwardMyr": b5_carried_forward_total,
          "maxCarryforwardYears": MAX_LOSS_CARRYFORWARD_YEARS,
        },
        "unabsorbedCapitalAllowanceMyr": m2_unabsorbed_total,
        "businessLossVintages": [
          {**v, "originalMyr": money(v["originalMyr"]), "absorbedMyr": money(v["absorbedMyr"]), "remainingMyr": money(v["remainingMyr"])}
          for v in sorted(vintages_by_year.values(), key=lambda v: v["yearArose"])
        ],
        "perEntityCarryforward":     per_entity_carryforward,
        # B21/B22 joint-assessment aggregation (Phase 4, 14 Jul 2026) — see
        # the b21_spouse_income_transferred block above for the gender-aware
        # logic on whether THIS return is the one that aggregates.
        "spouseTotalIncomeMyr":      money(person.spouse_total_income_myr) if (person and person.spouse_total_income_myr) else None,
        "jointAssessment": {
          "isJointElection":            is_joint_election,
          "isAggregatingThisReturn":    is_aggregating_this_return,
          "spouseIncomeTransferredMyr": b21_spouse_income_transferred,
          "needsReview":                b21_needs_review,
          "note":                       b21_note,
        },
        "zakatRebate":               zakat_rebate_applied,
        "departureLevyRebateMyr":    departure_levy_rebate_applied,   # B27iii
        "departureLevyTripsThisYear": departure_levy_result["tripsClaimedThisYear"],  # B27iv
        "section110RebateMyr":       section110_rebate_applied,   # B29
        "section107dWithheldMyr":    money(total_section107d),    # B33ii
        "individualSelfRelief":      individual_relief_applied,
        "lowIncomeRebate":           low_income_rebate_applied,
        "spouseRebate":              spouse_rebate_applied,
        "cp500Paid":                 money(total_cp500),
        "estimatedChargeableIncome": money(est_chargeable),
        "taxChargedMyr":             money(tax_charged),
        "bracketBreakdown": {
          "b25aLowerBoundMyr": bracket_breakdown["b25aLowerBoundMyr"],
          "b25aTaxMyr":        bracket_breakdown["b25aTaxMyr"],
          "b25bAmountMyr":     bracket_breakdown["b25bAmountMyr"],
          "b25bRatePct":       bracket_breakdown["b25bRatePct"],
          "b25bTaxMyr":        bracket_breakdown["b25bTaxMyr"],
          "isRecomputedFromFiledFigure": source == "filed_form_b",
        },
        "estimatedTaxPayable":       money(est_tax),
        "balancePayableMyr":         money(est_tax - total_cp500 - total_section107d - total_mtd),  # negative = refund due
        "mtdWithheldMyr":            total_mtd,
        "estimatedTaxSavings":       money(
                                       _estimate_tax(est_chargeable + total_deductions, target_year)
                                       - _estimate_tax(est_chargeable, target_year)),
        "sourceOfEstimate":          source,
        "taxBracketBasisYa":         _brackets_for_year(target_year)[1],
        **_bracket_headroom(est_chargeable, target_year),
      },
      "q1BusinessIncome":  income_q1,
      "q2PersonalIncome":  income_q2,
      "q3Deductions":      deductions_q3,
      "q3CapitalAssets":   capital_assets_annotated,
      "financialStatements": financial_statements_annotated,
      "d3EmployerTinSuggestion": {
        "value":               employer_tin_from_form_ea,
        "sourceDocumentId":    employer_tin_source_doc_id,
        "hasMultipleEmployers": len(distinct_employer_e_numbers) > 1,
      },
      "b7aSuggestion": {
        "count":               b7a_suggested_count,
        "distinctEmployerCount": len(distinct_employer_e_numbers),
        "totalFormEaCount":    sum(1 for e in income_q2 if (e.get("formEa") or {}).get("employer_e_number")),
        "hasUndatedMultiEntryEmployer": has_undated_multi_entry_employer,
      },
      "breastfeedingRelief": h11_relief,
      "q4Reliefs":         reliefs_q4_annotated,
      "q4NonDeductible":   non_deductible_q4,
      "q4Zakat":           zakat_entries,
      "q4Donations":       [d for entries in donation_entries_by_gline.values() for d in entries],
      "q4DonationsByLine": donation_entries_by_gline,
      "mixedPendingReview": mixed_pending,
      "referenceDocuments": reference_documents,
      "kDisclosures": k_disclosures,
      "bankStatementReviews": bank_statement_reviews,
      "reconciliation":     reconciliation,
      "cp500Installments": cp500_installments,
      "formB": {
        "aggregateIncome":           form_b_record.aggregate_income      if form_b_record else None,
        "chargeableIncome":          form_b_record.chargeable_income     if form_b_record else None,
        "taxPayable":                form_b_record.tax_payable           if form_b_record else None,
        "cp500TotalPaid":            form_b_record.cp500_total_paid      if form_b_record else None,
        "balancePayableRefundable":  form_b_record.balance_payable_refundable if form_b_record else None,
        "unabsorbedBusinessLosses":  form_b_record.unabsorbed_business_losses if form_b_record else None,
        "unabsorbedCapitalAllowance":form_b_record.unabsorbed_capital_allowance if form_b_record else None,
      } if form_b_record else None,
    }

  # Documents AND filed Form B profiles are scoped to the user AND (when
  # supplied) the active entity, so a multi-entity user's businesses aren't
  # merged and each entity keeps its own filed Form B for a given year.
  #
  # Status filter is ("completed", "archived") — NOT "completed" alone.
  # Archiving is a declutter action only (hide from the main list); a
  # document only becomes void when the user actually DELETES it, at which
  # point the row is gone entirely and this query naturally never sees it
  # again. Excluding "archived" here would have meant archiving a validly-
  # classified receipt silently dropped its amount from every tax total
  # (income, deductions, reliefs, donations) while the user believed they'd
  # only tidied their document list — a real understated/overstated-tax risk,
  # not a cosmetic one. "pending"/"processing"/"failed" are correctly still
  # excluded: those aren't resolved figures yet.
  def _docs_for_year(ya: int):
    q = db.query(Document).filter(
      Document.status.in_(["completed", "archived"]),
      Document.year_of_assessment == ya,
      Document.user_id == user_id,
    )
    if entity_id is not None:
      q = q.filter(Document.entity_id == entity_id)
    return q

  def _fb_for_year(ya: int):
    # A filed Form B now belongs to a specific business entity (FormBProfile
    # .entity_id), so it's scoped exactly like documents: when an entity is
    # selected, return THAT entity's filed Form B for the year — this is what
    # populates the prior-year figures (income / deductions / chargeable income /
    # tax) in the trend + bar chart. In the all-entities view (entity_id is None)
    # there's no single person-wide return to surface — each entity has its own —
    # so fall back to document-derived figures rather than arbitrarily picking
    # one entity's filing. Returns the record or None.
    if entity_id is None:
      return None
    return db.query(FormBProfile).filter(
      FormBProfile.year_of_assessment == ya,
      FormBProfile.user_id == user_id,
      FormBProfile.entity_id == entity_id,
    ).first()

  # Current year
  current_year = _build_year_summary(_docs_for_year(year).all(), year, _fb_for_year(year))

  # Prior year
  prior_docs = _docs_for_year(year - 1).all()
  prior_fb   = _fb_for_year(year - 1)
  prior_year = _build_year_summary(prior_docs, year - 1, prior_fb) if (prior_docs or prior_fb) else None

  # Yearly trend
  # Same status set as _docs_for_year above, for the same reason — an
  # archived document is still a valid, resolved figure; it must keep
  # contributing to which years show up in the trend.
  doc_years_q = db.query(Document.year_of_assessment).filter(
    Document.status.in_(["completed", "archived"]),
    Document.year_of_assessment.isnot(None),
    Document.user_id == user_id,
  )
  if entity_id is not None:
    doc_years_q = doc_years_q.filter(Document.entity_id == entity_id)
  # Form B years contribute to the trend for the SELECTED entity (each entity
  # has its own filed Form B). In the all-entities view we use document-derived
  # figures only (see _fb_for_year), so no Form B years are added there.
  fb_years = []
  if entity_id is not None:
    fb_years = [r[0] for r in db.query(FormBProfile.year_of_assessment)
                .filter(FormBProfile.user_id == user_id,
                        FormBProfile.entity_id == entity_id).distinct()]
  all_years = sorted(set([r[0] for r in doc_years_q.distinct()] + fb_years))

  yearly_trend = []
  for ya in all_years:
    s = _build_year_summary(_docs_for_year(ya).all(), ya, _fb_for_year(ya))
    yearly_trend.append({"year": ya, "isCurrentYear": ya == year, "totals": s["totals"],
                          "documentCount": s["documentCount"], "pendingReviewCount": s["pendingReviewCount"],
                          "averageConfidence": s["averageConfidence"]})

  # Forward projection
  today        = datetime.date.today()
  day_of_year  = today.timetuple().tm_yday
  days_in_year = 366 if (today.year % 4 == 0 and (today.year % 100 != 0 or today.year % 400 == 0)) else 365
  year_progress = day_of_year / days_in_year

  projection = None
  if year == today.year and 0 < year_progress < 1.0:
    current_income = current_year["totals"]["totalIncome"]
    if current_income > 0 and year_progress > 0.05:
      # year_progress is a plain fraction (day-of-year / days-in-year); convert
      # once to Decimal so the run-rate division stays in Decimal money math.
      progress = Decimal(str(year_progress))
      proj_inc  = money(current_income / progress)
      proj_ded  = money(current_year["totals"]["q3Deductions"] / progress)
      proj_rel  = money(current_year["totals"]["q4Reliefs"] / progress)
      proj_char = max(Decimal("0"), proj_inc - proj_ded - proj_rel)
      projection = {
        "basis":                      "run_rate",
        "yearProgressPct":            round(year_progress * 100, 1),
        "asOfDate":                   today.isoformat(),
        "projectedTotalIncome":       proj_inc,
        "projectedQ3Deductions":      proj_ded,
        "projectedQ4Reliefs":         proj_rel,
        "projectedChargeableIncome":  money(proj_char),
        "projectedTaxPayable":        _estimate_tax(proj_char, year),
      }

  return {
    "yearOfAssessment": year,
    "userId":           user_id,
    "currentYear":      current_year,
    "priorYear":        prior_year,
    "yearlyTrend":      yearly_trend,
    "projection":       projection,
  }


@app.get("/api/profile/form-b/{year}")
def get_form_b_profile(
  year:      int,
  user_id:   str = Query(..., description="Owner of the Form B record."),
  entity_id: Optional[int] = Query(default=None, description="Business entity the Form B belongs to; omit for the no-entity record."),
  db: Session = Depends(get_db),
):
  q = db.query(FormBProfile).filter(
    FormBProfile.year_of_assessment == year,
    FormBProfile.user_id == user_id,
  )
  if entity_id is not None:
    q = q.filter(FormBProfile.entity_id == entity_id)
  record = q.first()
  if not record:
    raise HTTPException(status_code=404, detail=f"No filed Form B found for YA {year}.")
  return {
    "yearOfAssessment":          record.year_of_assessment,
    "userId":                    record.user_id,
    "entityId":                  record.entity_id,
    "sourceDocumentId":          record.source_document_id,
    "statutoryIncome4a":         record.statutory_income_4a,
    "statutoryIncome4b":         record.statutory_income_4b,
    "statutoryIncome4c":         record.statutory_income_4c,
    "statutoryIncome4d":         record.statutory_income_4d,
    "statutoryIncome4e":         record.statutory_income_4e,
    "statutoryIncome4f":         record.statutory_income_4f,
    "aggregateIncome":           record.aggregate_income,
    "totalBusinessDeductions":   record.total_business_deductions,
    "approvedDonations":         record.approved_donations,
    "totalPersonalReliefs":      record.total_personal_reliefs,
    "chargeableIncome":          record.chargeable_income,
    "taxCharged":                record.tax_charged,
    "zakatRebate":               record.zakat_rebate,
    "taxPayable":                record.tax_payable,
    "cp500TotalPaid":            record.cp500_total_paid,
    "balancePayableRefundable":  record.balance_payable_refundable,
    "unabsorbedBusinessLosses":  record.unabsorbed_business_losses,
    "unabsorbedCapitalAllowance":record.unabsorbed_capital_allowance,
    "confidence":                record.confidence,
    "createdAt":                 record.created_at.strftime("%Y-%m-%d %H:%M:%S"),
  }