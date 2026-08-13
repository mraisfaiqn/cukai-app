# cukai

AI-assisted tax compliance for Malaysia's sole proprietors, built for the ~300,000+ new sole proprietorships registered every year (SSM, 2022–2024) who file **Form B** with no in-house accountant and no time to track LHDN's rules on the side.

> Less tax stress. More peace of mind.

## What this is

Malaysia's personal relief system spans 22+ LHDN categories (Form B, H2–H21), each with its own statutory caps, multi-year eligibility windows, and 7 years of mandatory record-keeping. Most existing Malaysian tax apps are built for salaried Form BE filers: they categorize receipts, but none model business income, capital allowance schedules, or Form B logic in detail.

**cukai** is a full-stack platform that does the deeper work. It classifies every document a sole proprietor uploads, computes what LHDN actually requires deterministically (not by guessing), and proactively tells the user what needs attention before a deadline is missed.

## How it works

1. **Upload**: a receipt, invoice, or LHDN notice comes in (web app or browser extension)
2. **Extract**: text and figures are pulled from the document
3. **Classify**: sorted into one of 30+ tax categories across a deterministic taxonomy (see below)
4. **Dispatch**: routed to the matching relief/tax module
5. **Compute & flag**: the relief or figure is calculated by a rules engine; anything legally ambiguous is flagged for human review instead of silently assumed

Every step is traceable: a figure on Form B can always be walked back to the exact document it came from.

## The classification taxonomy

Documents are sorted into four core "quadrants," plus six buckets that exist outside them:

| Quadrant | What it covers | Feeds |
|---|---|---|
| **Q1** | Business income (s.4(a) trade income) | B1 (statutory business income) |
| **Q2** | Personal income (s.4(b)–(f): employment, rental, dividends, interest) | The relevant personal-income lines on Form B |
| **Q3** | Business expense (s.33(1) / Schedule 3: COGS, rent, payroll, capital allowance) | Reduces business income before B1 is arrived at |
| **Q4** | Personal relief (H2–H21: insurance, medical, education, lifestyle) | B23 → B24 |

Outside the quadrants: **Donations** (Part G, before B24), **Tax Installments** (feeds B33, money already paid), **Rebates** (cuts the tax bill directly, B27/B29), **Reference** (never summed; bank statements, prior-year filings, disposals that feed other parts of the form), **Non-Tax** (zero financial content), and **Review** (genuinely ambiguous, needs a human).

Every category also carries *how* its amount is computed, whether that's a direct per-document sum, a multi-year registry lookup (capital allowance, breastfeeding relief, CP500), or a ledger match (bank statements). Mixed-use categories (client entertainment, gifts, vehicle expenses) carry an apportionment rule so the right percentage is applied automatically.

## What the engine actually computes

Unlike a receipt scanner, the rules engine models the *shape* of each relief, not just its category:

- **Progressive tax brackets**: YA-specific bracket tables, B25a/B25b breakdown, and bracket-headroom guidance
- **Capital allowance**: Schedule 3 Initial/Annual Allowance schedules, written-down value, balancing allowance/charge on disposal
- **Loss & capital allowance carryforward**: FIFO loss vintages with their own 10-year expiry (s.44(5F)), unabsorbed capital allowance with no expiry
- **CP500 reconciliation**: distinguishes an installment *notice* from a *payment*, and correctly excludes prior-year installments from the current year's B33
- **Child relief (H16)**: age/disability/education tiering, joint-custody eligibility splits, and the s.48(5) own-income disallowance test
- **Breastfeeding relief**: the "once every 2 years" gate, simulated chronologically so one blocked year never cascades into blocking every year after it
- **One-time reliefs**: food waste compost/grinder machines, home CCTV (claim-once-per-window), and departure levy (2-trips-lifetime cap)

Every multi-year rule is **re-derived from the full claim history on every call**, never stored as a standalone figure. Correcting one year's document automatically corrects every other affected year.

## Proactive insights, not just storage

