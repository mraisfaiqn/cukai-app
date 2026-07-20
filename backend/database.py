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
  # the explicit compatibility migration handles columns on existing tables.
  Base.metadata.create_all(bind=engine)
  from insights.migrations import apply_analysis_run_migration
  apply_analysis_run_migration(engine)
