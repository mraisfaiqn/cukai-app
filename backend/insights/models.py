"""
Database models for the AI Insights engine.

Tables:
  insights     — one row per insight card shown in the InsightsInbox. Upserted
                 atomically on (dedupe_key, assessment_year) so re-running the
                 engine updates the card's numbers in place instead of
                 duplicating it.
  insight_runs — one durable queued/running/terminal job per analysis request;
                 powers the inbox heartbeat and carries truthful scope/card/
                 evidence counters plus the audit trail for skipped runs.
  insight_run_changes — deterministic before/after events produced by a run.

Design notes:
  - user_id / entity_id are Integer FKs matching Person.id / Entity.id exactly
    (Person.id and Entity.id are Integer PKs in models.py). Note this differs
    from Document.user_id, which is a String(128) — the engine converts at the
    boundary when it queries documents.
  - assessment_year is the TAX Year of Assessment the insight belongs to — it
    is inferred from the triggering document's year_of_assessment, NOT from
    the calendar date the engine happened to run. A 2025 receipt uploaded in
    July 2026 produces YA2025 insights that can never overwrite or pollute the
    YA2026 feed.
  - dedupe_key format: u{user_id}:e{entity_id}:ya{assessment_year}:{insight_type}:{sub_key_hash}
    where sub_key_hash is the first 12 hex chars of SHA-1 over the rule's
    semantic sub-key. The uniqueness target for the atomic upsert is the
    composite (dedupe_key, assessment_year) constraint.
  - Existing pre-YA-format rows must be migrated with
    insights/backfill_dedupe_keys.py BEFORE this model's constraint is relied
    on — see that script's docstring.
  - snooze_until: a dismissed insight with a snooze date is automatically
    restored to state 'new' once the date passes (handled in both the GET feed
    endpoint and the engine run, whichever fires first).
"""

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, Integer, String, Text, Date, DateTime, Numeric,
    ForeignKey, CheckConstraint, Index, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB

from models import Base
from tax_rules import TAX_RULES_VERSION

VALID_INSIGHT_TYPES = (
    "deadline", "review_pending", "relief_headroom", "doc_gap",
    "provision", "formb_missing", "digest",
)
VALID_SEVERITIES = ("deadline", "action_required", "suggested", "info")
VALID_STATES = ("new", "read", "dismissed", "actioned")
VALID_GENERATED_BY = ("rule_template", "llm")
VALID_RUN_STATUSES = ("queued", "running", "completed", "failed", "skipped")
VALID_RUN_CHANGE_TYPES = ("created", "updated", "resolved", "reopened")


class Insight(Base):
    __tablename__ = "insights"

    id        = Column(Integer, primary_key=True, index=True)
    user_id   = Column(Integer, ForeignKey("persons.id", ondelete="CASCADE"), nullable=False, index=True)
    entity_id = Column(Integer, ForeignKey("entities.id", ondelete="SET NULL"), nullable=True, index=True)

    insight_type = Column(String(50), nullable=False)
    severity     = Column(String(20), nullable=False)
    generated_by = Column(String(20), nullable=False, default="rule_template")

    # Tax Year of Assessment this insight describes — never the calendar year
    # the engine ran in. Part of the upsert identity below.
    assessment_year = Column(Integer, nullable=False, index=True)

    # Lifecycle
    state          = Column(String(20), nullable=False, default="new")
    dismiss_reason = Column(String(255), nullable=True)
    resolved_note  = Column(String(500), nullable=True)
    snooze_until   = Column(Date, nullable=True)

    # Tax-rule version active when this insight's figures were last computed
    # (tax_rules.TAX_RULES_VERSION). When a snoozed insight wakes under a
    # NEWER version, it is flagged stale and re-scored through the engine —
    # its figures are never silently served or mutated across a rule change.
    rule_version = Column(String(32), nullable=False, default=TAX_RULES_VERSION)
    # True while the card's figures await a scoped engine re-run after a rule
    # version mismatch on wake; cleared by the engine's next upsert.
    stale = Column(Boolean, nullable=False, default=False)

    # Upsert identity — see module docstring for the format.
    dedupe_key = Column(String(255), nullable=False, index=True)

    # Card content
    title              = Column(String(255), nullable=False)
    body               = Column(Text, nullable=False)
    rm_impact          = Column(Numeric, nullable=True)
    deadline_date      = Column(Date, nullable=True)
    citation           = Column(String(255), nullable=True)
    signals            = Column(JSONB, nullable=True)   # [{label, value}, ...]
    source_document_ids = Column(JSONB, nullable=True)  # [int, ...]
    action             = Column(JSONB, nullable=True)   # {label, to} deep-link descriptor

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        UniqueConstraint("dedupe_key", "assessment_year", name="uq_insight_dedupe_key_ya"),
        CheckConstraint(
            "insight_type IN ('deadline', 'review_pending', 'relief_headroom', "
            "'doc_gap', 'provision', 'formb_missing', 'digest')",
            name="ck_insight_type",
        ),
        CheckConstraint(
            "severity IN ('deadline', 'action_required', 'suggested', 'info')",
            name="ck_insight_severity",
        ),
        CheckConstraint(
            "state IN ('new', 'read', 'dismissed', 'actioned')",
            name="ck_insight_state",
        ),
        CheckConstraint(
            "generated_by IN ('rule_template', 'llm')",
            name="ck_insight_generated_by",
        ),
        CheckConstraint(
            "assessment_year >= 2000 AND assessment_year <= 2100",
            name="ck_insight_assessment_year_range",
        ),
        Index("ix_insight_user_entity_state", "user_id", "entity_id", "state"),
        Index("ix_insight_user_entity_ya", "user_id", "entity_id", "assessment_year"),
    )


