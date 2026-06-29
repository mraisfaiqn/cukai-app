import asyncio
import bcrypt
import concurrent.futures
import datetime
import logging
import os
import uuid
from datetime import date
from typing import Annotated, Optional
from dotenv import load_dotenv

from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Path, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
import schemas
from database import engine, init_db, SessionLocal
from models import Document, FormBProfile
from pipeline import run_document_pipeline, validate_upload

# Thread pool for blocking OCR/LLM work — keeps the async event loop free.
# Max 4 concurrent pipelines: enough for batch uploads without exhausting DB pool.
_pipeline_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="pipeline")

# Load env variables from .env file
load_dotenv()

logger = logging.getLogger("uvicorn.error")

# ── Rate limiter ──────────────────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="Cukai.ai — LHDN Document Classification Engine", version="2.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Read allowed origins from env. Falls back to localhost for local dev.
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:5174")
ALLOWED_ORIGINS: list[str] = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
  CORSMiddleware,
  allow_origins=ALLOWED_ORIGINS,
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

# Reusable DB dependency for user/auth routes that use Annotated style
db_dependency = Annotated[Session, Depends(lambda: next(_get_db_gen()))]


# ── Startup ───────────────────────────────────────────────────────────────────

STORAGE_DIR = "./stored_documents"
MAX_BATCH_FILES = 10
MAX_BATCH_BYTES = 100 * 1024 * 1024   # 100 MB


@app.on_event("startup")
def startup_event():
  init_db()
  models.Base.metadata.create_all(bind=engine)
  os.makedirs(STORAGE_DIR, exist_ok=True)
  app.mount("/files", StaticFiles(directory=STORAGE_DIR), name="stored_documents")


# ── DB session helpers ────────────────────────────────────────────────────────

def _get_db_gen():
  db = SessionLocal()
  try:
    yield db
  finally:
    db.close()

def get_db():
  yield from _get_db_gen()


# ── Auth helpers ──────────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
  return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()

def parse_date(value) -> date | None:
  if not value:
    return None
  return date.fromisoformat(value)


# ── Document helpers ──────────────────────────────────────────────────────────

def _serialize_doc(doc: Document) -> dict:
  """Consistent document shape returned by all document endpoints."""
  return {
    "id":                 doc.id,
    "user_id":            doc.user_id,
    "file_name":          doc.file_name,
    "status":             doc.status,
    "document_type":      doc.document_type,
    "category":           doc.category,
    "tax_status":         doc.tax_status,
    "year_of_assessment": doc.year_of_assessment,
    "quadrant":           doc.extracted_data.get("quadrant")    if doc.extracted_data else None,
    "ita_section":        doc.extracted_data.get("ita_section") if doc.extracted_data else None,
    "extracted_data":     doc.extracted_data,
    "uploaded_at":        doc.created_at.strftime("%Y-%m-%d %H:%M:%S"),
  }


def _save_and_queue(
  file_content: bytes,
  original_name: str,
  user_id: Optional[str],
  db: Session,
) -> dict:
  """
  Save one file to disk, create its DB record, and queue the pipeline.
  Returns the serialised pending document dict.
  Raises HTTPException on validation or path-safety failure.
  """
  is_valid, error_msg = validate_upload(
    filename=original_name,
    content_type="",
    file_size_bytes=len(file_content),
  )
  if not is_valid:
    raise HTTPException(status_code=422, detail=f"{original_name}: {error_msg}")

  # Duplicate detection: same filename + same user within the last 24 hours
  from datetime import timedelta
  recent_cutoff = datetime.datetime.utcnow() - timedelta(hours=24)
  duplicate = db.query(Document).filter(
    Document.file_name == original_name,
    Document.user_id == user_id,
    Document.created_at >= recent_cutoff,
    Document.status.in_(["pending", "processing", "completed"]),
  ).first()
  if duplicate:
    raise HTTPException(
      status_code=409,
      detail=f"DUPLICATE:{duplicate.id}:{original_name}",
    )

  safe_filename  = f"{uuid.uuid4().hex}_{os.path.basename(original_name)}"
  safe_file_path = os.path.join(STORAGE_DIR, safe_filename)

  if not os.path.realpath(safe_file_path).startswith(os.path.realpath(STORAGE_DIR)):
    raise HTTPException(status_code=400, detail=f"{original_name}: Invalid file path.")

  with open(safe_file_path, "wb") as buf:
    buf.write(file_content)

  db_doc = Document(
    file_name=original_name,
    file_path=safe_file_path,
    user_id=user_id,
  )
  db.add(db_doc)
  db.commit()
  db.refresh(db_doc)

  loop = asyncio.get_event_loop()
  loop.run_in_executor(_pipeline_executor, run_document_pipeline, db_doc.id, safe_file_path, SessionLocal)

  return {
    "document_id": db_doc.id,
    "file_name":   original_name,
    "status":      "pending",
  }


