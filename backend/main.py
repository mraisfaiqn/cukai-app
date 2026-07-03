import asyncio
import concurrent.futures
import datetime
import logging
import os
import re
import uuid
import bcrypt
from datetime import date
from typing import Optional
from dotenv import load_dotenv

from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Query, Request, Path
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sqlalchemy.orm import Session

from database import init_db, SessionLocal
import models
from models import Document, FormBProfile
from pipeline import (
  run_document_pipeline, validate_upload,
  CATEGORY_STATUS_MAP, ALL_Q1, ALL_Q2, ALL_Q3, ALL_Q4,
  REVIEW_CATEGORY, NON_TAX_CATEGORY,
)

_pipeline_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="pipeline")

load_dotenv()
logger = logging.getLogger("uvicorn.error")

# slowapi = a rate limiting library
limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Cukai.ai — LHDN Document Classification Engine", version="2.0.0")
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

STORAGE_DIR = "./stored_documents"
MAX_BATCH_FILES = 10
MAX_BATCH_BYTES = 100 * 1024 * 1024  # 100 MB


@app.on_event("startup")
def startup_event():
  init_db()
  os.makedirs(STORAGE_DIR, exist_ok=True)
  app.mount("/files", StaticFiles(directory=STORAGE_DIR), name="stored_documents")


