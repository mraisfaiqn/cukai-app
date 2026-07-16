"""
MongoDB Atlas Vector Search — long-term semantic memory for CukaiBot.

Where database.py/models.py hold PostgreSQL ("what did we just talk about in
THIS conversation" — structured, session-scoped), this module holds the other
half of the two-database RAG design: "which chunks are MEANINGFULLY RELATED
to what the user just asked" — unstructured, similarity-scored, and searched
by embedding rather than by exact match.

ONE collection (document_chunks) holds two kinds of chunk, distinguished by
`source`:
  - "document"          — a user's own uploaded receipt/invoice (pipeline.py)
  - "external_resource"  — real chunked text from official LHDN/AGC PDFs
                            (seed_external_resources.py)

A third kind, "tax_law" (hand-written topic summaries, via the now-removed
seed_tax_law.py), existed early on as a stand-in for real legal-source
coverage before external_resource had any actual ingested PDFs. Once
external_resource covered the same ground with real, page-citable source
text, tax_law's plain-language summaries added no unique value against the
maintenance cost of keeping a second, hand-curated corpus in sync — so the
whole pool was retired rather than merged in. If you find "tax_law" in git
history/old comments, it no longer exists as a live `source` value.

This started as two separate collections (document_chunks +
external_resource_chunks), each with its own Atlas index. That split wasn't
wrong, but it wasn't earning its cost either: MongoDB doesn't require every
document in a collection to share the same shape, `source` already existed
as exactly the right discriminator, and running two $vectorSearch calls plus
a Python-side merge on every chat message was more moving parts for no real
benefit over one collection with one index. Fields that only apply to one
kind of chunk (e.g. `reference_no`, `source_url` for external resources;
`doc_id`, `year_of_assessment` for receipts) are simply None on chunks where
they don't apply — a normal, common pattern for a schemaless store, not a
messy one: `source` alone tells you which fields to expect.

Collection shape (one document per embedded chunk) — union of all fields
used by either source; most are None on any given chunk:
  {
    "_id": ObjectId(...),
    "text": "Category: Business Expense, Office Supplies, RM150",
    "embedding": [0.0123, -0.0456, ...],   # 768 floats, gemini-embedding-001
    "source": "document",   # "document" | "external_resource"

    # source="document" (user receipts, via pipeline.py):
    "user_id": "42", "entity_id": 7, "doc_id": 913,
    "year_of_assessment": 2026, "category": "office_supplies",

    # source="external_resource" (real PDFs, via seed_external_resources.py):
    "external_resource_id": 3, "resource_type": "public_ruling",
    "reference_no": "PR-4-2015", "title": "Entertainment Expense",
    "source_url": "https://...", "fallback_url": "https://...",
    "no_page_anchor": False, "page_number": None,

    # source_url/file_type are also populated for source="document" chunks
    # (via pipeline.py's embed_document_for_rag) so CukaiBot can preview a
    # user's own uploaded receipt in-page instead of only citing it by name:
    #   "source_url": "/files/<uuid>_<original filename>",  # relative — the
    #        backend's own /files/ static mount, NOT an external LHDN link.
    #        Frontend prefixes this with its API base URL, same as
    #        fileBasename elsewhere (see main.py's _serialize_doc).
    #   "file_type": "pdf" | "image" | "excel",  # which renderer to use

    "created_at": "2026-07-11T08:00:00Z",
  }

user_id/entity_id are stored on every chunk and used as pre-filters on every
$vectorSearch query — this is the "Metadata is King" rule from the leader's
diagram: without it, one user's chat could retrieve another user's receipts.
external_resource chunks use user_id=None/entity_id=None, which the filter
below treats as "visible to every user" — shared reference material rather
than anything owned by a specific account.

Required Atlas setup (done once, in the Atlas UI or via ensure_vector_index()
below): a vector search index on `embedding` (dimensions=768, similarity=
cosine) with `user_id`, `entity_id`, and `resource_type` as filter fields.
"""