class InsightRun(Base):
    __tablename__ = "insight_runs"

    id        = Column(Integer, primary_key=True, index=True)
    user_id   = Column(Integer, ForeignKey("persons.id", ondelete="CASCADE"), nullable=False, index=True)
    entity_id = Column(Integer, ForeignKey("entities.id", ondelete="SET NULL"), nullable=True, index=True)

    # Every run belongs to one tax Year of Assessment. It is nullable only so
    # pre-migration heartbeat rows can be retained without inventing a year.
    assessment_year = Column(Integer, nullable=True, index=True)

    trigger = Column(String(50), nullable=False)   # primary/user-facing trigger
    # All triggers folded into this queued run (e.g. a ten-file batch). Kept as
    # structured data so coalescing never loses the audit trail.
    requested_triggers = Column(JSONB, nullable=True)
    # NULL means a full run; a list means a stale-wake run restricted to these
    # insight types. Multiple queued stale wakes merge their lists.
    requested_insight_types = Column(JSONB, nullable=True)

    status       = Column(String(20), nullable=False, default="queued")
    queued_at    = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    started_at   = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    # Backward-compatible timestamp consumed by the current frontend. For new
    # rows this is set when the run completes; queued_at is the queue timestamp.
    ran_at       = Column(DateTime, nullable=True)

    # Truthful counters. These deliberately distinguish the year snapshot,
    # matched cards, and the raw evidence facts attached to those cards.
    documents_in_scope = Column(Integer, nullable=False, default=0)
    insights_matched   = Column(Integer, nullable=False, default=0)
    evidence_signals   = Column(Integer, nullable=False, default=0)
    insights_reopened  = Column(Integer, nullable=False, default=0)

    # Legacy aliases retained during the API transition. New code writes them
    # with the equivalent corrected values so older clients do not break.
    documents_analysed = Column(Integer, nullable=False, default=0)
    signals_found      = Column(Integer, nullable=False, default=0)
    insights_created   = Column(Integer, nullable=False, default=0)
    insights_updated   = Column(Integer, nullable=False, default=0)
    insights_resolved  = Column(Integer, nullable=False, default=0)

    # Free-form log lines. This is the REQUIRED audit trail for: Gemini
    # failures, rule failures, and — critically — analyses skipped because the
    # target assessment year is locked (filed Form B on record). A locked-YA
    # skip is never a silent no-op: it always leaves a run row with a log line.
    logs = Column(JSONB, nullable=True)

    __table_args__ = (
        CheckConstraint(
            "status IN ('queued', 'running', 'completed', 'failed', 'skipped')",
            name="ck_insight_run_status",
        ),
        CheckConstraint(
            "assessment_year IS NULL OR (assessment_year >= 2000 AND assessment_year <= 2100)",
            name="ck_insight_run_ya_range",
        ),
        Index("ix_insight_run_user_entity", "user_id", "entity_id"),
        Index(
            "ix_insight_run_scope_status",
            "user_id", "entity_id", "assessment_year", "status",
        ),
    )


class InsightRunChange(Base):
    """One deterministic change made visible by an insight-engine run."""

    __tablename__ = "insight_run_changes"

    id         = Column(Integer, primary_key=True, index=True)
    run_id     = Column(Integer, ForeignKey("insight_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    insight_id = Column(Integer, ForeignKey("insights.id", ondelete="SET NULL"), nullable=True, index=True)

    change_type = Column(String(20), nullable=False)
    impact_delta = Column(Numeric, nullable=True)
    before_data  = Column(JSONB, nullable=True)
    after_data   = Column(JSONB, nullable=True)
    created_at   = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        CheckConstraint(
            "change_type IN ('created', 'updated', 'resolved', 'reopened')",
            name="ck_insight_run_change_type",
        ),
        Index("ix_insight_run_change_run_type", "run_id", "change_type"),
    )
