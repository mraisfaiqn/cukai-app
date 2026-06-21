
# Fills the database with our two demo users (personal and company profiles).
# Run from the project folder:   python -m app.seed
# It wipes the tables first, then creates fresh data (a clean reset).


from app.database import Base, SessionLocal, engine
from app.models import CompanyProfile, UserProfile


def run():
    # Wipe and rebuild the tables (this also applies any new columns).
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()

    # --- Company 1: Ixora Florist & Cafe (sole proprietor) ---
    ixora_cafe = CompanyProfile(
        company_code="CP-2023-002",
        company_name="Ixora Florist & Cafe",
        ssm="JM0987654-A",
        owners="Ixora Nadim (sole owner)",
        num_partners=1,
        partners="",                       # no partners for a sole proprietor
        mth_income=21500,
        anl_income=258000,
    )

    # --- Company 2: Wanderlens Travel & Media (partnership) ---
    wanderlens = CompanyProfile(
        company_code="CP-2023-001",
        company_name="Wanderlens Travel & Media",
        ssm="202301012345",
        owners="Josh Farash & Lee Chee Tat (50/50 partnership)",
        num_partners=2,
        partners="Josh Farash (primary),Lee Chee Tat",   # comma-separated
        mth_income=34000,
        anl_income=411500,
    )

    db.add(ixora_cafe)
    db.add(wanderlens)
    db.commit()   # save so each company gets its id number

    # --- User 1: Ixora Nadim (login: soleprop / cukai123) ---
    ixora = UserProfile(
        user_code="P0100",
        username="soleprop",
        full_name="Ixora Nadim",
        email="ixora.nadim@ixorafloristcafe.com",
        password="cukai123",
        phone="012-3456789",
        nric="900512-10-5566",
        marital="Single",
        children=0,
        disability=False,
        elder_support=False,
        entity_type="sole_proprietor",
        company_id=ixora_cafe.id,
    )

    # --- User 2: Josh Farash (login: partner / cukai123) ---
    josh = UserProfile(
        user_code="P0101",
        username="partner",
        full_name="Josh Farash",
        email="josh.farash@wanderlens.com",
        password="cukai123",
        phone="013-2233445",
        nric="850304-14-5231",
        marital="Married",
        children=2,
        disability=False,
        elder_support=True,
        entity_type="partnership",
        company_id=wanderlens.id,
    )

    db.add(ixora)
    db.add(josh)
    db.commit()
    db.close()

    print("Done! Created 2 users.")
    print("  soleprop / cukai123  (Ixora Nadim - sole proprietor)")
    print("  partner  / cukai123  (Josh Farash - partnership)")


if __name__ == "__main__":
    run()