"""
seed_tax_law.py — one-time (re-runnable) script to seed MongoDB with real
Malaysian tax-law reference chunks, so CukaiBot's RAG retrieval has actual
law/guidance to find — not just the user's own uploaded receipts.

This fills the gap that "Part 1: ingestion" in the team's architecture
diagram always assumed would exist (source="tax_law" chunks) but which
nothing had ever written until now: pipeline.py's embed_document_for_rag()
only ever embeds a user's own documents (source="document"). This script is
the other half — a manual/curated ingestion path for shared reference
material, since tax law doesn't come from a user's upload.

Each entry below is written from real, current LHDN/ITA 1967 guidance
(cross-checked against LHDN's own site plus several professional tax-advisory
sources — see the `source_note` on each entry). These are SUMMARIES in plain
language for RAG retrieval, not verbatim statute text — always verify
specifics against the official LHDN Public Ruling / Income Tax Act 1967
before relying on them for real filings.

Usage:
  cd backend
  python seed_tax_law.py            # insert all chunks (skips duplicates by topic tag)
  python seed_tax_law.py --wipe     # delete all existing tax_law chunks first, then re-seed

Chunks are written with user_id=None and entity_id=None, which mongo.py's
vector_search() already treats as "visible to every user" (see the
owner_filter $or clause) — that's the mechanism that makes these show up
for ANY user's chat questions, not just one account's.
"""

import sys

from dotenv import load_dotenv
load_dotenv()

import mongo
from embeddings import embed_texts, chunk_text

