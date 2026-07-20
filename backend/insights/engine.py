"""
TaxInsightEngine — the hybrid rule/LLM engine behind the AI Insights inbox.

Architecture (mirrors the contract documented in InsightsInbox.jsx):

  PIPELINE A (deterministic) — rules compute every number from the same year
  summary the dashboard already trusts (main.get_tax_profile_summary) plus
  targeted queries, emitting insight cards with auditable `signals`.
  PIPELINE B (LLM-hybrid) — a single digest card worded by Gemini from
  Pipeline A's computed facts (generated_by='llm').

  THE TWO PIPELINES ARE ISOLATED WITH INDEPENDENT COMMIT POINTS. Pipeline A's
  cards are committed in their own transaction BEFORE Pipeline B ever talks
  to Gemini; a Gemini timeout, rate-limit, or digest-persist failure can only
  ever lose the digest, never the deterministic insights. Each pipeline runs
  inside its own try/except; the InsightRun heartbeat commits last, in a
  third independent write, so the audit trail survives either failure.

  GEMINI BOUNDS + CIRCUIT BREAKER — the Gemini client carries an explicit
  15s HTTP timeout (within the mandated 10–15s window) and at most one
  transient retry. On HTTP 429 / ResourceExhausted or a timeout, a
  process-wide circuit breaker opens for a cooldown window: overlapping
  bulk-upload runs skip the LLM immediately instead of queueing workers on a
  throttled endpoint, log the skip to InsightRun.logs, and continue with the
  template digest. The circuit breaker never retries — Gemini's single
  transient retry and Flaw C's advisory-lock retry remain the only retry
  loops, and they cannot compound (the LLM call happens BETWEEN database
  transactions, never inside one).

Production-hardening invariants:

  ASSESSMENT-YEAR SCOPING (Flaw A) — every run analyses exactly ONE Year of
  Assessment, taken from the triggering document's year_of_assessment, never
  from the calendar date. Dedupe keys carry the YA explicitly:
      u{user_id}:e{entity_id}:ya{assessment_year}:{insight_type}:{sub_key_hash}
  Pre-format rows are migrated by insights/backfill_dedupe_keys.py.

  TAX AMENDMENT LOCK (Flaw B) — a YA with a filed Form B on record is FROZEN.
  The single source of truth for that condition is is_assessment_year_locked()
  below (FormBProfile row existence — rows are only ever created from
  uploaded, previously-filed returns); the router reuses the same function for
  the is_locked response flag and for server-side action rejection. Skips are
  logged to InsightRun, never silent.

  CONCURRENCY SAFETY (Flaw C) — sessions are tight (open → work → commit →
  close; never held across the LLM call). Writes happen in transactions
  guarded by PostgreSQL advisory transaction locks (pg_advisory_xact_lock on
  SHA-1 hashes of the scope and each dedupe_key, acquired in sorted order),
  which serialise writers across threads AND across worker processes. Write
  transactions retry up to 3 times with jittered exponential backoff.

  RULE VERSIONING — every card is stamped with tax_rules.TAX_RULES_VERSION at
  write time (rule_version column). When a snoozed insight wakes under a newer
  version, the router flags it stale and triggers a SCOPED re-run (this
  engine with only_insight_types set) so figures are recomputed through the
  normal, auditable path — never mutated in place.

Imports from `main` and `pipeline` are deferred to call time: main.py imports
pipeline.py, pipeline.py invokes this engine, and main.py mounts the insights
router which imports this module — top-level imports in either direction would
be circular. By the time the engine actually runs, both modules are fully
loaded.
"""

import hashlib
import json
import logging
import os
import random
import re
import statistics
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Callable, Iterable, Optional

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import DBAPIError, OperationalError
from sqlalchemy.orm import Session

from models import FormBProfile
from insights.models import Insight, InsightRun
from tax_rules import TAX_RULES_VERSION

logger = logging.getLogger("uvicorn.error")

# Types this engine owns. Cards of these types that stop being generated are
# auto-resolved (digest excepted — an old digest is history, not a resolved
# problem, so it simply ages out in the feed).
ENGINE_MANAGED_TYPES = (
    "deadline", "review_pending", "relief_headroom", "doc_gap",
    "provision", "formb_missing", "digest",
)
AUTO_RESOLVE_TYPES = tuple(t for t in ENGINE_MANAGED_TYPES if t != "digest")

# CP500 installments for individuals run bimonthly across six odd months of
# the year; the engine uses the 15th as the in-month due day for countdown
# purposes. Only surfaced when the user's vault actually contains CP500
# receipts, and always cited to s.107B so the user can verify.
CP500_MONTHS = (1, 3, 5, 7, 9, 11)
CP500_DUE_DAY = 15
CP500_LOOKAHEAD_DAYS = 45

# doc_gap detection thresholds
DOC_GAP_MIN_MONTHS_PRESENT = 3
DOC_GAP_MAX_TRAILING_MISSING = 4

# relief_headroom thresholds
RELIEF_HEADROOM_MIN_MYR = 500
RELIEF_HEADROOM_MAX_CARDS = 3

REVIEW_PENDING_MAX_CARDS = 8

# Reopen a dismissed/actioned insight only when its RM impact moved this much.
REOPEN_IMPACT_CHANGE_PCT = 0.15

# Gemini bounds (Pipeline B). Explicit HTTP timeout within the mandated
# 10–15s window; a single transient retry (mandated earlier) — the circuit
# breaker below adds NO further retries.
GEMINI_TIMEOUT_SECONDS = 15
GEMINI_MAX_RETRIES = 1
GEMINI_CIRCUIT_COOLDOWN_SECONDS = 120

# Write-transaction retry policy (Flaw C)
UPSERT_MAX_ATTEMPTS = 3
UPSERT_BACKOFF_BASE_SECONDS = 0.1

_REVIEW_CITATIONS = {
    "Q3 — Client Entertainment (50% cap)": "ITA 1967 s.39(1)(l) · LHDN PR No. 3/2020",
    "Q3 — Client & Corporate Gifts":       "ITA 1967 s.39(1)(l)",
    "Q3 — Mixed-Use Vehicle Expenses":     "ITA 1967 s.33(1) · LHDN PR No. 1/2014",
    "Q3 — Hire Purchase & Leased Assets":  "ITA 1967 s.33 · Schedule 3",
}

_RELIEF_SLUGS = {
    "Q4 — Life Insurance & Takaful Relief": "life-insurance",
    "Q4 — EPF Personal Contribution":       "epf",
    "Q4 — Medical & Parental Care":         "medical-parental",
    "Q4 — Lifestyle Relief":                "lifestyle",
    "Q4 — Education Relief":                "education",
    "Q4 — Child Relief":                    "child",
    "Q4 — Medical Equipment Relief":        "medical-equipment",
    "Q4 — Private Retirement Scheme (PRS)": "prs",
    "Q4 — SOCSO Personal Contribution":     "socso",
    "Q4 — Domestic Tourism Relief":         "tourism",
    "Q4 — EV Charging Equipment":           "ev-charging",
}