# ══════════════════════════════════════════════════════════════════════════════
# USER / AUTH ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/users", response_model=schemas.PersonOut)
async def user_register(db: db_dependency, payload: schemas.ProfileIn):
  """Register a sole-proprietor profile (person + business entity) from onboarding."""
  p = payload.person

  if db.query(models.Person).filter(models.Person.email == p.email).first():
    raise HTTPException(status_code=400, detail="Email already registered")

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


@app.post("/api/auth/login")
async def user_login(db: db_dependency, payload: schemas.UserLogin):
  person_result = db.query(models.Person).filter(models.Person.email == payload.email).first()
  if not person_result:
    raise HTTPException(status_code=404, detail="User not found")
  if not bcrypt.checkpw(payload.password.encode(), person_result.password_hash.encode()):
    raise HTTPException(status_code=401, detail="Incorrect password")
  return {"id": person_result.id, "fullName": person_result.full_name}


@app.get("/api/users/{person_id}", response_model=schemas.PersonOut)
async def get_profile(db: db_dependency, person_id: int = Path(gt=0)):
  person_result = db.query(models.Person).filter(models.Person.id == person_id).first()
  if person_result is not None:
    return person_result
  raise HTTPException(status_code=404, detail="Profile not found")


@app.get("/api/users/{person_id}/personal-details", response_model=schemas.PersonalDetailsOut)
async def get_personal_details(db: db_dependency, person_id: int = Path(gt=0)):
  person_result = db.query(models.Person).filter(models.Person.id == person_id).first()
  if person_result is not None:
    return person_result
  raise HTTPException(status_code=404, detail="Person not found")


@app.get("/api/users/{person_id}/company-details", response_model=schemas.EntityOut)
async def get_company_details(db: db_dependency, person_id: int = Path(gt=0)):
  person_result = db.query(models.Person).filter(models.Person.id == person_id).first()
  if not person_result:
    raise HTTPException(status_code=404, detail="Person not found")
  if not person_result.entities:
    raise HTTPException(status_code=404, detail="No company found for this person")
  return person_result.entities[0]


@app.delete("/api/users/{person_id}")
async def delete_user(db: db_dependency, person_id: int = Path(gt=0)):
  user_result = db.query(models.Person).filter(models.Person.id == person_id).first()
  if user_result is None:
    raise HTTPException(status_code=404, detail="User not found")
  db.delete(user_result)
  db.commit()
  return {"message": "User successfully deleted"}


# ══════════════════════════════════════════════════════════════════════════════
# UPLOAD ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/documents/upload", status_code=202)
@limiter.limit("30/minute")
async def upload_document(
  request: Request,
  file: UploadFile = File(...),
  user_id: Optional[str] = Query(default=None, description="User identifier (pre-auth placeholder)"),
  db: Session = Depends(get_db),
):
  """Single file upload. Validates, stores, and queues OCR classification."""
  file_content = await file.read()

  is_valid, error_msg = validate_upload(
    filename=file.filename,
    content_type=file.content_type or "",
    file_size_bytes=len(file_content),
  )
  if not is_valid:
    raise HTTPException(status_code=422, detail=error_msg)

  result = _save_and_queue(file_content, file.filename, user_id, db)
  return {
    "message": "Document uploaded and queued for classification.",
    **result,
  }


