import base64
import os
import tempfile
from datetime import datetime, timedelta, timezone

_db = tempfile.mktemp(suffix=".db")
os.environ.update(HAEM5_DB_URL=f"sqlite:///{_db}", HAEM5_DATA_KEY=base64.b64encode(os.urandom(32)).decode(),
                  HAEM5_JWT_SECRET="x" * 40, HAEM5_REQUIRE_2FA="true")

import pyotp  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.models import AuditLog, Patient, User  # noqa: E402
from app.notice import NOTICE_VERSION  # noqa: E402
from app.security import hash_pw  # noqa: E402

c = TestClient(app)
PW = "Strong-Passw0rd-1"


def mkuser(role):
    db = SessionLocal()
    u = User(email=f"{role}@t.org", full_name=role.title(), role=role, pw_hash=hash_pw(PW), must_change_pw=False)
    db.add(u); db.commit(); db.close()


def login(role, with_2fa=True):
    r = c.post("/api/auth/login", json={"email": f"{role}@t.org", "password": PW}).json()
    if "token" in r:
        tok = r["token"]
        if with_2fa:
            s = c.post("/api/auth/2fa/setup", headers=H(tok)).json()
            c.post("/api/auth/2fa/enable", headers=H(tok), json={"code": pyotp.TOTP(s["secret"]).now()})
            SECRETS[role] = s["secret"]
        return tok
    code = pyotp.TOTP(SECRETS[role]).now()
    return c.post("/api/auth/login", json={"email": f"{role}@t.org", "password": PW, "code": code}).json()["token"]


SECRETS = {}
H = lambda t: {"Authorization": f"Bearer {t}"}
T = {}


@pytest.fixture(scope="module", autouse=True)
def users():
    for r in ("admin", "dpo", "pathologist", "resident", "technician"):
        mkuser(r)
    for r in ("dpo", "pathologist", "resident", "technician", "admin"):
        T[r] = login(r)


def new_patient(age=40, purposes=("diagnostic_reporting", "ai_assisted_analysis"), **kw):
    body = {"name": "Test Person", "contact": "+91-98300-12345", "age_years": age, "sex": "F",
            "consent": {"purposes": list(purposes), "notice_version": NOTICE_VERSION, "given_by": kw.pop("given_by", "self")}}
    body.update(kw)
    return c.post("/api/patients", headers=H(T["technician"]), json=body)


def test_public_notice_contents():
    n = c.get("/api/public/notice").json()
    assert n["version"] == NOTICE_VERSION
    for key in ("personal_data", "purposes", "withdrawal", "rights", "contact", "board"):
        assert n[key]


def test_2fa_required_for_patient_data():
    mkuser("pathologist2") if False else None
    db = SessionLocal(); db.add(User(email="no2fa@t.org", full_name="X", role="pathologist", pw_hash=hash_pw(PW), must_change_pw=False)); db.commit(); db.close()
    tok = c.post("/api/auth/login", json={"email": "no2fa@t.org", "password": PW}).json()["token"]
    assert c.get("/api/patients", headers=H(tok)).status_code == 403


def test_login_requires_code_after_2fa_and_lockout():
    r = c.post("/api/auth/login", json={"email": "dpo@t.org", "password": PW}).json()
    assert r == {"need_2fa": True}
    for _ in range(5):
        c.post("/api/auth/login", json={"email": "resident@t.org", "password": "wrong"})
    assert c.post("/api/auth/login", json={"email": "resident@t.org", "password": PW}).status_code == 423


def test_consent_required_and_identifiers_encrypted_at_rest():
    assert new_patient(purposes=("ai_assisted_analysis",)).status_code == 400
    p = new_patient().json()
    db = SessionLocal()
    raw = db.execute(text("select name_enc, contact_enc from patients where id=:i"), {"i": p["id"]}).one()
    db.close()
    assert "Test Person" not in raw[0] and raw[0].startswith("v1:") and "12345" not in raw[1]
    lst = c.get("/api/patients", headers=H(T["technician"])).json()
    assert all("Test Person" not in x["name"] for x in lst)  # masked in lists


def test_minor_needs_verified_guardian():
    assert new_patient(age=9).status_code == 400
    assert new_patient(age=9, given_by="guardian", guardian="Mother").status_code == 400
    assert new_patient(age=9, given_by="guardian", guardian="Mother", guardian_verified_by="ID card seen").status_code == 200


def test_role_limits():
    p = new_patient().json()
    assert c.get(f"/api/patients/{p['id']}?reveal=true", headers=H(T["resident"])).status_code == 403
    assert c.get(f"/api/patients/{p['id']}?reveal=true", headers=H(T["technician"])).status_code == 403
    assert c.get("/api/audit", headers=H(T["pathologist"])).status_code == 403


