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

    # Original shape: caller already knows total income (still supported).
    total_income: float | None = Field(
        default=None, ge=0,
        description="Total income before personal reliefs (RM). If set, businesses/"
                     "employment/rent/other_income/business_losses/donations below are ignored."
    )

    # Income-source breakdown (Form B Part B waterfall). Used only when
    # total_income above is omitted.
    businesses: list[float] = Field(
        default_factory=list,
        description="Statutory income (RM) for each business — one entry per business."
    )
    employment: float = Field(default=0, ge=0, description="Statutory income from employment (RM).")
    rent: float = Field(default=0, ge=0, description="Statutory income from rents (RM).")
    other_income: float = Field(default=0, ge=0, description="Other statutory income — interest, royalties, etc. (RM).")
    business_losses: float = Field(default=0, ge=0, description="Current-year business losses (RM), capped at aggregate income.")
    donations: float = Field(default=0, ge=0, description="Approved donations / gifts (RM), capped at 10% of aggregate income.")

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


class IncomeBreakdown(BaseModel):
    businesses: list[float]
    business_total: float
    employment: float
    rent: float
    other_income: float
    aggregate_income: float


class BusinessLossBreakdown(BaseModel):
    claimed: float
    applied: float
    unabsorbed: float
    income_after_losses: float


class DonationBreakdown(BaseModel):
    claimed: float
    cap: float
    applied: float
    capped: bool
    total_income: float


class CalculateResponse(BaseModel):
    year_of_assessment: int
    income_breakdown: IncomeBreakdown
    business_losses: BusinessLossBreakdown
    donations: DonationBreakdown
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
