"""DPDP operations: public notice, rights requests, erasure & retention, breach register, audit."""
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import audit
from ..config import settings
from ..crypto import dec, dec_json, enc
from ..db import get_db
from ..models import RIGHTS, AuditLog, Breach, Case, Consent, Patient, RightsRequest, User
from ..notice import notice
from ..security import client_ip, need
from .patients import consent_out

router = APIRouter(prefix="/api", tags=["privacy"])
UTC = timezone.utc


def aware(d: datetime | None) -> datetime | None:
    return None if d is None else (d if d.tzinfo else d.replace(tzinfo=UTC))


def ref(prefix: str) -> str:
    return f"{prefix}-{datetime.now(UTC):%y%m}-{secrets.token_hex(2).upper()}"


# ---------------- public ----------------
@router.get("/public/notice")
def public_notice(lang: str = "en"):
    return notice(lang)


class PublicRequestIn(BaseModel):
    kind: str
    lab_no_or_name: str = Field(min_length=2, max_length=200)
    contact: str = Field(min_length=5, max_length=200)
    details: str = Field(default="", max_length=4000)


@router.post("/public/rights-request")
def public_request(body: PublicRequestIn, request: Request, db: Session = Depends(get_db)):
    """A Data Principal can raise a request without an account; staff verify identity before acting."""
    if body.kind not in RIGHTS:
        raise HTTPException(400, "Unknown request type")
    r = RightsRequest(ref=ref("RR"), kind=body.kind, channel="public-form",
                      details_enc=enc({"identifier": body.lab_no_or_name, "details": body.details}),
                      requester_contact_enc=enc(body.contact),
                      due_at=datetime.now(UTC) + timedelta(days=settings.rights_sla_days))
    db.add(r); db.commit()
    audit.log(db, "public", "rights.received", "rights_request", r.ref, {"kind": r.kind, "channel": "public-form"}, client_ip(request))
    return {"ref": r.ref, "due_by": r.due_at, "message": f"Request {r.ref} received. We will verify your identity and respond by {r.due_at:%d %b %Y}."}


# ---------------- rights requests ----------------
def rr_out(r: RightsRequest, db: Session) -> dict:
    p = db.get(Patient, r.patient_id) if r.patient_id else None
    d = aware(r.due_at)
    return {"id": r.id, "ref": r.ref, "kind": r.kind, "channel": r.channel, "status": r.status, "identity_verified": r.identity_verified,
            "pseudonym": p.pseudonym if p else None, "received_at": r.received_at, "due_at": r.due_at, "resolved_at": r.resolved_at,
            "days_left": (d - datetime.now(UTC)).days, "overdue": r.status in ("open", "in_progress") and d < datetime.now(UTC),
            "details": dec_json(r.details_enc) if r.details_enc and r.details_enc else None,
            "requester_contact": dec(r.requester_contact_enc), "response": dec(r.response_enc)}


class RightsIn(BaseModel):
    patient_id: str
    kind: str
    details: str = ""


@router.post("/rights")
def create_rights(body: RightsIn, request: Request, u: User = Depends(need("rights.create")), db: Session = Depends(get_db)):
    if body.kind not in RIGHTS:
        raise HTTPException(400, "Unknown request type")
    p = db.get(Patient, body.patient_id)
    if not p:
        raise HTTPException(404, "Patient not found")
    r = RightsRequest(ref=ref("RR"), patient_id=p.id, kind=body.kind, channel="staff", identity_verified=True,
                      details_enc=enc({"details": body.details}), due_at=datetime.now(UTC) + timedelta(days=settings.rights_sla_days))
    db.add(r); db.commit()
    audit.log(db, u.id, "rights.received", "rights_request", r.ref, {"kind": r.kind, "patient": p.pseudonym}, client_ip(request))
    return rr_out(r, db)


def _staff_rights_list(db: Session):
    return [rr_out(r, db) for r in db.execute(select(RightsRequest).order_by(RightsRequest.due_at)).scalars()]


@router.get("/rights")
def list_rights(u: User = Depends(need("rights")), db: Session = Depends(get_db)):
    return _staff_rights_list(db)


