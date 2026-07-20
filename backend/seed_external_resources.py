"""
seed_external_resources.py — download real, official Malaysian tax-law
source documents (LHDN Public Rulings, the Income Tax Act 1967, e-Invoice
Guidelines), extract their text, chunk and embed them, and store the result
across both databases:

  PostgreSQL (ExternalResource table) — the catalog: what document is this,
    where did it come from, when was it downloaded/embedded, is it current
    or superseded. One row per source document.

  MongoDB (document_chunks collection, source="external_resource") — the
    actual embedded text chunks used for RAG retrieval, keyed back to their
    ExternalResource row via external_resource_id. Lives in the SAME
    collection as user receipts (source="document") — see mongo.py's
    module docstring for why one collection holds both rather than
    splitting them apart.

This is the "download real documents from the internet and index them"
half of CukaiBot's reference-material pipeline (give CukaiBot real
material to retrieve for general tax-law questions, sourced verbatim from
official documents rather than summarized). A companion hand-written-
summary pool (source="tax_law", via the now-removed seed_tax_law.py) used
to exist alongside this one, but was retired once this pool had real
Act/Ruling coverage of its own — see mongo.py's module docstring for the
full rationale. Everything gets searched together at chat time via
mongo.search_user_and_reference_chunks()'s two-level diversified retrieval.

Usage:
  cd backend
  python seed_external_resources.py                 # download + ingest anything not yet done
  python seed_external_resources.py --refresh PR-4-2015   # re-download + re-embed one resource
  python seed_external_resources.py --list           # show catalog status, no downloads

Downloaded PDFs are cached in backend/external_resources_cache/ so re-runs
don't re-download unchanged files — only re-parses/re-embeds if the chunks
are missing from Mongo.
"""

import argparse
import logging
import os
import sys
from datetime import date, datetime, timezone

import requests
from dotenv import load_dotenv
from pypdf import PdfReader

load_dotenv()

import mongo
from database import SessionLocal, init_db
from models import ExternalResource
from embeddings import chunk_text, embed_texts

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("seed_external_resources")

CACHE_DIR = os.path.join(os.path.dirname(__file__), "external_resources_cache")

