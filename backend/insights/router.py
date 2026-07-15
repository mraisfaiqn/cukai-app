"""
HTTP surface for the AI Insights inbox.

  GET   /api/insights                 — the feed + last engine run heartbeat.
                                        Computes is_locked per distinct
                                        (entity_id, assessment_year) pair in
                                        ONE batched FormBProfile query, wakes
                                        expired snoozes, and — when a woken
                                        insight was computed under an older
                                        TAX_RULES_VERSION — flags it stale and
                                        triggers a SCOPED background engine
                                        re-run for just that (entity, YA,
                                        insight_type) set.
  PATCH /api/insights/{id}/state      — lifecycle transitions (read/dismiss/
                                        snooze/mark-done/restore). Rejects any
                                        mutating action on a locked assessment
                                        year with 423 Locked — defence in
                                        depth behind the UI disable.
  POST  /api/insights/run             — manual engine refresh, runs via
                                        FastAPI BackgroundTasks (202)

Scoping follows the same temporary pattern as the document endpoints in
main.py: user_id is a required parameter (no session auth yet), an insight
belonging to someone else 404s exactly like a missing one, and a supplied
entity_id must belong to the requesting user.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

import models
from database import SessionLocal
from insights.engine import get_locked_year_pairs, is_assessment_year_locked, run_insight_engine
from insights.models import Insight, InsightRun
from insights.schemas import (
    InsightFeedOut, InsightOut, InsightRunRequestOut, InsightStateUpdate,
    serialize_insight, serialize_run,
)
from tax_rules import TAX_RULES_VERSION

router = APIRouter(prefix="/api/insights", tags=["insights"])

SNOOZE_DAYS_DEFAULT = 14

LOCKED_YA_DETAIL = (
    "This Assessment Year has been filed and locked. Its records are frozen "
    "pending a formal amendment to LHDN, so this insight can no longer be changed."
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _verify_entity_owned(db: Session, user_id: int, entity_id: Optional[int]) -> None:
    """Same guard as main.py's — duplicated locally because main.py imports this
    router, so importing back from main would be circular."""
    if entity_id is None:
        return
    entity = db.query(models.Entity).filter(models.Entity.id == entity_id).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found.")
    if entity.person_id != user_id:
        raise HTTPException(status_code=403, detail="This entity does not belong to the requesting user.")


def _scoped_insight_or_404(db: Session, insight_id: int, user_id: int) -> Insight:
    insight = db.query(Insight).filter(
        Insight.id == insight_id, Insight.user_id == user_id,
    ).first()
    if not insight:
        raise HTTPException(status_code=404, detail=f"Insight ID {insight_id} not found.")
    return insight


def _wake_expired_snoozes(db: Session, background_tasks: BackgroundTasks,
                          user_id: int, entity_id: Optional[int]) -> None:
    """Wake dismissed insights whose snooze has expired. Version-aware: an
    insight computed under an older TAX_RULES_VERSION must not blindly serve
    its stale figures — it is flagged stale (figures untouched — mutation only
    ever happens inside the engine) and a SCOPED engine re-run is queued for
    just its (entity, assessment_year, insight_type), never a full entity
    re-analysis. The mismatch is logged into that run's InsightRun.logs."""
    now = datetime.now(timezone.utc)
    wake_q = db.query(Insight).filter(
        Insight.user_id == user_id,
        Insight.state == "dismissed",
        Insight.snooze_until.isnot(None),
        Insight.snooze_until <= date.today(),
    )
    if entity_id is not None:
        wake_q = wake_q.filter(Insight.entity_id == entity_id)
    expired = wake_q.all()
    if not expired:
        return

    # (entity_id, assessment_year) → {insight_type, ...} needing re-scoring,
    # plus per-scope log lines describing exactly which cards mismatched.
    rerun_types: dict[tuple[Optional[int], int], set] = {}
    rerun_logs: dict[tuple[Optional[int], int], list] = {}

    for row in expired:
        row.state = "new"
        row.dismiss_reason = None
        row.snooze_until = None
        row.updated_at = now
        if row.rule_version != TAX_RULES_VERSION:
            row.stale = True
            scope = (row.entity_id, row.assessment_year)
            rerun_types.setdefault(scope, set()).add(row.insight_type)
            rerun_logs.setdefault(scope, []).append(
                f"rule version mismatch on snooze wake: insight id={row.id} "
                f"({row.insight_type}, {row.dedupe_key}) was computed under "
                f"'{row.rule_version}' but current is '{TAX_RULES_VERSION}' — "
                f"flagged stale and re-scored via scoped engine re-run."
            )
    db.commit()

    for (ent, ya), types in rerun_types.items():
        background_tasks.add_task(
            run_insight_engine,
            user_id, ent, "stale_wake", SessionLocal,
            assessment_year=ya,
            only_insight_types=sorted(types),
            initial_logs=rerun_logs[(ent, ya)],
        )


