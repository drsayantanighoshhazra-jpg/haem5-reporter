import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..config import settings
from ..crypto import dec, enc, mask_contact, mask_name
from ..db import get_db
from ..models import PURPOSES, Consent, Patient, User
from ..notice import NOTICE_VERSION
from ..security import PERMS, client_ip, need

router = APIRouter(prefix="/api", tags=["patients"])


class ConsentIn(BaseModel):
    purposes: list[str]
    notice_version: str
    language: str = "en"
    given_by: str = "self"          # self | guardian
    method: str = "in-person (recorded by staff)"


class PatientIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    contact: str | None = None
    dob: str | None = None
    age_years: int | None = Field(default=None, ge=0, le=130)
    sex: str | None = Field(default=None, pattern="^[MFO]?$")
    guardian: str | None = None
    guardian_verified_by: str | None = None
    nominee: str | None = None
    notice_language: str = "en"
    consent: ConsentIn


def new_pseudonym(db: Session) -> str:
    while True:
        p = "P-" + secrets.token_hex(3).upper()
        if not db.execute(select(Patient).where(Patient.pseudonym == p)).first():
            return p


def consent_out(c: Consent) -> dict:
    return {"id": c.id, "purpose": c.purpose, "purpose_text": PURPOSES.get(c.purpose), "notice_version": c.notice_version,
            "language": c.language, "given_at": c.given_at, "given_by": c.given_by, "method": c.method,
            "active": c.active, "withdrawn_at": c.withdrawn_at, "withdrawn_reason": c.withdrawn_reason}


def patient_out(p: Patient, reveal: bool) -> dict:
    out = {"id": p.id, "pseudonym": p.pseudonym, "sex": p.sex, "age_years": p.age_years, "is_minor": p.is_minor,
           "created_at": p.created_at, "retain_until": p.retain_until, "erasure_scheduled_for": p.erasure_scheduled_for,
           "erased": p.erased_at is not None,
           "active_purposes": sorted({c.purpose for c in p.consents if c.active})}
    if p.erased_at:
        out.update(name="[erased]", contact=None, dob=None, guardian=None, nominee=None)
    elif reveal:
        out.update(name=dec(p.name_enc), contact=dec(p.contact_enc), dob=dec(p.dob_enc), guardian=dec(p.guardian_enc),
                   guardian_verified_by=p.guardian_verified_by, nominee=dec(p.nominee_enc))
    else:
        out.update(name=mask_name(dec(p.name_enc)), contact=mask_contact(dec(p.contact_enc)))
    return out


def active_purposes(p: Patient) -> set[str]:
    return {c.purpose for c in p.consents if c.active}


@router.post("/patients")
def create_patient(body: PatientIn, request: Request, u: User = Depends(need("patients.write")), db: Session = Depends(get_db)):
    bad = [x for x in body.consent.purposes if x not in PURPOSES]
    if bad:
        raise HTTPException(400, f"Unknown purpose(s): {', '.join(bad)}")
    if "diagnostic_reporting" not in body.consent.purposes:
        raise HTTPException(400, "Consent for diagnostic reporting is required to register a sample")
    if body.consent.notice_version != NOTICE_VERSION:
        raise HTTPException(409, "The privacy notice has changed — show the current notice and record consent again")
    minor = body.age_years is not None and body.age_years < 18
    if minor:
        if not body.guardian or body.consent.given_by != "guardian":
            raise HTTPException(400, "For a child under 18, consent must be given by a parent or lawful guardian (Act s.9)")
        if not body.guardian_verified_by:
            raise HTTPException(400, "Record how the guardian's identity and age were verified (Rule 10)")
    p = Patient(pseudonym=new_pseudonym(db), name_enc=enc(body.name.strip()), contact_enc=enc(body.contact), dob_enc=enc(body.dob),
                sex=body.sex or None, age_years=body.age_years, is_minor=minor, guardian_enc=enc(body.guardian),
                guardian_verified_by=body.guardian_verified_by, nominee_enc=enc(body.nominee), notice_language=body.notice_language,
                created_by=u.id, retain_until=datetime.now(timezone.utc) + timedelta(days=365 * settings.record_retention_years))
    db.add(p); db.flush()
    for purpose in body.consent.purposes:
        db.add(Consent(patient_id=p.id, purpose=purpose, notice_version=body.consent.notice_version, language=body.consent.language,
                       given_by=body.consent.given_by, method=body.consent.method, recorded_by=u.id))
    db.commit(); db.refresh(p)
    audit.log(db, u.id, "patient.created", "patient", p.pseudonym, {"purposes": body.consent.purposes, "notice": body.consent.notice_version, "minor": minor}, client_ip(request))
    return patient_out(p, reveal=True)


