from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..crypto import dec_json, dec, enc
from ..db import get_db
from ..models import Case, Patient, User
from ..security import PERMS, client_ip, need
from .patients import active_purposes

router = APIRouter(prefix="/api/cases", tags=["cases"])

# Fields from the workbench that identify a person — never stored inside case data (kept on Patient, encrypted).
STRIP = {"patient"}


class CaseIn(BaseModel):
    patient_id: str
    lab_no: str
    data: dict = {}


class CaseUpdate(BaseModel):
    data: dict
    diagnosis: str | None = None
    report: str | None = None
    ai_used: bool = False


_NAMES: dict = {}


def _name(uid):
    return _NAMES.get(uid) if uid else None


def _load_names(db: Session):
    _NAMES.clear(); _NAMES.update({u.id: u.full_name for u in db.execute(select(User)).scalars()})


def case_out(c: Case, p: Patient, full: bool) -> dict:
    out = {"id": c.id, "lab_no": c.lab_no, "patient_id": p.id, "pseudonym": p.pseudonym, "diagnosis": c.diagnosis,
           "status": c.status, "ai_used": c.ai_used, "updated_at": c.updated_at, "signed_at": c.signed_at,
           "prepared_at": c.prepared_at, "prepared_by": _name(c.prepared_by), "signed_by": _name(c.signed_by), "return_note": c.return_note,
           "permissions": {"ai_allowed": "ai_assisted_analysis" in active_purposes(p),
                           "processing_allowed": "diagnostic_reporting" in active_purposes(p) and not p.erased_at}}
    if full:
        out["data"] = dec_json(c.data_enc) or {}
        out["report"] = dec(c.report_enc)
    return out


def _consent_gate(p: Patient):
    if p.erased_at:
        raise HTTPException(410, "This patient's personal data has been erased")
    if "diagnostic_reporting" not in active_purposes(p):
        raise HTTPException(409, "Consent for diagnostic reporting has been withdrawn — processing must stop")


@router.post("")
def create_case(body: CaseIn, request: Request, u: User = Depends(need("cases.write")), db: Session = Depends(get_db)):
    p = db.get(Patient, body.patient_id)
    if not p:
        raise HTTPException(404, "Patient not found")
    _consent_gate(p)
    data = {k: v for k, v in body.data.items() if k not in STRIP}
    c = Case(patient_id=p.id, lab_no=body.lab_no.strip(), data_enc=enc(data), created_by=u.id)
    db.add(c); db.commit()
    audit.log(db, u.id, "case.created", "case", c.id, {"patient": p.pseudonym, "lab_no": c.lab_no}, client_ip(request))
    return case_out(c, p, True)


@router.get("")
def list_cases(status: str | None = None, u: User = Depends(need("cases.read")), db: Session = Depends(get_db)):
    _load_names(db)
    q = select(Case, Patient).join(Patient)
    if status:
        q = q.where(Case.status == status)
    rows = db.execute(q.order_by(Case.prepared_at.asc() if status == "prepared" else Case.updated_at.desc()).limit(500)).all()
    return [case_out(c, p, False) for c, p in rows]


@router.get("/{cid}")
def get_case(cid: str, request: Request, u: User = Depends(need("cases.read")), db: Session = Depends(get_db)):
    c = db.get(Case, cid)
    if not c:
        raise HTTPException(404, "Case not found")
    p = db.get(Patient, c.patient_id); _load_names(db)
    audit.log(db, u.id, "case.viewed", "case", c.id, {"patient": p.pseudonym}, client_ip(request))
    return case_out(c, p, True)


@router.put("/{cid}")
def update_case(cid: str, body: CaseUpdate, request: Request, u: User = Depends(need("cases.write")), db: Session = Depends(get_db)):
    c = db.get(Case, cid)
    if not c:
        raise HTTPException(404, "Case not found")
    if c.status == "signed":
        raise HTTPException(409, "Signed reports are locked. Issue an addendum instead.")
    if c.status == "prepared" and "cases.sign" not in PERMS[u.role]:
        raise HTTPException(409, "This report is awaiting authorisation. Ask the pathologist to return it if changes are needed.")
    p = db.get(Patient, c.patient_id); _load_names(db)
    _consent_gate(p)
    if body.ai_used and "ai_assisted_analysis" not in active_purposes(p):
        raise HTTPException(409, "No consent for AI-assisted analysis — count manually")
    c.data_enc = enc({k: v for k, v in body.data.items() if k not in STRIP})
    c.diagnosis = (body.diagnosis or "")[:300] or None
    c.report_enc = enc(body.report)
    c.ai_used = c.ai_used or body.ai_used
    db.commit()
    audit.log(db, u.id, "case.updated", "case", c.id, {"ai_used": body.ai_used}, client_ip(request))
    return case_out(c, p, True)


class ReturnIn(BaseModel):
    note: str


def _get(db, cid):
    c = db.get(Case, cid)
    if not c:
        raise HTTPException(404, "Case not found")
    return c, db.get(Patient, c.patient_id)


@router.post("/{cid}/prepare")
def prepare_case(cid: str, request: Request, u: User = Depends(need("cases.write")), db: Session = Depends(get_db)):
    """Preparer (technician / resident / pathologist) sends a complete draft for authorisation."""
    c, p = _get(db, cid); _consent_gate(p)
    if c.status != "draft":
        raise HTTPException(409, f"Only drafts can be sent for authorisation (this case is {c.status})")
    if not c.diagnosis or not c.report_enc:
        raise HTTPException(400, "Save the draft with an impression and report text first")
    c.status = "prepared"; c.prepared_by = u.id; c.prepared_at = datetime.now(timezone.utc); c.return_note = None
    db.commit(); _load_names(db)
    audit.log(db, u.id, "case.prepared", "case", c.id, {"patient": p.pseudonym}, client_ip(request))
    return case_out(c, p, True)


@router.post("/{cid}/return")
def return_case(cid: str, body: ReturnIn, request: Request, u: User = Depends(need("cases.sign")), db: Session = Depends(get_db)):
    """Pathologist sends a prepared report back with a reason."""
    c, p = _get(db, cid)
    if c.status != "prepared":
        raise HTTPException(409, "Only reports awaiting authorisation can be returned")
    if len(body.note.strip()) < 3:
        raise HTTPException(400, "Say what needs correcting")
    c.status = "draft"; c.return_note = body.note.strip()
    db.commit(); _load_names(db)
    audit.log(db, u.id, "case.returned", "case", c.id, {"patient": p.pseudonym}, client_ip(request))
    return case_out(c, p, True)


@router.post("/{cid}/sign")
def sign_case(cid: str, request: Request, u: User = Depends(need("cases.sign")), db: Session = Depends(get_db)):
    """Authorisation: only a pathologist, never automatic."""
    c, p = _get(db, cid); _consent_gate(p)
    if c.status == "signed":
        raise HTTPException(409, "Already authorised")
    if not c.diagnosis or not c.report_enc:
        raise HTTPException(400, "Add a diagnosis and report before signing")
    c.status = "signed"; c.signed_by = u.id; c.signed_at = datetime.now(timezone.utc)
    db.commit(); _load_names(db)
    audit.log(db, u.id, "case.signed", "case", c.id, {"patient": p.pseudonym, "prepared_by": c.prepared_by}, client_ip(request))
    return case_out(c, p, True)
