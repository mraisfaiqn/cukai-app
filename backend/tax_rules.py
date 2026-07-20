"""
Central tax-rule versioning for cukai.ai.

There was previously NO versioning concept anywhere in the backend — the tax
rule tables live as plain constants (main.TAX_BRACKETS_BY_YA for the
progressive brackets, main.RELIEF_CAPS_FALLBACK_MYR for Schedule 9 relief
caps, capital_allowance.SCHEDULE_3_STANDARD_RATES for IA/AA rates). This
module gives all of them one shared version stamp.

TAX_RULES_VERSION — bump this string MANUALLY whenever LHDN rules change
(Budget announcements, gazette orders): new bracket tables, changed relief
caps, changed Schedule 3 rates, CP500 schedule changes, etc.

Convention: "YA{year}-v{n}" — the YA whose Budget introduced the rules, plus
a serial for mid-year corrections (e.g. "YA2026-v2" if a gazette order lands
after the initial Budget update).

Every Insight row is stamped with the version that was active when its
figures were computed (Insight.rule_version). When a snoozed insight wakes
and its stored version no longer matches TAX_RULES_VERSION, the insight is
flagged stale and a scoped engine re-run recomputes it under the current
rules — figures are never silently mutated outside the engine.
"""

# v2: Q4 Medical & Parental Care relief cap raised RM8,000 → RM10,000
#     (main.RELIEF_CAPS_FALLBACK_MYR), per the current LHDN personal relief
#     schedule adopted with the 5-insight engine upgrade.
TAX_RULES_VERSION = "YA2026-v2"
