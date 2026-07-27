"""
One-time cleanup: delete orphaned `provision` insight rows left behind by the
bracket_warning dedupe-key change (per-bracket-pair key -> stable
"bracket-warning" key).

WHY THIS EXISTS
  Before the fix, _rule_bracket_warning's dedupe_key embedded the current/next
  bracket rate pair (e.g. "provision:bracket:0-1"), so crossing a bracket
  boundary created a NEW row under a NEW key instead of updating the old one.
  The old row's key is never emitted again once the fix ships, so the reopen
  path (which only reopens a row when a currently-emitted card's dedupe_key
  matches it) can never touch it again -- it is permanently orphaned, stuck
  showing whatever figures were true at its last update, forever.

WHAT IT DOES (idempotent -- safe to re-run)
  For every (user_id, entity_id, assessment_year) scope that has ANY
  `provision`-type row, computes the two dedupe_keys the CURRENT code can
  possibly emit for that scope (_key("provision", "set-aside") and
  _key("provision", "bracket-warning")), and deletes every `provision` row in
  that scope whose dedupe_key is NOT one of those two. Rows are deleted, not
  merged -- an orphaned row only ever holds stale figures, so folding it into
  the current row would overwrite correct data with old data.
  InsightRunChange.insight_id is ON DELETE SET NULL, so the audit trail for
  those change events survives.

HOW TO RUN (once, with the backend virtualenv active and .env in place):
    cd backend
    python -m insights.backfill_provision_dedupe_key
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal
from insights.engine import TaxInsightEngine
from insights.insight_models import Insight


def _valid_provision_keys(user_id: int, entity_id, assessment_year: int) -> set[str]:
    runner = TaxInsightEngine.__new__(TaxInsightEngine)
    runner.user_id = user_id
    runner.entity_id = entity_id
    runner.ya = assessment_year
    return {
        TaxInsightEngine._key(runner, "provision", "set-aside"),
        TaxInsightEngine._key(runner, "provision", "bracket-warning"),
    }


def run() -> None:
    db = SessionLocal()
    try:
        rows = db.query(Insight).filter(Insight.insight_type == "provision").all()
        scopes = {(r.user_id, r.entity_id, r.assessment_year) for r in rows}
        valid_by_scope = {
            scope: _valid_provision_keys(*scope) for scope in scopes
        }

        orphans = [r for r in rows if r.dedupe_key not in valid_by_scope[(r.user_id, r.entity_id, r.assessment_year)]]

        if not orphans:
            print("No orphaned provision rows found.")
            return

        print(f"Deleting {len(orphans)} orphaned provision row(s):")
        for r in orphans:
            print(f"  id={r.id} dedupe_key={r.dedupe_key} state={r.state} title={r.title!r}")
            db.delete(r)
        db.commit()
        print("Done.")
    finally:
        db.close()


if __name__ == "__main__":
    run()
