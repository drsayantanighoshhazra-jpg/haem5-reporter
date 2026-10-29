"""Administration commands.

  python -m app.cli create-admin you@hospital.org "Full Name"
  python -m app.cli seed-demo          # synthetic patients & users (HAEM5_DEMO=true only)
  python -m app.cli gen-keys           # print fresh HAEM5_DATA_KEY and HAEM5_JWT_SECRET
"""
import base64
import os
import secrets
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import select


def gen_keys():
    print("HAEM5_DATA_KEY=" + base64.b64encode(os.urandom(32)).decode())
    print("HAEM5_JWT_SECRET=" + secrets.token_urlsafe(48))


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__); return
    if argv[0] == "gen-keys":
        gen_keys(); return
    from . import audit
    from .config import settings
    from .crypto import enc
    from .db import Base, SessionLocal, engine
    from .models import Case, Consent, Patient, User
    from .notice import NOTICE_VERSION
    from .security import hash_pw
    settings.validate()
    Base.metadata.create_all(engine)
    db = SessionLocal()
    if argv[0] == "create-admin":
        email, name = argv[1].lower(), argv[2]
        if db.execute(select(User).where(User.email == email)).first():
            print("User exists"); return
        pw = secrets.token_urlsafe(12) + "A1"
        db.add(User(email=email, full_name=name, role="admin", pw_hash=hash_pw(pw))); db.commit()
        audit.log(db, "cli", "user.created", "user", email, {"role": "admin"})
        print(f"Admin created. Temporary password: {pw}\nSign in, change it and set up two-factor authentication.")
    elif argv[0] == "seed-demo":
        if not settings.demo_mode:
            print("Refusing: set HAEM5_DEMO=true. Demo data is synthetic and must never be mixed with real patients."); return
        pw = "Demo-Haem5-2026"
        users = {}
        for email, name, role in [("admin@demo.haem5", "Demo Admin", "admin"), ("dpo@demo.haem5", "Demo DPO", "dpo"),
                                  ("pathologist@demo.haem5", "Dr Demo Pathologist", "pathologist"), ("resident@demo.haem5", "Dr Demo Resident", "resident"),
                                  ("tech@demo.haem5", "Demo Technician", "technician")]:
            u = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
            if not u:
                u = User(email=email, full_name=name, role=role, pw_hash=hash_pw(pw), must_change_pw=False); db.add(u); db.flush()
            users[role] = u
        db.commit()
        samples = [("Anika Synthetic", 67, "M", "BM/26/1043", "MDS with increased blasts-2 (MDS-IB2)"),
                   ("Rahul Synthetic", 52, "F", "BM/26/1088", "AML with NPM1 mutation"),
                   ("Mira Synthetic", 9, "F", "BM/26/1131", None)]
        for name, age, sex, lab, dx in samples:
            p = Patient(pseudonym="P-" + secrets.token_hex(3).upper(), name_enc=enc(name), contact_enc=enc("+91-90000-0" + str(age).zfill(4)),
                        age_years=age, sex=sex, is_minor=age < 18, guardian_enc=enc("Parent Synthetic (mother)") if age < 18 else None,
                        guardian_verified_by="Aadhaar-verified guardian (demo)" if age < 18 else None, created_by=users["technician"].id,
                        retain_until=datetime.now(timezone.utc) + timedelta(days=365 * settings.record_retention_years))
            db.add(p); db.flush()
            for purpose in (["diagnostic_reporting", "ai_assisted_analysis"] if age >= 18 else ["diagnostic_reporting"]):
                db.add(Consent(patient_id=p.id, purpose=purpose, notice_version=NOTICE_VERSION, given_by="guardian" if age < 18 else "self", recorded_by=users["technician"].id))
            db.add(Case(patient_id=p.id, lab_no=lab, data_enc=enc({"labNo": lab, "age": age, "sex": sex}), diagnosis=dx, created_by=users["pathologist"].id))
            db.commit()
            audit.log(db, "seed", "patient.created", "patient", p.pseudonym, {"synthetic": True})
        print(f"Demo data created. All demo accounts use password {pw} and must set up 2FA at first sign-in.")
    else:
        print(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