# Each topic becomes one Mongo chunk. Keep each `text` block focused on a
# single question/topic — this keeps embeddings specific, which is what
# gives good similarity scores at query time (mirrors why pipeline.py's
# build_rag_summary_text keeps document summaries short and factual rather
# than dumping raw OCR text).
TAX_LAW_ENTRIES = [
  {
    "topic": "broadband_business_expense",
    "category": "Business Expenses — Internet/Broadband",
    "text": (
      "Whether broadband/internet is deductible depends on how it is used. "
      "If a business subscribes to internet/broadband strictly for business "
      "purposes, it is deductible in full under Section 33(1) of the Income "
      "Tax Act 1967 as an outgoing wholly and exclusively incurred in the "
      "production of gross income — the same basis as any other operational "
      "expense (e.g. cloud hosting, software subscriptions). If the internet "
      "subscription is for personal/household use, it is NOT a business "
      "deduction — instead it falls under the individual Lifestyle Tax "
      "Relief category (up to RM2,500 combined with books, computers, "
      "smartphones, and similar digital lifestyle items), and only applies "
      "if the account is registered in the claimant's own name. Mixed-use "
      "broadband (partly business, partly personal, e.g. a home-based "
      "business) should be apportioned on a reasonable basis, with only the "
      "business-use portion deducted as a business expense and the "
      "remainder treated as personal. LHDN may request justification for "
      "the apportionment ratio used."
    ),
  },
  {
    "topic": "section_33_deduction_test",
    "category": "Section 33(1) ITA 1967 — General Deduction Rule",
    "text": (
      "Section 33(1) of the Income Tax Act 1967 has no fixed ringgit "
      "'deduction limit' — it is a qualitative test, not a numeric cap. It "
      "provides that a business's adjusted income is calculated by "
      "deducting from gross income 'all outgoings and expenses wholly and "
      "exclusively incurred... in the production of gross income'. Malaysian "
      "case law (e.g. Aspac Lubricants v Ketua Pengarah Hasil Dalam Negeri) "
      "establishes that 'wholly' refers to the quantum of money spent and "
      "'exclusively' refers to the motive/purpose of the expense — if an "
      "expense serves any purpose besides producing business income, it "
      "fails the exclusivity test. Section 33 must be read together with "
      "Section 39, which lists specific expenses that are NOT deductible "
      "even if they pass the s.33(1) test — for example: capital "
      "expenditure (buy a new machine — not deductible directly, claim "
      "Capital Allowance instead), depreciation, fines and penalties, "
      "donations to non-approved institutions, and private/domestic "
      "expenses. One specific numeric limit does exist within this "
      "framework: entertainment expenses are only 50% deductible unless "
      "they fall within specific exempted categories listed in the "
      "provisos to Section 39(1)(l), in which case they are 100% "
      "deductible."
    ),
  },
  {
    "topic": "einvoicing_phases_2026",
    "category": "e-Invoicing — LHDN MyInvois Rollout Phases",
    "text": (
      "Malaysia's e-Invoicing mandate (LHDN MyInvois system) is rolled out "
      "in phases based on a business's annual turnover, referenced against "
      "FY2022 audited financial statements (or latest available year for "
      "newer businesses). Phase 1 (turnover > RM100 million): mandatory "
      "from 1 August 2024. Phase 2 (turnover RM25 million-RM100 million): "
      "mandatory from 1 January 2025. Phase 3 (turnover RM5 million-RM25 "
      "million): mandatory from 1 July 2025. Phase 4 (turnover RM1 "
      "million-RM5 million): mandatory from 1 January 2026, with a "
      "relaxation period allowing simplified compliance (consolidated "
      "e-invoices, manual MyInvois Portal upload) before stricter "
      "enforcement begins. On 6 December 2025 the Cabinet raised the "
      "permanent exemption threshold from RM500,000 to RM1,000,000 annual "
      "turnover, and cancelled the previously planned Phase 5 (which would "
      "have covered the RM500k-RM1m band) — Phase 4 is now the final "
      "mandatory phase. Businesses below the RM1 million threshold are "
      "exempt but may opt in voluntarily. New businesses incorporated from "
      "2023 onwards that cross RM1 million in turnover generally become "
      "subject to e-Invoicing from 1 July 2026. A special tax deduction of "
      "up to RM50,000 per year (YA2024-YA2027) is available for e-Invoicing "
      "implementation costs (software, integration, training), and "
      "accelerated capital allowance (2-year claim period) applies to "
      "related ICT equipment."
    ),
  },
  {
    "topic": "medical_relief_parents",
    "category": "Personal Tax Relief — Medical Expenses for Parents",
    "text": (
      "Individual taxpayers can claim tax relief of up to RM8,000 per year "
      "for medical treatment, dental treatment, and carer expenses for "
      "their parents (father and/or mother), including hospital stays, "
      "outpatient treatment, specialist consultations, dialysis, "
      "physiotherapy, and nursing home or home-based care certified by a "
      "registered medical practitioner. This RM8,000 cap is SEPARATE from "
      "the RM10,000 medical relief for the taxpayer's own/spouse's/"
      "children's serious diseases and fertility treatment — they are not "
      "combined. Eligibility: the parent(s) must be resident in Malaysia; "
      "there is no strict age requirement stated for the medical-expense "
      "relief itself (a related but separate relief — the RM1,500 "
      "'parental care' relief for parents aged 60+ with income below a "
      "threshold — has its own age condition). Only ONE child may claim "
      "medical expenses for a given parent in a year of assessment — "
      "siblings supporting the same parent should coordinate and let the "
      "sibling with the highest marginal tax rate make the claim, as the "
      "relief is more valuable at higher tax brackets. Original receipts "
      "and, where applicable, a medical practitioner's letter/diagnosis "
      "confirmation must be kept for 7 years in case of an LHDN audit, "
      "although receipts are not submitted at the time of e-Filing."
    ),
  },
  {
    "topic": "lifestyle_relief_personal",
    "category": "Personal Tax Relief — Lifestyle Relief",
    "text": (
      "Individual taxpayers can claim the Lifestyle Tax Relief of up to "
      "RM2,500 per year, covering a combined basket of: purchase of books "
      "(including e-books), purchase of a personal computer, smartphone, or "
      "tablet (for personal use, not a business asset), monthly internet "
      "subscription (broadband or mobile data — must be registered in the "
      "claimant's own name; only the data/internet portion of a mobile plan "
      "qualifies, not the calls/SMS portion), and skill-improvement or "
      "personal development course fees. This RM2,500 is a SHARED ceiling "
      "across all these categories combined, not RM2,500 per item. Separate "
      "from this: (1) an additional RM2,500 relief specifically for "
      "purchase of a personal computer, smartphone, or tablet was a "
      "time-limited COVID-era measure and should be verified for current "
      "applicability; (2) sports-related expenses (gym memberships, sports "
      "equipment, facility rental, competition registration) have their own "
      "separate RM1,000 (or RM500 in some years — verify current YA figure) "
      "cap, distinct from the general Lifestyle Relief; (3) a separate "
      "RM2,500 relief exists for electric vehicle charging equipment and "
      "domestic food-waste composting machines. Receipts must show the "
      "claimant's name and are not submitted at filing time but must be "
      "kept for 7 years for audit purposes."
    ),
  },
  {
    "topic": "form_b_filing_deadline",
    "category": "Filing Deadlines — Form B",
    "text": (
      "Form B is the annual income tax return for individuals with business "
      "income (sole proprietors, freelancers, partners, and anyone with "
      "non-employment income such as commissions or rental income), as "
      "opposed to Form BE which is for employment-income-only taxpayers. "
      "The statutory Form B deadline is 30 June of the year following the "
      "assessment year (e.g. YA2025 Form B is due 30 June 2026), with an "
      "extended grace period to 15 July when filed electronically via the "
      "MyTax e-Filing portal. From YA2024 onwards, manual/paper filing of "
      "Form B is no longer accepted — submission must be via MyTax "
      "e-Filing. Any balance of tax owed for the year is due by the same "
      "deadline as the form itself; filing on time but paying late still "
      "triggers a Section 103 surcharge of 10% immediately, plus a further "
      "5% if still unpaid after 60 days. Late filing (missing the deadline "
      "even by one day) is a separate offence under Section 112 of the "
      "Income Tax Act 1967, carrying a fine of RM200 to RM20,000, "
      "imprisonment of up to 6 months, or both. A business must file Form B "
      "even if it made a loss or had zero income in the year — failing to "
      "file at all is itself what typically triggers LHDN audit attention, "
      "separate from any tax actually owed."
    ),
  },
  {
    "topic": "capital_allowance_rates",
    "category": "Capital Allowance — Rates by Asset Class",
    "text": (
      "Capital Allowance (Schedule 3, Income Tax Act 1967) is the tax "
      "equivalent of depreciation for business assets — capital "
      "expenditure on plant, machinery, and equipment cannot be deducted "
      "directly under Section 33; instead it is recovered gradually via "
      "Capital Allowance, split into Initial Allowance (IA, a one-time "
      "deduction in the year the asset is acquired and brought into "
      "business use) and Annual Allowance (AA, a recurring yearly "
      "deduction until the asset's cost is fully written off). General "
      "rates by asset class: Heavy machinery — 20% IA, 20% AA. Motor "
      "vehicles — 20% IA, 20% AA (non-commercial passenger vehicles have "
      "qualifying expenditure capped at RM50,000, or RM100,000 if new and "
      "costing RM150,000 or less). General plant and machinery (e.g. air "
      "conditioners, medical/lab equipment) — 20% IA, 14% AA. Office "
      "equipment, furniture and fittings ('Others' category) — 20% IA, 10% "
      "AA. ICT equipment and computer software — accelerated rates commonly "
      "apply (e.g. 20% IA / 40% AA), allowing full write-off in as little "
      "as 2 years — verify the current-year rate, as this has been "
      "adjusted by several Budget announcements and e-Invoicing-linked "
      "incentives. Unabsorbed capital allowance can be carried forward "
      "indefinitely but only against income from the same underlying "
      "business source. Buildings and intangible assets generally do not "
      "qualify for standard Capital Allowance (Industrial Building "
      "Allowance is a separate regime)."
    ),
  },
  {
    "topic": "entertainment_expense_limit",
    "category": "Business Expenses — Entertainment Expense Deduction",
    "text": (
      "Entertainment expenses are a specific carve-out under Section "
      "39(1)(l) of the Income Tax Act 1967: even though an entertainment "
      "expense may be 'wholly and exclusively incurred in the production of "
      "gross income' under Section 33(1), only 50% of it is deductible by "
      "default. Full 100% deduction is only available where the "
      "entertainment expense falls within one of the specific exempted "
      "categories in the provisos to Section 39(1)(l) — these generally "
      "include: entertainment provided to employees (e.g. a staff dinner or "
      "annual function), entertainment where the recipient pays a "
      "consideration equal to or greater than the cost (e.g. a paid "
      "corporate event), promotional gifts/samples given to the public in "
      "the ordinary course of business, and entertainment directly related "
      "to sales (e.g. hosting a client to demonstrate or promote goods for "
      "sale). Client entertainment that is purely for goodwill or "
      "relationship-building (e.g. taking a client to dinner with no direct "
      "sales/promotional purpose) typically falls under the default 50% "
      "restriction. LHDN's Public Ruling No. 4/2015 sets out the detailed "
      "steps for classifying entertainment expenses: first confirm the "
      "expense meets the Section 18 definition of 'entertainment', then "
      "check whether it falls within a Section 39(1)(l) proviso category "
      "for full deduction, and if not, apply the default 50% restriction."
    ),
  },
  {
    "topic": "sme_preferential_tax_rate",
    "category": "Corporate Tax — SME Preferential Rate",
    "text": (
      "Malaysia's standard corporate income tax rate is 24% (for resident "
      "and non-resident companies). Qualifying SMEs benefit from a "
      "preferential tiered rate structure instead: 15% on the first "
      "RM150,000 of chargeable income, 17% on chargeable income from "
      "RM150,001 up to RM600,000, and the standard 24% rate applies to any "
      "chargeable income above RM600,000. To qualify as an SME for this "
      "preferential rate, a company must be a Malaysian tax resident, have "
      "paid-up capital of RM2.5 million or less at the beginning of the "
      "basis period, and have gross business income of not more than RM50 "
      "million for the year of assessment. Companies that are part of a "
      "group where a related company does not meet these conditions may be "
      "disqualified from SME status (anti-fragmentation rules). New SMEs "
      "may additionally qualify for a tax rebate of 20% on the first "
      "RM20,000 of chargeable income for their first three years of "
      "assessment. Non-resident companies and companies exceeding the "
      "paid-up capital or gross income thresholds are taxed at the flat 24% "
      "rate on all chargeable income, with no access to the tiered SME "
      "rates."
    ),
  },
  {
    "topic": "form_b_vs_form_be",
    "category": "Filing — Which Form Applies (Form B vs Form BE)",
    "text": (
      "Malaysia's two main individual income tax return forms are "
      "distinguished by income type, not income amount. Form BE applies to "
      "resident individuals whose income is employment income ONLY — "
      "salary, bonuses, allowances, and benefits-in-kind from an employer, "
      "with no business, freelance, commission, or rental income. Form BE's "
      "deadline is 30 April, extended to 15 May via e-Filing. Form B "
      "applies to individuals who have ANY business or non-employment "
      "income — this includes sole proprietors, freelancers and gig "
      "workers, partners in a partnership (who report their share via Form "
      "B even though the partnership itself files a separate informational "
      "Form P), and anyone earning rental income or commissions outside "
      "formal employment. Critically, having a salary AND a side business "
      "or freelance income means the individual must use Form B, not Form "
      "BE — using the wrong form is one of the most common taxpayer "
      "mistakes and can trigger LHDN correspondence or penalties. Form B's "
      "deadline is 30 June, extended to 15 July via e-Filing. Only "
      "expenses that are 'wholly and exclusively' for business purposes may "
      "be deducted against business income reported on Form B — personal "
      "expenses are never deductible, only claimable as personal reliefs "
      "(which both Form B and Form BE filers can claim against their "
      "overall chargeable income)."
    ),
  },
]


