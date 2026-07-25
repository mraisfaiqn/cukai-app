"""
One-time backfill: migrate pre-YA-format insight rows to the new
assessment-year-aware schema and dedupe-key format.

WHY THIS EXISTS
  The dedupe_key format changed from
      u{user}:e{entity}:{semantic}                       (old)
  to
      u{user}:e{entity}:ya{year}:{type}:{sub_key_hash}   (new)
  and the `year_of_assessment` column was renamed to `assessment_year` with a
  new composite unique constraint on (dedupe_key, assessment_year). Old-format
  rows would never collide with new-format keys, silently breaking dedup for
  all pre-migration data — so they must be rewritten IN PLACE before the new
  constraint is enforced and before the new engine code serves traffic.

WHAT IT DOES (idempotent — safe to re-run)
  1. Renames insights.year_of_assessment → assessment_year (or adds the column
     if neither exists), and fills NULLs from created_at's year.
  2. Recomputes dedupe_key for every old-format row using the exact same
     build_dedupe_key() the engine uses, deriving the assessment year from the
     old key's own semantic content where possible (e.g. 'relief_headroom:prs:
     2026' → ya2026) and falling back to the column value.
  3. Resolves collisions (two old rows mapping to one new key): the most
     recently updated row wins; older duplicates are deleted and reported.
  4. Drops the old single-column unique index and installs the new composite
     unique constraint + supporting indexes.

HOW TO RUN (once, with the backend virtualenv active and .env in place):
    cd backend
    python -m insights.backfill_dedupe_keys
"""

import os
import re
import sys
from datetime import datetime

# Allow running as `python insights/backfill_dedupe_keys.py` from backend/ too
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import inspect, text

from database import engine
from insights.engine import build_dedupe_key

NEW_KEY_RE = re.compile(r"^u\d+:e(\d+|-):ya\d{4}:[a-z_]+:[0-9a-f]{12}$")
OLD_KEY_RE = re.compile(r"^u(?P<uid>\d+):e(?P<ent>\d+|-):(?P<semantic>.+)$")


def _derive_sub_key_and_year(insight_type: str, semantic: str, fallback_year: int):
    """Map an old-format semantic suffix to (new_sub_key, assessment_year).

    Old semantics per type (from the v1 engine):
      deadline         cp500_due:YYYY-MM
      review_pending   review_pending:doc-{id}
      relief_headroom  relief_headroom:{slug}:{ya}
      doc_gap          doc_gap:{slug}:{YYYY-MM}
      provision        provision:{ya}
      formb_missing    formb_missing:{prior_ya}
      digest           digest:YYYY-MM
    """
    parts = semantic.split(":")

    if insight_type == "deadline" and len(parts) >= 2 and re.match(r"^\d{4}-\d{2}$", parts[1]):
        return f"cp500:{parts[1]}", int(parts[1][:4])

    if insight_type == "review_pending" and len(parts) >= 2:
        return parts[1], fallback_year  # 'doc-{id}' — YA not in the old key

    if insight_type == "relief_headroom" and len(parts) >= 3 and parts[2].isdigit():
        return parts[1], int(parts[2])

    if insight_type == "doc_gap" and len(parts) >= 3 and re.match(r"^\d{4}-\d{2}$", parts[2]):
        return f"{parts[1]}:{parts[2]}", int(parts[2][:4])

    if insight_type == "provision" and len(parts) >= 2 and parts[1].isdigit():
        return "set-aside", int(parts[1])

    if insight_type == "formb_missing" and len(parts) >= 2 and parts[1].isdigit():
        prior = int(parts[1])
        return f"prior-{prior}", prior + 1  # card belongs to the year AFTER the missing return

    if insight_type == "digest" and len(parts) >= 2 and re.match(r"^\d{4}-\d{2}$", parts[1]):
        return parts[1], fallback_year  # digest month ≠ assessment year; trust the column

    # Unrecognised shape — keep the raw semantic as the sub key so the row
    # still gets a valid, stable new-format key.
    return semantic, fallback_year


