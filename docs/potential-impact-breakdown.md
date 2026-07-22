# "Potential Impact" — how it works, the bug, and the fix

_AI Insights page, stat strip, third tile. Written after a live investigation against
account `user_id=1` / `entity_id=1` ("kenji's Business"), YA 2026._

## 1. What the number is supposed to mean

**"Potential Impact" answers one question: "How much tax could I still avoid paying
by taking an action?"**

It is deliberately **not** "the RM total of everything on this page" — the AI Insights
feed also contains cards about money you *owe* (a CP500 installment) and money that's
*contingent* on an unresolved question (a document stuck in review). Those are real
numbers, but they aren't "potential savings," so they're excluded on purpose.

## 2. Which insight types count, and why

| Insight type | Counted? | Reasoning |
|---|---|---|
| `relief_headroom` | ✅ Yes | A known statutory relief cap you haven't used yet. Confirmed, quantifiable, actionable. |
| `doc_gap` | ✅ Yes | A detected pattern (missing mileage log, a recurring vendor gap) that's a real claimable deduction once confirmed. |
| `provision` (bracket-jump sub-type) | ✅ Yes | "Act before 31 Dec and avoid RM X in extra tax" is a saving, just framed as *avoid* instead of *claim*. (Its sibling, the monthly set-aside reminder, never carries an RM figure, so including the whole type is harmless.) |
| `deadline` | ❌ No | Its RM figure (e.g. a CP500 installment amount) is money **owed**, not saved — the opposite kind of number. |
| `review_pending` | ❌ No | Its RM figure is money **excluded pending an answer** — genuinely contingent. It might resolve to fully deductible, partially deductible, or not deductible at all. Counting it as a confirmed saving overstates certainty that doesn't exist yet. |

```js
// frontend/src/pages/InsightsInbox.jsx
const IMPACT_INSIGHT_TYPES = new Set(['relief_headroom', 'doc_gap', 'provision']);
const potentialImpact = active
  .filter(i => IMPACT_INSIGHT_TYPES.has(i.insightType))
  .reduce((sum, i) => sum + (i.rmImpact || 0), 0);
```

## 3. Component 1 — Relief headroom (RM 348.50)

**Step 1 — cap vs. claimed, per category.** `main.py`'s `RELIEF_CAPS_FALLBACK_MYR` table
holds Malaysia's statutory personal relief caps. For each one:

```
headroom = statutory_cap − amount_already_claimed_this_year
```

This account currently has **zero** relief documents on file for YA 2026, so every
category's claimed amount is RM 0 — headroom equals the full cap, everywhere.

**Step 2 — add up every category clearing the noise floor** (categories under RM100
of headroom are dropped as trivial):

| Category | Cap | Claimed | Headroom |
|---|---:|---:|---:|
| SSPN Net Deposit | RM 8,000 | RM 0 | RM 8,000 |
| Medical Equipment Relief | RM 6,000 | RM 0 | RM 6,000 |
| EPF Personal Contribution | RM 4,000 | RM 0 | RM 4,000 |
| Life Insurance & Takaful Relief | RM 3,000 | RM 0 | RM 3,000 |
| Childcare Fees | RM 3,000 | RM 0 | RM 3,000 |
| Private Retirement Scheme (PRS) | RM 3,000 | RM 0 | RM 3,000 |
| 5 smaller categories combined (SOCSO, Domestic Tourism, Tourist Attraction, EV Charging, Education & Medical Insurance) | — | — | RM 7,850 |
| **Total headroom** | | | **RM 34,850** |

**Step 3 — convert headroom into an actual tax saving**, using the same marginal-rate
lookup the dashboard's Chargeable Income card uses (never recalculated separately):

```
saving = total_headroom × marginal_rate
       = RM 34,850     × 1%
       = RM 348.50
```

**Caveat:** RM 34,850 is a theoretical *ceiling* ("if you maxed out every category"),
not a prediction you're about to spend that much. RM 348.50 is what that ceiling is
*worth* at your rate — useful for prioritizing (SSPN is the single biggest lever), not
a guaranteed refund.

## 4. Component 2 — Bracket-jump warning (was RM 139.41 → now RM 0)

