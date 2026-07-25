"""
Reconciliation: find (and optionally delete) MongoDB document_chunks that
have gone orphaned — chunks whose owning Document (or, transitively, whose
owning Person) no longer exists in Postgres.

WHY THIS EXISTS
  delete_document (main.py) and userDelete (main.py) both call
  mongo.delete_chunks_for_document(doc_id) at the right point in their own
  flow — that part of the code is correctly wired. But that call is wrapped
  in a non-fatal try/except (by design: a chatbot-indexing failure should
  never fail the document delete or account delete the user is actually
  waiting on), which means if the Mongo delete itself ever fails for an
  operational reason — a connectivity blip, an auth/permissions issue, a
  transient Atlas error — it fails SILENTLY: logged as a warning, nothing
  raised, the endpoint still returns success. From the outside that looks
  exactly like "chunks keep accumulating and are never cleaned up", with no
  error to point at. This script answers the underlying question directly by
  checking MongoDB against Postgres's actual current state, rather than
  trusting that every past delete's Mongo side actually succeeded.

WHAT IT DOES (idempotent — safe to re-run; read-only unless --apply)
  1. Collects every distinct doc_id currently referenced by a
     source="document" chunk in MongoDB.
  2. Collects every Document.id that currently exists in Postgres.
  3. Any doc_id in Mongo with no matching Postgres row is orphaned — reports
     the count of orphaned chunks per doc_id (dry-run), or deletes them
     (--apply).
  4. As a second, independent check (defence in depth — catches a chunk
     that was somehow inserted with a doc_id that never matched a real
     Document row at all, not just one whose Document was later deleted):
     collects every distinct user_id on a source="document" chunk and
     cross-checks against Person.id. A user_id with no matching Person is
     reported/cleaned the same way. In the ordinary case this finds nothing
     beyond what step 3 already found, since deleting a Person cascades to
     delete their Document rows too (see models.py) — but it's a cheap,
     honest second look rather than assuming step 3 alone is exhaustive.
  5. NEVER touches source="external_resource" chunks — those are shared
     reference material (LHDN/AGC PDFs), not owned by any one user or
     document, and have no Postgres row to reconcile against at all.

HOW TO RUN (from the backend virtualenv, with .env in place):
    cd backend
    python reconcile_mongo_chunks.py            # dry run — reports only
    python reconcile_mongo_chunks.py --apply     # actually deletes orphans
"""

import argparse
import sys

from database import SessionLocal
from models import Document, Person
import mongo


def find_orphaned_by_doc_id(existing_doc_ids: set[int]) -> dict[int, int]:
  """Returns {doc_id: chunk_count} for every doc_id chunks reference that
  has no matching Document row in Postgres."""
  collection = mongo.get_chunks_collection()
  pipeline = [
    {"$match": {"source": "document", "doc_id": {"$ne": None}}},
    {"$group": {"_id": "$doc_id", "count": {"$sum": 1}}},
  ]
  orphaned = {}
  for row in collection.aggregate(pipeline):
    doc_id = row["_id"]
    if doc_id not in existing_doc_ids:
      orphaned[doc_id] = row["count"]
  return orphaned


def find_orphaned_by_user_id(existing_user_ids: set[str]) -> dict[str, int]:
  """Returns {user_id: chunk_count} for every user_id chunks reference that
  has no matching Person row in Postgres. Independent of the doc_id check —
  see the module docstring for why both are run."""
  collection = mongo.get_chunks_collection()
  pipeline = [
    {"$match": {"source": "document", "user_id": {"$ne": None}}},
    {"$group": {"_id": "$user_id", "count": {"$sum": 1}}},
  ]
  orphaned = {}
  for row in collection.aggregate(pipeline):
    user_id = row["_id"]
    if user_id not in existing_user_ids:
      orphaned[user_id] = row["count"]
  return orphaned


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
  parser.add_argument("--apply", action="store_true", help="Actually delete orphaned chunks (default: dry-run report only).")
  args = parser.parse_args()

  db = SessionLocal()
  try:
    existing_doc_ids = {row[0] for row in db.query(Document.id).all()}
    existing_user_ids = {str(row[0]) for row in db.query(Person.id).all()}
  finally:
    db.close()

  print(f"Postgres currently has {len(existing_doc_ids)} document(s) across {len(existing_user_ids)} account(s).")
  print()

  orphaned_by_doc = find_orphaned_by_doc_id(existing_doc_ids)
  orphaned_by_user = find_orphaned_by_user_id(existing_user_ids)

  total_doc_chunks = sum(orphaned_by_doc.values())
  total_user_chunks = sum(orphaned_by_user.values())

  if not orphaned_by_doc and not orphaned_by_user:
    print("No orphaned MongoDB chunks found — nothing to clean up.")
    return

  if orphaned_by_doc:
    print(f"Found {total_doc_chunks} orphaned chunk(s) across {len(orphaned_by_doc)} deleted document(s):")
    for doc_id, count in sorted(orphaned_by_doc.items(), key=lambda kv: -kv[1])[:20]:
      print(f"  doc_id={doc_id}: {count} chunk(s)")
    if len(orphaned_by_doc) > 20:
      print(f"  ... and {len(orphaned_by_doc) - 20} more doc_id(s)")
    print()

  if orphaned_by_user:
    print(f"Found {total_user_chunks} orphaned chunk(s) across {len(orphaned_by_user)} deleted account(s) "
          f"(user_id has no matching Person — catches chunks the doc_id check above might have missed):")
    for user_id, count in sorted(orphaned_by_user.items(), key=lambda kv: -kv[1])[:20]:
      print(f"  user_id={user_id}: {count} chunk(s)")
    if len(orphaned_by_user) > 20:
      print(f"  ... and {len(orphaned_by_user) - 20} more user_id(s)")
    print()

  if not args.apply:
    print("Dry run only — no chunks were deleted. Re-run with --apply to actually delete the orphaned chunks above.")
    return

  collection = mongo.get_chunks_collection()
  deleted_total = 0

  if orphaned_by_doc:
    result = collection.delete_many({"source": "document", "doc_id": {"$in": list(orphaned_by_doc.keys())}})
    deleted_total += result.deleted_count
    print(f"Deleted {result.deleted_count} chunk(s) via the doc_id check.")

  if orphaned_by_user:
    result = collection.delete_many({"source": "document", "user_id": {"$in": list(orphaned_by_user.keys())}})
    deleted_total += result.deleted_count
    print(f"Deleted {result.deleted_count} chunk(s) via the user_id check.")

  print(f"Done. Deleted {deleted_total} orphaned chunk(s) in total.")


if __name__ == "__main__":
  main()