@app.post("/api/documents/batch-upload", status_code=202)
@limiter.limit("10/minute")
async def batch_upload_documents(
  request: Request,
  files: list[UploadFile] = File(...),
  user_id: Optional[str] = Query(default=None, description="User identifier (pre-auth placeholder)"),
  db: Session = Depends(get_db),
):
  """
  Batch upload: up to 10 files, 100 MB combined.
  Each file is validated and queued independently — a failure on one file
  does not block the others.
  """
  if len(files) == 0:
    raise HTTPException(status_code=422, detail="No files provided.")
  if len(files) > MAX_BATCH_FILES:
    raise HTTPException(
      status_code=422,
      detail=f"Maximum {MAX_BATCH_FILES} files per batch. Received {len(files)}.",
    )

  file_contents: list[tuple[str, bytes]] = []
  total_bytes = 0
  for f in files:
    content = await f.read()
    total_bytes += len(content)
    file_contents.append((f.filename, content))

  if total_bytes > MAX_BATCH_BYTES:
    raise HTTPException(
      status_code=422,
      detail=(
        f"Total batch size {total_bytes / (1024*1024):.1f} MB exceeds the "
        f"{MAX_BATCH_BYTES // (1024*1024)} MB limit."
      ),
    )

  results = []
  errors  = []

  for original_name, content in file_contents:
    try:
      result = _save_and_queue(content, original_name, user_id, db)
      results.append(result)
    except HTTPException as e:
      errors.append({"file_name": original_name, "error": e.detail})
    except Exception as e:
      logger.error(f"[Batch Upload] Unexpected error for '{original_name}': {e}", exc_info=True)
      errors.append({"file_name": original_name, "error": "Unexpected server error."})

  return {
    "message":       f"{len(results)} of {len(file_contents)} file(s) queued for classification.",
    "queued":        results,
    "errors":        errors,
    "total_queued":  len(results),
    "total_failed":  len(errors),
  }


# ══════════════════════════════════════════════════════════════════════════════
# DOCUMENT ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/documents")
def get_all_documents(
  user_id: Optional[str] = Query(default=None),
  year:    Optional[int]  = Query(default=None, description="Filter by year of assessment"),
  db: Session = Depends(get_db),
):
  """List all documents, optionally filtered by user_id and/or year_of_assessment."""
  q = db.query(Document).order_by(Document.id.desc())
  if user_id:
    q = q.filter(Document.user_id == user_id)
  if year:
    q = q.filter(Document.year_of_assessment == year)
  return [_serialize_doc(doc) for doc in q.all()]


@app.get("/api/documents/{doc_id}")
def get_document(
  doc_id: int,
  user_id: Optional[str] = Query(default=None),
  db: Session = Depends(get_db),
):
  q = db.query(Document).filter(Document.id == doc_id)
  if user_id:
    q = q.filter(Document.user_id == user_id)
  doc = q.first()
  if not doc:
    raise HTTPException(status_code=404, detail=f"Document ID {doc_id} not found.")
  return _serialize_doc(doc)


@app.get("/api/documents/{doc_id}/status")
def get_document_status(
  doc_id: int,
  user_id: Optional[str] = Query(default=None),
  db: Session = Depends(get_db),
):
  """Lightweight polling endpoint for the frontend while the pipeline runs."""
  q = db.query(Document).filter(Document.id == doc_id)
  if user_id:
    q = q.filter(Document.user_id == user_id)
  doc = q.first()
  if not doc:
    raise HTTPException(status_code=404, detail=f"Document ID {doc_id} not found.")

  payload: dict = {"id": doc.id, "status": doc.status}

  if doc.status == "completed":
    payload.update({
      "document_type":      doc.document_type,
      "category":           doc.category,
      "tax_status":         doc.tax_status,
      "year_of_assessment": doc.year_of_assessment,
      "quadrant":           doc.extracted_data.get("quadrant")    if doc.extracted_data else None,
      "ita_section":        doc.extracted_data.get("ita_section") if doc.extracted_data else None,
      "confidence":         doc.extracted_data.get("confidence")  if doc.extracted_data else None,
    })
  elif doc.status == "failed":
    payload["error"] = (
      doc.extracted_data.get("error_message") if doc.extracted_data else "Unknown error."
    )

  return payload


