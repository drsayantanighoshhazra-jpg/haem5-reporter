from datetime import datetime, timedelta, timezone

import pyotp
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..config import settings
from ..crypto import enc
from ..db import get_db
from ..models import User
from ..security import (PERMS, check_pw, client_ip, current_user, hash_pw, make_token, password_problems, qr_data_uri,
                        totp_for)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str
    code: str | None = None


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    u = db.execute(select(User).where(User.email == body.email.lower().strip())).scalar_one_or_none()
    nowt = datetime.now(timezone.utc)
    if u and u.locked_until and (u.locked_until if u.locked_until.tzinfo else u.locked_until.replace(tzinfo=timezone.utc)) > nowt:
        audit.log(db, u.id, "login.blocked_locked", ip=ip)
        raise HTTPException(423, "Account temporarily locked after repeated failed sign-ins. Try again later.")
    if not u or not u.active or not check_pw(u.pw_hash, body.password):
        if u:
            u.failed_logins += 1
            if u.failed_logins >= settings.max_failed_logins:
                u.locked_until = nowt + timedelta(minutes=settings.lockout_minutes); u.failed_logins = 0
            audit.log(db, u.id, "login.failed", ip=ip)
        raise HTTPException(401, "Email or password is incorrect")
    if u.totp_enabled:
        if not body.code:
            return {"need_2fa": True}
        t = totp_for(u)
        if not t or not t.verify(body.code.strip(), valid_window=1):
            u.failed_logins += 1; db.commit()
            audit.log(db, u.id, "login.failed_2fa", ip=ip)
            raise HTTPException(401, "Authenticator code is incorrect")
    u.failed_logins = 0; u.locked_until = None; db.commit()
    audit.log(db, u.id, "login.success", ip=ip)
    return {"token": make_token(u), "user": me_out(u)}


def me_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role, "totp_enabled": u.totp_enabled,
            "must_change_pw": u.must_change_pw, "permissions": sorted(PERMS.get(u.role, [])), "require_2fa": settings.require_2fa}


@router.get("/me")
def me(u: User = Depends(current_user)):
    return me_out(u)


@router.post("/2fa/setup")
def setup_2fa(request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    if u.totp_enabled:
        raise HTTPException(400, "Two-factor authentication is already on")
    secret = pyotp.random_base32()
    u.totp_secret_enc = enc(secret); db.commit()
    uri = pyotp.TOTP(secret).provisioning_uri(name=u.email, issuer_name="HAEM5 Reporter")
    audit.log(db, u.id, "2fa.setup_started", ip=client_ip(request))
    return {"secret": secret, "otpauth_uri": uri, "qr": qr_data_uri(uri)}


class CodeIn(BaseModel):
    code: str


@router.post("/2fa/enable")
def enable_2fa(body: CodeIn, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    t = totp_for(u)
    if not t or not t.verify(body.code.strip(), valid_window=1):
        raise HTTPException(400, "Code did not match. Check your authenticator app's time and try again.")
    u.totp_enabled = True; db.commit()
    audit.log(db, u.id, "2fa.enabled", ip=client_ip(request))
    return me_out(u)


class PwIn(BaseModel):
    current_password: str
    new_password: str


@router.post("/password")
def change_pw(body: PwIn, request: Request, u: User = Depends(current_user), db: Session = Depends(get_db)):
    if not check_pw(u.pw_hash, body.current_password):
        raise HTTPException(400, "Current password is incorrect")
    probs = password_problems(body.new_password)
    if probs:
        raise HTTPException(400, "New password needs " + ", ".join(probs))
    u.pw_hash = hash_pw(body.new_password); u.must_change_pw = False; db.commit()
    audit.log(db, u.id, "password.changed", ip=client_ip(request))
    return me_out(u)