# ══════════════════════════════════════════════════════════════════════════════
# TAX AMENDMENT LOCK — single source of truth (Flaw B)
# The lock condition is FormBProfile ROW EXISTENCE for (user, entity, YA):
# profiles are only ever created from uploaded, previously-FILED Form B
# returns (pipeline's 'Q1 — Filed Form B (Prior Year)' path), so existence
# means "already submitted to LHDN". There is no is_submitted column in this
# schema. Both the engine (skip analysis) and the router (is_locked flag +
# server-side action rejection) call THESE functions — the condition is
# defined exactly once.
# ══════════════════════════════════════════════════════════════════════════════

def is_assessment_year_locked(db: Session, user_id, entity_id: Optional[int],
                              assessment_year: int) -> bool:
    """True when (user, entity, assessment_year) has a filed Form B on record."""
    q = db.query(FormBProfile.id).filter(
        FormBProfile.user_id == str(user_id),
        FormBProfile.year_of_assessment == assessment_year,
    )
    if entity_id is not None:
        q = q.filter(FormBProfile.entity_id == entity_id)
    return bool(db.query(q.exists()).scalar())


def get_locked_year_pairs(db: Session, user_id,
                          pairs: Iterable[tuple[Optional[int], int]]) -> set[tuple[Optional[int], int]]:
    """Batched form of is_assessment_year_locked for the GET feed: one query
    against FormBProfile covering every distinct (entity_id, assessment_year)
    pair, applying the exact same match semantics (entity_id None → any of the
    user's filed returns for that YA locks it; entity_id set → only that
    entity's filed return locks it)."""
    pairs = set(pairs)
    years = {ya for _, ya in pairs if ya is not None}
    if not years:
        return set()
    rows = db.query(FormBProfile.entity_id, FormBProfile.year_of_assessment).filter(
        FormBProfile.user_id == str(user_id),
        FormBProfile.year_of_assessment.in_(years),
    ).all()
    entities_by_year: dict[int, set] = {}
    for ent, ya in rows:
        entities_by_year.setdefault(ya, set()).add(ent)
    locked = set()
    for ent, ya in pairs:
        filed_entities = entities_by_year.get(ya)
        if not filed_entities:
            continue
        if ent is None or ent in filed_entities:
            locked.add((ent, ya))
    return locked


# ══════════════════════════════════════════════════════════════════════════════
# GEMINI CIRCUIT BREAKER (Pipeline B only)
# Opens on rate-limit (429 / ResourceExhausted) or timeout; while open, every
# engine run in this process skips the LLM instantly instead of stacking
# Gunicorn workers behind a throttled endpoint. Process-local by design: each
# worker process discovers throttling with at most one failed call, then stays
# clear for the cooldown. Never blocks or retries — the deterministic pipeline
# is unaffected either way.
# ══════════════════════════════════════════════════════════════════════════════

_gemini_circuit = {"open_until": 0.0, "reason": ""}
_gemini_circuit_lock = threading.Lock()


def _gemini_circuit_open_reason() -> Optional[str]:
    with _gemini_circuit_lock:
        if time.monotonic() < _gemini_circuit["open_until"]:
            return _gemini_circuit["reason"]
    return None


def _trip_gemini_circuit(reason: str) -> None:
    with _gemini_circuit_lock:
        _gemini_circuit["open_until"] = time.monotonic() + GEMINI_CIRCUIT_COOLDOWN_SECONDS
        _gemini_circuit["reason"] = reason
    logger.warning(
        f"[Insights] Gemini circuit OPEN for {GEMINI_CIRCUIT_COOLDOWN_SECONDS}s: {reason}"
    )


def _is_rate_limit_error(e: Exception) -> bool:
    if type(e).__name__ in ("ResourceExhausted", "TooManyRequests", "RateLimitError"):
        return True
    s = str(e)
    return (
        "429" in s
        or "RESOURCE_EXHAUSTED" in s.upper()
        or "rate limit" in s.lower()
        or "quota" in s.lower()
    )


def _is_timeout_error(e: Exception) -> bool:
    if "Timeout" in type(e).__name__ or "Deadline" in type(e).__name__:
        return True
    s = str(e).lower()
    return "timed out" in s or "timeout" in s or "deadline exceeded" in s


# ── Small pure helpers ────────────────────────────────────────────────────────

def _fmt_rm(value) -> str:
    return f"RM {float(value):,.2f}"


def _slugify(text_value: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text_value or "").lower()).strip("-")
    return s[:32] or "unknown"


