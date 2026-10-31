"""Data model. Columns ending in `_enc` hold AES-GCM ciphertext only."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.types import DateTime as _DateTime, TypeDecorator


class UTCDateTime(TypeDecorator):
    """Stores UTC and always returns timezone-aware values (SQLite drops tzinfo), so API times carry +00:00."""
    impl = _DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value


def DateTime(timezone=True):  # noqa: N802 — keeps column definitions below unchanged
    return UTCDateTime()
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def now() -> datetime:
    return datetime.now(timezone.utc)


def uid() -> str:
    return uuid.uuid4().hex


ROLES = ("admin", "dpo", "pathologist", "resident", "technician")
PURPOSES = {
    "diagnostic_reporting": "Laboratory diagnosis and reporting of your sample (required for the service)",
    "ai_assisted_analysis": "Automated (AI) analysis of your blood/marrow cell images to assist the pathologist",
    "research_deidentified": "Use of de-identified data and images for research approved by an ethics committee",
    "teaching_deidentified": "Use of de-identified images for medical teaching",
}
RIGHTS = ("access", "correction", "completion", "updating", "erasure", "nomination", "grievance", "withdraw_consent")


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20))
    pw_hash: Mapped[str] = mapped_column(String(255))
    totp_secret_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    must_change_pw: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Patient(Base):
    """A Data Principal. Identifiers encrypted; `pseudonym` is the working identifier."""
    __tablename__ = "patients"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    pseudonym: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    name_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    contact_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    dob_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    sex: Mapped[str | None] = mapped_column(String(1), nullable=True)
    age_years: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_minor: Mapped[bool] = mapped_column(Boolean, default=False)
    guardian_enc: Mapped[str | None] = mapped_column(Text, nullable=True)        # name + relationship
    guardian_verified_by: Mapped[str | None] = mapped_column(String(60), nullable=True)  # method of verification
    nominee_enc: Mapped[str | None] = mapped_column(Text, nullable=True)         # Act s.14
    notice_language: Mapped[str] = mapped_column(String(10), default="en")
    created_by: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    retain_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    erasure_scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    erasure_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    erased_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    consents: Mapped[list["Consent"]] = relationship(back_populates="patient", cascade="all")


class Consent(Base):
    """One purpose-specific consent artefact (Act s.6; Rule 3 notice)."""
    __tablename__ = "consents"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"), index=True)
    purpose: Mapped[str] = mapped_column(String(40))
    notice_version: Mapped[str] = mapped_column(String(20))
    language: Mapped[str] = mapped_column(String(10), default="en")
    given_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    given_by: Mapped[str] = mapped_column(String(20), default="self")        # self | guardian | nominee
    method: Mapped[str] = mapped_column(String(40), default="in-person (recorded by staff)")
    recorded_by: Mapped[str] = mapped_column(String(32))
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    withdrawn_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    patient: Mapped[Patient] = relationship(back_populates="consents")

    @property
    def active(self) -> bool:
        return self.withdrawn_at is None


class Case(Base):
    __tablename__ = "cases"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"), index=True)
    lab_no: Mapped[str] = mapped_column(String(40), index=True)
    data_enc: Mapped[str | None] = mapped_column(Text, nullable=True)       # full workbench state (encrypted)
    report_enc: Mapped[str | None] = mapped_column(Text, nullable=True)     # final report text (encrypted)
    diagnosis: Mapped[str | None] = mapped_column(String(300), nullable=True)
    ai_used: Mapped[bool] = mapped_column(Boolean, default=False)
    ai_cells: Mapped[int | None] = mapped_column(Integer, nullable=True)        # cells with an AI label (QA: AI-override tracking)
    ai_agree: Mapped[int | None] = mapped_column(Integer, nullable=True)        # of those, final label = AI label
    status: Mapped[str] = mapped_column(String(12), default="draft")       # draft | prepared | signed
    prepared_by: Mapped[str | None] = mapped_column(String(32), nullable=True)
    prepared_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    return_note: Mapped[str | None] = mapped_column(Text, nullable=True)     # why the pathologist sent it back
    created_by: Mapped[str] = mapped_column(String(32))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
    signed_by: Mapped[str | None] = mapped_column(String(32), nullable=True)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RightsRequest(Base):
    """Data Principal rights (Act ss.11–14) and grievances; 90-day clock (Rule 14)."""
    __tablename__ = "rights_requests"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    ref: Mapped[str] = mapped_column(String(20), unique=True)
    patient_id: Mapped[str | None] = mapped_column(ForeignKey("patients.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(20))
    details_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    requester_contact_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    channel: Mapped[str] = mapped_column(String(20), default="staff")          # staff | public-form
    identity_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="open")           # open | in_progress | fulfilled | rejected
    response_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    handled_by: Mapped[str | None] = mapped_column(String(32), nullable=True)


class Breach(Base):
    """Personal data breach register (Act s.8(6); Rule 7)."""
    __tablename__ = "breaches"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=uid)
    ref: Mapped[str] = mapped_column(String(20), unique=True)
    became_aware_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    description: Mapped[str] = mapped_column(Text)
    data_categories: Mapped[str | None] = mapped_column(Text, nullable=True)
    affected_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    likely_consequences: Mapped[str | None] = mapped_column(Text, nullable=True)
    mitigation: Mapped[str | None] = mapped_column(Text, nullable=True)
    cause_findings: Mapped[str | None] = mapped_column(Text, nullable=True)
    board_initial_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    board_detailed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    principals_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="open")
    recorded_by: Mapped[str] = mapped_column(String(32))


class AuditLog(Base):
    """Append-only, hash-chained audit trail (Rule 6)."""
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    actor: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(60))
    entity: Mapped[str | None] = mapped_column(String(40), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