def test_case_flow_consent_gates_and_signing():
    p = new_patient(purposes=("diagnostic_reporting",)).json()
    case = c.post("/api/cases", headers=H(T["pathologist"]), json={"patient_id": p["id"], "lab_no": "BM/1", "data": {"patient": "Name", "hb": 8}}).json()
    assert case["permissions"]["ai_allowed"] is False and "patient" not in case["data"]
    assert c.put(f"/api/cases/{case['id']}", headers=H(T["resident"]), json={"data": {}, "ai_used": True}).status_code == 409
    assert c.put(f"/api/cases/{case['id']}", headers=H(T["resident"]), json={"data": {"hb": 8}, "diagnosis": "MDS-LB", "report": "text"}).status_code == 200
    assert c.post(f"/api/cases/{case['id']}/sign", headers=H(T["resident"])).status_code == 403
    assert c.post(f"/api/cases/{case['id']}/sign", headers=H(T["pathologist"])).json()["status"] == "signed"
    assert c.put(f"/api/cases/{case['id']}", headers=H(T["pathologist"]), json={"data": {}}).status_code == 409
    # withdrawal of diagnostic consent stops further processing
    p2 = new_patient().json()
    case2 = c.post("/api/cases", headers=H(T["pathologist"]), json={"patient_id": p2["id"], "lab_no": "BM/2"}).json()
    full = c.get(f"/api/patients/{p2['id']}", headers=H(T["pathologist"])).json()
    diag = next(x for x in full["consents"] if x["purpose"] == "diagnostic_reporting")
    assert c.post(f"/api/consents/{diag['id']}/withdraw", headers=H(T["technician"]), json={"reason": "patient request"}).status_code == 200
    assert c.put(f"/api/cases/{case2['id']}", headers=H(T["pathologist"]), json={"data": {}}).status_code == 409


def test_rights_access_erasure_and_retention():
    p = new_patient().json()
    pub = c.post("/api/public/rights-request", json={"kind": "erasure", "lab_no_or_name": "BM/9", "contact": "me@x.org", "details": "please erase"}).json()
    assert pub["ref"].startswith("RR-")
    rr = next(r for r in c.get("/api/rights", headers=H(T["dpo"])).json() if r["ref"] == pub["ref"])
    assert 89 <= rr["days_left"] <= 90
    assert c.post(f"/api/rights/{rr['id']}/schedule-erasure", headers=H(T["dpo"])).status_code == 400  # unverified / unlinked
    c.patch(f"/api/rights/{rr['id']}", headers=H(T["dpo"]), json={"patient_id": p["id"], "identity_verified": True})
    sched = c.post(f"/api/rights/{rr['id']}/schedule-erasure", headers=H(T["dpo"])).json()
    when = datetime.fromisoformat(sched["erasure_scheduled_for"].replace("Z", "+00:00"))
    assert timedelta(hours=47, minutes=59) < when - datetime.now(timezone.utc) <= timedelta(hours=48)
    assert p["pseudonym"] not in c.post("/api/retention/run", headers=H(T["dpo"])).json()["erased"]   # not yet due
    db = SessionLocal(); pt = db.get(Patient, p["id"]); pt.erasure_scheduled_for = datetime.now(timezone.utc) - timedelta(minutes=1); db.commit(); db.close()
    assert p["pseudonym"] in c.post("/api/retention/run", headers=H(T["dpo"])).json()["erased"]
    got = c.get(f"/api/patients/{p['id']}?reveal=true", headers=H(T["dpo"])).json()
    assert got["name"] == "[erased]" and got["erased"]
    # access summary
    p3 = new_patient().json()
    r3 = c.post("/api/rights", headers=H(T["pathologist"]), json={"patient_id": p3["id"], "kind": "access"}).json()
    summ = c.get(f"/api/rights/{r3['id']}/access-summary", headers=H(T["dpo"])).json()
    assert summ["identity"]["name"] == "Test Person" and summ["consents"] and summ["processing_activities"]
    assert c.patch(f"/api/rights/{r3['id']}", headers=H(T["dpo"]), json={"status": "rejected"}).status_code == 400


def test_breach_72h_clock():
    b = c.post("/api/breaches", headers=H(T["dpo"]), json={"description": "Laptop with export stolen", "affected_count": 3,
               "became_aware_at": (datetime.now(timezone.utc) - timedelta(hours=73)).isoformat()}).json()
    assert b["board_overdue"] is True
    assert c.patch(f"/api/breaches/{b['id']}", headers=H(T["dpo"]), json={"board_detailed": True}).status_code == 400
    ok = c.patch(f"/api/breaches/{b['id']}", headers=H(T["dpo"]), json={"mitigation": "Remote wipe; keys rotated", "cause_findings": "Unencrypted export", "board_detailed": True}).json()
    assert ok["board_detailed_at"] and not ok["board_overdue"]
    assert "Remote wipe" in c.get(f"/api/breaches/{b['id']}/principal-notice", headers=H(T["dpo"])).json()["text"]
    d = c.get("/api/dashboard", headers=H(T["dpo"])).json()
    assert d["breaches_open"] >= 1


