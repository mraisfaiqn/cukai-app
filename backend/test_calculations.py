"""Unit tests for the pure tax engine — run with:  python -m pytest  (in backend/)

These pin down the numbers so you can demonstrate the math is correct, and catch
regressions if the config changes. Worked by hand against the YA2025 resident
bracket table.
"""

from calculations import progressive_tax, apply_relief_caps, calculate_assessment


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