import logging
import os
from typing import Optional

from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.errors import PyMongoError

logger = logging.getLogger("uvicorn.error")

MONGODB_ATLAS_CLUSTER_URI = os.getenv("MONGODB_ATLAS_CLUSTER_URI")
MONGO_DB_NAME             = os.getenv("MONGO_DB_NAME", "cukai_rag")
MONGO_COLLECTION_NAME     = os.getenv("MONGO_COLLECTION_NAME", "document_chunks")
VECTOR_INDEX_NAME         = os.getenv("MONGO_VECTOR_INDEX_NAME", "vector_index")

# Must match the embedding model's output size (gemini-embedding-001,
# truncated to 768 via output_dimensionality — see embeddings.py).
EMBEDDING_DIMENSIONS = 768

_client: Optional[MongoClient] = None


def get_mongo_client() -> MongoClient:
  """Lazily create and cache a single MongoClient for the process. pymongo's
  client is itself a connection pool, so one instance is meant to be reused
  everywhere rather than opened per-request."""
  global _client
  if _client is None:
    if not MONGODB_ATLAS_CLUSTER_URI:
      raise EnvironmentError("MONGODB_ATLAS_CLUSTER_URI is not set.")
    _client = MongoClient(MONGODB_ATLAS_CLUSTER_URI)
  return _client


def get_chunks_collection() -> Collection:
  client = get_mongo_client()
  return client[MONGO_DB_NAME][MONGO_COLLECTION_NAME]


def ensure_vector_index() -> None:
  """
  Create the Atlas Vector Search index if it doesn't already exist, or patch
  it in place if it's missing a filter field this code now relies on. Safe
  to call on every startup (mirrors init_db() in database.py).

  Requires an Atlas cluster (M10+, or a free/shared tier that supports Search).
  This is a no-op on plain self-hosted MongoDB — Atlas Vector Search is an
  Atlas-only feature, and $vectorSearch calls will fail without it.

  Why the "patch in place" half exists: Atlas rejects any field named in a
  $vectorSearch `filter` clause that isn't explicitly declared as a
  type:"filter" field in the index definition — it does NOT silently ignore
  an un-indexed filter, it errors the whole aggregation ("Path 'source'
  needs to be indexed as filter"). When `source` was added as a filter
  parameter to vector_search() (for search_user_and_reference_chunks()'s
  split search), any Atlas cluster that already had this index from before
  that change started failing 100% of vector searches, since the old
  `if VECTOR_INDEX_NAME in existing: return` here meant the index was never
  touched again after its first creation. Detecting a missing required
  field and calling update_search_index() closes that gap for good — the
  next filter field added later won't require a manual Atlas Console visit
  either. Atlas rebuilds the index in the background on update; the OLD
  index keeps serving queries the whole time, so this is safe to run on
  every startup with no query downtime.
  """
  REQUIRED_FILTER_FIELDS = {"user_id", "entity_id", "resource_type", "source"}

  try:
    client = get_mongo_client()
    db = client[MONGO_DB_NAME]

    # On a brand-new Atlas cluster the collection may not exist yet — Atlas
    # can't attach a search index to a collection that isn't there. Creating
    # it explicitly (a no-op if it already exists) means the index is ready
    # from the very first startup, rather than only after the first chunk is
    # inserted and a restart happens to run this again.
    if MONGO_COLLECTION_NAME not in db.list_collection_names():
      db.create_collection(MONGO_COLLECTION_NAME)
      logger.info(f"[Mongo] Created collection {MONGO_DB_NAME}.{MONGO_COLLECTION_NAME}.")

    collection = get_chunks_collection()
    definition = {
      "fields": [
        {
          "type": "vector",
          "path": "embedding",
          "numDimensions": EMBEDDING_DIMENSIONS,
          "similarity": "cosine",
        },
        {"type": "filter", "path": "user_id"},
        {"type": "filter", "path": "entity_id"},
        {"type": "filter", "path": "resource_type"},
        {"type": "filter", "path": "source"},
      ]
    }

    existing_index = next(
      (idx for idx in collection.list_search_indexes() if idx["name"] == VECTOR_INDEX_NAME), None,
    )

    if existing_index is None:
      collection.create_search_index({
        "name": VECTOR_INDEX_NAME,
        "type": "vectorSearch",
        "definition": definition,
      })
      logger.info(f"[Mongo] Created vector search index '{VECTOR_INDEX_NAME}' on "
                  f"{MONGO_DB_NAME}.{MONGO_COLLECTION_NAME}.")
      return

    # Index already exists — check whether it's missing any filter field
    # this code now depends on. latestDefinition is what list_search_indexes()
    # actually returns the field list under (queuedDefinition would reflect
    # an update already in flight, so latestDefinition is the one to compare
    # against for "does the LIVE index support this filter yet").
    existing_fields = {
      f.get("path") for f in existing_index.get("latestDefinition", {}).get("fields", [])
      if f.get("type") == "filter"
    }
    missing = REQUIRED_FILTER_FIELDS - existing_fields
    if not missing:
      return

    logger.info(
      f"[Mongo] Vector search index '{VECTOR_INDEX_NAME}' is missing filter "
      f"field(s) {sorted(missing)} — updating it in place (Atlas rebuilds in "
      f"the background; the current index keeps serving queries until the "
      f"new one is ready)."
    )
    collection.update_search_index(VECTOR_INDEX_NAME, definition)
    logger.info(f"[Mongo] Requested update for vector search index '{VECTOR_INDEX_NAME}'.")
  except PyMongoError as e:
    # Non-fatal: log and continue. A missing/stale index means vector_search()
    # will return no results (or error) until it's created/updated manually
    # in Atlas, but it shouldn't take the whole API down at startup.
    logger.warning(f"[Mongo] Could not verify/create/update vector search index: {e}")