A rule engine + LLM continuously re-evaluates a user's full document history to surface deadline alerts, missed-relief opportunities, and document gaps as dismissible cards. Cards are deduplicated, so re-running the engine updates a card in place instead of spamming a new one, and version-stamped, so a change in tax rules automatically flags stale figures for re-scoring rather than silently serving outdated numbers.

**Design principle: the LLM explains, the rules engine decides.** Every ringgit figure comes from deterministic tax code; the LLM is only ever used to classify documents and phrase explanations in plain English, never to compute a number.

## Platform

- **Web app**: dashboard, document manager, insights inbox, AI chat assistant, profile/entity management, Form B generation
- **Browser extension**: a chrome-free side panel embedding the chat assistant and Form B values, sharing the web app's login session
- **Multi-entity support**: one person can manage multiple registered businesses from one account

## Tech stack

- **Frontend**: React 19, React Router 7, Tailwind CSS 4, Vite
- **Backend**: Python, FastAPI, Pydantic, SQLAlchemy
- **Relational data**: PostgreSQL, Google Cloud SQL in production, connected via a standard `postgresql://` URL (see the note in Deployment about the exact connection method)
- **Document store**: MongoDB Atlas, including vector search for retrieval-augmented context
- **AI**: Google Gemini (`google-genai`, `langchain-google-genai`) for document classification and natural-language explanation, layered over a fully deterministic computation core
- **Document extraction/OCR**: Docling, EasyOCR
- **Auth**: bcrypt-based password hashing
- **Rate limiting**: SlowAPI

## Getting started

### Prerequisites

- Node.js (for the Vite/React frontend)
- Python 3.11 (matches the production Docker image)
- A PostgreSQL database (Google Cloud SQL or local)
- A MongoDB Atlas cluster with a vector search index configured
- A Google Gemini API key

### Frontend

```bash
npm install
npm run dev      # starts the Vite dev server on http://localhost:5173
```

Other available scripts: `npm run build`, `npm run lint`, `npm run preview`.

### Backend

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

### Environment variables

Create a `.env` file in the backend directory:

```dotenv
ALLOWED_ORIGINS=http://localhost:5173

DB_USER="xxxx"
DB_PASSWORD="xxxx"
DB_HOST="xxxx"
DB_PORT="xxxx"
DB_NAME="xxxx"

GEMINI_API_KEY=xxxx

MONGODB_ATLAS_CLUSTER_URI="xxxx"
MONGO_DB_NAME=xxxx
MONGO_COLLECTION_NAME=xxxx
MONGO_VECTOR_INDEX_NAME=xxxx
```

| Variable | Purpose |
|---|---|
| `ALLOWED_ORIGINS` | CORS allow-list for the frontend origin |
| `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME` | PostgreSQL connection (relational tax/insight data) |
| `GEMINI_API_KEY` | Google Gemini API key for document classification and explanation |
| `MONGODB_ATLAS_CLUSTER_URI` | MongoDB Atlas connection string (document storage) |
| `MONGO_DB_NAME`, `MONGO_COLLECTION_NAME` | Target database/collection for documents |
| `MONGO_VECTOR_INDEX_NAME` | Atlas Search vector index used for retrieval-augmented context |

> Note: adjust the `cd`/path steps above to match your actual repo layout (e.g. if frontend and backend live in separate subdirectories).

## Deployment

Production runs on Google Cloud: a static frontend on Firebase Hosting, a containerized backend on Cloud Run, and a managed PostgreSQL instance on Cloud SQL.

### Frontend: Firebase Hosting

1. Install the Firebase CLI globally:
   ```bash
   npm install -g firebase-tools
   ```
2. Log in (opens a Google login window in your browser):
   ```bash
   firebase login
   ```