class RightsUpdate(BaseModel):
    status: str | None = Field(default=None, pattern="^(open|in_progress|fulfilled|rejected)$")
    patient_id: str | None = None
    identity_verified: bool | None = None
    response: str | None = None


@router.patch("/rights/{rid}")
def update_rights(rid: str, body: RightsUpdate, request: Request, u: User = Depends(need("rights")), db: Session = Depends(get_db)):
    r = db.get(RightsRequest, rid)
    if not r:
        raise HTTPException(404, "Request not found")
    if body.patient_id is not None:
        if not db.get(Patient, body.patient_id):
            raise HTTPException(404, "Patient not found")
        r.patient_id = body.patient_id
    if body.identity_verified is not None:
        r.identity_verified = body.identity_verified
    if body.response is not None:
        r.response_enc = enc(body.response)
    if body.status:
        if body.status == "fulfilled" and not r.identity_verified:
            raise HTTPException(400, "Verify the requester's identity before fulfilling")
        r.status = body.status
        if body.status in ("fulfilled", "rejected"):
            r.resolved_at = datetime.now(UTC)
            if body.status == "rejected" and not (body.response or r.response_enc):
                raise HTTPException(400, "Give reasons when rejecting a request")
    r.handled_by = u.id
    db.commit()
    audit.log(db, u.id, "rights.updated", "rights_request", r.ref, {"status": r.status}, client_ip(request))
    return rr_out(r, db)


@router.get("/rights/{rid}/access-summary")
def access_summary(rid: str, request: Request, u: User = Depends(need("export")), db: Session = Depends(get_db)):
    """Right to access (Act s.11): summary of data, processing activities and with whom it was shared."""
    r = db.get(RightsRequest, rid)
    if not r or not r.patient_id:
        raise HTTPException(404, "Link the request to a patient first")
    if not r.identity_verified:
        raise HTTPException(400, "Verify identity first")
    p = db.get(Patient, r.patient_id)
    cases = db.execute(select(Case).where(Case.patient_id == p.id)).scalars().all()
    trail = db.execute(select(AuditLog).where(AuditLog.entity_id == p.pseudonym).order_by(AuditLog.ts)).scalars().all()
    out = {
        "generated_at": datetime.now(UTC), "data_fiduciary": settings.fiduciary_name, "request_ref": r.ref,
        "identity": {"pseudonym": p.pseudonym, "name": dec(p.name_enc), "contact": dec(p.contact_enc), "dob": dec(p.dob_enc),
                     "age_years": p.age_years, "sex": p.sex, "guardian": dec(p.guardian_enc), "nominee": dec(p.nominee_enc)},
        "consents": [consent_out(c) for c in p.consents],
        "reports": [{"lab_no": c.lab_no, "status": c.status, "diagnosis": c.diagnosis, "signed_at": c.signed_at, "ai_assisted": c.ai_used} for c in cases],
        "processing_activities": [{"when": a.ts, "action": a.action} for a in trail],
        "shared_with": ["Treating/referring clinician (report delivery)"],
        "storage_location": settings.data_region,
    }
    audit.log(db, u.id, "rights.access_summary_generated", "patient", p.pseudonym, {"ref": r.ref}, client_ip(request))
    return out


@router.post("/rights/{rid}/schedule-erasure")
def schedule_erasure(rid: str, request: Request, u: User = Depends(need("rights")), db: Session = Depends(get_db)):
    """Erasure (Act s.12(3)): schedule with at least 48 h prior intimation, then purge via /retention/run."""
    r = db.get(RightsRequest, rid)
    if not r or r.kind != "erasure" or not r.patient_id:
        raise HTTPException(400, "Needs an erasure request linked to a patient")
    if not r.identity_verified:
        raise HTTPException(400, "Verify identity first")
    p = db.get(Patient, r.patient_id)
    nowt = datetime.now(UTC)
    p.erasure_notified_at = nowt
    p.erasure_scheduled_for = nowt + timedelta(hours=settings.erasure_notice_hours)
    r.status = "in_progress"
    db.commit()
    audit.log(db, u.id, "erasure.scheduled", "patient", p.pseudonym, {"ref": r.ref, "at": p.erasure_scheduled_for.isoformat()}, client_ip(request))
    return {"pseudonym": p.pseudonym, "erasure_scheduled_for": p.erasure_scheduled_for,
            "intimation": f"Notify the Data Principal now: personal data will be erased on {p.erasure_scheduled_for:%d %b %Y %H:%M} UTC unless they confirm otherwise."}


