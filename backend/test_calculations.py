"""Unit tests for the pure tax engine — run with:  python -m pytest  (in backend/)

These pin down the numbers so you can demonstrate the math is correct, and catch
regressions if the config changes. Worked by hand against the YA2025 resident
bracket table.
"""

from calculations import (
    progressive_tax,
    apply_relief_caps,
    aggregate_income,
    apply_business_losses,
    apply_donation_cap,
    calculate_assessment,
)


def test_progressive_tax_known_points():
    # Below the tax-free threshold.
    assert progressive_tax(5000) == 0.0
    # Tax on the first 35,000 is exactly RM600 (0 + 150 + 450).
    assert progressive_tax(35000) == 600.0
    # 50,000: 600 + (15,000 × 6%) = 600 + 900 = 1,500.
    assert progressive_tax(50000) == 1500.0
    # 100,000: 1,500 + (20,000 × 11%) + (30,000 × 19%) = 1,500 + 2,200 + 5,700 = 9,400.
    assert progressive_tax(100000) == 9400.0


def test_progressive_tax_is_marginal_not_flat():
    # One ringgit into a higher band only taxes that ringgit at the higher rate.
    assert progressive_tax(35001) == round(600 + 0.06, 2)


def test_relief_capping():
    rows = apply_relief_caps({"lifestyle": 5000, "epf_life": 4000})
    by_code = {r["code"]: r for r in rows}
    # Lifestyle claimed 5,000 but cap is 2,500 → capped.
    assert by_code["lifestyle"]["applied"] == 2500
    assert by_code["lifestyle"]["capped"] is True
    # EPF+life claimed 4,000 under the 7,000 cap → applied in full.
    assert by_code["epf_life"]["applied"] == 4000
    assert by_code["epf_life"]["capped"] is False
    # The automatic individual relief is always granted at its cap.
    assert by_code["individual"]["applied"] == 9000


def test_negative_claim_is_floored_to_zero():
    rows = apply_relief_caps({"lifestyle": -1000})
    by_code = {r["code"]: r for r in rows}
    assert by_code["lifestyle"]["applied"] == 0


def test_full_assessment_with_savings():
    # Income 120,000; claims that include an over-cap lifestyle and full EPF+life.
    result = calculate_assessment(
        total_income=120000,
        reliefs={"epf_life": 7000, "lifestyle": 5000, "medical_parents": 2000},
    )
    # Reliefs applied: 9,000 (auto) + 7,000 + 2,500 (capped) + 2,000 = 20,500.
    assert result["total_relief"] == 20500
    assert result["chargeable_income"] == 99500
    # Savings = tax(120,000) − tax(99,500), both positive and savings > 0.
    assert result["relief_savings"] > 0
    assert result["tax_payable"] == result["tax_before_rebate"]  # no rebate at this income


def test_rm400_rebate_applies_only_below_ceiling():
    # Low earner whose chargeable income lands at/below 35,000 gets the RM400 rebate.
    result = calculate_assessment(total_income=40000, reliefs={"lifestyle": 2500})
    # 40,000 − 9,000 (auto) − 2,500 = 28,500 ≤ 35,000 → rebate applies.
    assert result["chargeable_income"] == 28500
    assert result["individual_rebate"] == 400
    assert result["tax_payable"] == round(result["tax_before_rebate"] - 400, 2)


# ── Income-source waterfall (multiple businesses + other sources) ──────────

def test_aggregate_income_sums_multiple_businesses_and_other_sources():
    result = aggregate_income(businesses=[50000, 30000, 10000], employment=20000, rent=5000, other_income=1000)
    assert result["business_total"] == 90000
    assert result["aggregate_income"] == 116000


def test_aggregate_income_ignores_negative_business_entries():
    # A loss-making business contributes 0 here; losses are handled separately.
    result = aggregate_income(businesses=[50000, -8000])
    assert result["business_total"] == 50000


def test_business_losses_capped_at_aggregate_income():
    # Losses (60,000) exceed aggregate income (50,000) → fully absorbed, rest unabsorbed.
    result = apply_business_losses(aggregate_income_amount=50000, current_year_losses=60000)
    assert result["applied"] == 50000
    assert result["unabsorbed"] == 10000
    assert result["income_after_losses"] == 0


def test_business_losses_below_aggregate_income_fully_applied():
    result = apply_business_losses(aggregate_income_amount=100000, current_year_losses=15000)
    assert result["applied"] == 15000
    assert result["unabsorbed"] == 0
    assert result["income_after_losses"] == 85000


def test_donation_cap_is_ten_percent_of_aggregate_income():
    # Aggregate income 100,000 → cap = 10,000. Claimed 12,000 → capped to 10,000.
    result = apply_donation_cap(income_after_losses=100000, donations=12000, aggregate_income_amount=100000)
    assert result["cap"] == 10000
    assert result["applied"] == 10000
    assert result["capped"] is True
    assert result["total_income"] == 90000


def test_donation_within_cap_applied_in_full():
    result = apply_donation_cap(income_after_losses=100000, donations=5000, aggregate_income_amount=100000)
    assert result["applied"] == 5000
    assert result["capped"] is False
    assert result["total_income"] == 95000


def test_donation_cap_uses_aggregate_income_not_post_loss_income():
    # Aggregate income 200,000 (cap 20,000) but a loss has knocked income-after-losses
    # down to 15,000 — the donation can't exceed what's left to deduct from.
    result = apply_donation_cap(income_after_losses=15000, donations=20000, aggregate_income_amount=200000)
    assert result["cap"] == 20000          # cap is still based on aggregate income
    assert result["applied"] == 15000       # but can't deduct more than what's left
    assert result["total_income"] == 0


def test_full_assessment_multi_business_with_losses_and_donations():
    # Two profitable businesses, one lossy one (loss ignored at the aggregate-income
    # step, handled via business_losses instead), plus rental income.
    result = calculate_assessment(
        businesses=[80000, 40000],
        rent=10000,
        business_losses=20000,
        donations=15000,
        reliefs={"epf_life": 7000},
    )
    # Aggregate income = 80,000 + 40,000 + 10,000 = 130,000.
    assert result["income_breakdown"]["aggregate_income"] == 130000
    # Losses: 20,000 applied in full (well under aggregate income) → 110,000.
    assert result["business_losses"]["applied"] == 20000
    assert result["business_losses"]["income_after_losses"] == 110000
    # Donation cap = 10% of aggregate income (130,000) = 13,000 → claimed 15,000 capped to 13,000.
    assert result["donations"]["cap"] == 13000
    assert result["donations"]["applied"] == 13000
    assert result["donations"]["capped"] is True
    # Total income = 110,000 − 13,000 = 97,000.
    assert result["total_income"] == 97000
    # Reliefs: 9,000 (auto) + 7,000 = 16,000 → chargeable income = 81,000.
    assert result["total_relief"] == 16000
    assert result["chargeable_income"] == 81000


def test_total_income_shortcut_still_works_unchanged():
    # The original single-`total_income` call path must keep behaving exactly
    # as before — no losses/donations sneak in via the no-op breakdown steps.
    result = calculate_assessment(total_income=120000, reliefs={"epf_life": 7000})
    assert result["total_income"] == 120000
    assert result["business_losses"]["applied"] == 0
    assert result["donations"]["applied"] == 0
    assert result["chargeable_income"] == 120000 - 9000 - 7000
