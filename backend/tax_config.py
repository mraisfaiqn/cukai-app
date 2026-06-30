"""Malaysian resident-individual tax configuration, keyed by Year of Assessment (YA).

Holds the progressive bracket table, the personal relief catalogue (mapped onto
the Q4 — Personal Tax Relief categories used by pipeline.py's classifier), the
individual rebate rule, and the approved-donations cap percentage.

This module is intentionally a plain Python dict-of-dicts rather than database
tables — calculations.py is the only place that reads it, so it can be swapped
for a DB-backed config later (see kenji/partnership-overview-frontend's
tax_config.py / models.py for a reference implementation that moved this exact
shape of data into Postgres) without changing calculations.py's call sites.

IMPORTANT: verify these figures against the LHDN schedule for the relevant YA
before relying on them — relief caps and brackets change with most Budgets.
"""

DEFAULT_YA = 2025

# Q4 document category (as produced by pipeline.py's classifier) → relief code.
# "Q4 — Zakat" is deliberately excluded: zakat is a rebate against tax PAYABLE,
# not a deduction against income, so calculations.py handles it separately.
RELIEF_CATEGORY_MAP: dict[str, str] = {
    "Q4 — Life Insurance & Takaful Relief": "epf_life",
    "Q4 — EPF Personal Contribution":       "epf_life",
    "Q4 — Medical & Parental Care":         "medical_parents",
    "Q4 — Lifestyle Relief":                "lifestyle",
    "Q4 — Education Relief":                "education_self",
    "Q4 — Child Relief":                    "childcare",
    "Q4 — Medical Equipment Relief":        "medical_equipment",
    "Q4 — Private Retirement Scheme (PRS)": "prs_annuity",
    "Q4 — SOCSO Personal Contribution":     "socso",
    "Q4 — Domestic Tourism Relief":         "domestic_tourism",
    "Q4 — EV Charging Equipment":           "ev_charging",
}

_CONFIG: dict[int, dict] = {
    2025: {
        # Document-evidenced reliefs — claimed amount comes from summed
        # documents in that relief's category, then capped at `cap`.
        "reliefs": [
            {"code": "epf_life",         "label": "EPF + life insurance / takaful",          "cap": 7000},
            {"code": "prs_annuity",      "label": "Private retirement scheme + annuity",     "cap": 3000},
            {"code": "socso",            "label": "SOCSO / EIS contributions",                "cap": 350},
            {"code": "lifestyle",        "label": "Lifestyle (books, devices, internet, gym)", "cap": 2500},
            {"code": "medical_parents",  "label": "Medical & parental care",                  "cap": 8000},
            {"code": "education_self",   "label": "Education fees (self)",                    "cap": 7000},
            {"code": "childcare",        "label": "Child relief / childcare & kindergarten",  "cap": 3000},
            {"code": "medical_equipment","label": "Medical equipment for disabled/self",       "cap": 6000},
            {"code": "domestic_tourism", "label": "Domestic tourism",                          "cap": 1000},
            {"code": "ev_charging",      "label": "EV charging equipment",                    "cap": 2500},
            # Automatic/rule-based reliefs — not tied to a document category.
            # calculations.py grants these directly from the Person record.
            {"code": "individual", "label": "Individual & dependent relatives", "cap": 9000, "auto": True},
        ],
        # Per-Person-record reliefs that depend on marital status / number of
        # children rather than a claimed/capped document amount.
        "spouse_relief":        4000,   # combined assessment, spouse has no income of their own
        "child_relief_each":    2000,   # per child, doubled below if disabled
        "child_relief_disabled": 8000,

        # (lower, upper, rate). upper=None on the last band means unbounded.
        "brackets": [
            (0,       5000,    0.00),
            (5000,    20000,   0.01),
            (20000,   35000,   0.03),
            (35000,   50000,   0.06),
            (50000,   70000,   0.11),
            (70000,   100000,  0.19),
            (100000,  400000,  0.25),
            (400000,  600000,  0.26),
            (600000,  2000000, 0.28),
            (2000000, None,    0.30),
        ],

        "rebate": {"amount": 400, "chargeable_income_ceiling": 35000},
        "donation_cap_pct": 0.10,
    },
}


def _get_ya_config(ya: int) -> dict:
    """Config for one YA, falling back to DEFAULT_YA if `ya` isn't configured."""
    return _CONFIG.get(ya, _CONFIG[DEFAULT_YA])


def get_reliefs(ya: int = DEFAULT_YA) -> list[dict]:
    return _get_ya_config(ya)["reliefs"]


def get_brackets(ya: int = DEFAULT_YA) -> list[tuple]:
    return [(lo, hi if hi is not None else float("inf"), rate) for lo, hi, rate in _get_ya_config(ya)["brackets"]]


def get_rebate_rule(ya: int = DEFAULT_YA) -> dict:
    return _get_ya_config(ya)["rebate"]


def get_donation_cap_pct(ya: int = DEFAULT_YA) -> float:
    return _get_ya_config(ya)["donation_cap_pct"]


def get_spouse_relief(ya: int = DEFAULT_YA) -> float:
    return _get_ya_config(ya)["spouse_relief"]


def get_child_relief_amounts(ya: int = DEFAULT_YA) -> tuple[float, float]:
    """Return (per-child amount, per-disabled-child amount)."""
    cfg = _get_ya_config(ya)
    return cfg["child_relief_each"], cfg["child_relief_disabled"]
