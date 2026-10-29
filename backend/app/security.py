"""Authentication (argon2id passwords + TOTP 2FA + short-lived JWT) and role-based access control."""
import base64
import io
from datetime import datetime, timedelta, timezone

import jwt
import pyotp
import qrcode
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import settings
from .crypto import dec
from .db import get_db
from .models import User

ph = PasswordHasher()
bearer = HTTPBearer(auto_error=False)

# What each role may do (least privilege — Rule 6 access control).
PERMS = {
    "admin":       {"users", "settings", "audit", "breaches", "dashboard", "patients.read"},
    "dpo":         {"rights", "consents", "breaches", "audit", "retention", "dashboard", "patients.read", "patients.reveal", "export"},
    "pathologist": {"patients.read", "patients.write", "patients.reveal", "consents", "cases.read", "cases.write", "cases.sign", "rights.create", "dashboard"},
    "resident":    {"patients.read", "cases.read", "cases.write", "dashboard"},
    "technician":  {"patients.read", "patients.write", "consents", "rights.create", "dashboard", "cases.read", "cases.write"},
}


def hash_pw(pw: str) -> str:
    return ph.hash(pw)


def check_pw(h: str, pw: str) -> bool:
    try:
        return ph.verify(h, pw)
    except VerifyMismatchError:
        return False
    except Exception:
        return False


def password_problems(pw: str) -> list[str]:
    p = []
    if len(pw) < 12: p.append("at least 12 characters")
    if pw.lower() == pw or pw.upper() == pw: p.append("upper- and lower-case letters")
    if not any(c.isdigit() for c in pw): p.append("a digit")
    return p


def make_token(user: User) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.token_minutes)
    return jwt.encode({"sub": user.id, "role": user.role, "exp": exp}, settings.jwt_secret, algorithm="HS256")


def totp_for(user: User) -> pyotp.TOTP | None:
    s = dec(user.totp_secret_enc)
    return pyotp.TOTP(s) if s else None


def qr_data_uri(uri: str) -> str:
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User:
    if not creds:
        raise HTTPException(401, "Sign in required")
    try:
        payload = jwt.decode(creds.credentials, settings.jwt_secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Session expired — sign in again")
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid session")
    u = db.get(User, payload["sub"])
    if not u or not u.active:
        raise HTTPException(401, "Account inactive")
    return u


def need(perm: str):
    def dep(user: User = Depends(current_user)) -> User:
        if perm not in PERMS.get(user.role, set()):
            raise HTTPException(403, f"Your role ({user.role}) cannot do this")
        if settings.require_2fa and not user.totp_enabled and perm not in ("dashboard",):
            raise HTTPException(403, "Set up two-factor authentication before accessing patient data")
        return user
    return dep


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown"))[:64]