def insert_chunk(
  text: str,
  embedding: list[float],
  user_id: Optional[str] = None,
  entity_id: Optional[int] = None,
  source: str = "document",
  doc_id: Optional[int] = None,
  year_of_assessment: Optional[int] = None,
  category: Optional[str] = None,
  topic: Optional[str] = None,
  external_resource_id: Optional[int] = None,
  resource_type: Optional[str] = None,
  reference_no: Optional[str] = None,
  title: Optional[str] = None,
  source_url: Optional[str] = None,
  fallback_url: Optional[str] = None,
  no_page_anchor: bool = False,
  page_number: Optional[int] = None,
  file_type: Optional[str] = None,
  starts_mid_sentence: bool = False,
) -> str:
  """
  Insert one embedded chunk. Returns the inserted _id as a string.

  One function now covers both chunk kinds — pass only the fields relevant
  to the source you're inserting; the rest default to None:
    - source="document"          (pipeline.py):          user_id, entity_id, doc_id, year_of_assessment, category, source_url, file_type
    - source="external_resource"  (seed_external_resources.py): external_resource_id, resource_type, reference_no, title, source_url, fallback_url, no_page_anchor

  `topic` is a legacy field from the now-removed source="tax_law" pool
  (seed_tax_law.py). Nothing writes or reads it anymore — kept as a no-op
  optional param rather than removed outright, purely so any lingering
  external caller passing it doesn't hard-fail on a TypeError. Safe to
  delete entirely once you've confirmed nothing still passes it.

  `external_resource_id`/`reference_no` let seed_external_resources.py
  check "do I already have chunks for this resource?" without exact text
  matching, so it can re-run safely without duplicating entries. Document
  chunks (source="document") use doc_id as their natural de-dupe key
  instead.

  `source_url`/`file_type` are shared across both chunk kinds with different
  meanings: for source="external_resource" source_url is an absolute link to
  a real LHDN PDF. For source="document" (pipeline.py's
  embed_document_for_rag), source_url is instead a relative `/files/<basename>`
  path into this backend's own static mount, and file_type ("pdf" | "image" |
  "excel") tells the frontend which in-page renderer to use — this lets
  CukaiBot preview a user's own uploaded document inline instead of only
  citing it by name, without a second Postgres round-trip.

  `fallback_url` is stored per-chunk (rather than read from a single
  hardcoded constant at query time) because not every external_resource
  comes from LHDN — e.g. ACT-874 (Finance Act 2025) is sourced from the
  Attorney General's Chambers' Federal Legislation portal, whose own stable
  index page is a different URL than LHDN's. Left None for resources that
  should fall back to the shared LHDN index (main.py resolves that default).

  `no_page_anchor` is set True for resources whose source_url points at a
  page that can't honor a "#page=N" fragment — e.g. ACT-874's source_url is
  the AGC's act-detail.php page, which renders the PDF through its own
  in-page viewer rather than serving the raw file directly, so appending
  "#page=N" to it would do nothing useful (and could be misleading). See
  main.py's _chunks_to_citations for where this is read back.

  `starts_mid_sentence` comes straight from embeddings.chunk_text()'s Chunk
  tuple (see its docstring) — True when this chunk's start position could
  not be snapped to a sentence/clause boundary and almost certainly begins
  mid-sentence. Persisted so main.py's _chunks_to_citations() can prefix a
  citation snippet with "…" without re-deriving the boundary decision from
  scratch at read time (which would only be able to guess, not know). Chunks
  ingested before this field existed simply default to False on read (see
  the .get() in _chunks_to_citations) — under-flagging a few pre-existing
  chunks as "clean" is a much smaller cosmetic issue than mis-flagging new
  ones, and re-seeding will backfill the real value anyway.
  """
  from datetime import datetime, timezone

  collection = get_chunks_collection()
  result = collection.insert_one({
    "text": text,
    "embedding": embedding,
    "source": source,  # "document" | "external_resource"

    # source="document" fields
    "user_id": user_id,
    "entity_id": entity_id,
    "doc_id": doc_id,
    "year_of_assessment": year_of_assessment,
    "category": category,

    # legacy — see insert_chunk()'s docstring; no longer written by any caller
    "topic": topic,

    # source="external_resource" fields
    "external_resource_id": external_resource_id,
    "resource_type": resource_type,
    "reference_no": reference_no,
    "title": title,
    "source_url": source_url,
    "fallback_url": fallback_url,
    "no_page_anchor": no_page_anchor,
    "page_number": page_number,
    "file_type": file_type,
    "starts_mid_sentence": starts_mid_sentence,

    "created_at": datetime.now(timezone.utc),
  })
  return str(result.inserted_id)


