# Launch guide

Three ways to run HAEM5 Reporter, from quickest to production.

## 1. Live showcase (no setup)
The published demo page runs entirely in the browser with synthetic data, so share its link for capstone review. It shows the workbench, consent gating, rights requests, breach clock and audit trail. Real patient data must never be entered there.

## 1b. Full-platform public demo on Render (free, about 20 minutes)
Synthetic data only: the free server is outside India and its disk resets on restart.
1. Create a free account on **github.com** and a **New repository** (e.g. `haem5-reporter`, Public).
2. Unzip `haem5-platform.zip`. In the new repository click **uploading an existing file**, drag in *everything inside* the `haem5-platform` folder (including `Dockerfile` and `render.yaml`), then **Commit changes**.
3. Sign in to **render.com** with GitHub › **New +** › **Blueprint** › pick the repository › **Apply**. Render reads `render.yaml`, generates the secret keys and builds the app (about 5–10 min).
4. Open the URL Render shows (e.g. `https://haem5-reporter-demo.onrender.com`). Sign in with `pathologist@demo.haem5` / `Demo-Haem5-2026` and set up 2FA.
The free plan sleeps after 15 minutes idle; the first visit then takes about a minute to wake.

## 2. Local demo on a laptop (10 minutes)
Requirements: Python 3.11+.
```bash
cd backend
pip install -r requirements.txt
export HAEM5_DB_URL=sqlite:///./demo.db HAEM5_DEMO=true
eval "$(python -m app.cli gen-keys | sed 's/^/export /')"
python -m app.cli seed-demo
uvicorn app.main:app --port 8000
```
Open http://localhost:8000 and sign in as `pathologist@demo.haem5` (or `dpo@`, `admin@`, `resident@`, `tech@`) with password `Demo-Haem5-2026`. Each account asks you to set up an authenticator app at first sign-in. The public privacy page is at `/privacy` and the API reference at `/api/docs`.

Run the tests: `cd backend && python -m pytest -q`

## 3. Production (Indian cloud region or hospital server)
1. **Server:** one Linux VM (2 vCPU, 4 GB RAM is enough to start) in an **Indian region** (e.g. AWS ap-south-1 Mumbai, Azure Central India, or on-premise). Enable disk encryption and automated encrypted snapshots.
2. **Domain:** point a DNS A-record (e.g. `haem5.yourhospital.org`) to the server. Open ports 80 and 443 only.
3. **Install Docker**, then copy this folder to the server.
4. **Configure:** `cp deploy/.env.example deploy/.env`, then fill in the domain, Postgres password, fiduciary name and DPO contacts. Generate keys:
   `docker compose -f deploy/docker-compose.yml run --rm app python -m app.cli gen-keys`
   Paste `HAEM5_DATA_KEY` and `HAEM5_JWT_SECRET` into `.env`. **Back up the data key separately and securely: without it, encrypted records cannot be read.**
5. **Start:** `docker compose -f deploy/docker-compose.yml up -d --build`. Caddy obtains the HTTPS certificate automatically.
6. **First admin:** `docker compose -f deploy/docker-compose.yml exec app python -m app.cli create-admin you@hospital.org "Dr Your Name"`, then sign in, change the password, set up 2FA, and add staff from **Users**.
7. **Schedule retention:** run `POST /api/retention/run` daily as the DPO (or from cron with a service account), so scheduled erasures and log pruning happen.
8. **Backups:** nightly `pg_dump`, encrypted and kept in the same country. Test a restore every quarter.

## 4. Before real patients
Complete the open actions in `docs/COMPLIANCE.md` §5. These cover translations, DPO appointment, the hosting DPA, the incident runbook, a security audit, the legal review, and moving the key to a KMS.

## 5. Training and loading the AI model
Train with `HAEM5_cell_model_training.ipynb` in Colab. Then, in a case, open **Differential counter › AI-assisted** and load `cell_model.onnx` and `cell_labels.json`. The model runs in the browser, so images never leave the device. The counter is available only for patients with AI consent.

## 6. Data processing agreement checklist (hosting provider)
Processing only on documented instructions · confidentiality of personnel · security measures equivalent to Rule 6 · breach notification to you without undue delay · sub-processor approval · data stays in India · deletion or return at contract end · audit rights.
