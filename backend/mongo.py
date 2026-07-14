"""
MongoDB Atlas Vector Search — long-term semantic memory for CukaiBot.

Where database.py/models.py hold PostgreSQL ("what did we just talk about in
THIS conversation" — structured, session-scoped), this module holds the other
half of the two-database RAG design: "which chunks are MEANINGFULLY RELATED
to what the user just asked" — unstructured, similarity-scored, and searched
by embedding rather than by exact match.

ONE collection (document_chunks) holds three kinds of chunk, distinguished by
`source`:
  - "document"          — a user's own uploaded receipt/invoice (pipeline.py)
  - "tax_law"            — hand-written topic summaries (seed_tax_law.py)
  - "external_resource"  — real chunked text from official LHDN PDFs
                            (seed_external_resources.py)

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
used by any of the three sources; most are None on any given chunk:
  {
    "_id": ObjectId(...),
    "text": "Category: Business Expense, Office Supplies, RM150",
    "embedding": [0.0123, -0.0456, ...],   # 768 floats, gemini-embedding-001
    "source": "document",   # "document" | "tax_law" | "external_resource"

    # source="document" (user receipts, via pipeline.py):
    "user_id": "42", "entity_id": 7, "doc_id": 913,
    "year_of_assessment": 2026, "category": "office_supplies",

    # source="tax_law" (hand-written summaries, via seed_tax_law.py):
    "topic": "broadband_business_expense",

    # source="external_resource" (real PDFs, via seed_external_resources.py):
    "external_resource_id": 3, "resource_type": "public_ruling",
    "reference_no": "PR-4-2015", "title": "Entertainment Expense",
    "source_url": "https://...", "page_number": None,

    "created_at": "2026-07-11T08:00:00Z",
  }

user_id/entity_id are stored on every chunk and used as pre-filters on every
$vectorSearch query — this is the "Metadata is King" rule from the leader's
diagram: without it, one user's chat could retrieve another user's receipts.
tax_law and external_resource chunks use user_id=None/entity_id=None, which
the filter below treats as "visible to every user" — shared reference
material rather than anything owned by a specific account.

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
  Create the Atlas Vector Search index if it doesn't already exist. Safe to
  call on every startup (mirrors init_db() in database.py) — Atlas returns
  the existing index rather than erroring on a duplicate name, but we still
  guard with a name check to avoid a noisy API call on every restart.

  Requires an Atlas cluster (M10+, or a free/shared tier that supports Search).
  This is a no-op on plain self-hosted MongoDB — Atlas Vector Search is an
  Atlas-only feature, and $vectorSearch calls will fail without it.
  """
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
    existing = {idx["name"] for idx in collection.list_search_indexes()}
    if VECTOR_INDEX_NAME in existing:
      return

    collection.create_search_index({
      "name": VECTOR_INDEX_NAME,
      "type": "vectorSearch",
      "definition": {
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
        ]
      },
    })
    logger.info(f"[Mongo] Created vector search index '{VECTOR_INDEX_NAME}' on "
                f"{MONGO_DB_NAME}.{MONGO_COLLECTION_NAME}.")
  except PyMongoError as e:
    # Non-fatal: log and continue. A missing index means vector_search() will
    # return no results (or error) until it's created manually in Atlas, but
    # it shouldn't take the whole API down at startup.
    logger.warning(f"[Mongo] Could not verify/create vector search index: {e}")


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
  page_number: Optional[int] = None,
) -> str:
  """
  Insert one embedded chunk. Returns the inserted _id as a string.

  One function now covers all three chunk kinds — pass only the fields
  relevant to the source you're inserting; the rest default to None:
    - source="document"          (pipeline.py):          user_id, entity_id, doc_id, year_of_assessment, category
    - source="tax_law"            (seed_tax_law.py):       category, topic
    - source="external_resource"  (seed_external_resources.py): external_resource_id, resource_type, reference_no, title, source_url

  `topic` lets seed_tax_law.py check "do I already have a chunk for this
  topic?" without exact text matching, so it can re-run safely without
  duplicating entries. `external_resource_id`/`reference_no` serve the same
  de-dupe/resume purpose for seed_external_resources.py. Document chunks
  (source="document") use doc_id as their natural de-dupe key instead.
  """
  from datetime import datetime, timezone

  collection = get_chunks_collection()
  result = collection.insert_one({
    "text": text,
    "embedding": embedding,
    "source": source,  # "document" | "tax_law" | "external_resource"

    # source="document" fields
    "user_id": user_id,
    "entity_id": entity_id,
    "doc_id": doc_id,
    "year_of_assessment": year_of_assessment,
    "category": category,

    # source="tax_law" fields
    "topic": topic,

    # source="external_resource" fields
    "external_resource_id": external_resource_id,
    "resource_type": resource_type,
    "reference_no": reference_no,
    "title": title,
    "source_url": source_url,
    "page_number": page_number,

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


def vector_search(
  query_embedding: list[float],
  user_id: Optional[str],
  entity_id: Optional[int] = None,
  resource_type: Optional[str] = None,
  top_k: int = 5,
  num_candidates: int = 100,
) -> list[dict]:
  """
  Run MongoDB Atlas's $vectorSearch aggregation, pre-filtered by user_id
  (and entity_id, when given) so retrieval never crosses between users.
  Shared reference chunks (tax_law and external_resource, both stored with
  user_id=None) always pass this filter regardless of which user is asking —
  that's the mechanism that makes CukaiBot's legal/tax-law knowledge visible
  to everyone while receipts stay private to their owner.

  `resource_type`, when given, additionally narrows results to one kind of
  external resource ("act" | "public_ruling" | "guideline") — optional, for
  callers that already know which kind of source is most relevant. Chunks
  with no resource_type (i.e. source="document" or "tax_law") are excluded
  when this filter is active, so only pass it when you specifically want to
  search official documents alone.

  Returns up to top_k chunks, each with a similarity `score` attached.
  """
  collection = get_chunks_collection()

  # Match either this user's own chunks, or shared (user_id=None) chunks —
  # covers both tax_law summaries and external_resource chunks in one clause,
  # since both use user_id=None.
  owner_filter = {"$or": [{"user_id": user_id}, {"user_id": None}]}
  if entity_id is not None:
    owner_filter = {"$and": [owner_filter, {"$or": [{"entity_id": entity_id}, {"entity_id": None}]}]}
  if resource_type is not None:
    owner_filter = {"$and": [owner_filter, {"resource_type": resource_type}]}

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
        "page_number": 1,
        "score": {"$meta": "vectorSearchScore"},
      }
    },
  ]

  try:
    return list(collection.aggregate(pipeline))
  except PyMongoError as e:
    logger.error(f"[Mongo] Vector search failed: {e}")
    return []