# Real, verified, publicly downloadable LHDN documents — see the reference_no
# field for a stable identifier used for --refresh and de-duplication.
# `category` groups the document by the topic it's meant to help answer.
#
# All 7 URLs below were individually fetched and confirmed live (July 2026).
# Two of them — PR-4-2015 and PR-6-2015 — were previously thought to be
# unavailable: their only known copies were on phl.hasil.gov.my, a legacy
# LHDN subdomain that is now down. It turned out LHDN had in fact re-hosted
# both (along with the others) on the current www.hasil.gov.my/wp-content/
# uploads/ CDN, just under a different path pattern than the /media/ one
# used for newer Public Rulings — they just hadn't been re-linked from the
# public Public Rulings index page yet at the time of the original check.
EXTERNAL_RESOURCES = [
  {
    "reference_no": "ACT-53",
    "resource_type": "act",
    # NOTE (verified July 2026): LHDN moved this off the old wp-content/
    # uploads/ path — that URL now 404s. The current live copy sits under a
    # random-token /media/ path that LHDN can rotate again without notice
    # (this is why FALLBACK_INDEX_URL below exists — see its docstring).
    "title": "Income Tax Act 1967 (Act 53)",
    "category": "Primary Legislation — Sections 33 & 39 (General Deductions)",
    "source_url": "https://www.hasil.gov.my/wp-content/uploads/20240521-akta-cukai-pendapatan-1967-akta-53.pdf",
    "date_issued": "2024-05-21",
  },
  {
    "reference_no": "PR-4-2015",
    "resource_type": "public_ruling",
    "title": "Entertainment Expense",
    "category": "Entertainment Expense Deduction (50%/100% split)",
    "source_url": "https://www.hasil.gov.my/wp-content/uploads/PR_4_2015.pdf",
    "date_issued": "2015-07-29",
  },
  {
    "reference_no": "PR-6-2015",
    "resource_type": "public_ruling",
    "title": "Qualifying Expenditure And Computation Of Capital Allowances",
    "category": "Capital Allowance Rates",
    "source_url": "https://www.hasil.gov.my/wp-content/uploads/PR_6_2015.pdf",
    "date_issued": "2015-08-27",
  },
  {
    "reference_no": "PR-6-2022",
    "resource_type": "public_ruling",
    "title": "Accelerated Capital Allowance",
    "category": "Capital Allowance Rates — ICT/Accelerated",
    "source_url": "https://www.hasil.gov.my/wp-content/uploads/pr_6_2022.pdf",
    "date_issued": "2022-12-22",
  },
  {
    "reference_no": "PR-7-2025",
    "resource_type": "public_ruling",
    "title": "Taxation Of A Resident Individual Part 1 - Gifts Or Contributions And Allowable Deductions",
    "category": "Personal Reliefs — Medical (Parents), Lifestyle",
    "source_url": "https://www.hasil.gov.my/wp-content/uploads/pr-7-2025.pdf",
    "date_issued": "2025-12-05",
  },
  {
    "reference_no": "PR-8-2025",
    "resource_type": "public_ruling",
    "title": "Tax Treatment for Micro, Small and Medium Companies",
    "category": "SME Preferential Tax Rate",
    "source_url": "https://www.hasil.gov.my/wp-content/uploads/pr-8-2025-tax-treatment-for-micro-small-and-medium-companies.pdf",
    "date_issued": "2025-12-22",
  },
  {
    "reference_no": "PR-5-2019",
    "resource_type": "public_ruling",
    "title": "Perquisites From Employment",
    "category": "Employment Income / Benefits In Kind (BIK) — Perquisites",
    "source_url": "https://www.hasil.gov.my/wp-content/uploads/PR_05_2019_2.pdf",
    "date_issued": "2019-11-19",
  },
  {
    "reference_no": "PR-11-2019",
    "resource_type": "public_ruling",
    "title": "Benefits In Kind",
    "category": "Employment Income / Benefits In Kind (BIK)",
    "source_url": "https://www.hasil.gov.my/wp-content/uploads/PR_11_2019.pdf",
    "date_issued": "2019-12-12",
  },
  {
    "reference_no": "PR-12-2018",
    "resource_type": "public_ruling",
    "title": "Income From Letting Of Real Property",
    "category": "Rental Income (s.4(a) business source / s.4(d) non-business source)",
    "source_url": "https://www.hasil.gov.my/wp-content/uploads/PR_12_2018.pdf",
    "date_issued": "2018-12-19",
  },
  {
    "reference_no": "PR-10-2016",
    "resource_type": "public_ruling",
    "title": "Industrial Buildings Part II",
    "category": "Capital Renovation & Fit-Out / Industrial Building Allowance",
    "source_url": "https://www.hasil.gov.my/wp-content/uploads/PR_10_2016.pdf",
    "date_issued": "2016-12-05",
  },
  {
    "reference_no": "PR-8-2016",
    "resource_type": "public_ruling",
    "title": "Industrial Buildings Part I",
    "category": "Capital Renovation & Fit-Out / Industrial Building Allowance",
    "source_url": "https://www.hasil.gov.my/wp-content/uploads/PR_08_2016.pdf",
    "date_issued": "2016-11-23",
  },
  {
    "reference_no": "PR-6-2019",
    "resource_type": "public_ruling",
    "title": "Tax Treatment On Expenditure For Repairs And Renewals Of Assets",
    "category": "Revenue Repairs & Maintenance",
    "source_url": "https://www.hasil.gov.my/wp-content/uploads/PR_06_2019.pdf",
    "date_issued": "2019-11-26",
  },
  {
    "reference_no": "PR-3-2021",
    "resource_type": "public_ruling",
    "title": "Special Allowances For Small Value Assets",
    "category": "Mixed-Use Vehicle / Motor Vehicle QE Cap — Small Value Asset Rules",
    "source_url": "https://www.hasil.gov.my/wp-content/uploads/PR_03_2021.pdf",
    "date_issued": "2021-07-21",
  },
  {
    "reference_no": "PR-3-2018",
    "resource_type": "public_ruling",
    "title": "Qualifying Expenditure And Computation Of Industrial Building Allowances",
    "category": "Capital Renovation & Fit-Out / Industrial Building Allowance",
    # Hosted on LHDN's legacy lampiran1 subdomain (not the wp-content/uploads/
    # CDN the rest of the LHDN-sourced entries in this catalog use) — still
    # live and serving the document as of the July 2026 check above.
    "source_url": "http://lampiran1.hasil.gov.my/pdf/pdfam/PR_03_2018.pdf",
    "date_issued": "2018-09-12",
  },
  {
    "reference_no": "EINV-GUIDE-4-7",
    "resource_type": "guideline",
    "title": "e-Invoice Guideline (Version 4.7)",
    "category": "e-Invoicing Phases & Requirements",
    "source_url": "https://www.hasil.gov.my/wp-content/uploads/IRBM-e-Invoice-Guideline.pdf",
    "date_issued": "2026-07-07",
  },
  {
    "reference_no": "EN-B-2024",
    "resource_type": "guideline",
    "title": "Explanatory Notes B 2024 — Resident Individual Who Carries On Business",
    "category": "Form B Filing Guidance — Reliefs, Deductions & Income Tax Computation",
    "source_url": "https://www.hasil.gov.my/wp-content/uploads/explanatory_notes_b2024_2.pdf",
    "date_issued": "2024-01-01",
  },
  {
    "reference_no": "ACT-874",
    "resource_type": "act",
    "title": "Finance Act 2025 (Act 874)",
    "category": "Primary Legislation — Amendments to the Income Tax Act 1967, RPGT Act 1976, Stamp Act 1949, Labuan Business Activity Tax Act 1990 & Petroleum (Income Tax) Act 1967",
    # NOTE: unlike every other entry above, this is NOT an LHDN document —
    # Act 874 is published by the Attorney General's Chambers (AGC), not
    # LHDN, so it doesn't belong under FALLBACK_INDEX_URL (LHDN's index)
    # and its citations shouldn't fall back as if it were an LHDN source.
    # See fallback_url/no_page_anchor below.
    #
    # source_url is deliberately the AGC's human-browsable act-detail page
    # rather than a direct PDF link: AGC serves the actual PDF through its
    # own in-page viewer (lom.agc.gov.my/act-detail.php?act=874), so there
    # is no stable direct-download URL to point a citation at — a user
    # clicking this citation lands on the same page a browser would show
    # them anyway, just via AGC's viewer instead of a raw PDF response.
    "source_url": "https://lom.agc.gov.my/act-detail.php?act=874&lang=BI",
    # download_url is the actual fetchable PDF, used only by download_pdf()
    # below — never shown to the user. AGC's own page can't be fetched
    # directly as a PDF (it's a JS-driven viewer wrapping the document), so
    # this HubSpot-hosted mirror is what ingestion actually downloads from.
    "download_url": "https://494075.fs1.hubspotusercontent-na1.net/hubfs/494075/compliance-portal/act-874-finance-act-2025.pdf",
    # AGC's own Federal Legislation portal home (not LHDN's perundangan/akta/
    # page) — the correct place to send someone if source_url ever 404s or
    # AGC reshuffles its act-detail.php query params again.
    "fallback_url": "https://lom.agc.gov.my/",
    # source_url is a viewer page, not a raw PDF response, so a "#page=N"
    # fragment appended to it would do nothing — see _chunks_to_citations
    # in main.py for where this suppresses that behavior.
    "no_page_anchor": True,
    "date_issued": "2025-12-31",
  },
]