@app.delete("/api/documents/{doc_id}", status_code=200)
def delete_document(
  doc_id: int,
  user_id: Optional[str] = Query(default=None),
  db: Session = Depends(get_db),
):
  """Delete a document record and remove its file from disk."""
  q = db.query(Document).filter(Document.id == doc_id)
  if user_id:
    q = q.filter(Document.user_id == user_id)
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


@app.patch("/api/documents/{doc_id}/archive", status_code=200)
def archive_document(
  doc_id: int,
  user_id: Optional[str] = Query(default=None),
  db: Session = Depends(get_db),
):
  """Mark a document as archived. Archived docs are hidden from the main list."""
  q = db.query(Document).filter(Document.id == doc_id)
  if user_id:
    q = q.filter(Document.user_id == user_id)
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
  user_id: Optional[str] = Query(default=None),
  db: Session = Depends(get_db),
):
  """
  Persist a user-confirmed reclassification.
  Accepts { status, category } in the request body.
  """
  q = db.query(Document).filter(Document.id == doc_id)
  if user_id:
    q = q.filter(Document.user_id == user_id)
  doc = q.first()
  if not doc:
    raise HTTPException(status_code=404, detail=f"Document ID {doc_id} not found.")

  new_status   = payload.get("status")
  new_category = payload.get("category")

  valid_statuses = {"income", "deductible", "mixed", "relief", "non_deductible", "not_applicable"}
  if new_status and new_status not in valid_statuses:
    raise HTTPException(status_code=422, detail=f"Invalid status '{new_status}'.")

  if new_status:
    doc.tax_status = new_status
  if new_category:
    doc.category = new_category
  doc.status = "completed"

  ed = dict(doc.extracted_data or {})
  ed["user_reclassified"] = True
  ed["user_reclassified_status"]   = new_status
  ed["user_reclassified_category"] = new_category
  doc.extracted_data = ed

  db.commit()
  return _serialize_doc(doc)