def _erase(db: Session, p: Patient, actor: str, why: str):
    """Crypto-shred identifiers and clinical free text; keep only pseudonymised diagnosis line + audit trail."""
    p.name_enc = p.contact_enc = p.dob_enc = p.guardian_enc = p.nominee_enc = None
    p.erased_at = datetime.now(UTC); p.erasure_scheduled_for = None
    for c in db.execute(select(Case).where(Case.patient_id == p.id)).scalars():
        c.data_enc = None; c.report_enc = None
    for rr in db.execute(select(RightsRequest).where(RightsRequest.patient_id == p.id, RightsRequest.kind == "erasure", RightsRequest.status != "fulfilled")).scalars():
        rr.status = "fulfilled"; rr.resolved_at = datetime.now(UTC)
    db.commit()
    audit.log(db, actor, "patient.erased", "patient", p.pseudonym, {"reason": why})


@router.post("/retention/run")
def retention_run(request: Request, u: User = Depends(need("retention")), db: Session = Depends(get_db)):
    """Run scheduled erasures, expire records past retention (with 48 h intimation), prune old logs (>= 1 year kept)."""
    nowt = datetime.now(UTC)
    erased, notified = [], []
    for p in db.execute(select(Patient).where(Patient.erased_at.is_(None))).scalars().all():
        sched, retain = aware(p.erasure_scheduled_for), aware(p.retain_until)
        if sched and sched <= nowt:
            _erase(db, p, u.id, "scheduled erasure"); erased.append(p.pseudonym)
        elif retain and retain <= nowt and not sched:
            p.erasure_notified_at = nowt; p.erasure_scheduled_for = nowt + timedelta(hours=settings.erasure_notice_hours)
            notified.append(p.pseudonym)
    cutoff = nowt - timedelta(days=settings.log_retention_days)
    # Logs are pruned only from the start of the chain, so verification of what remains still holds.
    old = db.execute(select(AuditLog).where(AuditLog.ts < cutoff).order_by(AuditLog.id)).scalars().all()
    pruned = len(old)
    if old:
        db.execute(delete(AuditLog).where(AuditLog.id <= old[-1].id))
    db.commit()
    audit.log(db, u.id, "retention.run", None, None, {"erased": len(erased), "notified": len(notified), "logs_pruned": pruned}, client_ip(request))
    return {"erased": erased, "erasure_intimated": notified, "logs_pruned": pruned}


# ---------------- breaches ----------------
class BreachIn(BaseModel):
    became_aware_at: datetime | None = None
    description: str = Field(min_length=5)
    data_categories: str | None = None
    affected_count: int | None = None
    likely_consequences: str | None = None
    mitigation: str | None = None


class BreachUpdate(BaseModel):
    mitigation: str | None = None
    cause_findings: str | None = None
    likely_consequences: str | None = None
    affected_count: int | None = None
    board_initial: bool | None = None
    board_detailed: bool | None = None
    principals_notified: bool | None = None
    status: str | None = Field(default=None, pattern="^(open|closed)$")


def breach_out(b: Breach) -> dict:
    aw = aware(b.became_aware_at)
    due = aw + timedelta(hours=settings.breach_board_hours)
    hrs = (due - datetime.now(UTC)).total_seconds() / 3600
    return {"id": b.id, "ref": b.ref, "became_aware_at": b.became_aware_at, "description": b.description, "data_categories": b.data_categories,
            "affected_count": b.affected_count, "likely_consequences": b.likely_consequences, "mitigation": b.mitigation,
            "cause_findings": b.cause_findings, "status": b.status,
            "board_initial_at": b.board_initial_at, "board_detailed_due": due, "board_detailed_at": b.board_detailed_at,
            "principals_notified_at": b.principals_notified_at,
            "hours_to_board_deadline": round(hrs, 1), "board_overdue": b.board_detailed_at is None and hrs < 0}


