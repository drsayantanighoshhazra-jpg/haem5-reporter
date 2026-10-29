#!/bin/sh
# Container entry point. In demo mode, seed synthetic accounts/patients once (only if the database is empty).
set -e
cd /srv/backend
if [ "${HAEM5_DEMO:-false}" = "true" ]; then
  python -c "
from app.config import settings; settings.validate()
from app.models import User
from app.db import Base, engine, SessionLocal; Base.metadata.create_all(engine)
import subprocess, sys
db = SessionLocal()
if db.query(User).count() == 0:
    subprocess.check_call([sys.executable, '-m', 'app.cli', 'seed-demo'])
"
fi
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips "*"