# Some official guideline PDFs run to 100+ pages of largely procedural detail
# (API specs, XML schemas) that would dilute retrieval quality if embedded
# whole. For those, only a specific page range is ingested — the range
# covering the implementation-timeline/phases section relevant to the target
# questions. Omitted from this dict = ingest the whole document.
PAGE_RANGES = {
  "EINV-GUIDE-4-7": (1, 41),  # implementation timeline, overview, and validation sections;
                              # excludes Appendix 1-3 (raw field/org lists) and Glossary
}

# LHDN hosts every direct-download PDF under a random-token /media/<token>/
# path that it rotates without redirecting the old link (this is exactly
# what happened to ACT-53's source_url above — the wp-content/uploads/ path
# that used to work now 404s). A direct source_url can go stale at any time
# with no warning, so every citation that points at one also carries this
# human-browsable index page as a fallback: it's stable (same URL structure
# for years) and, unlike the direct PDF links, reliably loads in a browser.
# Frontend usage: if a click on sourceUrl 404s, the citation UI can offer
# this as "search the LHDN legislation index instead" rather than a dead end.
#
# This is the DEFAULT fallback, used for every resource whose catalog entry
# above doesn't set its own "fallback_url" — i.e. the LHDN-hosted ones. It's
# wrong for non-LHDN sources (e.g. ACT-874, published by the Attorney
# General's Chambers), which is why that entry sets its own fallback_url in
# EXTERNAL_RESOURCES instead of relying on this constant. See main.py's
# _chunks_to_citations for where a chunk's own stored fallback_url takes
# priority over this default.
FALLBACK_INDEX_URL = "https://www.hasil.gov.my/perundangan/akta/"