@router.get("/patients")
def list_patients(q: str | None = None, u: User = Depends(need("patients.read")), db: Session = Depends(get_db)):
    rows = db.execute(select(Patient).order_by(Patient.created_at.desc()).limit(500)).scalars().all()
    out = [patient_out(p, reveal=False) for p in rows]
    if q:
        ql = q.lower()
        out = [o for o in out if ql in o["pseudonym"].lower()]
    return out


@router.get("/patients/{pid}")
def get_patient(pid: str, request: Request, reveal: bool = False, u: User = Depends(need("patients.read")), db: Session = Depends(get_db)):
    p = db.get(Patient, pid) or db.execute(select(Patient).where(Patient.pseudonym == pid)).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Patient not found")
    can_reveal = "patients.reveal" in PERMS[u.role]
    if reveal and not can_reveal:
        raise HTTPException(403, "Your role cannot view identifiers")
    if reveal:
        audit.log(db, u.id, "patient.identifiers_viewed", "patient", p.pseudonym, None, client_ip(request))
    out = patient_out(p, reveal=reveal)
    out["consents"] = [consent_out(c) for c in p.consents]
    return out


class PatientPatch(BaseModel):
    name: str | None = None
    contact: str | None = None
    dob: str | None = None
    nominee: str | None = None
    reason: str = Field(min_length=3)


@router.patch("/patients/{pid}")
def correct_patient(pid: str, body: PatientPatch, request: Request, u: User = Depends(need("patients.write")), db: Session = Depends(get_db)):
    """Correction / completion / updating (Act s.12)."""
    p = db.get(Patient, pid)
    if not p or p.erased_at:
        raise HTTPException(404, "Patient not found")
    changed = []
    for f in ("name", "contact", "dob", "nominee"):
        v = getattr(body, f)
        if v is not None:
            setattr(p, f + "_enc", enc(v)); changed.append(f)
    db.commit()
    audit.log(db, u.id, "patient.corrected", "patient", p.pseudonym, {"fields": changed, "reason": body.reason}, client_ip(request))
    return patient_out(p, reveal=True)


class WithdrawIn(BaseModel):
    reason: str | None = None


@router.post("/consents/{cid}/withdraw")
def withdraw(cid: str, body: WithdrawIn, request: Request, u: User = Depends(need("consents")), db: Session = Depends(get_db)):
    """Withdrawal must be as easy as giving consent (Act s.6(4))."""
    c = db.get(Consent, cid)
    if not c:
        raise HTTPException(404, "Consent not found")
    if not c.active:
        raise HTTPException(400, "Already withdrawn")
    c.withdrawn_at = datetime.now(timezone.utc); c.withdrawn_reason = body.reason
    db.commit()
    audit.log(db, u.id, "consent.withdrawn", "patient", c.patient.pseudonym, {"purpose": c.purpose}, client_ip(request))
    return consent_out(c)


class AddConsentIn(BaseModel):
    purpose: str
    notice_version: str
    given_by: str = "self"
    method: str = "in-person (recorded by staff)"


@router.post("/patients/{pid}/consents")
def add_consent(pid: str, body: AddConsentIn, request: Request, u: User = Depends(need("consents")), db: Session = Depends(get_db)):
    p = db.get(Patient, pid)
    if not p or p.erased_at:
        raise HTTPException(404, "Patient not found")
    if body.purpose not in PURPOSES:
        raise HTTPException(400, "Unknown purpose")
    if body.notice_version != NOTICE_VERSION:
        raise HTTPException(409, "Show the current privacy notice first")
    if p.is_minor and body.given_by != "guardian":
        raise HTTPException(400, "For a child, consent must come from the parent or lawful guardian")
    c = Consent(patient_id=p.id, purpose=body.purpose, notice_version=body.notice_version, given_by=body.given_by, method=body.method, recorded_by=u.id)
    db.add(c); db.commit()
    audit.log(db, u.id, "consent.given", "patient", p.pseudonym, {"purpose": body.purpose}, client_ip(request))
    return consent_out(c)
