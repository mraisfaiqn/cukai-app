"""Pydantic request/response models for the tax endpoints.

These give FastAPI automatic validation (e.g. rejecting negative income) and a
self-documenting schema at /docs. The calculation engine stays pure Python; this
layer only describes the shape of what crosses the HTTP boundary.
"""

from pydantic import BaseModel, Field
from tax_config import DEFAULT_YA


# ── GET /api/v1/tax/reliefs ───────────────────────────────────────────────────
class ReliefCatalogueItem(BaseModel):
    code: str
    label: str
    cap: float
    auto: bool = False
    note: str | None = None


class ReliefCatalogueResponse(BaseModel):
    year_of_assessment: int
    reliefs: list[ReliefCatalogueItem]


# ── POST /api/v1/tax/calculate ────────────────────────────────────────────────
class CalculateRequest(BaseModel):
    year_of_assessment: int = DEFAULT_YA
    total_income: float = Field(ge=0, description="Total income before personal reliefs (RM).")
    # Map of relief code → amount claimed (RM). Unknown codes are ignored;
    # missing codes default to 0.
    reliefs: dict[str, float] = Field(default_factory=dict)
    zakat: float = Field(default=0, ge=0, description="Zakat paid (RM) — rebated in full against tax.")


class ReliefLine(BaseModel):
    code: str
    label: str
    cap: float
    claimed: float
    applied: float
    capped: bool


class MarginalBracket(BaseModel):
    lower: float
    upper: float
    rate: float


class CalculateResponse(BaseModel):
    year_of_assessment: int
    total_income: float
    reliefs: list[ReliefLine]
    total_relief: float
    chargeable_income: float
    marginal_bracket: MarginalBracket
    tax_before_rebate: float
    individual_rebate: float
    zakat: float
    total_rebate: float
    tax_payable: float
    tax_without_reliefs: float
    relief_savings: float