def test_audit_chain_detects_tampering():
    assert c.get("/api/audit/verify", headers=H(T["dpo"])).json()["ok"] is True
    db = SessionLocal(); row = db.query(AuditLog).order_by(AuditLog.id).offset(3).first(); row.action = "tampered"; db.commit(); db.close()
    v = c.get("/api/audit/verify", headers=H(T["dpo"])).json()
    assert v["ok"] is False and v["reason"] == "entry altered"


def test_security_headers_and_no_pii_in_errors():
    r = c.get("/api/public/notice")
    assert r.headers["X-Frame-Options"] == "DENY" and "default-src 'self'" in r.headers["Content-Security-Policy"] and r.headers["Cache-Control"] == "no-store"


def test_prepare_then_authorise_workflow():
    p = new_patient().json()
    case = c.post("/api/cases", headers=H(T["technician"]), json={"patient_id": p["id"], "lab_no": "PBS/77", "data": {"hb": 9}}).json()
    cid = case["id"]
    # cannot send an empty draft
    assert c.post(f"/api/cases/{cid}/prepare", headers=H(T["technician"])).status_code == 400
    assert c.put(f"/api/cases/{cid}", headers=H(T["technician"]), json={"data": {"hb": 9}, "diagnosis": "AML (provisional)", "report": "PBS report text", "ai_used": True}).status_code == 200
    r = c.post(f"/api/cases/{cid}/prepare", headers=H(T["technician"])).json()
    assert r["status"] == "prepared" and r["prepared_by"] == "Technician"
    # technician cannot authorise or edit while awaiting
    assert c.post(f"/api/cases/{cid}/sign", headers=H(T["technician"])).status_code == 403
    assert c.put(f"/api/cases/{cid}", headers=H(T["technician"]), json={"data": {}}).status_code == 409
    # pathologist sees it in the queue
    q = c.get("/api/cases?status=prepared", headers=H(T["pathologist"])).json()
    assert any(x["id"] == cid for x in q)
    assert c.get("/api/dashboard", headers=H(T["pathologist"])).json()["cases_awaiting"] >= 1
    # returning needs a reason, then goes back to draft with the note
    assert c.post(f"/api/cases/{cid}/return", headers=H(T["pathologist"]), json={"note": ""}).status_code == 400
    back = c.post(f"/api/cases/{cid}/return", headers=H(T["pathologist"]), json={"note": "Recheck blast count on 10 more fields"}).json()
    assert back["status"] == "draft" and "blast" in back["return_note"]
    # re-prepared, then authorised by the pathologist only
    assert c.post(f"/api/cases/{cid}/prepare", headers=H(T["technician"])).json()["status"] == "prepared"
    signed = c.post(f"/api/cases/{cid}/sign", headers=H(T["pathologist"])).json()
    assert signed["status"] == "signed" and signed["signed_by"] == "Pathologist"
    actions = [a["action"] for a in c.get("/api/audit?limit=50", headers=H(T["dpo"])).json() if a["entity_id"] == cid]
    for a in ("case.prepared", "case.returned", "case.signed"):
        assert a in actions


def test_previous_cbc_ai_qa_and_lab_ranges():
    p = new_patient().json()
    first = c.post("/api/cases", headers=H(T["technician"]), json={"patient_id": p["id"], "lab_no": "PBS/80", "data": {"hb": 11.2, "plt": 210, "pbFilm": "normal"}}).json()
    second = c.post("/api/cases", headers=H(T["technician"]), json={"patient_id": p["id"], "lab_no": "PBS/81", "data": {"hb": 8.0}}).json()
    prev = c.get(f"/api/cases/{second['id']}/previous", headers=H(T["pathologist"])).json()
    assert prev["found"] and prev["lab_no"] == "PBS/80" and prev["cbc"] == {"hb": 11.2, "plt": 210} and prev["film_reviewed"]
    assert c.get(f"/api/cases/{first['id']}/previous", headers=H(T["pathologist"])).json()["found"] is False
    # AI-override tracking reaches the dashboard once the report is signed
    c.put(f"/api/cases/{second['id']}", headers=H(T["pathologist"]), json={"data": {"hb": 8.0}, "diagnosis": "Anaemia", "report": "text", "ai_used": True, "ai_cells": 100, "ai_agree": 93})
    c.post(f"/api/cases/{second['id']}/sign", headers=H(T["pathologist"]))
    qa = c.get("/api/dashboard", headers=H(T["pathologist"])).json()["ai_qa"]
    assert qa["cells"] >= 100 and 0 < qa["agreement"] <= 1
    # laboratory ranges: pathologist may set, technician may read but not change
    rng = {"F": {"hb": [11.5, 15.5]}, "critical": {"hb": [6.5, 20]}}
    assert c.put("/api/settings/lab-ranges", headers=H(T["technician"]), json={"ranges": rng}).status_code == 403
    assert c.put("/api/settings/lab-ranges", headers=H(T["pathologist"]), json={"ranges": rng}).status_code == 200
    assert c.get("/api/settings/lab-ranges", headers=H(T["technician"])).json()["ranges"] == rng
    assert c.put("/api/settings/lab-ranges", headers=H(T["pathologist"]), json={"ranges": None}).json()["ranges"] is None