def _month_str(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _next_month(ym: str) -> str:
    y, m = int(ym[:4]), int(ym[5:7])
    return f"{y + 1:04d}-01" if m == 12 else f"{y:04d}-{m + 1:02d}"


def _months_between(start_exclusive: str, end_inclusive: str) -> list[str]:
    """Months strictly after start_exclusive up to and including end_inclusive."""
    months, cur = [], _next_month(start_exclusive)
    while cur <= end_inclusive:
        months.append(cur)
        cur = _next_month(cur)
    return months


def _sub_key_hash(sub_key: str) -> str:
    return hashlib.sha1(sub_key.encode("utf-8")).hexdigest()[:12]


def _advisory_lock_key(value: str) -> int:
    """Map an arbitrary string to a signed 64-bit key for pg_advisory_xact_lock.
    SHA-1 keeps the mapping stable across processes and Python versions
    (unlike hash(), which is salted per process)."""
    digest = hashlib.sha1(value.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big", signed=True)


def build_dedupe_key(user_id: int, entity_id: Optional[int], assessment_year: int,
                     insight_type: str, sub_key: str) -> str:
    """Canonical dedupe key. Shared with the backfill script so old rows are
    migrated to byte-identical keys."""
    ent = entity_id if entity_id is not None else "-"
    return f"u{user_id}:e{ent}:ya{assessment_year}:{insight_type}:{_sub_key_hash(sub_key)}"


class TaxInsightEngine:
    """One run = recompute insights for a single (user, entity,
    assessment_year) scope — optionally restricted to a subset of insight
    types (scoped re-run after a rule-version mismatch). Holds NO long-lived
    session: facts are gathered in one short session, rules and the LLM run
    with no session at all, and each pipeline's writes commit independently
    in fresh, advisory-locked, retried transactions."""

    def __init__(self, session_factory: Callable[[], Session], user_id: int,
                 entity_id: Optional[int], trigger: str,
                 assessment_year: Optional[int] = None,
                 only_insight_types: Optional[Iterable[str]] = None,
                 initial_logs: Optional[list[str]] = None):
        self.session_factory = session_factory
        self.user_id = user_id            # Integer — matches Person.id
        self.doc_user_id = str(user_id)   # Documents store user_id as String(128)
        self.entity_id = entity_id
        self.trigger = trigger
        self.today = date.today()
        # The TAX year under analysis — from the triggering document, never
        # the wall clock (Flaw A). Out-of-range/absent values fall back to the
        # current year, which is also the correct default for manual refresh.
        if assessment_year is not None and 2000 <= int(assessment_year) <= 2100:
            self.ya = int(assessment_year)
        else:
            self.ya = self.today.year
        self.is_current_ya = self.ya == self.today.year
        # Scoped re-run support: when set, only these insight types are
        # recomputed AND housekeeping (wake / auto-resolve) is restricted to
        # them, so a scoped run can never resolve or wake unrelated cards.
        if only_insight_types:
            self.only_types: Optional[frozenset] = frozenset(only_insight_types) & frozenset(ENGINE_MANAGED_TYPES)
        else:
            self.only_types = None
        self.logs: list[str] = list(initial_logs or [])

    def _type_enabled(self, insight_type: str) -> bool:
        return self.only_types is None or insight_type in self.only_types

    # ── Scoped dedupe key ────────────────────────────────────────────────────
    def _key(self, insight_type: str, sub_key: str) -> str:
        return build_dedupe_key(self.user_id, self.entity_id, self.ya, insight_type, sub_key)

    def _scope_string(self) -> str:
        ent = self.entity_id if self.entity_id is not None else "-"
        return f"u{self.user_id}:e{ent}:ya{self.ya}"

    # ── Phase 1: fact gathering (one short session) ──────────────────────────
    def _gather_facts(self) -> dict:
        """Everything the rules need from the database, collected in a single
        short-lived session that is closed before any LLM call happens."""
        db = self.session_factory()
        try:
            if is_assessment_year_locked(db, self.doc_user_id, self.entity_id, self.ya):
                return {"locked": True, "summary": None, "cy": {}, "prior_formb_exists": False}

            # Reuse the dashboard's own year summary — totals, bracket
            # headroom, pending reviews, CP500 installments, relief caps —
            # instead of re-deriving any of it. Deferred import: see module
            # docstring.
            import main as main_module
            summary = None
            try:
                summary = main_module.get_tax_profile_summary(
                    year=self.ya,
                    user_id=self.doc_user_id,
                    entity_id=self.entity_id,
                    db=db,
                )
            except Exception as e:
                self.logs.append(f"summary load failed: {e}")

            prior_ya = self.ya - 1
            prior_q = db.query(FormBProfile.id).filter(
                FormBProfile.user_id == self.doc_user_id,
                FormBProfile.year_of_assessment == prior_ya,
            )
            if self.entity_id is not None:
                prior_q = prior_q.filter(FormBProfile.entity_id == self.entity_id)
            prior_formb_exists = db.query(prior_q.exists()).scalar()

            return {
                "locked": False,
                "summary": summary,
                "cy": (summary or {}).get("currentYear") or {},
                "prior_formb_exists": bool(prior_formb_exists),
            }
        finally:
            db.close()

    # ── Phase 2, Pipeline A: deterministic rules (pure — no session held) ────
    def _rule_cp500_deadline(self, cy: dict) -> list[dict]:
        installments = cy.get("cp500Installments") or []
        if not installments:
            return []
        n_paid = len(installments)
        if n_paid >= len(CP500_MONTHS):
            return []

        amounts = [float(i.get("installmentAmountNumeric") or 0) for i in installments]
        amounts = [a for a in amounts if a > 0]
        expected = round(statistics.median(amounts), 2) if amounts else None
        total_paid = round(sum(amounts), 2)

        # Due dates belong to the YA under analysis. For a past YA every date
        # has passed, so this rule naturally produces nothing — a backdated
        # receipt can't spawn a phantom deadline.
        upcoming = None
        for m in CP500_MONTHS:
            due = date(self.ya, m, CP500_DUE_DAY)
            if due >= self.today:
                upcoming = due
                break
        if upcoming is None:
            return []
        days_left = (upcoming - self.today).days
        if days_left > CP500_LOOKAHEAD_DAYS:
            return []

        next_no = n_paid + 1
        title = (
            f"CP500 installment #{next_no}"
            + (f" — {_fmt_rm(expected)} due soon" if expected else " due soon")
        )
        body = (
            f"Your next bimonthly tax installment"
            + (f" of {_fmt_rm(expected)}" if expected else "")
            + f" is due around {upcoming.strftime('%d %b %Y')}. You have paid "
            f"{n_paid} installment{'s' if n_paid != 1 else ''}"
            + (f" ({_fmt_rm(total_paid)})" if total_paid else "")
            + f" for YA {self.ya} so far. Missing an installment attracts a 10% "
            "late-payment penalty on the amount due under s.107B."
        )
        signals = [
            {"label": "Installments detected", "value": f"{n_paid} CP500 receipt{'s' if n_paid != 1 else ''} in your vault"},
            {"label": f"Total paid YA{self.ya}", "value": _fmt_rm(total_paid) if total_paid else "—"},
            {"label": "Next installment", "value": f"#{next_no} — due {upcoming.strftime('%d %b %Y')}"},
            {"label": "Typical installment", "value": _fmt_rm(expected) if expected else "Unknown — check your CP500 notice"},
        ]
        return [{
            "insight_type": "deadline",
            "severity": "deadline",
            "generated_by": "rule_template",
            "dedupe_key": self._key("deadline", f"cp500:{upcoming.year:04d}-{upcoming.month:02d}"),
            "title": title,
            "body": body,
            "rm_impact": expected,
            "deadline_date": upcoming,
            "citation": "ITA 1967 s.107B",
            "signals": signals,
            "source_document_ids": [i.get("documentId") for i in installments if i.get("documentId")],
            "action": {"label": "View installment history", "to": "/account"},
        }]

    def _rule_review_pending(self, cy: dict) -> list[dict]:
        import main as main_module
        pending = cy.get("mixedPendingReview") or []
        cards = []
        for entry in pending[:REVIEW_PENDING_MAX_CARDS]:
            doc_id = entry.get("documentId")
            if not doc_id:
                continue
            amount = float(entry.get("amountNumeric") or 0)
            category = entry.get("category") or ""
            vendor = entry.get("vendor") or entry.get("fileName") or "a document"

            # Blocked value = what is currently EXCLUDED from the user's totals.
            # For apportioned categories with a known statutory/default split,
            # the realistic blocked deduction is pct% of the amount; otherwise
            # the whole amount is held out pending the answer.
            spec = main_module.APPORTIONED_CATEGORIES.get(category)
            if spec and spec.get("pct") is not None:
                blocked = round(amount * spec["pct"] / 100, 2)
            else:
                blocked = round(amount, 2)

            question = entry.get("question") or "Confirm how this document should be treated for tax."
            reason = entry.get("reason") or "The AI could not fully resolve this document's tax treatment."

            signals = [
                {"label": "Document", "value": f"{vendor} — {_fmt_rm(amount)}" if amount else str(vendor)},
                {"label": "Category", "value": category or "Pending review"},
                {"label": "Why it's stuck", "value": reason[:180]},
                {"label": "Held out of your totals", "value": _fmt_rm(blocked) if blocked else "—"},
            ]
            cards.append({
                "insight_type": "review_pending",
                "severity": "action_required",
                "generated_by": "rule_template",
                "dedupe_key": self._key("review_pending", f"doc-{doc_id}"),
                "title": (
                    f"One answer is blocking {_fmt_rm(blocked)} in your totals"
                    if blocked else "A document needs your answer to be counted"
                ),
                "body": f"{reason} {question}",
                "rm_impact": blocked or None,
                "deadline_date": None,
                "citation": _REVIEW_CITATIONS.get(category, "ITA 1967 s.33(1)"),
                "signals": signals,
                "source_document_ids": [doc_id],
                "action": {"label": "Answer now", "to": "/account"},
            })
        if len(pending) > REVIEW_PENDING_MAX_CARDS:
            self.logs.append(
                f"review_pending: {len(pending)} pending items, capped at {REVIEW_PENDING_MAX_CARDS} cards"
            )
        return cards

    def _rule_relief_headroom(self, cy: dict) -> list[dict]:
        import main as main_module
        totals = cy.get("totals") or {}
        if float(totals.get("totalIncome") or 0) <= 0:
            return []
        marginal = totals.get("currentMarginalRatePct")
        if not marginal or marginal <= 0:
            return []

        claimed_by_cat = {
            b["category"]: float(b.get("cappedTotal") or 0)
            for b in (totals.get("q4ReliefsBreakdown") or [])
        }

        candidates = []
        for cat, cap in main_module.RELIEF_CAPS_FALLBACK_MYR.items():
            claimed = claimed_by_cat.get(cat, 0.0)
            headroom = float(cap) - claimed
            if headroom < RELIEF_HEADROOM_MIN_MYR:
                continue
            saving = round(headroom * marginal / 100, 2)
            candidates.append((cat, cap, claimed, headroom, saving))

        candidates.sort(key=lambda c: c[4], reverse=True)
        cards = []
        for cat, cap, claimed, headroom, saving in candidates[:RELIEF_HEADROOM_MAX_CARDS]:
            slug = _RELIEF_SLUGS.get(cat, _slugify(cat))
            short_name = cat.replace("Q4 — ", "")
            # A countdown only makes sense while the relief window is still
            # open — i.e. when analysing the current calendar year. For a
            # backdated YA the headroom is still reportable at filing time,
            # but there is no live deadline to count down to.
            window_close = date(self.ya, 12, 31) if self.is_current_ya else None
            if self.is_current_ya:
                body = (
                    f"You have claimed {_fmt_rm(claimed)} of the {_fmt_rm(cap)} "
                    f"{short_name} cap this year. Using the remaining "
                    f"{_fmt_rm(headroom)} before 31 December could save you up to "
                    f"{_fmt_rm(saving)} in tax at your current {marginal:.0f}% marginal rate."
                )
            else:
                body = (
                    f"For YA {self.ya}, you claimed {_fmt_rm(claimed)} of the "
                    f"{_fmt_rm(cap)} {short_name} cap. If you have qualifying "
                    f"receipts from {self.ya} that were never uploaded, the remaining "
                    f"{_fmt_rm(headroom)} could be worth up to {_fmt_rm(saving)} at "
                    f"your {marginal:.0f}% marginal rate for that year."
                )
            signals = [
                {"label": "Claimed so far", "value": f"{_fmt_rm(claimed)} of {_fmt_rm(cap)} cap"},
                {"label": "Your marginal tax rate", "value": f"{marginal:.0f}%"},
                {"label": "Potential tax saving", "value": f"{_fmt_rm(headroom)} × {marginal:.0f}% = {_fmt_rm(saving)}"},
            ]
            if window_close:
                signals.append({"label": "Window closes", "value": window_close.strftime("%d %b %Y")})
            cards.append({
                "insight_type": "relief_headroom",
                "severity": "suggested",
                "generated_by": "rule_template",
                "dedupe_key": self._key("relief_headroom", slug),
                "title": f"{_fmt_rm(headroom)} of {short_name} still unclaimed",
                "body": body,
                "rm_impact": saving,
                "deadline_date": window_close,
                "citation": "Schedule 9, ITA 1967",
                "signals": signals,
                "source_document_ids": [],
                "action": {"label": "How to claim this", "to": "/cukaibot"},
            })
        return cards

    def _rule_doc_gap(self, cy: dict) -> list[dict]:
        """Recurring-expense gap: a vendor billed monthly for ≥3 months in this
        YA, then the trail goes cold — likely unclaimed deductions. The gap
        window never extends past the YA under analysis (December of that
        year), so a backdated run can't report months from the following year."""
        prev_month_end = self.today.replace(day=1) - timedelta(days=1)
        window_end = min(_month_str(prev_month_end), f"{self.ya:04d}-12")

        by_vendor: dict[str, dict] = {}
        for entry in cy.get("q3Deductions") or []:
            vendor = (entry.get("vendor") or "").strip()
            d = entry.get("date") or ""
            if not vendor or not re.match(r"^\d{4}-\d{2}", d):
                continue
            v = by_vendor.setdefault(vendor, {"months": {}, "doc_ids": [], "category": entry.get("category")})
            month = d[:7]
            v["months"].setdefault(month, []).append(float(entry.get("amountNumeric") or 0))
            if entry.get("documentId"):
                v["doc_ids"].append(entry["documentId"])

        cards = []
        for vendor, v in by_vendor.items():
            months_present = sorted(v["months"])
            if len(months_present) < DOC_GAP_MIN_MONTHS_PRESENT:
                continue
            last_present = months_present[-1]
            if last_present >= window_end:
                continue  # trail is current for this YA — no gap
            missing = _months_between(last_present, window_end)
            if not missing or len(missing) > DOC_GAP_MAX_TRAILING_MISSING:
                continue

            monthly_totals = [sum(amts) for amts in v["months"].values()]
            avg = round(statistics.mean(monthly_totals), 2)
            if avg <= 0:
                continue
            unclaimed = round(avg * len(missing), 2)
            missing_names = ", ".join(
                date(int(m[:4]), int(m[5:7]), 1).strftime("%b") for m in missing
            )
            first_m, last_m = months_present[0], last_present
            span = (
                f"{date(int(first_m[:4]), int(first_m[5:7]), 1).strftime('%b')}–"
                f"{date(int(last_m[:4]), int(last_m[5:7]), 1).strftime('%b %Y')}"
            )
            cards.append({
                "insight_type": "doc_gap",
                "severity": "action_required",
                "generated_by": "rule_template",
                "dedupe_key": self._key("doc_gap", f"{_slugify(vendor)}:{missing[0]}"),
                "title": f"{vendor} bills stopped arriving in {date(int(missing[0][:4]), int(missing[0][5:7]), 1).strftime('%B')}",
                "body": (
                    f"Bills from {vendor} were uploaded every month from {span} "
                    f"(about {_fmt_rm(avg)}/month), but {missing_names} "
                    f"{'is' if len(missing) == 1 else 'are'} missing. That is roughly "
                    f"{_fmt_rm(unclaimed)} in business deductions currently unclaimed."
                ),
                "rm_impact": unclaimed,
                "deadline_date": None,
                "citation": "ITA 1967 s.33(1)",
                "signals": [
                    {"label": "Pattern detected", "value": f"{vendor} · monthly · {span}"},
                    {"label": "Average bill", "value": f"{_fmt_rm(avg)} / month"},
                    {"label": "Missing months", "value": missing_names},
                    {"label": "Estimated unclaimed", "value": f"{len(missing)} × {_fmt_rm(avg)} ≈ {_fmt_rm(unclaimed)}"},
                ],
                "source_document_ids": v["doc_ids"],
                "action": {"label": "Upload the missing bills", "to": "/account"},
            })
        return cards

    def _rule_provision(self, summary: dict, cy: dict) -> list[dict]:
        # summary["projection"] is only produced for the current calendar year
        # (main.py guards on year == today.year), so a backdated YA run
        # naturally emits no provision card.
        proj = summary.get("projection") or {}
        projected_tax = float(proj.get("projectedTaxPayable") or 0)
        if projected_tax <= 0:
            return []
        cp500_paid = float((cy.get("totals") or {}).get("cp500Paid") or 0)
        remaining = round(projected_tax - cp500_paid, 2)
        if remaining <= 0:
            return []
        months_left = max(1, 12 - self.today.month)
        monthly = round(remaining / months_left, 2)
        return [{
            "insight_type": "provision",
            "severity": "info",
            "generated_by": "rule_template",
            "dedupe_key": self._key("provision", "set-aside"),
            "title": f"Set aside ~{_fmt_rm(monthly)}/month for your YA {self.ya} tax bill",
            "body": (
                f"Based on your income so far, your projected tax for YA {self.ya} is "
                f"about {_fmt_rm(projected_tax)}. After the {_fmt_rm(cp500_paid)} in "
                f"CP500 installments already paid, setting aside {_fmt_rm(monthly)} a "
                f"month over the remaining {months_left} month{'s' if months_left != 1 else ''} "
                "covers the balance comfortably by filing time."
            ),
            "rm_impact": None,
            "deadline_date": None,
            "citation": "Run-rate estimate — not a final tax computation",
            "signals": [
                {"label": "Projected tax (run-rate)", "value": _fmt_rm(projected_tax)},
                {"label": "CP500 already paid", "value": _fmt_rm(cp500_paid)},
                {"label": "Remaining to cover", "value": _fmt_rm(remaining)},
                {"label": "Suggested monthly set-aside", "value": f"{_fmt_rm(remaining)} ÷ {months_left} months ≈ {_fmt_rm(monthly)}"},
            ],
            "source_document_ids": [],
            "action": {"label": "See full breakdown", "to": "/overview"},
        }]

    def _rule_formb_missing(self, cy: dict, prior_formb_exists: bool) -> list[dict]:
        if (cy.get("documentCount") or 0) == 0:
            return []  # empty year — nothing to compare a prior Form B against yet
        if prior_formb_exists:
            return []
        prior_ya = self.ya - 1
        return [{
            "insight_type": "formb_missing",
            "severity": "suggested",
            "generated_by": "rule_template",
            "dedupe_key": self._key("formb_missing", f"prior-{prior_ya}"),
            "title": f"Upload your filed YA {prior_ya} Form B to unlock smarter insights",
            "body": (
                f"We do not have your filed YA {prior_ya} Form B. Uploading it gives "
                "the AI your official prior-year baseline — enabling carry-forward "
                "tracking, year-on-year comparisons, and more accurate relief suggestions."
            ),
            "rm_impact": None,
            "deadline_date": None,
            "citation": None,
            "signals": [
                {"label": "Prior-year Form B on file", "value": f"None found for YA {prior_ya}"},
                {"label": "Unlocks", "value": "Carry-forward losses · YoY gaps · relief history"},
            ],
            "source_document_ids": [],
            "action": {"label": "Upload Form B", "to": "/account"},
        }]

    # ── Phase 2, Pipeline B: the LLM-phrased digest (no session held) ───────
    def _build_digest(self, summary: dict, cy: dict, other_cards: list[dict]) -> list[dict]:
        totals = cy.get("totals") or {}
        income = float(totals.get("totalIncome") or 0)
        if income <= 0 and not other_cards:
            return []

        pending = [c for c in other_cards if c["insight_type"] == "review_pending"]
        pending_value = round(sum(c["rm_impact"] or 0 for c in pending), 2)
        reliefs = [c for c in other_cards if c["insight_type"] == "relief_headroom"]
        top_relief = reliefs[0] if reliefs else None
        deadlines = [c for c in other_cards if c["insight_type"] == "deadline"]
        next_deadline = deadlines[0] if deadlines else None

        prior_income = None
        for yr in summary.get("yearlyTrend") or []:
            if yr.get("year") == self.ya - 1:
                prior_income = float((yr.get("totals") or {}).get("totalIncome") or 0)

        facts = {
            "assessment_year": self.ya,
            "is_current_year": self.is_current_ya,
            "generated_in_month": self.today.strftime("%B %Y"),
            "income_ytd_myr": round(income, 2),
            "prior_full_year_income_myr": prior_income,
            "pending_review_count": len(pending),
            "pending_review_blocked_myr": pending_value,
            "top_unclaimed_relief": top_relief["title"] if top_relief else None,
            "top_relief_potential_saving_myr": (top_relief["rm_impact"] if top_relief else None),
            "next_deadline": (next_deadline["title"] if next_deadline else None),
            "next_deadline_date": (
                next_deadline["deadline_date"].isoformat() if next_deadline and next_deadline["deadline_date"] else None
            ),
            "projected_tax_myr": float((summary.get("projection") or {}).get("projectedTaxPayable") or 0) or None,
        }

        signals = [
            {"label": f"YA{self.ya} income recorded", "value": _fmt_rm(income)},
        ]
        if prior_income:
            signals.append({"label": f"YA{self.ya - 1} total income", "value": _fmt_rm(prior_income)})
        signals.append({
            "label": "Pending review questions",
            "value": f"{len(pending)}" + (f" — worth ~{_fmt_rm(pending_value)}" if pending_value else ""),
        })
        if top_relief:
            signals.append({"label": "Top unclaimed relief", "value": top_relief["title"]})
        if next_deadline:
            signals.append({"label": "Next deadline", "value": next_deadline["title"]})

        body, generated_by = self._phrase_digest_with_llm(facts)
        if body is None:
            body = self._phrase_digest_fallback(facts)
            generated_by = "rule_template"

        title = (
            f"Your {self.today.strftime('%B')} tax brief"
            if self.is_current_ya
            else f"Your YA {self.ya} catch-up brief"
        )
        return [{
            "insight_type": "digest",
            "severity": "info",
            "generated_by": generated_by,
            "dedupe_key": self._key("digest", self.today.strftime("%Y-%m")),
            "title": title,
            "body": body,
            "rm_impact": None,
            "deadline_date": None,
            "citation": None,
            "signals": signals,
            "source_document_ids": [],
            "action": {"label": "Ask CukaiBot about this", "to": "/cukaibot"},
        }]

    def _phrase_digest_with_llm(self, facts: dict) -> tuple[Optional[str], str]:
        """Ask Gemini to word the digest from rule-computed facts. Bounded:
        explicit 15s HTTP timeout, one transient retry, circuit breaker on
        rate-limit/timeout. Any failure returns (None, ...) so the
        deterministic fallback takes over — never raises. Runs with NO database
        session held (a 15s LLM stall must never pin a pooled connection)."""
        open_reason = _gemini_circuit_open_reason()
        if open_reason:
            self.logs.append(f"digest LLM skipped: circuit breaker open ({open_reason})")
            return None, "rule_template"

        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            self.logs.append("digest LLM skipped: GEMINI_API_KEY not set")
            return None, "rule_template"
        try:
            from langchain_google_genai import ChatGoogleGenerativeAI
            from langchain_core.messages import HumanMessage, SystemMessage

            llm = ChatGoogleGenerativeAI(
                model="gemini-3.1-flash-lite",
                api_key=api_key,
                temperature=0.3,
                timeout=GEMINI_TIMEOUT_SECONDS,
                max_retries=GEMINI_MAX_RETRIES,
                convert_system_message_to_human=True,
            )
            system = (
                "You write a short tax brief for a Malaysian sole proprietor about one "
                "specific Year of Assessment (YA). Use ONLY the facts provided — do not "
                "invent numbers, deadlines, or advice beyond them. If is_current_year is "
                "false, frame it as a catch-up on that past year's records, not as "
                "this-month news. 2-3 sentences, warm but professional, amounts formatted "
                "like 'RM 1,234'. Lead with the single most useful thing the user should "
                "know. Return plain text only, no markdown, no preamble."
            )
            resp = llm.invoke([
                SystemMessage(content=system),
                HumanMessage(content="Facts (JSON):\n" + json.dumps(facts, default=str)),
            ])
            text_out = (resp.content or "").strip() if hasattr(resp, "content") else ""
            if isinstance(text_out, list):  # some LangChain versions return content parts
                text_out = " ".join(str(p) for p in text_out).strip()
            if not text_out or len(text_out) < 30:
                self.logs.append("digest LLM returned empty/too-short text — using template fallback")
                return None, "rule_template"
            return text_out[:2000], "llm"
        except Exception as e:
            if _is_rate_limit_error(e):
                reason = f"rate limited ({type(e).__name__})"
                _trip_gemini_circuit(reason)
                self.logs.append(f"digest LLM aborted: {reason}: {e} — circuit opened, template fallback used")
            elif _is_timeout_error(e):
                reason = f"timeout after {GEMINI_TIMEOUT_SECONDS}s ({type(e).__name__})"
                _trip_gemini_circuit(reason)
                self.logs.append(f"digest LLM aborted: {reason} — circuit opened, template fallback used")
            else:
                self.logs.append(f"digest LLM failed ({type(e).__name__}): {e}")
            return None, "rule_template"

    def _phrase_digest_fallback(self, facts: dict) -> str:
        year_label = f"YA {self.ya}"
        parts = [f"Recorded income for {year_label} is {_fmt_rm(facts['income_ytd_myr'])}."]
        if facts.get("prior_full_year_income_myr"):
            parts[-1] = (
                f"Recorded income for {year_label} is {_fmt_rm(facts['income_ytd_myr'])} "
                f"(YA{self.ya - 1} full-year total: {_fmt_rm(facts['prior_full_year_income_myr'])})."
            )
        if facts.get("pending_review_count"):
            parts.append(
                f"{facts['pending_review_count']} review question"
                f"{'s are' if facts['pending_review_count'] != 1 else ' is'} holding "
                f"~{_fmt_rm(facts['pending_review_blocked_myr'])} out of your totals."
            )
        if facts.get("top_relief_potential_saving_myr"):
            parts.append(
                f"Your biggest unclaimed relief could save up to "
                f"{_fmt_rm(facts['top_relief_potential_saving_myr'])} in tax."
            )
        if facts.get("next_deadline"):
            parts.append(f"Coming up: {facts['next_deadline']}.")
        return " ".join(parts)

    # ── Phase 3: persistence (fresh session, advisory-locked, retried) ──────
    def _persist_once(self, cards: list[dict], housekeeping: bool) -> tuple[int, int, int]:
        """One attempt at a write transaction. Everything below happens in a
        single transaction on a session opened here and closed here:

          1. pg_advisory_xact_lock on the (user, entity, YA) scope, then on
             each card's dedupe_key hash IN SORTED ORDER — consistent global
             lock ordering means concurrent bulk-upload runs queue instead of
             deadlocking, across threads and across worker processes.
          2. Snapshot existing lifecycle state (for the >15% reopen rule —
             the one deliberately SELECT-first path).
          3. Atomic INSERT ... ON CONFLICT (dedupe_key, assessment_year)
             DO UPDATE for every card, stamped with the current
             TAX_RULES_VERSION and stale=False. Content refreshes; user
             lifecycle state is never clobbered.
          4. When housekeeping=True (Pipeline A only): conditional reopen /
             snooze-wake / stale auto-resolve, scoped to this (user, entity,
             YA) and — on scoped re-runs — to the run's insight types only.
        """
        now = datetime.now(timezone.utc)
        cards = sorted(cards, key=lambda c: c["dedupe_key"])
        keys = [c["dedupe_key"] for c in cards]

        db = self.session_factory()
        try:
            # 1 — advisory locks (transaction-scoped: released on commit/rollback)
            lock_values = sorted({self._scope_string(), *keys})
            for value in lock_values:
                db.execute(
                    text("SELECT pg_advisory_xact_lock(:k)"),
                    {"k": _advisory_lock_key(value)},
                )

            # 2 — lifecycle snapshot for the reopen rule
            existing = {}
            if keys:
                rows = db.query(Insight).filter(
                    Insight.dedupe_key.in_(keys),
                    Insight.assessment_year == self.ya,
                ).all()
                for row in rows:
                    existing[row.dedupe_key] = {
                        "state": row.state,
                        "rm_impact": float(row.rm_impact) if row.rm_impact is not None else None,
                    }

            # 3 — atomic upserts (rule-version stamped)
            created = updated = 0
            for c in cards:
                stmt = pg_insert(Insight.__table__).values(
                    user_id=self.user_id,
                    entity_id=self.entity_id,
                    insight_type=c["insight_type"],
                    severity=c["severity"],
                    generated_by=c["generated_by"],
                    assessment_year=self.ya,
                    state="new",
                    dedupe_key=c["dedupe_key"],
                    title=c["title"],
                    body=c["body"],
                    rm_impact=c["rm_impact"],
                    deadline_date=c["deadline_date"],
                    citation=c["citation"],
                    signals=c["signals"],
                    source_document_ids=c["source_document_ids"],
                    action=c["action"],
                    rule_version=TAX_RULES_VERSION,
                    stale=False,
                    created_at=now,
                    updated_at=now,
                ).on_conflict_do_update(
                    index_elements=[
                        Insight.__table__.c.dedupe_key,
                        Insight.__table__.c.assessment_year,
                    ],
                    # Refresh content only — never clobber the user's lifecycle
                    # state, dismiss reason, snooze, or created_at on re-runs.
                    # rule_version/stale refresh: this IS the fresh, auditable
                    # recomputation a stale wake asked for.
                    set_={
                        "severity": c["severity"],
                        "generated_by": c["generated_by"],
                        "title": c["title"],
                        "body": c["body"],
                        "rm_impact": c["rm_impact"],
                        "deadline_date": c["deadline_date"],
                        "citation": c["citation"],
                        "signals": c["signals"],
                        "source_document_ids": c["source_document_ids"],
                        "action": c["action"],
                        "rule_version": TAX_RULES_VERSION,
                        "stale": False,
                        "updated_at": now,
                    },
                )
                db.execute(stmt)
                if c["dedupe_key"] in existing:
                    updated += 1
                else:
                    created += 1

            resolved = 0
            if housekeeping:
                # 4a — reopen dismissed/actioned insights whose impact moved > threshold
                for c in cards:
                    old = existing.get(c["dedupe_key"])
                    if not old or old["state"] not in ("dismissed", "actioned"):
                        continue
                    if self._impact_changed_significantly(old["rm_impact"], c["rm_impact"]):
                        db.query(Insight).filter(
                            Insight.dedupe_key == c["dedupe_key"],
                            Insight.assessment_year == self.ya,
                        ).update({
                            "state": "new",
                            "dismiss_reason": None,
                            "resolved_note": None,
                            "snooze_until": None,
                            "updated_at": now,
                        }, synchronize_session=False)
                        self.logs.append(
                            f"reopened {c['dedupe_key']}: rm_impact {old['rm_impact']} → {c['rm_impact']}"
                        )

                # Scoped re-runs restrict housekeeping to their own types so
                # they can never wake or resolve unrelated cards.
                if self.only_types is None:
                    housekeeping_types = AUTO_RESOLVE_TYPES
                else:
                    housekeeping_types = tuple(t for t in AUTO_RESOLVE_TYPES if t in self.only_types)

                if housekeeping_types:
                    # 4b — wake expired snoozes for this scope. Version-mismatch
                    # handling isn't needed here: this same transaction has just
                    # upserted fresh, current-version figures for every card the
                    # rules still generate, and 4c resolves the ones they don't.
                    snooze_q = db.query(Insight).filter(
                        Insight.user_id == self.user_id,
                        Insight.assessment_year == self.ya,
                        Insight.insight_type.in_(housekeeping_types),
                        Insight.state == "dismissed",
                        Insight.snooze_until.isnot(None),
                        Insight.snooze_until <= self.today,
                    )
                    snooze_q = self._entity_scope(snooze_q)
                    snooze_q.update({
                        "state": "new", "dismiss_reason": None, "snooze_until": None, "updated_at": now,
                    }, synchronize_session=False)

                    # 4c — auto-resolve insights whose underlying condition no
                    # longer holds: engine-managed types (digest excepted) still
                    # active in THIS assessment year but not regenerated by this
                    # run.
                    stale_q = db.query(Insight).filter(
                        Insight.user_id == self.user_id,
                        Insight.assessment_year == self.ya,
                        Insight.insight_type.in_(housekeeping_types),
                        Insight.state.in_(["new", "read"]),
                    )
                    stale_q = self._entity_scope(stale_q)
                    if keys:
                        stale_q = stale_q.filter(Insight.dedupe_key.notin_(keys))
                    resolved = stale_q.update({
                        "state": "actioned",
                        "resolved_note": "Resolved automatically — the underlying condition no longer applies.",
                        "stale": False,
                        "updated_at": now,
                    }, synchronize_session=False)

            db.commit()
            return created, updated, resolved
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def _entity_scope(self, query):
        if self.entity_id is not None:
            return query.filter(Insight.entity_id == self.entity_id)
        return query.filter(Insight.entity_id.is_(None))

    def _persist_with_retry(self, cards: list[dict], housekeeping: bool) -> tuple[int, int, int]:
        """Jittered exponential backoff around the write transaction for
        transient lock contention / serialization failures (Flaw C). Each
        attempt uses a brand-new session (the failed one is already closed).
        This is the ONLY database retry loop — Gemini failures are handled
        upstream by the circuit breaker and never reach this code path."""
        last_exc: Optional[Exception] = None
        for attempt in range(UPSERT_MAX_ATTEMPTS):
            try:
                return self._persist_once(cards, housekeeping)
            except (OperationalError, DBAPIError) as e:
                last_exc = e
                if attempt == UPSERT_MAX_ATTEMPTS - 1:
                    break
                delay = UPSERT_BACKOFF_BASE_SECONDS * (2 ** attempt)
                delay += random.uniform(0, delay / 2)  # jitter
                self.logs.append(
                    f"persist attempt {attempt + 1} failed ({type(e).__name__}); retrying in {delay:.2f}s"
                )
                logger.warning(
                    f"[Insights] Persist attempt {attempt + 1}/{UPSERT_MAX_ATTEMPTS} failed for "
                    f"scope {self._scope_string()}: {e} — retrying in {delay:.2f}s"
                )
                time.sleep(delay)
        raise last_exc  # exhausted retries — caller logs and the run row records it

    @staticmethod
    def _impact_changed_significantly(old: Optional[float], new: Optional[float]) -> bool:
        if old is None and new is None:
            return False
        if old is None or new is None:
            # Impact appeared where there was none → reopen; impact vanished →
            # the auto-resolve/staleness pass handles that, don't reopen.
            return old is None
        if old == 0:
            return new != 0
        return abs(new - old) / abs(old) > REOPEN_IMPACT_CHANGE_PCT

    def _record_run(self, status: str, docs_analysed: int = 0, signals_found: int = 0,
                    created: int = 0, updated: int = 0, resolved: int = 0) -> None:
        """Write the run heartbeat in its own short session — the third,
        independent commit point. The audit trail survives even when one (or
        both) pipeline commits failed."""
        db = self.session_factory()
        try:
            db.add(InsightRun(
                user_id=self.user_id,
                entity_id=self.entity_id,
                trigger=self.trigger,
                status=status,
                ran_at=datetime.now(timezone.utc),
                documents_analysed=docs_analysed,
                signals_found=signals_found,
                insights_created=created,
                insights_updated=updated,
                insights_resolved=resolved,
                logs=self.logs or None,
            ))
            db.commit()
        except Exception as e:
            logger.error(f"[Insights] Could not record run row for user={self.user_id}: {e}")
            db.rollback()
        finally:
            db.close()

    # ── Entry point ──────────────────────────────────────────────────────────
    def run(self) -> None:
        # Phase 1 — facts (short session, closed inside)
        facts = self._gather_facts()

        # Tax Amendment Lock (Flaw B): per-YA, logged, never silent. Note this
        # aborts only THIS year's analysis — a batch spanning a locked and an
        # open YA triggers separate per-document runs, and the open year's run
        # proceeds normally.
        if facts["locked"]:
            msg = (
                f"YA {self.ya} is locked — a filed Form B is on record for this "
                f"assessment year, so its financial record is frozen pending a formal "
                f"amendment to LHDN. Document was received and stored, but insight "
                f"analysis was skipped (trigger: {self.trigger})."
            )
            self.logs.append(msg)
            logger.info(f"[Insights] {msg} (user={self.user_id}, entity={self.entity_id})")
            self._record_run(status="completed")
            return

        summary = facts["summary"]
        cy = facts["cy"]
        docs_analysed = cy.get("documentCount") or 0

        # ── PIPELINE A — deterministic rules, committed FIRST and alone ─────
        cards_a: list[dict] = []
        a_created = a_updated = a_resolved = 0
        pipeline_a_ok = True
        if summary is not None:
            rules = [
                ("deadline",        lambda: self._rule_cp500_deadline(cy)),
                ("review_pending",  lambda: self._rule_review_pending(cy)),
                ("relief_headroom", lambda: self._rule_relief_headroom(cy)),
                ("doc_gap",         lambda: self._rule_doc_gap(cy)),
                ("provision",       lambda: self._rule_provision(summary, cy)),
                ("formb_missing",   lambda: self._rule_formb_missing(cy, facts["prior_formb_exists"])),
            ]
            for insight_type, rule in rules:
                if not self._type_enabled(insight_type):
                    continue
                try:
                    cards_a.extend(rule())
                except Exception as e:
                    self.logs.append(f"rule {insight_type} failed ({type(e).__name__}): {e}")
                    logger.error(f"[Insights] Rule '{insight_type}' failed for user={self.user_id}: {e}", exc_info=True)

        try:
            # Commit point 1: deterministic insights land regardless of
            # anything Gemini does afterwards.
            a_created, a_updated, a_resolved = self._persist_with_retry(cards_a, housekeeping=True)
        except Exception as e:
            pipeline_a_ok = False
            self.logs.append(f"pipeline A persist failed ({type(e).__name__}): {e}")
            logger.error(
                f"[Insights] Pipeline A persist failed for scope {self._scope_string()}: {e}",
                exc_info=True,
            )

        # ── PIPELINE B — LLM-hybrid digest, isolated try/except + commit ────
        # A Gemini timeout / 429 / persist failure here can only lose the
        # digest; Pipeline A's results are already committed above.
        cards_b: list[dict] = []
        b_created = b_updated = 0
        if summary is not None and self._type_enabled("digest"):
            try:
                cards_b = self._build_digest(summary, cy, cards_a)
            except Exception as e:
                self.logs.append(f"digest build failed ({type(e).__name__}): {e}")
                logger.error(f"[Insights] Digest failed for user={self.user_id}: {e}", exc_info=True)
            if cards_b:
                try:
                    # Commit point 2: digest only. housekeeping=False — the wake/
                    # auto-resolve passes already ran (and committed) with
                    # Pipeline A, and digests are never auto-resolved anyway.
                    b_created, b_updated, _ = self._persist_with_retry(cards_b, housekeeping=False)
                except Exception as e:
                    self.logs.append(f"pipeline B persist failed ({type(e).__name__}): {e}")
                    logger.error(
                        f"[Insights] Pipeline B persist failed for scope {self._scope_string()}: {e}",
                        exc_info=True,
                    )

        # ── Run heartbeat — commit point 3, independent of both pipelines ───
        self._record_run(
            status="completed" if pipeline_a_ok else "failed",
            docs_analysed=docs_analysed,
            signals_found=len(cards_a) + len(cards_b),
            created=a_created + b_created,
            updated=a_updated + b_updated,
            resolved=a_resolved,
        )
        logger.info(
            f"[Insights] Run complete for scope {self._scope_string()} trigger={self.trigger}"
            + (f" (scoped to {sorted(self.only_types)})" if self.only_types else "")
            + f": {docs_analysed} documents → {len(cards_a) + len(cards_b)} signals "
            f"({a_created + b_created} created, {a_updated + b_updated} updated, "
            f"{a_resolved} auto-resolved)"
        )


def run_insight_engine(user_id, entity_id, trigger: str, db_session_factory,
                       assessment_year=None, only_insight_types=None,
                       initial_logs=None) -> None:
    """Fire an engine run for one (user, entity, assessment_year) scope,
    optionally restricted to specific insight types (scoped re-run after a
    rule-version mismatch on snooze wake). Never raises — callers include the
    document pipeline's tail and FastAPI background tasks, neither of which
    should ever fail because insight generation did. assessment_year comes
    from the triggering document's year_of_assessment; None falls back to the
    current year (correct for manual refresh)."""
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        logger.warning(f"[Insights] Skipping run: user_id '{user_id}' is not numeric.")
        return

    engine = None
    try:
        engine = TaxInsightEngine(
            db_session_factory, uid, entity_id, trigger,
            assessment_year=assessment_year,
            only_insight_types=only_insight_types,
            initial_logs=initial_logs,
        )
        engine.run()
    except Exception as e:
        logger.error(f"[Insights] Engine run failed for user={user_id}: {e}", exc_info=True)
        if engine is not None:
            engine.logs.append(f"engine run failed ({type(e).__name__}): {e}")
            engine._record_run(status="failed")
        else:
            # Constructor itself failed — record with a throwaway engine-less write
            db = db_session_factory()
            try:
                db.add(InsightRun(
                    user_id=uid,
                    entity_id=entity_id,
                    trigger=trigger,
                    status="failed",
                    ran_at=datetime.now(timezone.utc),
                    logs=[f"engine construction failed ({type(e).__name__}): {e}"],
                ))
                db.commit()
            except Exception as inner:
                logger.error(f"[Insights] Could not record failed run for user={user_id}: {inner}")
                db.rollback()
            finally:
                db.close()
