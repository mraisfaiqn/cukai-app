"""
Pydantic schemas for the insights API.

Field names are camelCase to match what InsightsInbox.jsx consumes — the
frontend maps these objects straight onto its card components, so every field
here must serialise to a JSON-safe primitive (dates → ISO strings, Numeric →
float) with no backend types leaking through.
"""

from datetime import date
from typing import List, Literal, Optional

from pydantic import BaseModel

from insights.models import Insight, InsightRun


class SignalOut(BaseModel):
    label: str
    value: str


class ActionOut(BaseModel):
    label: str
    to: str


class InsightOut(BaseModel):
    id: int
    userId: int
    entityId: Optional[int] = None
    insightType: str
    severity: str
    generatedBy: str
    state: str
    dismissReason: Optional[str] = None
    resolvedNote: Optional[str] = None
    snoozeUntil: Optional[str] = None
    dedupeKey: str
    title: str
    body: str
    rmImpact: Optional[float] = None
    deadlineDate: Optional[str] = None
    citation: Optional[str] = None
    signals: List[SignalOut] = []
    sourceDocumentIds: List[int] = []
    action: Optional[ActionOut] = None
    assessmentYear: int
    ruleVersion: Optional[str] = None
    # True while a rule-version mismatch re-score is pending (figures shown
    # are from the OLD rule version until the engine's scoped re-run lands).
    isStale: bool = False
    # True when this insight's assessment year has a filed Form B on record —
    # the year is frozen, so lifecycle actions are disabled in the UI and
    # rejected server-side.
    isLocked: bool = False
    createdAt: str
    updatedAt: Optional[str] = None


class InsightRunOut(BaseModel):
    id: int
    trigger: str
    status: str
    ranAt: str
    documentsAnalysed: int
    signalsFound: int
    insightsCreated: int
    insightsUpdated: int
    insightsResolved: int
    logs: List[str] = []


class InsightFeedOut(BaseModel):
    insights: List[InsightOut]
    lastRun: Optional[InsightRunOut] = None


class InsightStateUpdate(BaseModel):
    """PATCH /api/insights/{id}/state payload.

    dismissReason drives snooze semantics when snoozeUntil isn't given
    explicitly: a reason containing "snooze" (e.g. "Snoozed for 2 weeks") →
    today + 14 days; "Not relevant this year" → hidden until 1 Jan of the year
    after the insight's assessment year.
    """
    state: Literal["new", "read", "dismissed", "actioned"]
    dismissReason: Optional[str] = None
    snoozeUntil: Optional[date] = None
    resolvedNote: Optional[str] = None


class InsightRunRequestOut(BaseModel):
    message: str
    trigger: str


def serialize_insight(i: Insight, is_locked: bool = False) -> InsightOut:
    return InsightOut(
        id=i.id,
        userId=i.user_id,
        entityId=i.entity_id,
        insightType=i.insight_type,
        severity=i.severity,
        generatedBy=i.generated_by,
        state=i.state,
        dismissReason=i.dismiss_reason,
        resolvedNote=i.resolved_note,
        snoozeUntil=i.snooze_until.isoformat() if i.snooze_until else None,
        dedupeKey=i.dedupe_key,
        title=i.title,
        body=i.body,
        rmImpact=float(i.rm_impact) if i.rm_impact is not None else None,
        deadlineDate=i.deadline_date.isoformat() if i.deadline_date else None,
        citation=i.citation,
        signals=[SignalOut(**s) for s in (i.signals or [])],
        sourceDocumentIds=list(i.source_document_ids or []),
        action=ActionOut(**i.action) if i.action else None,
        assessmentYear=i.assessment_year,
        ruleVersion=i.rule_version,
        isStale=bool(i.stale),
        isLocked=is_locked,
        createdAt=i.created_at.isoformat() if i.created_at else "",
        updatedAt=i.updated_at.isoformat() if i.updated_at else None,
    )


def serialize_run(r: InsightRun) -> InsightRunOut:
    return InsightRunOut(
        id=r.id,
        trigger=r.trigger,
        status=r.status,
        ranAt=r.ran_at.isoformat() if r.ran_at else "",
        documentsAnalysed=r.documents_analysed or 0,
        signalsFound=r.signals_found or 0,
        insightsCreated=r.insights_created or 0,
        insightsUpdated=r.insights_updated or 0,
        insightsResolved=r.insights_resolved or 0,
        logs=[str(line) for line in (r.logs or [])],
    )
