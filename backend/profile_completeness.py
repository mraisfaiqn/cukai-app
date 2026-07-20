"""
Personal Information completeness — the single source of truth for which
Person fields Form B generation actually requires.

WHY THIS EXISTS
  frontend/src/data/formB.js:buildFormData() reads ~34 profile fields and
  silently renders "—" for every blank one, so a user with an incomplete
  Personal Profile gets a broken Form B with no explanation. This module
  defines exactly which fields are required (and under what conditions), so
  the insight engine can detect the gap and tell the user precisely what to
  fill in.

  The Personal Information form's own `required` JSX markers are NOT a usable
  spec — only "Full name" and "TIN" carry one, while a filable Form B needs
  identity, contact, and refund details too. Hence this explicit definition.

CONDITIONALITY
  Several fields are only required in context, so a flat "any empty field"
  check would fire wrongly and permanently:
    • identity      — identification_no OR passport_no satisfies it (there is
                      no id_type column any more; either ID is enough).
    • bank details  — only when refund_method == 'bank' (DuitNow needs none).
    • spouse block  — only when marital_status == 'married'.
    • ecommerce     — only when carries_on_ecommerce is set.

  Value vocabularies mirror frontend/src/data/formB.js:
    marital_status: single | married | divorced-widowed | deceased
    refund_method:  bank | duitnow

Keys returned are camelCase to match _serialize_person() / the frontend
profile draft, so the "Complete Profile" tab can address each field directly.
"""

MARITAL_MARRIED = "married"
REFUND_BANK = "bank"

# Section labels group the missing fields in the UI exactly like the full
# Personal Information panel does.
SECTION_IDENTITY = "Identity & residency"
SECTION_MARITAL = "Marital & dependants"
SECTION_CONTACT = "Contact"
SECTION_REFUND = "Refund details"
SECTION_OTHER = "Other particulars"


def _blank(value) -> bool:
    """A field counts as missing when it is None or an empty/whitespace string.
    Booleans and numbers (including 0) are deliberately NOT treated as blank —
    False and 0 are real, meaningful answers."""
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    return False


# ── Unconditional requirements ────────────────────────────────────────────────
# (camelCase key, human label, section)
_ALWAYS_REQUIRED = [
    ("fullName",                "Full name (as per IC/passport)", SECTION_IDENTITY),
    ("personalTin",             "Tax Identification No. (TIN)",   SECTION_IDENTITY),
    ("citizenship",             "Citizenship",                    SECTION_IDENTITY),
    ("gender",                  "Gender",                         SECTION_IDENTITY),
    ("dateOfBirth",             "Date of birth",                  SECTION_IDENTITY),
    ("maritalStatus",           "Marital status",                 SECTION_MARITAL),
    ("phone",                   "Phone number",                   SECTION_CONTACT),
    ("correspondenceAddress",   "Correspondence address",         SECTION_CONTACT),
    ("correspondencePostcode",  "Postcode",                       SECTION_CONTACT),
    ("correspondenceCity",      "City",                           SECTION_CONTACT),
    ("correspondenceState",     "State",                          SECTION_CONTACT),
    ("refundMethod",            "Refund method",                  SECTION_REFUND),
]

# Person ORM attribute for each camelCase key (only where they differ by more
# than snake_case conversion is a mapping needed — everything here converts
# mechanically, so we derive it instead of maintaining a second table).


def _snake(camel: str) -> str:
    out = []
    for ch in camel:
        if ch.isupper():
            out.append("_")
            out.append(ch.lower())
        else:
            out.append(ch)
    return "".join(out)


def _get(person, camel_key: str):
    """Read a camelCase profile key off a Person ORM object (or a plain dict,
    which is what the test-data path and any serialized profile provide)."""
    if isinstance(person, dict):
        return person.get(camel_key)
    return getattr(person, _snake(camel_key), None)


def missing_profile_fields(person) -> list[dict]:
    """Return the required-but-blank profile fields for Form B generation.

    Each entry is {key, label, section} where `key` is the camelCase profile
    field the frontend edits. An empty list means the Personal Information is
    complete enough for Form B to generate correctly.
    """
    if person is None:
        # No profile row at all — every unconditional requirement is missing.
        return [
            {"key": k, "label": label, "section": section}
            for k, label, section in _ALWAYS_REQUIRED
        ]

    missing: list[dict] = []

    for key, label, section in _ALWAYS_REQUIRED:
        if _blank(_get(person, key)):
            missing.append({"key": key, "label": label, "section": section})

    # ── Identity: either ID satisfies the requirement ────────────────────────
    if _blank(_get(person, "identificationNo")) and _blank(_get(person, "passportNo")):
        missing.append({
            "key": "identificationNo",
            "label": "Identification no. (IC) or passport no.",
            "section": SECTION_IDENTITY,
        })

    # ── Refund: bank details only matter for a bank refund ───────────────────
    if _get(person, "refundMethod") == REFUND_BANK:
        for key, label in (("bankName", "Bank name"), ("bankAccountNo", "Bank account no.")):
            if _blank(_get(person, key)):
                missing.append({"key": key, "label": label, "section": SECTION_REFUND})

    # ── Spouse block: only when married ──────────────────────────────────────
    if _get(person, "maritalStatus") == MARITAL_MARRIED:
        if _blank(_get(person, "spouseName")):
            missing.append({"key": "spouseName", "label": "Spouse's name", "section": SECTION_MARITAL})
        if _blank(_get(person, "spouseIdNo")) and _blank(_get(person, "spousePassportNo")):
            missing.append({
                "key": "spouseIdNo",
                "label": "Spouse's IC or passport no.",
                "section": SECTION_MARITAL,
            })
        if _blank(_get(person, "spouseDob")):
            missing.append({"key": "spouseDob", "label": "Spouse's date of birth", "section": SECTION_MARITAL})
        if _blank(_get(person, "assessmentType")):
            missing.append({
                "key": "assessmentType",
                "label": "Type of assessment (joint / separate)",
                "section": SECTION_MARITAL,
            })

    # ── E-commerce: model only required once the user says they trade online ─
    if _get(person, "carriesOnEcommerce") and _blank(_get(person, "ecommerceModel")):
        missing.append({
            "key": "ecommerceModel",
            "label": "E-commerce business model",
            "section": SECTION_OTHER,
        })

    return missing


def is_profile_complete(person) -> bool:
    return not missing_profile_fields(person)