def delete_chunks_for_document(doc_id: int) -> int:
  """Remove all chunks for a document — used when a document is deleted or
  re-classified, so stale embeddings don't keep surfacing in chat retrieval.
  Returns the number of chunks deleted."""
  collection = get_chunks_collection()
  result = collection.delete_many({"doc_id": doc_id})
  return result.deleted_count


def delete_chunks_for_external_resource(external_resource_id: int) -> int:
  """Remove all chunks for one external resource — used when re-ingesting a
  document (e.g. a Public Ruling gets superseded and re-downloaded) so stale
  chunks from the old version don't linger alongside the new ones. Returns
  the number of chunks deleted."""
  collection = get_chunks_collection()
  result = collection.delete_many({"external_resource_id": external_resource_id})
  return result.deleted_count


def count_chunks_for_external_resource(external_resource_id: int) -> int:
  """
  How many chunks currently exist for this resource. Used by
  seed_external_resources.py to resume a partially-ingested document after a
  failure (e.g. a 429 that survived all retries) — chunks are inserted one
  at a time as they're embedded (see ingest_resource's on_chunk_done
  callback), so this count reflects real progress even mid-document, not
  just whether ingestion fully completed.
  """
  collection = get_chunks_collection()
  return collection.count_documents({"external_resource_id": external_resource_id})


