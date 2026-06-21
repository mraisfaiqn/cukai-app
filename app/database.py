# database.py
# ----------------------------------------------------------------------------
# This file sets up the connection to our PostgreSQL database.
# Every other file that needs the database imports from here.
# ----------------------------------------------------------------------------

import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Load settings from the .env file, so the database password is not written
# directly in our code (safer, and easier to change).
load_dotenv()

# The address of our database. It is read from the .env file. If it's missing,
# the part after "or" is used as a fallback default.
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:password@localhost/cukai_profiles",
)

# The "engine" is the actual live connection to PostgreSQL.
engine = create_engine(DATABASE_URL)

# A "session" is one short conversation with the database (used to read/write).
SessionLocal = sessionmaker(bind=engine)

# "Base" is the parent class that our table classes (in models.py) inherit from.
Base = declarative_base()


# This helper hands each web request its own database session, then closes it
# afterwards so we don't leave connections open.
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
