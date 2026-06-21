
# Our two database tables, described as classes.
#   user_profile     = the personal info page
#   company_profile  = the company info page

from sqlalchemy import Boolean, Column, ForeignKey, Integer, String

from app.database import Base


# ---- The company's information ----
class CompanyProfile(Base):
    __tablename__ = "company_profile"

    id = Column(Integer, primary_key=True)
    company_code = Column(String)      # friendly ID, e.g. "CP-2023-001"
    company_name = Column(String)      # e.g. "Wanderlens Travel & Media"
    ssm = Column(String)               # SSM registration number
    owners = Column(String)            # owner text (used for sole proprietors)
    num_partners = Column(Integer)     # how many partners (1 for sole prop)
    partners = Column(String)          # partner list, comma-separated
    mth_income = Column(Integer)       # monthly income in RM
    anl_income = Column(Integer)       # annual income in RM


# ---- The person's information ----
class UserProfile(Base):
    __tablename__ = "user_profile"

    id = Column(Integer, primary_key=True)
    user_code = Column(String)         # personalised ID, e.g. "P0101"
    username = Column(String)          # short login name, e.g. "partner"
    full_name = Column(String)
    email = Column(String)             # real email address (for display)
    password = Column(String)          # plain text for this demo only
    phone = Column(String)
    nric = Column(String)              # NRIC / IC number
    marital = Column(String)           # "single" or "married"
    children = Column(Integer)         # number of children
    disability = Column(Boolean)       # is the person disabled?
    elder_support = Column(Boolean)    # supports a dependant (parent)?
    entity_type = Column(String)       # "sole_proprietor" or "partnership"
    company_id = Column(Integer, ForeignKey("company_profile.id"))