def download_pdf(url: str, dest_path: str) -> None:
  """Download a PDF to dest_path. Raises on non-200 or network failure —
  callers should catch and record the failure on the ExternalResource row
  rather than letting one bad download crash the whole ingestion run."""
  response = requests.get(url, timeout=60, headers={"User-Agent": "Mozilla/5.0 (cukai.ai RAG ingestion)"})
  response.raise_for_status()
  os.makedirs(os.path.dirname(dest_path), exist_ok=True)
  with open(dest_path, "wb") as f:
    f.write(response.content)


def extract_pdf_text(pdf_path: str, page_range: tuple[int, int] | None = None) -> str:
  """
  Extract text from a PDF using pypdf. If page_range is given (1-indexed,
  inclusive), only those pages are extracted — used for PAGE_RANGES entries
  above to avoid embedding hundreds of pages of procedural/schema detail
  that isn't useful for chat retrieval.

  Kept as-is (returns a single joined string, no page info) for anything
  that still just wants the plain text. extract_pdf_pages() below is the
  page-aware counterpart used by ingest_resource() so citations can link to
  the correct page — see that function's docstring for why a parallel
  function was added rather than changing this one's return type.
  """
  reader = PdfReader(pdf_path)
  start, end = (page_range[0] - 1, page_range[1]) if page_range else (0, len(reader.pages))
  end = min(end, len(reader.pages))

  parts = []
  for i in range(start, end):
    text = reader.pages[i].extract_text() or ""
    if text.strip():
      parts.append(text)
  return "\n\n".join(parts)


def extract_pdf_pages(pdf_path: str, page_range: tuple[int, int] | None = None) -> list[tuple[int, str]]:
  """
  Extract text from a PDF page-by-page, keeping each page's 1-indexed page
  number attached to its text — unlike extract_pdf_text(), which joins
  every page into one big string and loses that information.

  Returns a list of (page_number, page_text) tuples, one per non-blank page,
  in document order. page_number is 1-indexed to match how PDF viewers and
  the "#page=N" URL fragment (used later to deep-link citations) count
  pages, so no off-by-one translation is needed at the call site.

  This is what lets a chunk built later from this page's text know which
  page it came from — see build_page_lookup() for how a chunk's character
  offset in the joined text gets mapped back to one of these page numbers.
  """
  reader = PdfReader(pdf_path)
  start, end = (page_range[0] - 1, page_range[1]) if page_range else (0, len(reader.pages))
  end = min(end, len(reader.pages))

  pages = []
  for i in range(start, end):
    text = reader.pages[i].extract_text() or ""
    if text.strip():
      pages.append((i + 1, text))  # 1-indexed page number
  return pages


def join_pages_with_offsets(pages: list[tuple[int, str]]) -> tuple[str, list[tuple[int, int]]]:
  """
  Join per-page text (from extract_pdf_pages) into one string using the same
  "\\n\\n".join(...) separator extract_pdf_text() uses — so chunk_text() sees
  identical input either way and chunking behavior doesn't change — while
  also recording, for each page, the character offset in the joined string
  where that page's text starts.

  Returns (joined_text, offsets) where offsets is a list of
  (start_offset, page_number) tuples in ascending order of start_offset.
  build_page_lookup() below turns this into a fast "which page is character
  N in?" lookup.
  """
  parts = []
  offsets = []
  cursor = 0
  for i, (page_number, text) in enumerate(pages):
    offsets.append((cursor, page_number))
    parts.append(text)
    cursor += len(text)
    if i < len(pages) - 1:
      cursor += 2  # length of the "\n\n" separator join() will insert
  return "\n\n".join(parts), offsets


def page_for_offset(offsets: list[tuple[int, int]], char_offset: int) -> int | None:
  """
  Given the (start_offset, page_number) list from join_pages_with_offsets(),
  return which page a given character offset in the joined text falls on.
  Returns None if offsets is empty (e.g. extraction produced no pages).

  Uses a simple linear scan rather than bisect — offsets is at most a few
  hundred entries even for the full Income Tax Act, and this only runs once
  per chunk during ingestion, not on the hot chat-query path.
  """
  if not offsets:
    return None
  page_number = offsets[0][1]
  for start_offset, pn in offsets:
    if start_offset > char_offset:
      break
    page_number = pn
  return page_number