def get_db():
  db = SessionLocal()
  try:
    yield db
  finally:
    db.close()


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
    "quadrant":          doc.extracted_data.get("quadrant")    if doc.extracted_data else None,
    "itaSection":        doc.extracted_data.get("ita_section") if doc.extracted_data else None,
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
  """Delete an entity. Refuses to delete a person's only remaining entity."""
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

  db.delete(entity)
  db.commit()
  return {"deleted": True, "id": entity_id}


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
  recent_cutoff = datetime.datetime.utcnow() - timedelta(hours=24)
  duplicate = db.query(Document).filter(
    Document.file_name == original_name,
    Document.user_id == user_id,
    Document.entity_id == entity_id,
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
  user_id: Optional[str] = Query(default=None),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  file_content = await file.read()
  is_valid, error_msg = validate_upload(
    filename=file.filename, content_type=file.content_type or "", file_size_bytes=len(file_content)
  )
  if not is_valid:
    raise HTTPException(status_code=422, detail=error_msg)
  result = _save_and_queue(file_content, file.filename, user_id, entity_id, db)
  return {"message": "Document uploaded and queued for classification.", **result}


@app.post("/api/documents/batch-upload", status_code=202)
@limiter.limit("10/minute")
async def batch_upload_documents(
  request: Request,
  files: list[UploadFile] = File(...),
  user_id: Optional[str] = Query(default=None),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
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
  user_id:   Optional[str] = Query(default=None),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  """
  Persist a document the user entered by hand (no file, no OCR pipeline).
  Used by the "Manually add a document" flow when a receipt can't be
  uploaded as a file. A plain-text receipt is generated and stored on disk
  so the record behaves consistently with every other Document row.
  """
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
  user_id:   Optional[str] = Query(default=None),
  entity_id: Optional[int] = Query(default=None),
  year:      Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  q = db.query(Document).order_by(Document.id.desc())
  if user_id:
    q = q.filter(Document.user_id == user_id)
  if entity_id:
    q = q.filter(Document.entity_id == entity_id)
  if year:
    q = q.filter(Document.year_of_assessment == year)
  return [_serialize_doc(doc) for doc in q.all()]


@app.get("/api/documents/{doc_id}/status")
def get_document_status(
  doc_id: int,
  user_id:   Optional[str] = Query(default=None),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  q = db.query(Document).filter(Document.id == doc_id)
  if user_id:
    q = q.filter(Document.user_id == user_id)
  if entity_id:
    q = q.filter(Document.entity_id == entity_id)
  doc = q.first()
  if not doc:
    raise HTTPException(status_code=404, detail=f"Document ID {doc_id} not found.")

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
  user_id:   Optional[str] = Query(default=None),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  q = db.query(Document).filter(Document.id == doc_id)
  if user_id:
    q = q.filter(Document.user_id == user_id)
  if entity_id:
    q = q.filter(Document.entity_id == entity_id)
  doc = q.first()
  if not doc:
    raise HTTPException(status_code=404, detail=f"Document ID {doc_id} not found.")
  return _serialize_doc(doc)


@app.delete("/api/documents/{doc_id}", status_code=200)
def delete_document(
  doc_id: int,
  user_id:   Optional[str] = Query(default=None),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  q = db.query(Document).filter(Document.id == doc_id)
  if user_id:
    q = q.filter(Document.user_id == user_id)
  if entity_id:
    q = q.filter(Document.entity_id == entity_id)
  doc = q.first()
  if not doc:
    raise HTTPException(status_code=404, detail=f"Document ID {doc_id} not found.")
  file_path = doc.file_path
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
  user_id:   Optional[str] = Query(default=None),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  """
  Re-run the OCR/classification pipeline on a previously failed document,
  using the file already stored on disk — no re-upload required.
  """
  q = db.query(Document).filter(Document.id == doc_id)
  if user_id:
    q = q.filter(Document.user_id == user_id)
  if entity_id:
    q = q.filter(Document.entity_id == entity_id)
  doc = q.first()
  if not doc:
    raise HTTPException(status_code=404, detail=f"Document ID {doc_id} not found.")
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
  user_id:   Optional[str] = Query(default=None),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  q = db.query(Document).filter(Document.id == doc_id)
  if user_id:
    q = q.filter(Document.user_id == user_id)
  if entity_id:
    q = q.filter(Document.entity_id == entity_id)
  doc = q.first()
  if not doc:
    raise HTTPException(status_code=404, detail=f"Document ID {doc_id} not found.")
  doc.status = "archived"
  db.commit()
  return {"message": f"Document ID {doc_id} archived.", "document_id": doc_id, "status": "archived"}


@app.patch("/api/documents/{doc_id}/reclassify", status_code=200)
def reclassify_document(
  doc_id: int,
  payload: dict,
  user_id:   Optional[str] = Query(default=None),
  entity_id: Optional[int] = Query(default=None),
  db: Session = Depends(get_db),
):
  q = db.query(Document).filter(Document.id == doc_id)
  if user_id:
    q = q.filter(Document.user_id == user_id)
  if entity_id:
    q = q.filter(Document.entity_id == entity_id)
  doc = q.first()
  if not doc:
    raise HTTPException(status_code=404, detail=f"Document ID {doc_id} not found.")

  new_status   = payload.get("status")
  new_category = payload.get("category")
  new_amount   = payload.get("amount")
  new_date     = payload.get("date")
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

  if new_status:
    doc.tax_status = new_status
  if new_category:
    doc.category = new_category
  doc.status = "completed"

  ed = dict(doc.extracted_data or {})
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
  doc.extracted_data = ed
  db.commit()
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
INDIVIDUAL_SELF_RELIEF_MYR = 9000.0

# Standard tax rebate (s.6D) for chargeable income <= this threshold.
LOW_INCOME_REBATE_THRESHOLD_MYR = 35000.0
LOW_INCOME_REBATE_MYR = 400.0


# Progressive resident-individual bracket table (band size, rate). Shared by
# _estimate_tax and _bracket_headroom so the two can never drift apart.
TAX_BRACKETS_MYR = [
  (5_000,        0.00),
  (15_000,       0.01),
  (15_000,       0.03),
  (15_000,       0.08),
  (20_000,       0.13),
  (30_000,       0.21),
  (300_000,      0.24),
  (200_000,      0.245),
  (float("inf"), 0.25),
]


def _estimate_tax(chargeable_income: float) -> float:
  tax = 0.0
  remaining = chargeable_income
  for band_size, rate in TAX_BRACKETS_MYR:
    if remaining <= 0:
      break
    taxable_in_band = min(remaining, band_size)
    tax += taxable_in_band * rate
    remaining -= taxable_in_band
  return round(tax, 2)


def _bracket_headroom(chargeable_income: float) -> dict:
  """
  Locate which marginal band `chargeable_income` currently sits in and how
  much more chargeable income it could absorb before crossing into the next
  (higher-rate) band. Lets the UI show "RM X of headroom left in your
  current Y% bracket" — useful for year-end purchase/relief timing decisions.
  Returns None-filled values if already in the top band (no next bracket).
  """
  floor = 0.0
  for band_size, rate in TAX_BRACKETS_MYR:
    ceiling = floor + band_size
    if chargeable_income < ceiling or band_size == float("inf"):
      band_index = TAX_BRACKETS_MYR.index((band_size, rate))
      next_rate = TAX_BRACKETS_MYR[band_index + 1][1] if band_index + 1 < len(TAX_BRACKETS_MYR) else None
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
  year:    int            = Query(..., description="Year of assessment e.g. 2024"),
  user_id: Optional[str] = Query(default=None),
  db: Session = Depends(get_db),
):
  def _parse_amount(val) -> float:
    if val is None:
      return 0.0
    try:
      return float(str(val).replace("RM", "").replace(",", "").strip())
    except (ValueError, TypeError):
      return 0.0

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
      bucket = by_category.setdefault(cat, {"rawTotal": 0.0, "cap": None, "entries": []})
      bucket["rawTotal"] += e["amountNumeric"]
      bucket["entries"].append(e)
      doc_cap = e.get("reliefCapMyr")
      if doc_cap is not None and bucket["cap"] is None:
        bucket["cap"] = _parse_amount(doc_cap)

    capped_total = 0.0
    breakdown = []
    annotated_entries = []
    for cat, bucket in by_category.items():
      cap = bucket["cap"] if bucket["cap"] is not None else RELIEF_CAPS_FALLBACK_MYR.get(cat)
      capped_amount = min(bucket["rawTotal"], cap) if cap is not None else bucket["rawTotal"]
      was_capped = cap is not None and bucket["rawTotal"] > cap
      capped_total += capped_amount
      breakdown.append({
        "category":     cat,
        "rawTotal":     round(bucket["rawTotal"], 2),
        "cap":          cap,
        "cappedTotal":  round(capped_amount, 2),
        "wasCapped":    was_capped,
      })
      for e in bucket["entries"]:
        annotated_entries.append({**e, "categoryCapMyr": cap, "categoryWasCapped": was_capped})

    return round(capped_total, 2), breakdown, annotated_entries

  def _build_year_summary(docs: list, form_b_record=None) -> dict:
    income_q1, income_q2, deductions_q3 = [], [], []
    capital_assets, reliefs_q4, non_deductible_q4 = [], [], []
    zakat_entries, mixed_pending, cp500_installments = [], [], []
    total_confidence = 0

    for doc in docs:
      ed         = doc.extracted_data or {}
      quadrant   = ed.get("quadrant", "")
      tax_status = doc.tax_status or ""
      amount     = ed.get("amount")
      confidence = ed.get("confidence", 0) or 0
      total_confidence += confidence
      is_mixed   = (tax_status == "mixed" or doc.category == "Mixed / Pending Review")

      entry = {
        "documentId":    doc.id,
        "fileName":      doc.file_name,
        "documentType":  doc.document_type,
        "category":      doc.category,
        "amount":        amount,
        "amountNumeric": _parse_amount(amount),
        "currency":      ed.get("currency", "MYR"),
        "vendor":        ed.get("vendor"),
        "date":          ed.get("date"),
        "itaSection":    ed.get("ita_section"),
        "confidence":    confidence,
        "ocrQuality":    ed.get("ocr_quality"),
        "note":          ed.get("note"),
        "needsReview":   is_mixed,
      }

      if ed.get("installment_amount") is not None:
        cp500_installments.append({
          **entry,
          "installmentAmount":        ed.get("installment_amount"),
          "installmentAmountNumeric": _parse_amount(ed.get("installment_amount")),
          "installmentMonth":         ed.get("installment_month"),
        })

      if quadrant == "Q1":
        income_q1.append(entry)
      elif quadrant == "Q2":
        income_q2.append({**entry, "formEa": ed.get("form_ea"), "fsiSourceCountry": ed.get("fsi_source_country")})
      elif quadrant == "Q3":
        has_installment = ed.get("installment_amount") is not None
        if tax_status == "capital":
          capital_assets.append({
            **entry,
            "assetClass": ed.get("asset_class"),
            "iaRatePct":  ed.get("ia_rate_pct"),
            "aaRatePct":  ed.get("aa_rate_pct"),
          })
        elif not has_installment and tax_status != "not_applicable":
          deductions_q3.append(entry)
      elif quadrant == "Q4":
        if tax_status == "relief":
          relief_entry = {**entry, "reliefCapMyr": ed.get("relief_cap_myr"), "zakatAmount": ed.get("zakat_amount")}
          # Zakat is a REBATE against tax payable (s.6A ITA), not a relief that
          # reduces chargeable income — keep it out of the capped-relief pool.
          if doc.category == "Q4 — Zakat":
            zakat_entries.append(relief_entry)
          else:
            reliefs_q4.append(relief_entry)
        else:
          non_deductible_q4.append(entry)

      if is_mixed:
        mixed_pending.append({**entry, "reason": ed.get("reason"), "question": ed.get("question"), "source": ed.get("source")})

    doc_count = len(docs)
    avg_conf  = round(total_confidence / doc_count) if doc_count else 0

    total_q1    = sum(d["amountNumeric"] for d in income_q1)
    total_q2    = sum(d["amountNumeric"] for d in income_q2)
    total_inc   = total_q1 + total_q2
    total_q3    = sum(d["amountNumeric"] for d in deductions_q3)
    total_cp500 = sum(d["installmentAmountNumeric"] for d in cp500_installments)

    # ── Capital allowance (Schedule 3 ITA 1967) ─────────────────────────
    # Capital assets are NOT directly deductible — they're claimed via
    # Initial Allowance (one-time, year of purchase) + Annual Allowance
    # (recurring), both computed off the asset cost using the rates the
    # LLM extracted per asset. This was previously extracted but never
    # actually folded into the deduction total.
    total_capital_allowance = 0.0
    capital_assets_annotated = []
    for ca in capital_assets:
      ia_pct = ca.get("iaRatePct") or 0
      aa_pct = ca.get("aaRatePct") or 0
      cost   = ca["amountNumeric"]
      ia_amount = round(cost * (ia_pct / 100), 2)
      aa_amount = round(cost * (aa_pct / 100), 2)
      allowance = ia_amount + aa_amount
      total_capital_allowance += allowance
      capital_assets_annotated.append({
        **ca,
        "initialAllowanceMyr": ia_amount,
        "annualAllowanceMyr":  aa_amount,
        "totalAllowanceMyr":   round(allowance, 2),
      })
    total_capital_allowance = round(total_capital_allowance, 2)

    # ── Personal reliefs — grouped, capped per statutory limit ──────────
    total_q4_capped, q4_relief_breakdown, reliefs_q4_annotated = _cap_reliefs(reliefs_q4)

    # ── Zakat — tracked separately as a rebate, never as a deduction ────
    total_zakat = round(sum(z["amountNumeric"] for z in zakat_entries), 2)

    total_deductions = round(total_q3 + total_capital_allowance, 2)

    if form_b_record and form_b_record.chargeable_income:
      # A previously filed Form B is ground truth — trust LHDN's own figures
      # rather than re-deriving them from documents.
      est_chargeable   = _parse_amount(form_b_record.chargeable_income)
      tax_charged      = _parse_amount(form_b_record.tax_charged) or _parse_amount(form_b_record.tax_payable)
      est_tax          = _parse_amount(form_b_record.tax_payable)
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
        0.0,
        total_inc - total_deductions - total_q4_capped - individual_relief_applied,
      )
      tax_charged = _estimate_tax(est_chargeable)

      low_income_rebate_applied = (
        LOW_INCOME_REBATE_MYR if est_chargeable <= LOW_INCOME_REBATE_THRESHOLD_MYR and tax_charged > 0 else 0.0
      )
      after_low_income_rebate = max(0.0, tax_charged - low_income_rebate_applied)

      zakat_rebate_applied = round(min(total_zakat, after_low_income_rebate), 2)
      est_tax = round(max(0.0, after_low_income_rebate - zakat_rebate_applied), 2)
      source = "document_derived"

    return {
      "documentCount":      doc_count,
      "averageConfidence":  avg_conf,
      "completenessWarning": len(mixed_pending) > 0,
      "pendingReviewCount": len(mixed_pending),
      "totals": {
        "q1BusinessIncome":          round(total_q1, 2),
        "q2PersonalIncome":          round(total_q2, 2),
        "totalIncome":               round(total_inc, 2),
        "q3Deductions":              round(total_q3, 2),
        "q3CapitalAllowance":        total_capital_allowance,
        "q3TotalDeductions":         total_deductions,
        "q4Reliefs":                 total_q4_capped,
        "q4ReliefsBreakdown":        q4_relief_breakdown,
        "zakatRebate":               zakat_rebate_applied,
        "individualSelfRelief":      individual_relief_applied,
        "lowIncomeRebate":           low_income_rebate_applied,
        "cp500Paid":                 round(total_cp500, 2),
        "estimatedChargeableIncome": round(est_chargeable, 2),
        "taxChargedMyr":             round(tax_charged, 2),
        "estimatedTaxPayable":       round(est_tax, 2),
        "balancePayableMyr":         round(est_tax - total_cp500, 2),  # negative = refund due
        "estimatedTaxSavings":       round(total_deductions * 0.24, 2),
        "sourceOfEstimate":          source,
        **_bracket_headroom(est_chargeable),
      },
      "q1BusinessIncome":  income_q1,
      "q2PersonalIncome":  income_q2,
      "q3Deductions":      deductions_q3,
      "q3CapitalAssets":   capital_assets_annotated,
      "q4Reliefs":         reliefs_q4_annotated,
      "q4NonDeductible":   non_deductible_q4,
      "q4Zakat":           zakat_entries,
      "mixedPendingReview": mixed_pending,
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

  # Current year
  current_docs_q = db.query(Document).filter(Document.status == "completed", Document.year_of_assessment == year)
  if user_id:
    current_docs_q = current_docs_q.filter(Document.user_id == user_id)
  current_fb_q = db.query(FormBProfile).filter(FormBProfile.year_of_assessment == year)
  if user_id:
    current_fb_q = current_fb_q.filter(FormBProfile.user_id == user_id)
  current_year = _build_year_summary(current_docs_q.all(), current_fb_q.first())

  # Prior year
  prior_docs_q = db.query(Document).filter(Document.status == "completed", Document.year_of_assessment == year - 1)
  if user_id:
    prior_docs_q = prior_docs_q.filter(Document.user_id == user_id)
  prior_fb_q = db.query(FormBProfile).filter(FormBProfile.year_of_assessment == year - 1)
  if user_id:
    prior_fb_q = prior_fb_q.filter(FormBProfile.user_id == user_id)
  prior_docs = prior_docs_q.all()
  prior_fb   = prior_fb_q.first()
  prior_year = _build_year_summary(prior_docs, prior_fb) if (prior_docs or prior_fb) else None

  # Yearly trend
  doc_years_q = db.query(Document.year_of_assessment).filter(Document.status == "completed", Document.year_of_assessment.isnot(None))
  fb_years_q  = db.query(FormBProfile.year_of_assessment)
  if user_id:
    doc_years_q = doc_years_q.filter(Document.user_id == user_id)
    fb_years_q  = fb_years_q.filter(FormBProfile.user_id == user_id)
  all_years = sorted(set([r[0] for r in doc_years_q.distinct()] + [r[0] for r in fb_years_q.distinct()]))

  yearly_trend = []
  for ya in all_years:
    ya_docs_q = db.query(Document).filter(Document.status == "completed", Document.year_of_assessment == ya)
    ya_fb_q   = db.query(FormBProfile).filter(FormBProfile.year_of_assessment == ya)
    if user_id:
      ya_docs_q = ya_docs_q.filter(Document.user_id == user_id)
      ya_fb_q   = ya_fb_q.filter(FormBProfile.user_id == user_id)
    s = _build_year_summary(ya_docs_q.all(), ya_fb_q.first())
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
      proj_inc  = round(current_income / year_progress, 2)
      proj_ded  = round(current_year["totals"]["q3Deductions"] / year_progress, 2)
      proj_rel  = round(current_year["totals"]["q4Reliefs"] / year_progress, 2)
      proj_char = max(0.0, proj_inc - proj_ded - proj_rel)
      projection = {
        "basis":                      "run_rate",
        "yearProgressPct":            round(year_progress * 100, 1),
        "asOfDate":                   today.isoformat(),
        "projectedTotalIncome":       proj_inc,
        "projectedQ3Deductions":      proj_ded,
        "projectedQ4Reliefs":         proj_rel,
        "projectedChargeableIncome":  round(proj_char, 2),
        "projectedTaxPayable":        _estimate_tax(proj_char),
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
  year:    int,
  user_id: Optional[str] = Query(default=None),
  db: Session = Depends(get_db),
):
  q = db.query(FormBProfile).filter(FormBProfile.year_of_assessment == year)
  if user_id:
    q = q.filter(FormBProfile.user_id == user_id)
  record = q.first()
  if not record:
    raise HTTPException(status_code=404, detail=f"No filed Form B found for YA {year}.")
  return {
    "yearOfAssessment":          record.year_of_assessment,
    "userId":                    record.user_id,
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