@router.get("", response_model=InsightFeedOut)
def get_insights(
    background_tasks: BackgroundTasks,
    user_id:   int           = Query(..., description="Owner of the insights — required so the feed is scoped to one user."),
    entity_id: Optional[int] = Query(default=None, description="Active entity; when supplied, restricts to that entity's insights."),
    db: Session = Depends(get_db),
):
    _verify_entity_owned(db, user_id, entity_id)

    # Wake any snoozes that have expired before building the feed, so a
    # "remind me later" card reappears on schedule even if no engine run
    # happened in the meantime. Rule-version mismatches are flagged stale and
    # queued for a scoped background re-score (see _wake_expired_snoozes).
    _wake_expired_snoozes(db, background_tasks, user_id, entity_id)

    q = db.query(Insight).filter(Insight.user_id == user_id)
    if entity_id is not None:
        q = q.filter(Insight.entity_id == entity_id)
    insights = q.order_by(Insight.created_at.desc(), Insight.id.desc()).all()

    # Tax Amendment Lock visibility: ONE batched query over the distinct
    # (entity_id, assessment_year) pairs in the result set — never a
    # per-insight-row lookup. Uses the exact same lock condition as the
    # engine (insights.engine.is_assessment_year_locked / FormBProfile row
    # existence — profiles only exist for filed returns).
    pairs = {(i.entity_id, i.assessment_year) for i in insights}
    locked_pairs = get_locked_year_pairs(db, user_id, pairs)

    run_q = db.query(InsightRun).filter(InsightRun.user_id == user_id)
    if entity_id is not None:
        run_q = run_q.filter(InsightRun.entity_id == entity_id)
    last_run = run_q.order_by(InsightRun.ran_at.desc(), InsightRun.id.desc()).first()

    return InsightFeedOut(
        insights=[
            serialize_insight(i, is_locked=((i.entity_id, i.assessment_year) in locked_pairs))
            for i in insights
        ],
        lastRun=serialize_run(last_run) if last_run else None,
    )


@router.patch("/{insight_id}/state", response_model=InsightOut)
def update_insight_state(
    insight_id: int,
    payload: InsightStateUpdate,
    user_id: int = Query(..., description="Owner of the insight."),
    db: Session = Depends(get_db),
):
    insight = _scoped_insight_or_404(db, insight_id, user_id)
    now = datetime.now(timezone.utc)

    # Tax Amendment Lock — defence in depth behind the UI disable: even if a
    # client sends the request anyway, a locked assessment year rejects every
    # lifecycle mutation. Sole exception: marking an unread card as read (a
    # view receipt, not a change to the year's records).
    ya_locked = is_assessment_year_locked(db, user_id, insight.entity_id, insight.assessment_year)
    if ya_locked and not (payload.state == "read" and insight.state == "new"):
        raise HTTPException(status_code=423, detail=LOCKED_YA_DETAIL)

    if payload.state == "dismissed":
        insight.state = "dismissed"
        insight.dismiss_reason = payload.dismissReason or "Dismissed"
        insight.resolved_note = None
        if payload.snoozeUntil is not None:
            insight.snooze_until = payload.snoozeUntil
        elif payload.dismissReason and "snooze" in payload.dismissReason.lower():
            # "Snoozed for 2 weeks" / "Remind me later" semantics
            insight.snooze_until = date.today() + timedelta(days=SNOOZE_DAYS_DEFAULT)
        elif payload.dismissReason and "this year" in payload.dismissReason.lower():
            # "Not relevant this year" — hidden until 1 Jan after the insight's
            # assessment year (its tax year, not the calendar year of dismissal)
            base_year = insight.assessment_year or date.today().year
            insight.snooze_until = date(base_year + 1, 1, 1)
        else:
            insight.snooze_until = None

    elif payload.state == "actioned":
        insight.state = "actioned"
        insight.resolved_note = payload.resolvedNote or "Marked as done by you."
        insight.dismiss_reason = None
        insight.snooze_until = None

    else:  # "new" | "read" — includes "restore to inbox"
        insight.state = payload.state
        insight.dismiss_reason = None
        insight.resolved_note = None
        insight.snooze_until = None

    insight.updated_at = now
    db.commit()
    db.refresh(insight)
    return serialize_insight(insight, is_locked=ya_locked)


@router.post("/run", status_code=202, response_model=InsightRunRequestOut)
def trigger_insight_run(
    background_tasks: BackgroundTasks,
    user_id:   int           = Query(..., description="User to recompute insights for."),
    entity_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
):
    """Manual refresh. The engine runs after the response is sent (FastAPI
    BackgroundTasks) with its own DB session — the request never blocks on
    rule evaluation or the digest's Gemini call."""
    _verify_entity_owned(db, user_id, entity_id)
    background_tasks.add_task(run_insight_engine, user_id, entity_id, "manual_refresh", SessionLocal)
    return InsightRunRequestOut(
        message="Insight engine run queued.",
        trigger="manual_refresh",
    )