def update_source_url_for_external_resource(external_resource_id: int, new_source_url: str) -> int:
  """
  Patch source_url on every existing chunk for one external resource,
  without touching text/embedding/page_number — i.e. correct a citation link
  without re-downloading, re-chunking, or re-embedding anything.

  Exists because LHDN (and similar sources) sometimes rotate a document's
  hosting URL without changing the document itself (see the ACT-53 URL
  fix in seed_external_resources.py's EXTERNAL_RESOURCES catalog) — a full
  delete_chunks_for_external_resource() + re-ingest would re-run the
  embedding API over every chunk (1000+ calls for a document the size of
  the Income Tax Act) just to change one string field that's identical
  across all of them. seed_external_resources.py's --fix-url flag uses this
  instead for that case.

  Returns the number of chunks updated.
  """
  collection = get_chunks_collection()
  result = collection.update_many(
    {"external_resource_id": external_resource_id},
    {"$set": {"source_url": new_source_url}},
  )
  return result.modified_count


def vector_search(
  query_embedding: list[float],
  user_id: Optional[str],
  entity_id: Optional[int] = None,
  resource_type: Optional[str] = None,
  source: Optional[str] = None,
  top_k: int = 5,
  num_candidates: int = 100,
  min_score: Optional[float] = 0.72,
) -> list[dict]:
  """
  Run MongoDB Atlas's $vectorSearch aggregation, pre-filtered by user_id
  (and entity_id, when given) so retrieval never crosses between users.
  Shared reference chunks (external_resource, stored with user_id=None)
  always pass this filter regardless of which user is asking — that's the
  mechanism that makes CukaiBot's legal/tax-law knowledge visible to
  everyone while receipts stay private to their owner.

  `resource_type`, when given, additionally narrows results to one kind of
  external resource ("act" | "public_ruling" | "guideline") — optional, for
  callers that already know which kind of source is most relevant. Chunks
  with no resource_type (i.e. source="document") are excluded when this
  filter is active, so only pass it when you specifically want to search
  official documents alone.

  `source`, when given, narrows results to one top-level source type
  ("document" | "external_resource"). This is the filter
  search_user_and_reference_chunks() below uses to run the user's own
  documents and the shared law corpus as two separate searches — see that
  function's docstring for why a single pooled top_k across both is
  structurally biased against the user's own (much smaller) document set.

  `min_score` drops any result below this cosine-similarity score (Atlas
  reports cosine scores already mapped to 0-1, where 1.0 is identical and
  ~0.5 is unrelated/orthogonal) before returning. This exists because
  $vectorSearch's `limit` is a ceiling on how many results to return, not a
  relevance bar — it will always return top_k nearest neighbors even when
  none of them clear a reasonable bar for genuine relevance. Pass None to
  disable filtering (e.g. for diagnostics where every raw match is wanted).

  Returns up to top_k chunks (fewer, or none, if fewer than top_k clear
  min_score), each with a similarity `score` attached.
  """
  collection = get_chunks_collection()

  # Match either this user's own chunks, or shared (user_id=None) chunks —
  # covers external_resource chunks, since those use user_id=None.
  owner_filter = {"$or": [{"user_id": user_id}, {"user_id": None}]}
  if entity_id is not None:
    owner_filter = {"$and": [owner_filter, {"$or": [{"entity_id": entity_id}, {"entity_id": None}]}]}
  if resource_type is not None:
    owner_filter = {"$and": [owner_filter, {"resource_type": resource_type}]}
  if source is not None:
    owner_filter = {"$and": [owner_filter, {"source": source}]}

  pipeline = [
    {
      "$vectorSearch": {
        "index": VECTOR_INDEX_NAME,
        "path": "embedding",
        "queryVector": query_embedding,
        "numCandidates": num_candidates,
        "limit": top_k,
        "filter": owner_filter,
      }
    },
    {
      "$project": {
        "_id": 0,
        "text": 1,
        "source": 1,
        "doc_id": 1,
        "category": 1,
        "year_of_assessment": 1,
        "resource_type": 1,
        "reference_no": 1,
        "title": 1,
        "source_url": 1,
        "fallback_url": 1,
        "no_page_anchor": 1,
        "page_number": 1,
        "file_type": 1,
        "starts_mid_sentence": 1,
        "score": {"$meta": "vectorSearchScore"},
      }
    },
  ]

  # $vectorSearch has no native "only above this score" option — Atlas
  # computes the score via the $meta projection stage above, so the
  # threshold has to be applied as a post-filter on the returned documents
  # rather than inside the search stage itself.
  if min_score is not None:
    pipeline.append({"$match": {"score": {"$gte": min_score}}})

  try:
    return list(collection.aggregate(pipeline))
  except PyMongoError as e:
    logger.error(f"[Mongo] Vector search failed: {e}")
    return []