3. From the frontend project root, initialize Hosting:
   ```bash
   firebase init
   ```
   - **Features**: Hosting
   - **Project setup**: use an existing project (create one first at [console.firebase.google.com](https://console.firebase.google.com/) if needed)
   - **Public directory**: `dist`
   - **Configure as a single-page app**: Yes (required for React Router)
   - **Set up automatic builds with GitHub**: optional, no if deploying manually
4. Build and deploy:
   ```bash
   npm run build
   firebase deploy
   ```
   You'll get a live Hosting URL on success.

> If you deploy and still see the default Firebase welcome page, go to Project Settings in the Firebase Console, under "Your apps" click "Add app" and register a web app. You don't need to add the SDK scripts to your code, but registration can resolve deployment issues.

### Database: Google Cloud SQL (PostgreSQL)

1. Sign up for [Google Cloud Platform](https://cloud.google.com/) and enable billing (a free trial credit is available for new accounts).
2. Enable the **Cloud SQL Admin API**: *APIs & Services > Library > Cloud SQL Admin API > Enable*.
3. Create a PostgreSQL instance: *SQL > Create instance*, choose PostgreSQL, set an instance ID, password, and region.
4. Once created, create a database: *Databases > Create database*.
5. Note the instance's connection details from the instance's Overview page: its public IP address (if connecting directly) or its connection name in the format `project-id:region:instance-name` (if using a Unix socket or the Python Connector).
6. Set `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME` in your `.env` to match. On Cloud Run specifically, `DB_HOST` is typically the mounted Unix socket path (`/cloudsql/project-id:region:instance-name`) once the instance is attached to the service; outside Cloud Run, it's the instance's IP address with `DB_PORT=5432`.

### Backend: Google Cloud Run

1. **Containerize the app.** Add a `Dockerfile` to the backend root:
   ```dockerfile
   FROM python:3.11-slim
   WORKDIR /app
   COPY requirements.txt .
   RUN pip install --no-cache-dir -r requirements.txt
   COPY . .
   EXPOSE 8080
   CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
   ```
2. Add a `.dockerignore` so secrets and local artifacts never get built into the image:
   ```
   .env
   __pycache__/
   *.pyc
   .git/
   .gitignore
   venv/
   ```
3. **Build and push the image:**
   ```bash
   gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/cukai-backend
   ```
4. **Grant Cloud SQL access.** In *IAM & Admin*, find the default Compute Engine service account (`PROJECT_NUMBER-compute@developer.gserviceaccount.com`) and assign it the **Cloud SQL Client** role.
5. **Deploy**, attaching the Cloud SQL instance and passing your env vars:
   ```bash
   gcloud run deploy cukai-backend \
     --image gcr.io/YOUR_PROJECT_ID/cukai-backend \
     --platform managed \
     --region YOUR_REGION \
     --add-cloudsql-instances YOUR_PROJECT_ID:YOUR_REGION:YOUR_INSTANCE \
     --set-env-vars DB_USER="...",DB_PASSWORD="...",DB_HOST="/cloudsql/YOUR_PROJECT_ID:YOUR_REGION:YOUR_INSTANCE",DB_PORT="5432",DB_NAME="...",GEMINI_API_KEY="...",MONGODB_ATLAS_CLUSTER_URI="...",MONGO_DB_NAME="...",MONGO_COLLECTION_NAME="...",MONGO_VECTOR_INDEX_NAME="...",ALLOWED_ORIGINS="https://your-firebase-app.web.app"
   ```
   Cloud Run authenticates to Cloud SQL automatically via its service account (Application Default Credentials), no JSON key files needed. Replace every `YOUR_...` placeholder and the `...` values with your actual production values, and never commit real secrets to the repo.

> The exact `DB_HOST` value (Unix socket path vs. IP vs. Cloud SQL Python Connector) should match whatever `database.py` expects at the time you deploy; confirm against the current code before relying on this section.

## Project status

Built for Malaysian sole proprietors filing **Form B** (business income), a genuinely different, higher-complexity problem than the Form BE (salaried) tools already on the market. Foreign-source income and partnership income (B10/Part F/Part L, B2/B2a/HK-1B) are recognized but intentionally out of scope for v1; documents in those categories are captured and flagged for a tax agent rather than silently mis-summed.

---

*This project computes tax figures based on the Income Tax Act 1967 and LHDN's published guidance. It is a compliance aid, not a substitute for professional tax advice.*