# ══════════════════════════════════════════════════════════════════════════════
# TAX HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _estimate_tax(chargeable_income: float) -> float:
  """
  Simplified Malaysian progressive income tax estimate (YA 2024 scale).
  Used only when no filed Form B is available. Not authoritative — for indicative display only.
  Brackets: 0–5k=0%, 5k–20k=1%, 20k–35k=3%, 35k–50k=8%, 50k–70k=13%,
            70k–100k=21%, 100k–400k=24%, 400k–600k=24.5%, 600k+=25%
  """
  brackets = [
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
  tax = 0.0
  remaining = chargeable_income
  for band_size, rate in brackets:
    if remaining <= 0:
      break
    taxable_in_band = min(remaining, band_size)
    tax += taxable_in_band * rate
    remaining -= taxable_in_band
  return round(tax, 2)


# ══════════════════════════════════════════════════════════════════════════════
# TAX PROFILE ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/profile/summary")
def get_tax_profile_summary(
  year:    int             = Query(..., description="Year of assessment e.g. 2024"),
  user_id: Optional[str]  = Query(default=None),
  db: Session = Depends(get_db),
):
  """
  Aggregates all completed documents for a given YA into a structured tax profile.

  Returns three layers:
    1. current_year  — full quadrant breakdown with numeric totals for charts
    2. yearly_trend  — all available YAs for this user (for stacked bar charts)
    3. projection    — run-rate estimate for the current YA based on upload date
  """

  def _parse_amount(val) -> float:
    if val is None:
      return 0.0
    try:
      return float(str(val).replace("RM", "").replace(",", "").strip())
    except (ValueError, TypeError):
      return 0.0

  def _build_year_summary(docs: list, form_b_record=None) -> dict:
    income_q1:          list[dict] = []
    income_q2:          list[dict] = []
    deductions_q3:      list[dict] = []
    capital_assets:     list[dict] = []
    reliefs_q4:         list[dict] = []
    non_deductible_q4:  list[dict] = []
    mixed_pending:      list[dict] = []
    cp500_installments: list[dict] = []
    total_confidence    = 0

    for doc in docs:
      ed         = doc.extracted_data or {}
      quadrant   = ed.get("quadrant", "")
      tax_status = doc.tax_status or ""
      amount     = ed.get("amount")
      confidence = ed.get("confidence", 0) or 0
      total_confidence += confidence
      is_mixed   = (tax_status == "mixed" or doc.category == "Mixed / Pending Review")

      entry = {
        "document_id":    doc.id,
        "file_name":      doc.file_name,
        "document_type":  doc.document_type,
        "category":       doc.category,
        "amount":         amount,
        "amount_numeric": _parse_amount(amount),
        "currency":       ed.get("currency", "MYR"),
        "vendor":         ed.get("vendor"),
        "date":           ed.get("date"),
        "ita_section":    ed.get("ita_section"),
        "confidence":     confidence,
        "ocr_quality":    ed.get("ocr_quality"),
        "note":           ed.get("note"),
        "needs_review":   is_mixed,
      }

      if ed.get("installment_amount") is not None:
        cp500_installments.append({
          **entry,
          "installment_amount":        ed.get("installment_amount"),
          "installment_amount_numeric": _parse_amount(ed.get("installment_amount")),
          "installment_month":          ed.get("installment_month"),
        })

      if quadrant == "Q1":
        income_q1.append(entry)
      elif quadrant == "Q2":
        income_q2.append({
          **entry,
          "form_ea":            ed.get("form_ea"),
          "form_b":             ed.get("form_b"),
          "fsi_source_country": ed.get("fsi_source_country"),
        })
      elif quadrant == "Q3":
        has_installment = ed.get("installment_amount") is not None
        if tax_status == "not_applicable" and not has_installment:
          capital_assets.append({
            **entry,
            "asset_class": ed.get("asset_class"),
            "ia_rate_pct": ed.get("ia_rate_pct"),
            "aa_rate_pct": ed.get("aa_rate_pct"),
          })
        elif not has_installment:
          deductions_q3.append(entry)
      elif quadrant == "Q4":
        if tax_status == "relief":
          reliefs_q4.append({
            **entry,
            "relief_cap_myr": ed.get("relief_cap_myr"),
            "zakat_amount":   ed.get("zakat_amount"),
          })
        else:
          non_deductible_q4.append(entry)

      if is_mixed:
        mixed_pending.append({
          **entry,
          "reason":   ed.get("reason"),
          "question": ed.get("question"),
          "source":   ed.get("source"),
        })

    doc_count = len(docs)
    avg_conf  = round(total_confidence / doc_count) if doc_count else 0

    total_q1_income     = sum(_parse_amount(d["amount"]) for d in income_q1)
    total_q2_income     = sum(_parse_amount(d["amount"]) for d in income_q2)
    total_income        = total_q1_income + total_q2_income
    total_q3_deductions = sum(_parse_amount(d["amount"]) for d in deductions_q3)
    total_q4_reliefs    = sum(_parse_amount(d["amount"]) for d in reliefs_q4)
    total_cp500_paid    = sum(d["installment_amount_numeric"] for d in cp500_installments)

    if form_b_record and form_b_record.chargeable_income:
      estimated_chargeable_income = _parse_amount(form_b_record.chargeable_income)
      estimated_tax_payable       = _parse_amount(form_b_record.tax_payable)
      source_of_estimate          = "filed_form_b"
    else:
      estimated_chargeable_income = max(0.0, total_income - total_q3_deductions - total_q4_reliefs)
      estimated_tax_payable       = _estimate_tax(estimated_chargeable_income)
      source_of_estimate          = "document_derived"

    return {
      "document_count":       doc_count,
      "average_confidence":   avg_conf,
      "completeness_warning": len(mixed_pending) > 0,
      "pending_review_count": len(mixed_pending),
      "totals": {
        "q1_business_income":          round(total_q1_income, 2),
        "q2_personal_income":          round(total_q2_income, 2),
        "total_income":                round(total_income, 2),
        "q3_deductions":               round(total_q3_deductions, 2),
        "q4_reliefs":                  round(total_q4_reliefs, 2),
        "cp500_paid":                  round(total_cp500_paid, 2),
        "estimated_chargeable_income": round(estimated_chargeable_income, 2),
        "estimated_tax_payable":       round(estimated_tax_payable, 2),
        "estimated_tax_savings":       round(total_q3_deductions * 0.24, 2),
        "source_of_estimate":          source_of_estimate,
      },
      "q1_business_income":   income_q1,
      "q2_personal_income":   income_q2,
      "q3_deductions":        deductions_q3,
      "q3_capital_assets":    capital_assets,
      "q4_reliefs":           reliefs_q4,
      "q4_non_deductible":    non_deductible_q4,
      "mixed_pending_review": mixed_pending,
      "cp500_installments":   cp500_installments,
      "form_b": {
        "aggregate_income":             form_b_record.aggregate_income           if form_b_record else None,
        "chargeable_income":            form_b_record.chargeable_income          if form_b_record else None,
        "tax_payable":                  form_b_record.tax_payable                if form_b_record else None,
        "cp500_total_paid":             form_b_record.cp500_total_paid           if form_b_record else None,
        "balance_payable_refundable":   form_b_record.balance_payable_refundable if form_b_record else None,
        "unabsorbed_business_losses":   form_b_record.unabsorbed_business_losses if form_b_record else None,
        "unabsorbed_capital_allowance": form_b_record.unabsorbed_capital_allowance if form_b_record else None,
      } if form_b_record else None,
    }

  # ── Current year ──────────────────────────────────────────────────────────
  current_docs_q = db.query(Document).filter(
    Document.status == "completed",
    Document.year_of_assessment == year,
  )
  if user_id:
    current_docs_q = current_docs_q.filter(Document.user_id == user_id)
  current_docs = current_docs_q.all()

  current_fb_q = db.query(FormBProfile).filter(FormBProfile.year_of_assessment == year)
  if user_id:
    current_fb_q = current_fb_q.filter(FormBProfile.user_id == user_id)
  current_fb = current_fb_q.first()

  current_year = _build_year_summary(current_docs, current_fb)

  # ── Prior year baseline ───────────────────────────────────────────────────
  prior_fb_q = db.query(FormBProfile).filter(FormBProfile.year_of_assessment == year - 1)
  if user_id:
    prior_fb_q = prior_fb_q.filter(FormBProfile.user_id == user_id)
  prior_fb = prior_fb_q.first()

  prior_year_docs_q = db.query(Document).filter(
    Document.status == "completed",
    Document.year_of_assessment == year - 1,
  )
  if user_id:
    prior_year_docs_q = prior_year_docs_q.filter(Document.user_id == user_id)
  prior_year_docs = prior_year_docs_q.all()

  prior_year = _build_year_summary(prior_year_docs, prior_fb) if (prior_year_docs or prior_fb) else None

  # ── Yearly trend ──────────────────────────────────────────────────────────
  available_years_q = db.query(Document.year_of_assessment).filter(
    Document.status == "completed",
    Document.year_of_assessment.isnot(None),
  )
  if user_id:
    available_years_q = available_years_q.filter(Document.user_id == user_id)

  fb_years_q = db.query(FormBProfile.year_of_assessment)
  if user_id:
    fb_years_q = fb_years_q.filter(FormBProfile.user_id == user_id)

  all_years = sorted(set(
    [r[0] for r in available_years_q.distinct().all()] +
    [r[0] for r in fb_years_q.distinct().all()]
  ))

  yearly_trend = []
  for ya in all_years:
    ya_docs_q = db.query(Document).filter(
      Document.status == "completed",
      Document.year_of_assessment == ya,
    )
    if user_id:
      ya_docs_q = ya_docs_q.filter(Document.user_id == user_id)
    ya_docs = ya_docs_q.all()

    ya_fb_q = db.query(FormBProfile).filter(FormBProfile.year_of_assessment == ya)
    if user_id:
      ya_fb_q = ya_fb_q.filter(FormBProfile.user_id == user_id)
    ya_fb = ya_fb_q.first()

    ya_summary = _build_year_summary(ya_docs, ya_fb)
    yearly_trend.append({
      "year":                 ya,
      "is_current_year":      ya == year,
      "totals":               ya_summary["totals"],
      "document_count":       ya_summary["document_count"],
      "pending_review_count": ya_summary["pending_review_count"],
      "average_confidence":   ya_summary["average_confidence"],
    })

  # ── Forward projection ────────────────────────────────────────────────────
  today        = datetime.date.today()
  current_ya   = today.year
  day_of_year  = today.timetuple().tm_yday
  days_in_year = 366 if (current_ya % 4 == 0 and (current_ya % 100 != 0 or current_ya % 400 == 0)) else 365
  year_progress = day_of_year / days_in_year

  projection = None
  if year == current_ya and 0 < year_progress < 1.0:
    current_income = current_year["totals"]["total_income"]
    if current_income > 0 and year_progress > 0.05:
      projected_income     = round(current_income / year_progress, 2)
      projected_deductions = round(current_year["totals"]["q3_deductions"] / year_progress, 2)
      projected_reliefs    = round(current_year["totals"]["q4_reliefs"] / year_progress, 2)
      proj_chargeable      = max(0.0, projected_income - projected_deductions - projected_reliefs)
      proj_tax             = _estimate_tax(proj_chargeable)

      projection = {
        "basis":                       "run_rate",
        "year_progress_pct":           round(year_progress * 100, 1),
        "as_of_date":                  today.isoformat(),
        "projected_total_income":      projected_income,
        "projected_q3_deductions":     projected_deductions,
        "projected_q4_reliefs":        projected_reliefs,
        "projected_chargeable_income": round(proj_chargeable, 2),
        "projected_tax_payable":       proj_tax,
        "note": (
          f"Run-rate projection based on {round(year_progress * 100, 1)}% of {year} elapsed. "
          "Assumes income and expenses are distributed evenly throughout the year. "
          "Upload more documents for a more accurate projection."
        ),
      }

  return {
    "year_of_assessment": year,
    "user_id":            user_id,
    "current_year":       current_year,
    "prior_year":         prior_year,
    "yearly_trend":       yearly_trend,
    "projection":         projection,
  }


@app.get("/api/profile/form-b/{year}")
def get_form_b_profile(
  year:    int,
  user_id: Optional[str] = Query(default=None),
  db: Session = Depends(get_db),
):
  """Return the extracted Form B profile for a specific year of assessment."""
  q = db.query(FormBProfile).filter(FormBProfile.year_of_assessment == year)
  if user_id:
    q = q.filter(FormBProfile.user_id == user_id)
  record = q.first()
  if not record:
    raise HTTPException(
      status_code=404,
      detail=f"No filed Form B found for YA {year}. Upload your Form B to populate this.",
    )
  return {
    "year_of_assessment":           record.year_of_assessment,
    "user_id":                      record.user_id,
    "source_document_id":           record.source_document_id,
    "statutory_income_4a":          record.statutory_income_4a,
    "statutory_income_4b":          record.statutory_income_4b,
    "statutory_income_4c":          record.statutory_income_4c,
    "statutory_income_4d":          record.statutory_income_4d,
    "statutory_income_4e":          record.statutory_income_4e,
    "statutory_income_4f":          record.statutory_income_4f,
    "aggregate_income":             record.aggregate_income,
    "total_business_deductions":    record.total_business_deductions,
    "approved_donations":           record.approved_donations,
    "total_personal_reliefs":       record.total_personal_reliefs,
    "chargeable_income":            record.chargeable_income,
    "tax_charged":                  record.tax_charged,
    "zakat_rebate":                 record.zakat_rebate,
    "tax_payable":                  record.tax_payable,
    "cp500_total_paid":             record.cp500_total_paid,
    "balance_payable_refundable":   record.balance_payable_refundable,
    "unabsorbed_business_losses":   record.unabsorbed_business_losses,
    "unabsorbed_capital_allowance": record.unabsorbed_capital_allowance,
    "confidence":                   record.confidence,
    "created_at":                   record.created_at.strftime("%Y-%m-%d %H:%M:%S"),
  }