def main():
  wipe = "--wipe" in sys.argv

  if wipe:
    collection = mongo.get_chunks_collection()
    result = collection.delete_many({"source": "tax_law"})
    print(f"Wiped {result.deleted_count} existing tax_law chunk(s).")

  collection = mongo.get_chunks_collection()

  for entry in TAX_LAW_ENTRIES:
    # Skip topics that already have at least one chunk, so re-running this
    # script (e.g. after adding a new topic to the list above) doesn't
    # duplicate existing entries. Use --wipe first if you want to
    # regenerate everything from scratch (e.g. after editing entry text).
    existing = collection.count_documents({"source": "tax_law", "topic": entry["topic"]})
    if existing > 0:
      print(f"Skipping '{entry['topic']}' — {existing} chunk(s) already present.")
      continue

    chunks = chunk_text(entry["text"])

    vectors = embed_texts(chunks, task_type="retrieval_document")

    for chunk, vector in zip(chunks, vectors):
      mongo.insert_chunk(
        text=chunk,
        embedding=vector,
        user_id=None,      # None = visible to every user (see vector_search's owner_filter)
        entity_id=None,
        source="tax_law",
        category=entry["category"],
        topic=entry["topic"],
      )

    print(f"Inserted '{entry['topic']}' ({len(chunks)} chunk(s)).")

  total = collection.count_documents({"source": "tax_law"})
  print(f"\nDone. {total} tax_law chunk(s) now in {mongo.MONGO_DB_NAME}.{mongo.MONGO_COLLECTION_NAME}.")


if __name__ == "__main__":
  main()
