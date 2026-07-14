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
from decimal import Decimal
from typing import Optional
from dotenv import load_dotenv

from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Query, Request, Path
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sqlalchemy.orm import Session
from sqlalchemy import or_

from database import init_db, SessionLocal
import models
from models import Document, FormBProfile, CapitalAsset, ChatSession, ChatMessage
from capital_allowance import compute_capital_allowance_for_year
from utils import parse_amount, money
from pipeline import (
  run_document_pipeline, validate_upload,
  CATEGORY_STATUS_MAP, ALL_Q1, ALL_Q2, ALL_Q3, ALL_Q4,
  REVIEW_CATEGORY, NON_TAX_CATEGORY,
  derive_document_role, derive_aggregation_state,
  APPORTIONED_CATEGORIES, resolve_deductible_pct,
  embed_document_for_rag,
)
import mongo
from embeddings import embed_text

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
  # Best-effort: verify/create the MongoDB Atlas vector search index used by
  # CukaiBot's RAG retrieval (one index on the one document_chunks
  # collection, which holds user receipts, tax_law summaries, and
  # external_resource PDF chunks together — see mongo.py's module docstring).
  # Non-fatal if MONGODB_ATLAS_CLUSTER_URI isn't set yet or Atlas is unreachable — the rest
  # of the app (uploads, tax profile, etc.) should still start normally.
  try:
    mongo.ensure_vector_index()
  except Exception as e:
    logger.warning(f"[Startup] MongoDB vector index setup skipped: {e}")
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
    "idType":                      person.id_type,
    "identificationNo":            person.identification_no,
    "personalTin":                 person.personal_tin,
    "citizenship":                 person.citizenship,
    "gender":                      person.gender,
    "dateOfBirth":                 person.date_of_birth.isoformat() if person.date_of_birth else None,
    "maritalStatus":               person.marital_status,
    "maritalEventDate":            person.marital_event_date.isoformat() if person.marital_event_date else None,
    "spouseName":                  person.spouse_name,
    "spouseIdNo":                  person.spouse_id_no,
    "spouseDob":                   person.spouse_dob.isoformat() if person.spouse_dob else None,
    "assessmentType":              person.assessment_type,
    "numberOfChildren":            person.number_of_children,
    "hasDisabledDependents":       person.has_disabled_dependents,
    "phone":                       person.phone,
    "correspondenceAddress":       person.correspondence_address,
    "correspondencePostcode":      person.correspondence_postcode,
    "correspondenceCity":          person.correspondence_city,
    "correspondenceState":         person.correspondence_state,
    "refundMethod":                person.refund_method,
    "bankName":                    person.bank_name,
    "bankAccountNo":               person.bank_account_no,
    "recordKeeping":               person.record_keeping,
    "hasForeignAccounts":          person.has_foreign_accounts,
    "rpgtDisposal":                person.rpgt_disposal,
    "hasDependentParents":         person.has_dependent_parents,
    "hasEpfLifeInsurance":         person.has_epf_life_insurance,
    "hasEducationMedicalInsurance":person.has_education_medical_insurance,
    "hasLifestylePurchases":       person.has_lifestyle_purchases,
    "hasSspnEvOther":              person.has_sspn_ev_other,
    "createdAt":                   person.created_at.isoformat() if person.created_at else None,
    "entities":                    [_serialize_entity(e) for e in person.entities],
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
    id_type=p.get("idType", "ic"),
    identification_no=p.get("identificationNo"),
    personal_tin=p.get("personalTin"),
    citizenship=p.get("citizenship", "MYS"),
    gender=p.get("gender"),
    date_of_birth=parse_date(p.get("dateOfBirth")),
    marital_status=p.get("maritalStatus", "single"),
    marital_event_date=parse_date(p.get("maritalEventDate")),
    spouse_name=p.get("spouseName"),
    spouse_id_no=p.get("spouseIdNo"),
    spouse_dob=parse_date(p.get("spouseDob")),
    assessment_type=p.get("assessmentType"),
    number_of_children=p.get("numberOfChildren", 0),
    has_disabled_dependents=p.get("hasDisabledDependents", False),
    phone=p.get("phone"),
    correspondence_address=p.get("correspondenceAddress"),
    correspondence_postcode=p.get("correspondencePostcode"),
    correspondence_city=p.get("correspondenceCity"),
    correspondence_state=p.get("correspondenceState"),
    refund_method=p.get("refundMethod", "bank"),
    bank_name=p.get("bankName"),
    bank_account_no=p.get("bankAccountNo"),
    record_keeping=p.get("recordKeeping", True),
    has_foreign_accounts=p.get("hasForeignAccounts", False),
    rpgt_disposal=p.get("rpgtDisposal", False),
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
    "idType":                      "id_type",
    "identificationNo":            "identification_no",
    "personalTin":                 "personal_tin",
    "citizenship":                 "citizenship",
    "gender":                      "gender",
    "dateOfBirth":                 None,   # handled below
    "maritalStatus":               "marital_status",
    "maritalEventDate":            None,   # handled below
    "spouseName":                  "spouse_name",
    "spouseIdNo":                  "spouse_id_no",
    "spouseDob":                   None,   # handled below
    "assessmentType":              "assessment_type",
    "numberOfChildren":            "number_of_children",
    "hasDisabledDependents":       "has_disabled_dependents",
    "phone":                       "phone",
    "correspondenceAddress":       "correspondence_address",
    "correspondencePostcode":      "correspondence_postcode",
    "correspondenceCity":          "correspondence_city",
    "correspondenceState":         "correspondence_state",
    "refundMethod":                "refund_method",
    "bankName":                    "bank_name",
    "bankAccountNo":               "bank_account_no",
    "recordKeeping":               "record_keeping",
    "hasForeignAccounts":          "has_foreign_accounts",
    "rpgtDisposal":                "rpgt_disposal",
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
  )
  db.add(entity)
  db.commit()
  db.refresh(entity)
  return _serialize_entity(entity)


