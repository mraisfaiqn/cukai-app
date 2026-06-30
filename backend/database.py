# """Database engine, session factory, and declarative base.

# Single place that decides *where* the data lives. Two modes, chosen by env:

#   1. Local dev (default)  — SQLite file `cukai.db`, so you can create tables and
#      run the app with zero infrastructure. Set DATABASE_URL to point at a local
#      Postgres instead if you prefer (e.g. postgresql+pg8000://user:pass@host/db).
#   2. Cloud SQL (Postgres) — when INSTANCE_CONNECTION_NAME is set, connect through
#      Google's cloud-sql-python-connector + pg8000 (both already in requirements).

# The rest of the backend only imports `Base`, `SessionLocal`, and `get_db` — it
# never needs to know which mode is active.
# """

# import os

# from dotenv import load_dotenv
# from sqlalchemy import create_engine
# from sqlalchemy.orm import declarative_base, sessionmaker

# # Load backend/.env so DATABASE_URL / Cloud SQL vars are picked up automatically.
# load_dotenv()

# # Shared declarative base — every model in models.py subclasses this.
# Base = declarative_base()

# # the "_" infront signals its a private function, only can be called in this file
# def _build_engine():
#     """Create the SQLAlchemy engine for whichever environment we're in."""
#     instance = os.getenv("INSTANCE_CONNECTION_NAME")

#     if instance:
#         # ── Google Cloud SQL (Postgres) via the connector + pg8000 ───────────
#         # Imported lazily so local dev never needs the connector installed.
#         from google.cloud.sql.connector import Connector, IPTypes

#         connector = Connector()

#         def getconn():
#             return connector.connect(
#                 instance,
#                 "pg8000",
#                 user=os.environ["DB_USER"],
#                 password=os.environ["DB_PASS"],
#                 db=os.environ["DB_NAME"],
#                 ip_type=IPTypes.PRIVATE if os.getenv("DB_PRIVATE_IP") else IPTypes.PUBLIC,
#             )

#         # The connection is supplied by `creator`, so the URL has no host part.
#         return create_engine("postgresql+pg8000://", creator=getconn, pool_pre_ping=True)

#     # ── Local dev: DATABASE_URL if given, else a SQLite file ─────────────────
#     url = os.getenv("DATABASE_URL", "sqlite:///./cukai.db")
#     connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
#     return create_engine(url, connect_args=connect_args, pool_pre_ping=True)

# engine = _build_engine()

# # autoflush=False keeps queries predictable; commit explicitly in endpoints.
# SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


# def get_db():
#     """FastAPI dependency — yields a session and always closes it.

#     Usage:  def endpoint(db: Session = Depends(get_db)): ...
#     """
#     db = SessionLocal()
#     try:
#         yield db
#     finally:
#         db.close()


# def init_db():
#     """Create every table that doesn't exist yet.

#     Fine for the capstone / first run. For schema *changes* over time, switch to
#     Alembic migrations rather than dropping and recreating.
#     """
#     import models  # noqa: F401  — registers all models on Base.metadata
#     Base.metadata.create_all(bind=engine)

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
  Base.metadata.create_all(bind=engine)