def search_user_and_reference_chunks(
  query_embedding: list[float],
  user_id: Optional[str],
  entity_id: Optional[int] = None,
  search_documents: bool = True,
  search_reference: bool = True,
  user_top_k: int = 3,
  reference_candidate_k: int = 50,
  reference_min_score: float = 0.80,
  reference_chunks_per_doc: int = 2,
  reference_max_docs: int = 5,
  num_candidates: int = 100,
  min_score: Optional[float] = 0.72,
) -> list[dict]:
  """
  Search the user's own uploaded documents (source="document") and the
  shared external_resource corpus (real LHDN/AGC PDFs — Acts, Public
  Rulings, guidelines) as two SEPARATE retrieval strategies, then merge and
  re-sort by score — instead of one pooled vector_search() call across
  everything.

  Why "document" stays a plain vector_search(): a single pooled top_k search
  is structurally biased toward whichever source has more chunks indexed,
  regardless of which one actually answers the question. A user's own
  uploaded Form EA might only produce a handful of chunks, and shouldn't be
  crowded out of its own top_k slots by the much larger external_resource
  corpus. Running it as its own pool guarantees it a fair, undiluted shot
  at user_top_k regardless of how large external_resource is.

  Why "external_resource" is NOT a plain vector_search(): the same crowding
  problem recurs *within* this pool once it holds several distinct
  documents (ACT-53, ACT-874, six Public Rulings, an e-Invoice guideline,
  and growing) — a plain top_k over all of them favors whichever single
  document happens to have the most individually-strong chunk matches,
  which can silently starve out a second, equally-relevant document (e.g.
  a comparison question naming two Public Rulings could return 5 chunks
  from one and 0 from the other, purely because that one's phrasing
  happened to embed slightly closer to the query). Instead this runs a
  two-level "retrieve wide, then diversify by document" strategy:

    1. Retrieve reference_candidate_k (default 50) nearest neighbors from
       external_resource — a much wider net than what's ultimately kept.
    2. Filter to reference_min_score (default 0.80) — stricter than the
       0.72 used elsewhere, because a 50-wide candidate pool will otherwise
       happily include genuinely mediocre matches just to fill the count;
       $vectorSearch's `limit` is a ceiling, not a relevance bar (see
       vector_search()'s docstring).
    3. Group the survivors by reference_no (the Act/Ruling/guideline
       identifier — e.g. "ACT-874", "PR-7-2025").
    4. Within each document, keep only its top reference_chunks_per_doc
       (default 2) chunks by score — this is what lets the LLM see
       multiple adjacent chunks from the same document (e.g. a definition
       plus the operative clause that uses it) without that document
       consuming the entire budget.
    5. Rank documents by their OWN best chunk's score (i.e. how well each
       document's strongest match did), and keep only the top
       reference_max_docs (default 5) documents.
    6. Return all kept chunks from those documents, flattened.

  This guarantees no single document can occupy every slot just by having
  many strong individual chunk matches, while still letting a genuinely
  dominant document contribute more than one chunk of context.

  `tax_law` no longer exists as a separate source — it was a parallel
  hand-written-summary pool (see git history / seed_tax_law.py, now
  removed) that predated external_resource having real ingested PDFs.
  Once external_resource had actual Act/Ruling coverage, tax_law's
  plain-language summaries became a maintenance burden with no unique
  value, so the pool was retired outright rather than merged in.

  `search_documents`/`search_reference` let the caller skip an entire pool rather
  than just filtering its results after the fact — see
  main.py._classify_and_maybe_answer(), which decides per-question whether
  each pool is even worth querying (e.g. "what is my name?" needs neither;
  "what is the Section 33 deduction limit?" needs law but not documents).
  min_score alone can't achieve this: a user's own documents can score
  respectably against almost any tax-related question just by sharing the
  same narrow topic area, without actually answering what was asked, so a
  threshold has no clean way to tell "on-topic but irrelevant" apart from
  "the right answer" — skipping the pool outright when it isn't needed
  avoids that problem entirely instead of trying to tune around it.

  Results are merged and sorted by score (descending) for the caller. Note
  this function does NOT itself cap the total combined result size — see
  main.py's CHAT_MAX_TOTAL_CITATIONS, which trims the merged, sorted output
  to an overall prompt/citation budget after both pools have already had
  their fair, undiluted shot. Capping here instead would reintroduce the
  same "larger pool wins by default" bias this function exists to avoid.
  """
  user_chunks = []
  if search_documents:
    user_chunks = vector_search(
      query_embedding=query_embedding,
      user_id=user_id,
      entity_id=entity_id,
      source="document",
      top_k=user_top_k,
      num_candidates=num_candidates,
      min_score=min_score,
    )

  reference_chunks = []
  if search_reference:
    candidates = vector_search(
      query_embedding=query_embedding,
      user_id=user_id,
      entity_id=entity_id,
      source="external_resource",
      top_k=reference_candidate_k,
      num_candidates=max(num_candidates, reference_candidate_k * 2),
      min_score=reference_min_score,
    )
    reference_chunks = _diversify_by_document(
      candidates,
      chunks_per_doc=reference_chunks_per_doc,
      max_docs=reference_max_docs,
    )

  merged = user_chunks + reference_chunks
  merged.sort(key=lambda c: c.get("score", 0), reverse=True)
  return merged