This is where the bug lived. The card projects your YA-end chargeable income from a
run-rate (how fast income is coming in so far this year) and checks whether that
projection crosses into a higher tax bracket.

### The bug

```python
# main.py — BEFORE
proj_inc  = money(current_income / progress)
proj_ded  = money(current_year["totals"]["q3Deductions"] / progress)   # ← double-subtracted
proj_rel  = money(current_year["totals"]["q4Reliefs"] / progress)
proj_char = max(Decimal("0"), proj_inc - proj_ded - proj_rel)          # ← self relief missing entirely
```

Two separate mistakes, stacked:

1. **`totals.totalIncome` is already net of Q3 business deductions** (confirmed via a
   code comment in `main.py`: *"total_inc now correctly reflects NET business income
   ...previously this was GROSS Q1 revenue"*). Subtracting `q3Deductions` again here
   double-counted the same deduction, artificially **lowering** the projection... which
   sounds like it should help, except:
2. **The automatic RM 9,000 self relief was never subtracted at all.** Every other
   chargeable-income calculation in the codebase subtracts it; the projection alone
   forgot it — which artificially **raised** the projection.

The two errors partially fought each other, but didn't cancel out — the net effect was
still a meaningfully inflated projected chargeable income, which is what pushed the
bracket-jump card into "you're about to cross the line" territory when the real
run-rate wasn't actually there yet.

### The fix

```python
# main.py — AFTER
proj_inc  = money(current_income / progress)                 # already net of Q3 — don't subtract it again
proj_rel  = money(current_year["totals"]["q4Reliefs"] / progress)

# Self relief / profile reliefs are FIXED annual amounts — they don't scale
# with how much of the year has passed, so they're NOT divided by progress.
self_relief     = current_year["totals"].get("individualSelfRelief") or Decimal("0")
profile_reliefs = (current_year["totals"].get("profileReliefs") or {}).get("totalMyr") or Decimal("0")
proj_char = max(Decimal("0"), proj_inc - proj_rel - self_relief - profile_reliefs)
```

### Before vs. after, this account (YA 2026, 3% bracket threshold = RM 20,000)

| | Before (buggy) | After (fixed) |
|---|---:|---:|
| Projected chargeable income | RM 26,970.44 (over the line) | RM 6,000.00 (well under) |
| Bracket-jump card | "On track to cross into the 3% bracket" | "RM 14,000.00 **from** the 3% tax bracket" (not crossing) |
| Card severity | `action_required` | `suggested` |
| Card `rmImpact` | RM 139.41 | *(none — no longer projected to cross)* |

(An earlier pass through this same investigation, at an earlier point in the account's
document history, caught the equivalent bug crossing the *1%* bracket instead —
RM 61.48 → RM 29.01 once fixed. Same mechanism, different snapshot in time; the 3%
example above is the one this account shows right now.)

**Bottom line:** the bracket-jump risk was entirely a bug artifact here — not a real
signal that this account is about to cross into a higher bracket. That's a meaningfully
different conclusion for the user than "you're RM 139 away from a tax increase."

## 5. Final total, right now

```
Potential Impact = relief_headroom (RM 348.50) + doc_gap (RM 0 — none active) + provision (RM 0 — no longer crossing)
                  = RM 348.50
```

Down from the RM 488 shown before this fix (RM 348.50 + RM 139.41).

## 6. What's deliberately still excluded (and visible elsewhere)

| Card | RM amount | Where it shows instead |
|---|---:|---|
| "One answer is blocking RM 3,042.20 in your totals" (hamper invoice, `review_pending`) | RM 3,042.20 | Counted in "Needs action" (the count tile), and visible on its own card — not folded into "Potential Impact" since it's contingent on how the user answers. |
| Any future CP500/Form B deadline card (`deadline`) | varies | Same — visible as its own card, never summed into "Potential Impact" since it's money owed, not saved. |

## 7. Files touched

- `backend/main.py` — forward-projection block inside `get_tax_profile_summary` (the
  `/api/profile/summary` endpoint), lines ~4259–4283.
- `frontend/src/pages/InsightsInbox.jsx` — `potentialImpact` computation, ~line 607.