def main() -> None:
    inspector = inspect(engine)
    if "insights" not in inspector.get_table_names():
        print("Table 'insights' does not exist — nothing to backfill. "
              "(A fresh database gets the new schema directly from init_db().)")
        return

    with engine.begin() as conn:
        cols = {c["name"] for c in inspector.get_columns("insights")}

        # ── Step 1: column rename / add ─────────────────────────────────────
        if "assessment_year" not in cols:
            if "year_of_assessment" in cols:
                conn.execute(text(
                    "ALTER TABLE insights RENAME COLUMN year_of_assessment TO assessment_year"
                ))
                print("Renamed column year_of_assessment → assessment_year.")
            else:
                conn.execute(text(
                    "ALTER TABLE insights ADD COLUMN assessment_year INTEGER"
                ))
                print("Added column assessment_year.")

        filled = conn.execute(text(
            "UPDATE insights SET assessment_year = EXTRACT(YEAR FROM created_at)::int "
            "WHERE assessment_year IS NULL"
        )).rowcount
        if filled:
            print(f"Filled assessment_year from created_at on {filled} row(s).")

        # ── Step 1b: rule-versioning columns ────────────────────────────────
        # Pre-versioning rows get the sentinel 'legacy' — deliberately unequal
        # to any real TAX_RULES_VERSION, so if such a row is ever snoozed and
        # wakes, the version-mismatch path flags it stale and re-scores it
        # through the engine instead of serving pre-versioning figures.
        conn.execute(text(
            "ALTER TABLE insights ADD COLUMN IF NOT EXISTS "
            "rule_version VARCHAR(32) NOT NULL DEFAULT 'legacy'"
        ))
        conn.execute(text(
            "ALTER TABLE insights ADD COLUMN IF NOT EXISTS "
            "stale BOOLEAN NOT NULL DEFAULT FALSE"
        ))
        print("Ensured rule_version (default 'legacy' for pre-versioning rows) "
              "and stale columns exist.")

        # ── Step 2: rewrite old-format keys ─────────────────────────────────
        rows = conn.execute(text(
            "SELECT id, user_id, entity_id, insight_type, dedupe_key, assessment_year, "
            "       COALESCE(updated_at, created_at) AS last_touched "
            "FROM insights ORDER BY id"
        )).mappings().all()

        rewritten = skipped_new_format = unparseable = 0
        planned: dict[tuple[str, int], dict] = {}   # (new_key, ya) → winning row plan
        losers: list[int] = []                      # row ids deleted as duplicates

        for row in rows:
            if NEW_KEY_RE.match(row["dedupe_key"]):
                skipped_new_format += 1
                # New-format rows still participate in collision detection so an
                # old row can't be rewritten onto an existing new-format key.
                planned.setdefault(
                    (row["dedupe_key"], row["assessment_year"]),
                    {"id": row["id"], "key": row["dedupe_key"],
                     "ya": row["assessment_year"], "last_touched": row["last_touched"],
                     "rewrite": False},
                )
                continue

            m = OLD_KEY_RE.match(row["dedupe_key"])
            if not m:
                unparseable += 1
                print(f"  WARNING: row id={row['id']} has unparseable dedupe_key "
                      f"'{row['dedupe_key']}' — left untouched.")
                continue

            entity_id = None if m.group("ent") == "-" else int(m.group("ent"))
            fallback_year = row["assessment_year"] or datetime.now().year
            sub_key, ya = _derive_sub_key_and_year(
                row["insight_type"], m.group("semantic"), fallback_year
            )
            new_key = build_dedupe_key(row["user_id"], entity_id, ya, row["insight_type"], sub_key)

            plan = {"id": row["id"], "key": new_key, "ya": ya,
                    "last_touched": row["last_touched"], "rewrite": True}
            slot = (new_key, ya)
            incumbent = planned.get(slot)
            if incumbent is None:
                planned[slot] = plan
            else:
                # Collision: most recently touched row wins; the other is deleted.
                if (plan["last_touched"] or datetime.min) > (incumbent["last_touched"] or datetime.min):
                    losers.append(incumbent["id"])
                    planned[slot] = plan
                else:
                    losers.append(plan["id"])

        for plan in planned.values():
            if plan["rewrite"]:
                conn.execute(
                    text("UPDATE insights SET dedupe_key = :k, assessment_year = :ya WHERE id = :id"),
                    {"k": plan["key"], "ya": plan["ya"], "id": plan["id"]},
                )
                rewritten += 1

        if losers:
            conn.execute(
                text("DELETE FROM insights WHERE id = ANY(:ids)"),
                {"ids": losers},
            )
            print(f"Deleted {len(losers)} duplicate row(s) that collided after rewrite "
                  f"(most recently updated row kept in each case): ids={sorted(losers)}")

        print(f"Rewrote {rewritten} old-format key(s); {skipped_new_format} row(s) already "
              f"new-format; {unparseable} unparseable row(s) left untouched.")

        # ── Step 3: enforce NOT NULL ────────────────────────────────────────
        conn.execute(text(
            "ALTER TABLE insights ALTER COLUMN assessment_year SET NOT NULL"
        ))

        # ── Step 4: swap the uniqueness target ──────────────────────────────
        # v1 declared dedupe_key with unique=True + index=True, which Postgres
        # materialised as a UNIQUE index named ix_insights_dedupe_key (or, on
        # some paths, a constraint named insights_dedupe_key_key). Drop both
        # forms if present, then install the composite constraint the new
        # ON CONFLICT (dedupe_key, assessment_year) upsert targets.
        conn.execute(text(
            "ALTER TABLE insights DROP CONSTRAINT IF EXISTS insights_dedupe_key_key"
        ))
        conn.execute(text("DROP INDEX IF EXISTS ix_insights_dedupe_key"))
        conn.execute(text(
            "ALTER TABLE insights DROP CONSTRAINT IF EXISTS uq_insight_dedupe_key_ya"
        ))
        conn.execute(text(
            "ALTER TABLE insights "
            "ADD CONSTRAINT uq_insight_dedupe_key_ya UNIQUE (dedupe_key, assessment_year)"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_insights_dedupe_key ON insights (dedupe_key)"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_insights_assessment_year ON insights (assessment_year)"
        ))
        conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_insight_user_entity_ya "
            "ON insights (user_id, entity_id, assessment_year)"
        ))
        print("Installed composite unique constraint uq_insight_dedupe_key_ya "
              "(dedupe_key, assessment_year) and supporting indexes.")

    print("Backfill complete.")


if __name__ == "__main__":
    main()