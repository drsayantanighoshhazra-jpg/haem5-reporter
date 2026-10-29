"""Tamper-evident audit log: each entry's hash covers the previous entry's hash (hash chain).

Personal data is never written into audit details — only identifiers (pseudonyms / ids) and action names.
"""
import hashlib
import json
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AuditLog

GENESIS = "0" * 64


def _digest(prev: str, ts: datetime, actor: str, action: str, entity, entity_id, detail) -> str:
    body = json.dumps({"prev": prev, "ts": ts.astimezone(timezone.utc).isoformat(timespec="microseconds"), "actor": actor,
                       "action": action, "entity": entity, "entity_id": entity_id, "detail": detail},
                      sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(body.encode()).hexdigest()


def log(db: Session, actor: str, action: str, entity: str | None = None, entity_id: str | None = None,
        detail: dict | None = None, ip: str | None = None, commit: bool = True) -> AuditLog:
    last = db.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(1)).scalar_one_or_none()
    prev = last.hash if last else GENESIS
    ts = datetime.now(timezone.utc)
    h = _digest(prev, ts, actor, action, entity, entity_id, detail)
    row = AuditLog(ts=ts, actor=actor, action=action, entity=entity, entity_id=entity_id, detail=detail, ip=ip, prev_hash=prev, hash=h)
    db.add(row)
    if commit:
        db.commit()
    return row


def verify(db: Session) -> dict:
    prev = None
    n = 0
    for row in db.execute(select(AuditLog).order_by(AuditLog.id)).scalars():
        if prev is not None and row.prev_hash != prev:
            return {"ok": False, "checked": n, "broken_at": row.id, "reason": "chain link mismatch"}
        ts = row.ts if row.ts.tzinfo else row.ts.replace(tzinfo=timezone.utc)
        if _digest(row.prev_hash, ts, row.actor, row.action, row.entity, row.entity_id, row.detail) != row.hash:
            return {"ok": False, "checked": n, "broken_at": row.id, "reason": "entry altered"}
        prev = row.hash
        n += 1
    return {"ok": True, "checked": n}