@app.put("/entities/{entity_id}")
async def update_entity(entity_id: int, payload: dict, db: Session = Depends(get_db)):
  """Update an existing entity."""
  entity = db.query(models.Entity).filter(models.Entity.id == entity_id).first()
  if not entity:
    raise HTTPException(status_code=404, detail="Entity not found")

  simple_fields = {
    "entityType": "entity_type", "name": "name",
    "businessCode": "business_code", "businessActivity": "business_activity",
    "ssmNo": "ssm_no", "tin": "tin",
    "salesTurnover": "sales_turnover", "totalExpenditure": "total_expenditure",
    "netProfitLoss": "net_profit_loss", "totalAssets": "total_assets",
    "totalLiabilities": "total_liabilities",
    "monthlyIncome": "monthly_income", "annualIncome": "annual_income",
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
async def delete_entity(entity_id: int = Path(gt=0), db: Session = Depends(get_db)):
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
  entity = db.query(models.Entity).filter(models.Entity.id == entity_id).first()
  if not entity:
    raise HTTPException(status_code=404, detail="Entity not found")

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
  duplicate = db.query(Document).filter(
    Document.file_name == original_name,
    Document.user_id == user_id,
    Document.created_at >= recent_cutoff,
    Document.status.in_(["pending", "processing", "completed"]),
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

  db.delete(doc)
  db.commit()
  try:
    if file_path and os.path.isfile(file_path):
      os.remove(file_path)
  except OSError as e:
    logger.warning(f"[Delete] Could not remove file '{file_path}': {e}")

  # Remove this document's embedded RAG chunks so deleted receipts stop
  # surfacing in future CukaiBot answers. Non-fatal — the document itself is
  # already gone from Postgres either way.
  try:
    mongo_deleted = mongo.delete_chunks_for_document(doc_id)
    if mongo_deleted:
      logger.info(f"[Delete] Removed {mongo_deleted} MongoDB chunk(s) for document ID {doc_id}.")
  except Exception as e:
    logger.warning(f"[Delete] Could not remove MongoDB chunks for document ID {doc_id}: {e}")

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
  doc.status = "archived"
  db.commit()
  return {"message": f"Document ID {doc_id} archived.", "document_id": doc_id, "status": "archived"}


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
  valid_statuses = {"income", "deductible", "mixed", "relief", "non_deductible", "not_applicable", "capital"}
  if new_status and new_status not in valid_statuses:
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

  # Keep RAG retrieval in sync with the correction: drop the old chunk(s) and
  # re-embed from the now-updated category/status/amount/date. Non-fatal —
  # the reclassification itself already succeeded and is committed above.
  try:
    mongo.delete_chunks_for_document(doc.id)
    embed_document_for_rag(doc)
  except Exception as e:
    logger.warning(f"[Reclassify] Could not re-embed document ID {doc.id} for RAG: {e}")

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

  # Keep RAG retrieval in sync with the revert — non-fatal on failure.
  try:
    mongo.delete_chunks_for_document(doc.id)
    embed_document_for_rag(doc)
  except Exception as e:
    logger.warning(f"[Reset] Could not re-embed document ID {doc.id} for RAG: {e}")

  return _serialize_doc(doc)


# ── Tax profile endpoints ────────────────────────────────────────────────────

# ── LHDN statutory relief caps (Schedule 9, ITA 1967) — fallback values used
# only when a document's own `relief_cap_myr` wasn't extracted by the LLM.
# Kept here (not in pipeline.py) since this is where caps get ENFORCED.
RELIEF_CAPS_FALLBACK_MYR = {
  "Q4 — Life Insurance & Takaful Relief": 3000,
  "Q4 — EPF Personal Contribution":       4000,
  "Q4 — Medical & Parental Care":         8000,
  "Q4 — Lifestyle Relief":                2500,
  "Q4 — Education Relief":                7000,
  "Q4 — Child Relief":                    2000,
  "Q4 — Medical Equipment Relief":        6000,
  "Q4 — Private Retirement Scheme (PRS)": 3000,
  "Q4 — SOCSO Personal Contribution":     250,
  "Q4 — Domestic Tourism Relief":         1000,
  "Q4 — EV Charging Equipment":           2500,
  # "Q4 — Zakat" is deliberately absent — zakat is a tax REBATE, not a
  # capped relief, and is handled separately below.
}

# Automatic self relief every resident individual receives (Sch. 9 para 1)
# before any of the above are applied.
INDIVIDUAL_SELF_RELIEF_MYR = Decimal("9000")

# Standard tax rebate (s.6D) for chargeable income <= this threshold.
LOW_INCOME_REBATE_THRESHOLD_MYR = Decimal("35000")
LOW_INCOME_REBATE_MYR = Decimal("400")


# Progressive resident-individual bracket table as (band size, rate) tuples,
# keyed by year of assessment. Rates change between YAs, so tax for a given year
# must use that year's table — the same table can't be reused across the trend.
#
# The YA2023–2025 schedule (verified against LHDN-published rates, YA2025):
#   0–5k 0% · 5–20k 1% · 20–35k 3% · 35–50k 6% · 50–70k 11% · 70–100k 19%
#   100–400k 25% · 400–600k 26% · 600k–2m 28% · >2m 30%
# VERIFY against the LHDN gazette before relying on this for a filing, and add
# new years here as each Budget's rates are gazetted.
_TAX_BRACKETS_YA2023_2025 = [
  (5_000,        0.00),
  (15_000,       0.01),
  (15_000,       0.03),
  (15_000,       0.06),
  (20_000,       0.11),
  (30_000,       0.19),
  (300_000,      0.25),
  (200_000,      0.26),
  (1_400_000,    0.28),
  (float("inf"), 0.30),
]

TAX_BRACKETS_BY_YA: dict[int, list] = {
  2023: _TAX_BRACKETS_YA2023_2025,
  2024: _TAX_BRACKETS_YA2023_2025,
  2025: _TAX_BRACKETS_YA2023_2025,
}


def _brackets_for_year(ya: Optional[int]) -> tuple[list, int]:
  """Return (bracket_table, basis_ya_used). For a year without its own table,
  fall back to the nearest earlier registered year (else the earliest), and
  report which year's table was actually used so the estimate stays honest."""
  registered = sorted(TAX_BRACKETS_BY_YA)
  if ya in TAX_BRACKETS_BY_YA:
    return TAX_BRACKETS_BY_YA[ya], ya
  basis = registered[0]
  for y in registered:
    if ya is not None and y <= ya:
      basis = y
  if ya is not None and ya > registered[-1]:
    basis = registered[-1]
  return TAX_BRACKETS_BY_YA[basis], basis


def _estimate_tax(chargeable_income, ya: Optional[int] = None) -> Decimal:
  brackets, _ = _brackets_for_year(ya)
  tax = Decimal("0")
  remaining = Decimal(chargeable_income)
  for band_size, rate in brackets:
    if remaining <= 0:
      break
    # band_size may be float('inf') for the top band; min() with a Decimal
    # returns `remaining` there (finite < inf), so no Decimal/inf arithmetic
    # is ever performed. rate is a float in the bracket table — convert via
    # str() so the marginal rate is applied without binary drift.
    taxable_in_band = min(remaining, band_size) if band_size != float("inf") else remaining
    tax += taxable_in_band * Decimal(str(rate))
    remaining -= taxable_in_band
  return money(tax)


def _bracket_headroom(chargeable_income: float, ya: Optional[int] = None) -> dict:
  """
  Locate which marginal band `chargeable_income` currently sits in and how
  much more chargeable income it could absorb before crossing into the next
  (higher-rate) band. Lets the UI show "RM X of headroom left in your
  current Y% bracket" — useful for year-end purchase/relief timing decisions.
  Returns None-filled values if already in the top band (no next bracket).
  """
  brackets, _ = _brackets_for_year(ya)
  # Display-only guidance ("RM X of headroom left"): compute in float so the
  # float('inf') top band arithmetic works. Precision here is immaterial — this
  # figure is never summed into a filed total.
  chargeable_income = float(chargeable_income)
  floor = 0.0
  for i, (band_size, rate) in enumerate(brackets):
    ceiling = floor + band_size
    if chargeable_income < ceiling or band_size == float("inf"):
      next_rate = brackets[i + 1][1] if i + 1 < len(brackets) else None
      headroom = round(ceiling - chargeable_income, 2) if ceiling != float("inf") else None
      return {
        "currentMarginalRatePct":   round(rate * 100, 2),
        "nextMarginalRatePct":      round(next_rate * 100, 2) if next_rate is not None else None,
        "headroomToNextBracketMyr": headroom,
      }
    floor = ceiling
  # Unreachable given the inf top band, but keep a safe fallback.
  return {"currentMarginalRatePct": None, "nextMarginalRatePct": None, "headroomToNextBracketMyr": None}


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

  def _cap_reliefs(relief_entries: list) -> tuple[float, list, list]:
    """
    Group relief entries by category, sum within each, and cap each
    category's total at its statutory limit (Sch. 9 ITA 1967).
    Uses the per-document `relief_cap_myr` extracted by the LLM where
    available (falls back to RELIEF_CAPS_FALLBACK_MYR otherwise) so the
    cap logic stays driven by the same source the pipeline already trusts.
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

    capped_total = Decimal("0")
    breakdown = []
    annotated_entries = []
    for cat, bucket in by_category.items():
      cap = bucket["cap"]
      if cap is None:
        fallback = RELIEF_CAPS_FALLBACK_MYR.get(cat)
        cap = Decimal(fallback) if fallback is not None else None
      capped_amount = min(bucket["rawTotal"], cap) if cap is not None else bucket["rawTotal"]
      was_capped = cap is not None and bucket["rawTotal"] > cap
      capped_total += capped_amount
      breakdown.append({
        "category":     cat,
        "rawTotal":     money(bucket["rawTotal"]),
        "cap":          cap,
        "cappedTotal":  money(capped_amount),
        "wasCapped":    was_capped,
      })
      for e in bucket["entries"]:
        annotated_entries.append({**e, "categoryCapMyr": cap, "categoryWasCapped": was_capped})

    return money(capped_total), breakdown, annotated_entries

  def _build_year_summary(docs: list, target_year: int, form_b_record=None) -> dict:
    income_q1, income_q2, deductions_q3 = [], [], []
    reliefs_q4, non_deductible_q4 = [], []
    zakat_entries, mixed_pending, cp500_installments = [], [], []
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

      if ed.get("installment_amount") is not None:
        cp500_installments.append({
          **entry,
          "installmentAmount":        ed.get("installment_amount"),
          "installmentAmountNumeric": _parse_amount(ed.get("installment_amount")),
          "installmentMonth":         ed.get("installment_month"),
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
      if document_role == "summary_statement":
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
        if tax_status == "relief":
          relief_entry = {**entry, "reliefCapMyr": ed.get("relief_cap_myr"), "zakatAmount": ed.get("zakat_amount")}
          # Zakat is a REBATE against tax payable (s.6A ITA), not a relief that
          # reduces chargeable income — keep it out of the capped-relief pool.
          if doc.category == "Q4 — Zakat":
            if aggregation_state == "resolved":
              zakat_entries.append(relief_entry)
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
      capital_assets_annotated.append(schedule)
    total_capital_allowance = money(total_capital_allowance)

    # Amount currently held out of the totals above, pending the user's input
    # (apportionment split or a direct answer) — surfaced so nothing is
    # silently dropped from the numbers the user sees.
    total_pending_review = money(sum(e["amountNumeric"] for e in mixed_pending))

    doc_count = len(docs)
    avg_conf  = round(total_confidence / doc_count) if doc_count else 0

    total_q1    = sum(d["amountNumeric"] for d in income_q1)
    total_q2    = sum(d["amountNumeric"] for d in income_q2)
    total_inc   = total_q1 + total_q2
    total_q3    = sum(d["deductibleNumeric"] for d in deductions_q3)
    total_cp500 = sum(d["installmentAmountNumeric"] for d in cp500_installments)

    # ── Reconciliation against reference documents ──────────────────────
    # A P&L's stated revenue SHOULD roughly equal the sum of the sales/
    # service invoices the user has actually uploaded (total_q1). If it
    # doesn't, that's a real signal — missing invoices, or a P&L including
    # income outside this platform — worth surfacing, not silently ignoring
    # in either direction.
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
    reconciliation = []
    for ref in reference_documents:
      if ref["category"] != "Q1 — Financial Statements (P&L)":
        continue
      stated_revenue = _find_line_item_amount(ref["lineItems"], revenue_keywords)
      if stated_revenue is None:
        reconciliation.append({
          "documentId":   ref["documentId"],
          "fileName":     ref["fileName"],
          "statedRevenueMyr":     None,
          "documentedIncomeMyr": money(total_q1),
          "deltaMyr":     None,
          "flagged":      False,
          "note":         "Could not find a clear revenue figure in this P&L's extracted line items — check it manually.",
        })
        continue
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
        ),
      })

    # ── Personal reliefs — grouped, capped per statutory limit ──────────
    total_q4_capped, q4_relief_breakdown, reliefs_q4_annotated = _cap_reliefs(reliefs_q4)

    # ── Zakat — tracked separately as a rebate, never as a deduction ────
    total_zakat = money(sum(z["amountNumeric"] for z in zakat_entries))

    total_deductions = money(total_q3 + total_capital_allowance)

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
      zakat_rebate_applied      = _parse_amount(form_b_record.zakat_rebate)
      source = "filed_form_b"
    else:
      # Document-derived estimate — apply the same relief mechanics LHDN does:
      # 1. Net business profit + other income
      # 2. Less business deductions + capital allowance
      # 3. Less capped personal reliefs
      # 4. Less automatic individual self relief (Sch. 9 para 1)
      # 5. Tax charged via progressive brackets
      # 6. Less low-income rebate (s.6D), if eligible
      # 7. Less zakat rebate (s.6A), capped at remaining tax payable
      individual_relief_applied = INDIVIDUAL_SELF_RELIEF_MYR
      est_chargeable = max(
        Decimal("0"),
        total_inc - total_deductions - total_q4_capped - individual_relief_applied,
      )
      tax_charged = _estimate_tax(est_chargeable, target_year)

      low_income_rebate_applied = (
        LOW_INCOME_REBATE_MYR if est_chargeable <= LOW_INCOME_REBATE_THRESHOLD_MYR and tax_charged > 0 else Decimal("0")
      )
      after_low_income_rebate = max(Decimal("0"), tax_charged - low_income_rebate_applied)

      zakat_rebate_applied = money(min(total_zakat, after_low_income_rebate))
      est_tax = money(max(Decimal("0"), after_low_income_rebate - zakat_rebate_applied))
      source = "document_derived"

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
        "q3TotalDeductions":         money(fb_deductions if (source == "filed_form_b" and fb_deductions) else total_deductions),
        "q4Reliefs":                 total_q4_capped,
        "q4ReliefsBreakdown":        q4_relief_breakdown,
        "zakatRebate":               zakat_rebate_applied,
        "individualSelfRelief":      individual_relief_applied,
        "lowIncomeRebate":           low_income_rebate_applied,
        "cp500Paid":                 money(total_cp500),
        "estimatedChargeableIncome": money(est_chargeable),
        "taxChargedMyr":             money(tax_charged),
        "estimatedTaxPayable":       money(est_tax),
        "balancePayableMyr":         money(est_tax - total_cp500),  # negative = refund due
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
      "q4Reliefs":         reliefs_q4_annotated,
      "q4NonDeductible":   non_deductible_q4,
      "q4Zakat":           zakat_entries,
      "mixedPendingReview": mixed_pending,
      "referenceDocuments": reference_documents,
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
  def _docs_for_year(ya: int):
    q = db.query(Document).filter(
      Document.status == "completed",
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
  doc_years_q = db.query(Document.year_of_assessment).filter(
    Document.status == "completed",
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


# ── CukaiBot chat (RAG) ──────────────────────────────────────────────────────
# Implements the 5-step retrieval-chat loop from the team's architecture
# diagram: (1) fetch PostgreSQL session history → (2) [contextualization
# skipped for this build — see note on _generate_chat_answer] → (3) MongoDB
# Atlas $vectorSearch → (4) Gemini generation grounded in retrieved context +
# history → (5) persist both turns to PostgreSQL and respond.
#
# Two databases, two different jobs (mirrors the comment already on
# ChatSession/ChatMessage in models.py):
#   PostgreSQL → short-term memory: this conversation's own turns, by session_id.
#   MongoDB    → long-term memory: which receipt/tax-law chunks are semantically
#                relevant to the current question, via vector similarity.

CHAT_HISTORY_TURN_LIMIT = 20  # most recent messages pulled into the prompt
CHAT_VECTOR_TOP_K        = 5

CHAT_SYSTEM_PROMPT = """You are Cukai Bot, a Malaysian tax advisory assistant for cukai.ai.

Answer ONLY using the CONTEXT provided below plus the conversation history. The
CONTEXT may include: the user's own account profile (name, TIN, active
business/entity — treat this as authoritative first-party account data, not an
uploaded document), their uploaded receipts/documents, and Malaysian tax-law
reference material. If the context doesn't contain enough information to
answer confidently, say so plainly rather than guessing.

Rules:
- Be concise and specific. Reference concrete figures/dates from the context when relevant.
- Always mention the general Malaysian tax rule/section if it's present in the context.
- Never fabricate a section number, ruling number, or amount that isn't in the context.
- Remind the user, when appropriate, to verify with a licensed tax agent or LHDN directly.

Formatting:
- Write in plain, well-organized prose and short paragraphs, the way you'd
  explain it out loud to someone — not as a reference document.
- Avoid heavy markdown structure: no "###" headings, and don't break the
  answer into many bolded sub-sections. A normal answer should read as a
  few flowing paragraphs, not a formatted document.
- Only use light markdown where it genuinely helps: "**bold**" for a handful
  of the most important terms or figures (not entire clauses), and a simple
  "- " bulleted list only when there are 3+ distinct items that are easier
  to scan as a list (e.g. a set of conditions or required documents). Do not
  nest bullets or mix multiple heading levels.
"""


def _person_context_block(db: Session, user_id: str, entity_id: Optional[int]) -> Optional[str]:
  """
  Fetch the user's own Postgres profile (Person) and, if one is active, their
  business Entity, and format it as a short block of facts the chat LLM can
  answer identity/profile questions from (e.g. "what is my name?", "what's my
  TIN?", "what's my business's SSM number?").

  This exists because _generate_chat_answer's CONTEXT was built *only* from
  mongo.vector_search() results — the user's uploaded documents and tax-law
  reference chunks. That's the right source for "how much did I earn from
  MIXTURE OF EXPERTS", but a Form EA or bank statement chunk has no reason to
  contain the user's name, so a question like "what is my name?" always came
  back empty even though the name is sitting right there in Postgres. This
  queries the same Person/Entity tables _serialize_person()/_serialize_entity()
  already expose over the REST API, just reused here for the chat prompt.

  Returns None (not an empty string) when there's no Person row at all, so
  the caller can distinguish "nothing to add" from "profile exists but every
  field happens to be blank" — see the callsite in the chat endpoint.

  Deliberately NOT reusing _serialize_person()'s full field list: this only
  surfaces fields worth grounding a conversational answer in (name, IC/TIN,
  contact, marital/dependant status relevant to reliefs, and each entity's
  business details). Bank account number and full correspondence address are
  left out — they're the kind of sensitive-but-answer-irrelevant fields that
  don't need to ride along in every single LLM prompt just because they
  exist on the record.

  Lists every entity the person owns (a person can have multiple businesses
  registered), not only the one currently selected in the UI — otherwise a
  question like "what businesses do I have?" or "how many entities do I
  own?" has no way to be answered, the same gap "what is my name?" had
  before this function existed. The currently-active entity_id (if any) is
  still flagged separately so the model can tell "my businesses in general"
  apart from "the business I'm currently looking at".
  """
  # Cast to int for the query — user_id arrives as a string from the request
  # body (see _verify_entity_owned's docstring on the same int/str mismatch),
  # while Person.id is a real Integer primary key.
  try:
    person_id = int(user_id)
  except (TypeError, ValueError):
    return None

  person = db.query(models.Person).filter(models.Person.id == person_id).first()
  if not person:
    return None

  lines = ["The following is the user's own profile on file (from their account, not an uploaded document):"]
  if person.full_name:
    lines.append(f"- Full name: {person.full_name}")
  if person.identification_no:
    lines.append(f"- IC/identification no.: {person.identification_no}")
  if person.personal_tin:
    lines.append(f"- Personal TIN: {person.personal_tin}")
  if person.marital_status:
    lines.append(f"- Marital status: {person.marital_status}")
    if person.marital_status != "single" and person.spouse_name:
      lines.append(f"- Spouse name: {person.spouse_name}")
  if person.number_of_children:
    lines.append(f"- Number of children: {person.number_of_children}")
  if person.correspondence_city or person.correspondence_state:
    lines.append(f"- Location: {person.correspondence_city or ''} {person.correspondence_state or ''}".strip())

  # List every entity the person owns, not just the one currently selected —
  # a person can register multiple businesses (see models.Entity.person_id
  # being a plain one-to-many FK), and the chat should be able to answer
  # questions about all of them, not only whichever one happens to be active
  # in the UI right now.
  if person.entities:
    lines.append(f"- Businesses/entities on file ({len(person.entities)} total):")
    for entity in person.entities:
      is_active = entity_id is not None and entity.id == entity_id
      marker = " [currently active in this conversation]" if is_active else ""
      lines.append(f"  - {entity.name or '(unnamed)'} — type: {entity.entity_type}{marker}")
      if entity.business_activity:
        lines.append(f"    Business activity: {entity.business_activity}")
      if entity.ssm_no:
        lines.append(f"    SSM registration no.: {entity.ssm_no}")
      if entity.tin:
        lines.append(f"    Business TIN: {entity.tin}")

  # lines always has at least the header — that alone isn't useful context,
  # so require at least one real fact before returning a block.
  return "\n".join(lines) if len(lines) > 1 else None


def _generate_chat_answer(
  question: str, history: list[dict], context_chunks: list[dict], person_context: Optional[str] = None,
) -> str:
  """
  Step 4 of the loop — Gemini generation grounded in retrieved Mongo context
  + the user's own Postgres profile (person_context, see
  _person_context_block) + Postgres chat history + the current question.
  Reuses the same ChatGoogleGenerativeAI pattern as pipeline.py's
  classify_and_extract_with_llm.

  Note on query contextualization (step 2 in the team's diagram): the
  original diagram rewrites e.g. "what does it eat?" into "what do cats eat?"
  using a separate lightweight LLM call before embedding the query. This build
  embeds the raw question directly to avoid an extra per-message LLM
  round-trip — an intentional MVP simplification (see the original planning
  conversation). Add a rewrite step here first if the bot starts losing track
  of pronouns/follow-ups across turns.
  """
  from langchain_google_genai import ChatGoogleGenerativeAI
  from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

  api_key = os.getenv("GEMINI_API_KEY")
  if not api_key:
    raise EnvironmentError("GEMINI_API_KEY is not set.")

  llm = ChatGoogleGenerativeAI(
    model="gemini-3.1-flash-lite",
    api_key=api_key,
    temperature=0.2,
    convert_system_message_to_human=True,
  )

  if context_chunks:
    context_block = "\n".join(f"- {c.get('text', '')}" for c in context_chunks)
  else:
    context_block = "(No relevant documents or tax-law references were found for this question.)"

  # Prepend the Postgres profile block (name, TIN, active entity, etc.) ahead
  # of the document-chunk context, when there is one — see
  # _person_context_block()'s docstring for why this exists as a second,
  # separate context source rather than folding it into the Mongo query.
  if person_context:
    context_block = f"{person_context}\n\n{context_block}"

  messages = [SystemMessage(content=CHAT_SYSTEM_PROMPT + f"\n\nCONTEXT:\n{context_block}")]
  for turn in history[-CHAT_HISTORY_TURN_LIMIT:]:
    if turn["role"] == "user":
      messages.append(HumanMessage(content=turn["content"]))
    else:
      messages.append(AIMessage(content=turn["content"]))
  messages.append(HumanMessage(content=question))

  response = llm.invoke(messages)
  raw = response.content
  if isinstance(raw, list):
    return "".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in raw).strip()
  return str(raw).strip() if raw is not None else ""


# Stable, human-browsable landing page to fall back to when a direct PDF
# sourceUrl 404s — LHDN rotates its direct-download PDF links under
# random-token /media/<token>/ paths without redirecting the old ones (see
# the note on ACT-53's source_url in seed_external_resources.py), so a
# hardcoded direct link can go stale at any time with no warning. This page
# has been stable for years and reliably loads in a browser, unlike raw PDF
# GETs which some LHDN CDN paths appear to gate behind referer/session
# checks. Kept in sync with seed_external_resources.FALLBACK_INDEX_URL.
_EXTERNAL_RESOURCE_FALLBACK_URL = "https://www.hasil.gov.my/perundangan/akta/"


def _chunks_to_citations(chunks: list[dict]) -> list[dict]:
  """Shape MongoDB chunks into the CitationCard format the frontend already
  renders (tag/title/snippet/verified/sourceUrl) — see CitationCard in
  CukaiBot.jsx. sourceUrl is only populated for external_resource chunks
  (real LHDN PDFs) — the frontend's link-out button hides itself when absent.

  Also adds two fields the frontend can use but doesn't have to:
    - pageNumber: the 1-indexed PDF page this chunk came from, when known
      (see seed_external_resources.py's page-tracking extraction). None for
      chunks ingested before that tracking existed, or for non-PDF sources.
    - fallbackUrl: a stable index-page link to offer if sourceUrl 404s, since
      direct LHDN PDF links can rot without warning (see the module-level
      note above). Always present for external_resource chunks even when
      sourceUrl itself is fine, so the frontend has something to fall back
      to without a second round-trip.
  """
  citations = []
  for c in chunks:
    source = c.get("source")
    source_url = None
    page_number = None
    fallback_url = None
    if source == "external_resource":
      tag = c.get("reference_no") or c.get("resource_type", "REFERENCE").upper()
      title = c.get("title") or c.get("category") or "Official reference"
      source_url = c.get("source_url")
      page_number = c.get("page_number")
      # "#page=N" is the de-facto PDF open-parameter most browsers/viewers
      # honor (Chrome, Firefox, Edge, Adobe Reader) to jump straight to a
      # given page — cheap, standard, no extra request needed.
      if source_url and page_number:
        source_url = f"{source_url}#page={page_number}"
      fallback_url = _EXTERNAL_RESOURCE_FALLBACK_URL
    elif source == "tax_law":
      tag, title = "TAX LAW", c.get("category") or "Reference material"
    else:
      tag = f"YA{c['year_of_assessment']}" if c.get("year_of_assessment") else "DOCUMENT"
      title = c.get("category") or "Your document"
    citations.append({
      "tag": tag,
      "title": title,
      "snippet": c.get("text", ""),
      "verified": f"Similarity {round(c['score'] * 100)}%" if c.get("score") is not None else None,
      "sourceUrl": source_url,
      "pageNumber": page_number,
      "fallbackUrl": fallback_url,
    })
  return citations


@app.get("/api/chat/sessions")
def list_chat_sessions(
  user_id:   str            = Query(..., description="Owner of the sessions."),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  """List a user's chat sessions (most recently updated first), optionally
  scoped to one entity — mirrors getAllEntities-style listing elsewhere."""
  _verify_entity_owned(db, user_id, entity_id)
  q = db.query(ChatSession).filter(ChatSession.user_id == user_id)
  if entity_id is not None:
    q = q.filter(ChatSession.entity_id == entity_id)
  sessions = q.order_by(ChatSession.updated_at.desc()).all()
  return [
    {
      "sessionId": s.session_id,
      "entityId": s.entity_id,
      "title": s.title,
      "createdAt": s.created_at.strftime("%Y-%m-%d %H:%M:%S"),
      "updatedAt": s.updated_at.strftime("%Y-%m-%d %H:%M:%S"),
    }
    for s in sessions
  ]


@app.get("/api/chat/{session_id}/history")
def get_chat_history(
  session_id: str,
  user_id:    str = Query(..., description="Owner of the session."),
  db: Session = Depends(get_db),
):
  """Fetch the full message history for one session, ordered oldest→newest —
  what CukaiBot.jsx's getInitialMessagesForEntity should be replaced with."""
  session = db.query(ChatSession).filter(
    ChatSession.session_id == session_id, ChatSession.user_id == user_id,
  ).first()
  if not session:
    raise HTTPException(status_code=404, detail="Chat session not found.")

  messages = (
    db.query(ChatMessage)
    .filter(ChatMessage.session_id == session_id)
    .order_by(ChatMessage.created_at.asc())
    .all()
  )
  return {
    "sessionId": session.session_id,
    "entityId": session.entity_id,
    "messages": [
      {
        "id": m.id,
        "role": m.role,
        "text": m.content,
        "citations": m.citations,
      }
      for m in messages
    ],
  }


@app.post("/api/chat", status_code=200)
def post_chat_message(
  payload:  dict,
  db: Session = Depends(get_db),
):
  """
  The main retrieval-chat endpoint (steps 1–5 of the loop).

  Request body:
    { "message": str, "user_id": str, "entity_id": int|null, "session_id": str|null }
  session_id is optional — a new session is created automatically on first
  message, exactly like starting a new WhatsApp thread.

  Response:
    { "session_id", "message": {id, role, text, citations} }
  """
  message   = (payload.get("message") or "").strip()
  user_id   = payload.get("user_id")
  entity_id = payload.get("entity_id")
  session_id = payload.get("session_id")

  if not message:
    raise HTTPException(status_code=422, detail="message is required.")
  if not user_id:
    raise HTTPException(status_code=422, detail="user_id is required.")
  _verify_entity_owned(db, user_id, entity_id)

  # ── Resolve or create the session ──────────────────────────────────────
  session = None
  if session_id:
    session = db.query(ChatSession).filter(
      ChatSession.session_id == session_id, ChatSession.user_id == user_id,
    ).first()
    if not session:
      raise HTTPException(status_code=404, detail="Chat session not found.")
  if session is None:
    session_id = uuid.uuid4().hex
    session = ChatSession(
      session_id=session_id,
      user_id=user_id,
      entity_id=entity_id,
      title=message[:80],
    )
    db.add(session)
    db.commit()
    db.refresh(session)

  # ── Step 1: fetch PostgreSQL session history ─────────────────────────────
  history_rows = (
    db.query(ChatMessage)
    .filter(ChatMessage.session_id == session.session_id)
    .order_by(ChatMessage.created_at.desc())
    .limit(CHAT_HISTORY_TURN_LIMIT)
    .all()
  )
  history = [{"role": m.role, "content": m.content} for m in reversed(history_rows)]

  # Persist the user's message immediately, so it's saved even if generation
  # below fails partway through.
  user_msg = ChatMessage(session_id=session.session_id, user_id=user_id, role="user", content=message)
  db.add(user_msg)
  db.commit()
  db.refresh(user_msg)

  # ── Steps 2–3: (contextualization skipped, see _generate_chat_answer) +
  #    embed the question and run MongoDB Atlas vector search. One call now
  #    covers everything — the user's own documents, hand-written tax_law
  #    summaries, and official external_resource PDF chunks all live in the
  #    same document_chunks collection (see mongo.py's module docstring).
  context_chunks: list[dict] = []
  try:
    query_vector = embed_text(message, task_type="retrieval_query")
    context_chunks = mongo.vector_search(
      query_embedding=query_vector,
      user_id=user_id,
      entity_id=entity_id,
      top_k=CHAT_VECTOR_TOP_K,
    )
  except Exception as e:
    logger.warning(f"[Chat] Vector search failed for session {session.session_id}: {e}")

  # ── Step 3b: fetch the user's own Postgres profile (name, TIN, active
  #    entity, etc.) so identity/profile questions can be answered even when
  #    no uploaded document happens to mention them — see
  #    _person_context_block()'s docstring for the "what is my name?" case
  #    this fixes. Best-effort: a lookup failure here shouldn't break the
  #    document-grounded half of the answer.
  person_context: Optional[str] = None
  try:
    person_context = _person_context_block(db, user_id, entity_id)
  except Exception as e:
    logger.warning(f"[Chat] Person profile lookup failed for session {session.session_id}: {e}")

  # ── Step 4: generate the answer ──────────────────────────────────────────
  try:
    answer_text = _generate_chat_answer(message, history, context_chunks, person_context)
    if not answer_text:
      raise ValueError("empty response")
  except Exception as e:
    logger.error(f"[Chat] Generation failed for session {session.session_id}: {e}")
    answer_text = (
      "Sorry, I couldn't generate a response just now. Please try again in a moment, "
      "or rephrase your question."
    )

  citations = _chunks_to_citations(context_chunks)

  # ── Step 5: save the assistant reply and respond ────────────────────────
  assistant_msg = ChatMessage(
    session_id=session.session_id,
    user_id=user_id,
    role="assistant",
    content=answer_text,
    citations=citations or None,
  )
  db.add(assistant_msg)
  session.updated_at = datetime.datetime.now(datetime.timezone.utc)
  db.commit()
  db.refresh(assistant_msg)

  return {
    "sessionId": session.session_id,
    "message": {
      "id": assistant_msg.id,
      "role": "assistant",
      "text": assistant_msg.content,
      "citations": citations,
    },
  }


@app.delete("/api/chat/{session_id}")
def delete_chat_session(
  session_id: str,
  user_id:    str = Query(..., description="Owner of the session."),
  db: Session = Depends(get_db),
):
  """Delete a session and all its messages (cascade via ChatSession.messages
  relationship) — backs the frontend's existing "Clear Chat" button."""
  session = db.query(ChatSession).filter(
    ChatSession.session_id == session_id, ChatSession.user_id == user_id,
  ).first()
  if not session:
    raise HTTPException(status_code=404, detail="Chat session not found.")
  db.delete(session)
  db.commit()
  return {"message": f"Chat session {session_id} deleted.", "session_id": session_id}