import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit
from ..config import settings
from ..db import get_db
from ..models import ROLES, Breach, Case, Patient, RightsRequest, User
from ..security import client_ip, current_user, hash_pw, need
from .privacy import aware, breach_out

router = APIRouter(prefix="/api", tags=["admin"])


class UserIn(BaseModel):
    email: str
    full_name: str = Field(min_length=2)
    role: str


@router.get("/users")
def list_users(u: User = Depends(need("users")), db: Session = Depends(get_db)):
    return [{"id": x.id, "email": x.email, "full_name": x.full_name, "role": x.role, "active": x.active, "totp_enabled": x.totp_enabled}
            for x in db.execute(select(User).order_by(User.created_at)).scalars()]


@router.post("/users")
def create_user(body: UserIn, request: Request, u: User = Depends(need("users")), db: Session = Depends(get_db)):
    if body.role not in ROLES:
        raise HTTPException(400, "Unknown role")
    email = body.email.lower().strip()
    if db.execute(select(User).where(User.email == email)).first():
        raise HTTPException(409, "A user with this email exists")
    temp = secrets.token_urlsafe(12) + "A1"
    x = User(email=email, full_name=body.full_name, role=body.role, pw_hash=hash_pw(temp), must_change_pw=True)
    db.add(x); db.commit()
    audit.log(db, u.id, "user.created", "user", x.id, {"role": x.role}, client_ip(request))
    return {"id": x.id, "email": x.email, "temporary_password": temp,
            "message": "Give this temporary password to the user privately. They must change it and set up two-factor authentication at first sign-in."}


class UserPatch(BaseModel):
    active: bool | None = None
    role: str | None = None


@router.patch("/users/{xid}")
def patch_user(xid: str, body: UserPatch, request: Request, u: User = Depends(need("users")), db: Session = Depends(get_db)):
    x = db.get(User, xid)
    if not x:
        raise HTTPException(404, "User not found")
    if x.id == u.id and body.active is False:
        raise HTTPException(400, "You cannot deactivate yourself")
    if body.role:
        if body.role not in ROLES:
            raise HTTPException(400, "Unknown role")
        x.role = body.role
    if body.active is not None:
        x.active = body.active
    db.commit()
    audit.log(db, u.id, "user.updated", "user", x.id, body.model_dump(exclude_none=True), client_ip(request))
    return {"ok": True}


@router.get("/dashboard")
def dashboard(u: User = Depends(current_user), db: Session = Depends(get_db)):
    nowt = datetime.now(timezone.utc)
    rr = db.execute(select(RightsRequest).where(RightsRequest.status.in_(["open", "in_progress"]))).scalars().all()
    br = [breach_out(b) for b in db.execute(select(Breach).where(Breach.status == "open")).scalars()]
    return {
        "patients": db.scalar(select(func.count()).select_from(Patient).where(Patient.erased_at.is_(None))),
        "cases_draft": db.scalar(select(func.count()).select_from(Case).where(Case.status == "draft")),
        "cases_signed": db.scalar(select(func.count()).select_from(Case).where(Case.status == "signed")),
        "cases_awaiting": db.scalar(select(func.count()).select_from(Case).where(Case.status == "prepared")),
        "rights_open": len(rr), "rights_overdue": sum(1 for r in rr if aware(r.due_at) < nowt),
        "rights_due_7d": sum(1 for r in rr if 0 <= (aware(r.due_at) - nowt).days <= 7),
        "breaches_open": len(br), "breach_board_overdue": sum(1 for b in br if b["board_overdue"]),
        "next_breach_deadline_h": min([b["hours_to_board_deadline"] for b in br if not b["board_detailed_at"]], default=None),
        "erasures_scheduled": db.scalar(select(func.count()).select_from(Patient).where(Patient.erasure_scheduled_for.is_not(None), Patient.erased_at.is_(None))),
        "org": {"fiduciary": settings.fiduciary_name, "region": settings.data_region, "demo": settings.demo_mode},
    }
