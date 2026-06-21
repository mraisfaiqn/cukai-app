"""Malaysian individual-tax configuration, keyed by Year of Assessment (YA).

This is the single source of truth for relief caps and tax brackets. It lives as
plain Python dicts for now (no database) so the calculator can run standalone;
when you later move reliefs to a DB table, only this module changes — the engine
in calculations.py keeps working unchanged.

IMPORTANT: verify these figures against the LHDN schedule for the relevant YA
before relying on them — relief caps and brackets change with most Budgets.
Figures below reflect YA 2024/2025 (resident individual).
"""

# ── Personal reliefs (resident individual) ───────────────────────────────────
# Each relief has a legal cap. The engine applies  min(claimed, cap)  per line.
# `auto=True` reliefs are always granted at their cap (e.g. the standard
# individual relief); the frontend pre-fills these but the engine enforces them.
RELIEFS = {
    2025: [
        {"code": "individual",       "label": "Individual & dependent relatives", "cap": 9000, "auto": True,
         "note": "Granted automatically to every resident individual."},
        {"code": "epf_life",         "label": "EPF + life insurance",              "cap": 7000,
         "note": "Combined ceiling (EPF up to RM4,000 + life insurance up to RM3,000)."},
        {"code": "prs_annuity",      "label": "PRS + deferred annuity",            "cap": 3000},
        {"code": "socso",            "label": "SOCSO / EIS contributions",         "cap": 350},
        {"code": "lifestyle",        "label": "Lifestyle (books, devices, internet, sports)", "cap": 2500},
        {"code": "medical_serious",  "label": "Serious illness / fertility / vaccination", "cap": 10000,
         "note": "Includes a RM1,000 sub-limit for full medical check-ups."},
        {"code": "medical_parents",  "label": "Medical for parents",               "cap": 8000},
        {"code": "education_self",   "label": "Education fees (self)",              "cap": 7000},
        {"code": "childcare",        "label": "Childcare / kindergarten fees",     "cap": 3000},
        {"code": "sspn",             "label": "SSPN net savings",                  "cap": 8000},
        {"code": "ev_charging",      "label": "EV charging equipment",             "cap": 2500},
    ],
}

# ── Progressive tax brackets (resident individual) ───────────────────────────
# (lower_bound, upper_bound, rate). Lower is exclusive, upper inclusive; the top
# band runs to infinity. Tax is the sum over bands of (slice within band × rate).
BRACKETS = {
    2025: [
        (0,        5000,     0.00),
        (5000,     20000,    0.01),
        (20000,    35000,    0.03),
        (35000,    50000,    0.06),
        (50000,    70000,    0.11),
        (70000,    100000,   0.19),
        (100000,   400000,   0.25),
        (400000,   600000,   0.26),
        (600000,   2000000,  0.28),
        (2000000,  float("inf"), 0.30),
    ],
}

# ── Rebates ──────────────────────────────────────────────────────────────────
# The RM400 individual rebate applies only when chargeable income is at or below
# this threshold. Zakat is rebated in full (handled as a user input in the API).
INDIVIDUAL_REBATE = {2025: {"amount": 400, "chargeable_income_ceiling": 35000}}

DEFAULT_YA = 2025


def get_reliefs(ya: int = DEFAULT_YA):
    """Return the relief catalogue for a Year of Assessment."""
    return RELIEFS.get(ya, RELIEFS[DEFAULT_YA])


def get_brackets(ya: int = DEFAULT_YA):
    """Return the progressive bracket table for a Year of Assessment."""
    return BRACKETS.get(ya, BRACKETS[DEFAULT_YA])


def get_rebate_rule(ya: int = DEFAULT_YA):
    """Return the individual-rebate rule for a Year of Assessment."""
    return INDIVIDUAL_REBATE.get(ya, INDIVIDUAL_REBATE[DEFAULT_YA])