def ingest_resource(entry: dict, db, force: bool = False) -> None:
  """
  Download (if needed), extract, chunk, embed, and store one external
  resource. Updates its ExternalResource row throughout so progress/failure
  is visible in Postgres even if the process is interrupted partway through
  a long run.
  """
  reference_no = entry["reference_no"]
  row = db.query(ExternalResource).filter(ExternalResource.reference_no == reference_no).first()
  if row is None:
    date_issued = entry.get("date_issued")
    if isinstance(date_issued, str):
      date_issued = date.fromisoformat(date_issued)
    row = ExternalResource(
      reference_no=reference_no,
      resource_type=entry["resource_type"],
      title=entry["title"],
      category=entry["category"],
      source_url=entry["source_url"],
      date_issued=date_issued,
      status="pending",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
  else:
    # The EXTERNAL_RESOURCES catalog entry (this file) is the source of
    # truth for these fields, not whatever was in Postgres when the row was
    # first created — without this sync, editing a stale source_url here
    # (e.g. the ACT-53 URL fix, after LHDN rotated its /media/ path) would
    # only ever take effect for a row that doesn't exist yet. An existing
    # row would keep re-embedding chunks stamped with its old, cached
    # row.source_url below forever, even under --refresh, since force=True
    # only controls re-downloading/re-embedding — it never touched these
    # metadata columns on an existing row.
    date_issued = entry.get("date_issued")
    if isinstance(date_issued, str):
      date_issued = date.fromisoformat(date_issued)
    row.title = entry["title"]
    row.category = entry["category"]
    row.source_url = entry["source_url"]
    row.date_issued = date_issued
    db.commit()

  if row.status == "embedded" and not force:
    # `row.status` is only a cached belief, not a live fact — it's set once
    # at the end of a successful run (see the end of this function) and
    # nothing keeps it in sync if the Mongo collection is later dropped,
    # cleared, or partially deleted outside this script (e.g. `db.document_
    # chunks.deleteMany({})` in a Mongo shell, or restoring an older Mongo
    # snapshot without also resetting Postgres). Trusting the flag alone
    # would silently skip re-ingestion and leave the resource with zero
    # retrievable chunks — no error, just quietly missing from every future
    # chat answer. So before skipping, check Mongo itself, which is the
    # actual source of truth for what's retrievable.
    actual_chunk_count = mongo.count_chunks_for_external_resource(row.id)
    if actual_chunk_count > 0:
      logger.info(f"  Skipping {reference_no} — already embedded ({actual_chunk_count} chunks). Use --refresh to redo.")
      return
    logger.warning(
      f"  {reference_no} is marked 'embedded' in Postgres but has 0 chunks in Mongo "
      f"(collection likely dropped/cleared outside this script) — re-ingesting automatically."
    )
    # Fall through to the same ingestion path --refresh takes. `force` stays
    # False here on purpose: this resource still needs a full re-embed, but
    # other resources in the same run that are genuinely still embedded
    # shouldn't be forced to re-download/re-embed just because this one
    # drifted — force is a per-CLI-invocation flag, this drift check is
    # per-resource and shouldn't escalate into a blanket --refresh.

  cache_path = os.path.join(CACHE_DIR, f"{reference_no}.pdf")

  # Most resources are downloaded straight from source_url. A few (e.g.
  # ACT-874) have a source_url that's a human-browsable viewer page rather
  # than a raw PDF response — download_url, when present, is the actual
  # fetchable file used for ingestion instead. This keeps source_url free to
  # be "whatever URL a citation should send the user to" without that also
  # having to be a URL requests.get() can pull a PDF from. Existing entries
  # (no download_url key) are unaffected — they fall back to source_url,
  # same as before this field existed.
  fetch_url = entry.get("download_url") or entry["source_url"]

  try:
    # ── Download (skip if already cached, unless forced) ────────────────
    if force or not os.path.isfile(cache_path):
      logger.info(f"  Downloading {reference_no} from {fetch_url} ...")
      download_pdf(fetch_url, cache_path)
    row.local_path = cache_path
    row.status = "downloaded"
    row.downloaded_at = datetime.now(timezone.utc)
    db.commit()

    # ── Extract text (page-by-page, so each chunk can be traced back to a
    #    page — see extract_pdf_pages()/join_pages_with_offsets() docstrings
    #    for why this replaces the old "extract_pdf_text() -> one big
    #    string" approach that made page_number impossible to compute) ─────
    page_range = PAGE_RANGES.get(reference_no)
    pages = extract_pdf_pages(cache_path, page_range)
    text, page_offsets = join_pages_with_offsets(pages)
    if not text.strip():
      raise ValueError("No extractable text found in PDF (may be scanned/image-only).")

    # ── Chunk + embed ────────────────────────────────────────────────────
    chunks = chunk_text(text)

    # For each chunk, find its starting character offset in the joined
    # `text` and map that back to a source page number via page_offsets.
    # find() from a running cursor (rather than text.index each time) keeps
    # this correct even if the exact same sentence repeats verbatim
    # elsewhere in the document (e.g. a boilerplate phrase reused across
    # sections) — each chunk is looked up starting from where the previous
    # one was found, so occurrences are matched in document order.
    chunk_page_numbers: list[int | None] = []
    search_cursor = 0
    for chunk in chunks:
      # chunk_text() strips each chunk, so search for a normalized/whitespace
      # -insensitive match isn't needed: `chunk.text` is a verbatim substring
      # of `text` (post-strip), except right at start=0 where .strip() may
      # have trimmed leading text — find() still locates it correctly either
      # way.
      found_at = text.find(chunk.text, search_cursor)
      if found_at == -1:
        # Extremely defensive fallback: shouldn't happen since every chunk
        # is built as a literal slice of `text`, but if it ever does, don't
        # crash the whole ingestion run over a page-number lookup.
        found_at = search_cursor
      chunk_page_numbers.append(page_for_offset(page_offsets, found_at))
      search_cursor = found_at + 1  # allow overlapping chunks to re-match

    # How many chunks (if any) survived a previous partial run before it
    # hit a 429 that exhausted all retries? If this resource is mid-way
    # through ingestion (status="downloaded", some chunks already in Mongo
    # from a prior attempt), pick up from where it left off instead of
    # re-embedding and re-inserting chunks that already succeeded — this
    # matters most for large documents like the Income Tax Act 1967, where
    # a failure at chunk 900 of 1102 would otherwise mean redoing 900 calls.
    already_inserted = 0
    if force:
      deleted = mongo.delete_chunks_for_external_resource(row.id)
      if deleted:
        logger.info(f"  Removed {deleted} old chunk(s) before re-ingesting.")
    else:
      already_inserted = mongo.count_chunks_for_external_resource(row.id)
      if already_inserted:
        logger.info(f"  Resuming — {already_inserted} chunk(s) already embedded from a previous run.")

    remaining_chunks = chunks[already_inserted:]
    if not remaining_chunks:
      logger.info(f"  All {len(chunks)} chunk(s) already embedded, nothing to do.")
    else:
      logger.info(
        f"  Extracted {len(text)} chars -> {len(chunks)} chunk(s) total, "
        f"{len(remaining_chunks)} remaining. Embedding..."
      )

      # chunk_page_numbers was computed above against the full `chunks`
      # list; slice it the same way remaining_chunks was sliced so index i
      # below still lines up after a resumed (partial) run.
      remaining_page_numbers = chunk_page_numbers[already_inserted:]

      def _on_chunk_embedded(i: int, vector: list[float]) -> None:
        # Insert immediately rather than waiting for the whole batch, so
        # progress survives a later chunk's failure. Runs inside
        # embed_texts()'s loop, right after each individual embed succeeds.
        #
        # fallback_url/no_page_anchor come from `entry` (this file's catalog
        # dict), not `row` (the Postgres ExternalResource) — models.py has
        # no column for either, on purpose (see the plan this was built
        # from): they only ever need to be read back at chat-citation time
        # via the Mongo chunk itself (main.py's _chunks_to_citations), so
        # there's no need for a Postgres round-trip or migration to carry
        # them. entry.get(...) defaults both to None/False for every
        # existing catalog entry that doesn't set them, which is exactly
        # the old LHDN-fallback / page-anchor-on behavior.
        mongo.insert_chunk(
          text=remaining_chunks[i].text,
          embedding=vector,
          source="external_resource",
          external_resource_id=row.id,
          resource_type=row.resource_type,
          reference_no=row.reference_no,
          title=row.title,
          category=row.category,
          source_url=row.source_url,
          fallback_url=entry.get("fallback_url"),
          no_page_anchor=entry.get("no_page_anchor", False),
          page_number=remaining_page_numbers[i],
          starts_mid_sentence=remaining_chunks[i].starts_mid_sentence,
        )

      embed_texts(
        [c.text for c in remaining_chunks],
        task_type="retrieval_document",
        on_chunk_done=_on_chunk_embedded,
      )

    row.status = "embedded"
    row.chunk_count = len(chunks)
    row.embedded_at = datetime.now(timezone.utc)
    row.error_message = None
    db.commit()
    logger.info(f"  Done — {reference_no}: {len(chunks)} chunk(s) embedded.")

  except Exception as e:
    # Even on failure, record how far we got — count_chunks_for_external_resource
    # will show a re-run how many chunks can be skipped next time.
    row.status = "failed"
    row.error_message = str(e)[:2000]
    db.commit()
    inserted_so_far = mongo.count_chunks_for_external_resource(row.id)
    logger.error(
      f"  FAILED {reference_no}: {e}\n"
      f"  {inserted_so_far} chunk(s) were embedded before the failure and are "
      f"kept — re-running without --refresh will resume from there."
    )


def list_catalog(db) -> None:
  rows = db.query(ExternalResource).order_by(ExternalResource.reference_no).all()
  if not rows:
    print("No external resources in the catalog yet. Run without --list to ingest.")
    return
  print(f"{'REFERENCE':<16} {'STATUS':<12} {'CHUNKS':<8} TITLE")
  print("-" * 90)
  for r in rows:
    print(f"{r.reference_no or '-':<16} {r.status:<12} {str(r.chunk_count or 0):<8} {r.title}")


def main():
  parser = argparse.ArgumentParser(description="Download and ingest official Malaysian tax-law reference documents.")
  parser.add_argument("--refresh", metavar="REFERENCE_NO", help="Re-download and re-embed one resource by reference_no.")
  parser.add_argument(
    "--fix-url", metavar="REFERENCE_NO",
    help=(
      "Patch only the source_url on an already-embedded resource's existing "
      "chunks, using the source_url currently in EXTERNAL_RESOURCES below — "
      "no re-download or re-embed. Use this instead of --refresh when only "
      "the hosting URL changed (e.g. LHDN rotated a /media/ path) and the "
      "document content itself is unchanged; --refresh would needlessly "
      "re-run the embedding API over every chunk just to update one string."
    ),
  )
  parser.add_argument("--list", action="store_true", help="Show catalog status without downloading anything.")
  args = parser.parse_args()

  init_db()  # ensure external_resources table exists
  db = SessionLocal()

  try:
    if args.list:
      list_catalog(db)
      return

    if args.fix_url:
      entry = next((e for e in EXTERNAL_RESOURCES if e["reference_no"] == args.fix_url), None)
      if not entry:
        print(f"Unknown reference_no '{args.fix_url}'. Known: {[e['reference_no'] for e in EXTERNAL_RESOURCES]}")
        sys.exit(1)
      row = db.query(ExternalResource).filter(ExternalResource.reference_no == args.fix_url).first()
      if not row:
        print(f"'{args.fix_url}' hasn't been ingested yet — run without flags (or --refresh) first.")
        sys.exit(1)
      row.source_url = entry["source_url"]
      db.commit()
      updated = mongo.update_source_url_for_external_resource(row.id, entry["source_url"])
      logger.info(
        f"Patched source_url for {args.fix_url} -> {entry['source_url']} "
        f"({updated} chunk(s) in Mongo, Postgres row updated)."
      )
      return

    if args.refresh:
      entry = next((e for e in EXTERNAL_RESOURCES if e["reference_no"] == args.refresh), None)
      if not entry:
        print(f"Unknown reference_no '{args.refresh}'. Known: {[e['reference_no'] for e in EXTERNAL_RESOURCES]}")
        sys.exit(1)
      logger.info(f"Refreshing {args.refresh}...")
      ingest_resource(entry, db, force=True)
      return

    logger.info(f"Ingesting {len(EXTERNAL_RESOURCES)} external resource(s)...\n")
    for entry in EXTERNAL_RESOURCES:
      logger.info(f"[{entry['reference_no']}] {entry['title']}")
      ingest_resource(entry, db, force=False)
      print()

    list_catalog(db)

  finally:
    db.close()


if __name__ == "__main__":
  main()