@router.post("/breaches")
def create_breach(body: BreachIn, request: Request, u: User = Depends(need("breaches")), db: Session = Depends(get_db)):
    b = Breach(ref=ref("BR"), became_aware_at=body.became_aware_at or datetime.now(UTC), description=body.description,
               data_categories=body.data_categories, affected_count=body.affected_count, likely_consequences=body.likely_consequences,
               mitigation=body.mitigation, recorded_by=u.id)
    db.add(b); db.commit()
    audit.log(db, u.id, "breach.recorded", "breach", b.ref, None, client_ip(request))
    return breach_out(b)


@router.get("/breaches")
def list_breaches(u: User = Depends(need("breaches")), db: Session = Depends(get_db)):
    return [breach_out(b) for b in db.execute(select(Breach).order_by(Breach.became_aware_at.desc())).scalars()]


@router.patch("/breaches/{bid}")
def update_breach(bid: str, body: BreachUpdate, request: Request, u: User = Depends(need("breaches")), db: Session = Depends(get_db)):
    b = db.get(Breach, bid)
    if not b:
        raise HTTPException(404, "Breach not found")
    nowt = datetime.now(UTC)
    for f in ("mitigation", "cause_findings", "likely_consequences", "affected_count"):
        v = getattr(body, f)
        if v is not None:
            setattr(b, f, v)
    if body.board_initial: b.board_initial_at = b.board_initial_at or nowt
    if body.board_detailed:
        if not (b.mitigation and b.cause_findings):
            raise HTTPException(400, "The detailed intimation needs mitigation measures and findings on the cause (Rule 7)")
        b.board_detailed_at = b.board_detailed_at or nowt
    if body.principals_notified: b.principals_notified_at = b.principals_notified_at or nowt
    if body.status: b.status = body.status
    db.commit()
    audit.log(db, u.id, "breach.updated", "breach", b.ref, body.model_dump(exclude_none=True, exclude={"mitigation", "cause_findings", "likely_consequences"}), client_ip(request))
    return breach_out(b)


@router.get("/breaches/{bid}/principal-notice")
def principal_notice(bid: str, u: User = Depends(need("breaches")), db: Session = Depends(get_db)):
    """Draft intimation to affected Data Principals (Rule 7): nature, consequences, mitigation, safety steps, contact."""
    b = db.get(Breach, bid)
    if not b:
        raise HTTPException(404, "Breach not found")
    s = settings
    text = (f"Notice of a personal data breach — {s.fiduciary_name}\n\n"
            f"What happened: {b.description} (we became aware on {aware(b.became_aware_at):%d %b %Y}).\n"
            f"Data involved: {b.data_categories or 'under assessment'}.\n"
            f"Possible consequences for you: {b.likely_consequences or 'under assessment'}.\n"
            f"What we have done: {b.mitigation or 'containment in progress'}.\n"
            "What you can do: be cautious of unexpected calls or messages that mention your laboratory tests, and contact us with any concern.\n"
            f"Contact: {s.dpo_name}, {s.dpo_email}, {s.dpo_phone}.")
    return {"text": text}


# ---------------- audit ----------------
@router.get("/audit")
def audit_list(limit: int = 200, u: User = Depends(need("audit")), db: Session = Depends(get_db)):
    rows = db.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(min(limit, 1000))).scalars()
    return [{"id": a.id, "ts": a.ts, "actor": a.actor, "action": a.action, "entity": a.entity, "entity_id": a.entity_id,
             "detail": a.detail, "ip": a.ip, "hash": a.hash[:12]} for a in rows]


@router.get("/audit/verify")
def audit_verify(u: User = Depends(need("audit")), db: Session = Depends(get_db)):
    return audit.verify(db)
