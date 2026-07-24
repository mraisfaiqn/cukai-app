import os
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from models import Base  # Essential import to register definitions prior to creation

# Load env variables from .env file
load_dotenv()

# PostgreSQL connection details:
DB_USER = os.getenv("DB_USER")
DB_PASSWORD = os.getenv("DB_PASSWORD")
DB_HOST = os.getenv("DB_HOST")
DB_PORT = os.getenv("DB_PORT")
DB_NAME = os.getenv("DB_NAME")

# Database URL
DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

engine = create_engine(
  DATABASE_URL,
  pool_size=5,
  max_overflow=10,
  pool_timeout=30,
  pool_recycle=1800,
  pool_pre_ping=True,   # silently reconnects on stale connections after idle periods
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def init_db():
  # Importing the router from main.py has registered the insight models on the
  # shared Base before startup reaches here. create_all handles new tables;
  # the explicit compatibility migrations handle constraint/column changes on
  # tables that already existed before this schema change was made.
  Base.metadata.create_all(bind=engine)
  from insights.migrations import apply_analysis_run_migration
  apply_analysis_run_migration(engine)
  apply_document_tax_status_migration(engine)


def apply_document_tax_status_migration(engine) -> None:
  """
  Widen ck_document_tax_status to accept 'reference' and 'rebate'.

  Bug found in production (24 Jul 2026): category_registry.py's
  CATEGORY_TAX_TREATMENT can produce 'reference' (Bank Statement, P&L,
  Balance Sheet, Filed Form B (Prior Year), Voluntary Disclosure, Property
  Disposal/CKHT, Capital Gains, SST-02, Foreign-Source Income, Partnership
  Income) and 'rebate' (Zakat, Departure Levy, Section 110 Withholding) —
  but the constraint below was never updated to match when those values
  were introduced. Every document in any of those 13 categories crashed
  with a CheckViolation on save — not a transient failure, so retrying
  never succeeded. create_all() only creates NEW tables and never alters
  an existing constraint, so this idempotent ALTER is required to fix any
  database that was already initialised under the old (narrower) version.

  Spelling fix (25 Jul 2026): the 'tax_instalment' value (and every
  'instalment' identifier across the codebase) was renamed to the US
  spelling 'tax_installment' for consistency. Existing rows saved under the
  old spelling are UPDATEd to the new one BEFORE the widened constraint
  below is re-added — otherwise ADD CONSTRAINT would fail validation
  against any pre-existing row still carrying the old spelling. The UPDATE
  is idempotent (a no-op once every row has been migrated), so this is
  safe to run on every application start alongside the constraint widening.
  """
  from sqlalchemy import text
  with engine.begin() as conn:
    conn.execute(text("ALTER TABLE documents DROP CONSTRAINT IF EXISTS ck_document_tax_status"))
    conn.execute(text(
      "UPDATE documents SET tax_status = 'tax_installment' WHERE tax_status = 'tax_instalment'"
    ))
    conn.execute(text(
      "ALTER TABLE documents ADD CONSTRAINT ck_document_tax_status "
      "CHECK (tax_status IS NULL OR tax_status IN "
      "('income', 'deductible', 'mixed', 'not_applicable', 'relief', "
      "'non_deductible', 'capital', 'donation', 'tax_installment', "
      "'reference', 'rebate'))"
    ))