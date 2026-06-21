# Cukai.ai — User Profiles (Login + Personal & Company pages)

This is the **profile** part of Cukai.ai: a returning user logs in, and sees
their **personal info page** and their **company info page**. It does *not* do
tax calculations or income/expense lists — those belong to the Dashboard.

Two demo users are included:

| Login username | Password | Who |
|---|---|---|
| `soleprop` | `cukai123` | Ixora Nadim — sole proprietor (Ixora Florist & Cafe) |
| `partner`  | `cukai123` | Josh Farash — partnership (Wanderlens Travel & Media) |

## What's inside

```
app/
  database.py   - connects to PostgreSQL
  models.py     - the two tables: user_profile, company_profile
  seed.py       - fills the database with Ixora and Josh
  main.py       - the web pages (login, personal profile, company profile)
templates/      - the HTML pages
static/         - the CSS styling
requirements.txt
```

## How to run it (Windows)

**1. Create the database** in pgAdmin: make a new database called `cukai_profiles`.

**2. Set your password:** copy `.env.example` to a new file called `.env`, and
put your real PostgreSQL password in it.

**3. Open a terminal in this folder and set up the environment (first time only):**
```
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

**4. Fill the database with the demo users (first time, or to reset):**
```
python -m app.seed
```

**5. Start the server:**
```
uvicorn app.main:app --reload
```

**6. Open in your browser:** http://127.0.0.1:8000
Log in with `soleprop` / `cukai123` (or `partner` / `cukai123`).

## Notes

- Login uses **POST** (not GET) because it sends a password — POST keeps the
  password out of the web address, which is safer.
- The demo passwords are stored as plain text for simplicity. In a real app
  they would be encrypted (hashed).
