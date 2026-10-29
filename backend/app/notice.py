"""Privacy notice (Act s.5; Rule 3). Versioned — every consent records the version shown.

Rule 3 requires the notice to stand alone, be clear and plain, and give: an itemised description of the
personal data, the specific purpose(s), the services enabled, how to withdraw consent (as easily as it was
given), how to exercise rights, and how to complain to the Data Protection Board.
Act s.5(3): the notice must be available in English or any Eighth Schedule language — add certified
translations to TRANSLATIONS before go-live.
"""
from .config import settings
from .models import PURPOSES

NOTICE_VERSION = "2026-10-v1"

TRANSLATIONS: dict[str, dict] = {}   # e.g. {"bn": {...}, "hi": {...}} — certified translations only


def notice(lang: str = "en") -> dict:
    s = settings
    base = {
        "version": NOTICE_VERSION,
        "language": "en",
        "available_languages": ["en"] + list(TRANSLATIONS),
        "data_fiduciary": s.fiduciary_name,
        "title": "Privacy notice — laboratory haematopathology reporting",
        "personal_data": [
            "Identity: name, age or date of birth, sex, laboratory number",
            "Contact: phone number or e-mail (to send reports and privacy notifications)",
            "Health data: clinical details, blood count, smear/marrow findings and images, flow cytometry, cytogenetic and molecular results, diagnosis and report",
            "For a child (under 18): parent or lawful guardian's name and relationship",
            "Optional: a nominee who may exercise your rights on your death or incapacity",
        ],
        "purposes": [{"id": k, "description": v, "required": k == "diagnostic_reporting"} for k, v in PURPOSES.items()],
        "services_enabled": "Examination of your sample, an integrated diagnostic report classified under the WHO Classification of Haematolymphoid Tumours (5th edition), and its delivery to you and your treating doctor.",
        "ai_statement": "If you agree, an AI model assists in counting cells on your images. A qualified pathologist reviews every result and signs the report; no decision is made by the software alone.",
        "storage": f"Data are stored encrypted on servers located in {s.data_region}. Access is limited to authorised laboratory staff and every access is logged.",
        "retention": f"Records are kept for {s.record_retention_years} years (or longer where a law requires), then erased or irreversibly de-identified. Security logs are kept for at least one year.",
        "withdrawal": "You can withdraw any consent at any time — at the reception desk, by e-mail to the Data Protection Officer, or through the privacy request form — as easily as you gave it. Withdrawal does not affect processing already done; withdrawing consent for diagnostic reporting means we cannot continue to process your sample.",
        "rights": "You may ask for a summary of your data and who it was shared with, correction, completion or updating, erasure, nomination of another person, and you may raise a grievance. We respond within 90 days.",
        "contact": {"name": s.dpo_name, "email": s.dpo_email, "phone": s.dpo_phone},
        "board": "If you are not satisfied with our response, you may complain to the Data Protection Board of India through its online portal.",
    }
    if lang in TRANSLATIONS:
        out = dict(base); out.update(TRANSLATIONS[lang]); out["language"] = lang
        return out
    return base