def _diversify_by_document(
  chunks: list[dict],
  chunks_per_doc: int = 2,
  max_docs: int = 5,
) -> list[dict]:
  """
  Two-level document-diversity ranking for a flat list of scored chunks —
  see search_user_and_reference_chunks()'s docstring for the full rationale.
  Assumes every chunk has a "reference_no" (true for source="external_resource";
  not meaningful for "document" or the retired "tax_law", so this is only
  ever called on external_resource candidates).

  Steps: group by reference_no -> sort each group's chunks by score, keep
  the top chunks_per_doc -> rank groups by their best (first, since already
  sorted) chunk's score -> keep the top max_docs groups -> flatten and
  return, still sorted by score (desc) so the caller's own merge+sort stays
  correct without needing to know this function's internals.

  A chunk with no reference_no (shouldn't normally happen for
  external_resource, but defensively handled) is grouped under None and
  treated as its own single-chunk "document" — it can still be selected,
  just never grouped with anything else.
  """
  groups: dict[Optional[str], list[dict]] = {}
  for c in chunks:
    groups.setdefault(c.get("reference_no"), []).append(c)

  kept_per_doc = []
  for ref_no, doc_chunks in groups.items():
    doc_chunks.sort(key=lambda c: c.get("score", 0), reverse=True)
    kept_per_doc.append(doc_chunks[:chunks_per_doc])

  # Rank documents by their own best (highest-scoring) surviving chunk —
  # each inner list is already sorted, so [0] is that document's best.
  kept_per_doc.sort(key=lambda group: group[0].get("score", 0), reverse=True)

  selected_docs = kept_per_doc[:max_docs]
  flattened = [c for group in selected_docs for c in group]
  flattened.sort(key=lambda c: c.get("score", 0), reverse=True)
  return flattened