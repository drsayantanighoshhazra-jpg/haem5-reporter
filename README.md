# HAEM5 Reporter

A WHO-HAEM5 (2022) haematolymphoid tumour reporting platform with AI-assisted differential counting, built to the requirements of India's **Digital Personal Data Protection Act 2023** and **DPDP Rules 2025**.

| Part | What it does |
|---|---|
| `frontend/` | Staff console (sign-in with 2FA, patients and consent, cases, rights requests, breaches, audit, users), the WHO-HAEM5 workbench (differential counter, in-browser AI, rule engine, synoptic report) and the public privacy page |
| `backend/` | FastAPI service: encrypted storage, role-based access, consent ledger, 90-day rights workflow, 48-h erasure, 72-h breach clock, hash-chained audit log |
| `deploy/` | Docker Compose stack: app + PostgreSQL + Caddy (automatic HTTPS) |
| `docs/COMPLIANCE.md` | Act/Rules → control matrix, AI safeguards, GDPR/HIPAA crosswalk, open actions |
| `docs/DEPLOY.md` | Local demo, production launch, backups, DPA checklist |

**Reporting workflow:** technician or resident prepares (CBC, slide photos → AI-assisted count, auto-drafted report and suggested WHO-HAEM5 impression) → **Send for authorisation** → the pathologist reviews the report and the flagged cells in the cell gallery → **Authorise & sign** or **Return for correction**. Nothing is ever signed automatically; every step is audited.

**Quick start:** see `docs/DEPLOY.md` §2. **Tests:** `cd backend && python -m pytest -q` (platform) and `node frontend/src/test_engine.js` (53 WHO-HAEM5 rule cases) , `node frontend/src/test_rbc.js` (38 red-cell grading cases) and `node frontend/src/test_cbc.js` (53 CBC flagging cases).

**Also included:** per-cell occlusion heatmaps ("Why?"), AI–pathologist agreement tracking (gallery, report and dashboard), printable report with SHA-256 verification code, analyser paste-import, laboratory-wide reference ranges, previous-result delta checks, export of reviewed cells for local-stain fine-tuning, and Colab notebooks for the white-cell, red-cell and malaria models plus Leishman/local-stain fine-tuning (`notebooks/`).

**Accuracy roadmap:** `notebooks/HAEM5_cell_model_v2_training.ipynb` (adds Raabin-WBC, phone/stain augmentation, EfficientNet-B2 @ 288 px, external hold-outs, calibrated confident-cells threshold, resumable Drive checkpoints) and `notebooks/HAEM5_malaria_model_v2_training.ipynb` (recalibration on app-style crops). Photo quality checks and a count-progress bar guide capture.

Rebuild the workbench after editing `frontend/src/`: `python tools/build_frontend.py`.

Research and teaching software. Not a medical device. The reporting pathologist makes every diagnosis.

References: Khoury JD et al., *Leukemia* 2022;36:1703–19 · Alaggio R et al., *Leukemia* 2022;36:1720–48 · DPDP Act 2023 · DPDP Rules 2025.
