# HAEM5 Reporter — DPDP compliance dossier

**System:** HAEM5 Reporter, a WHO-HAEM5 haematopathology reporting platform with AI-assisted cell counting
**Law:** Digital Personal Data Protection Act, 2023 (the Act) and Digital Personal Data Protection Rules, 2025 (the Rules)
**Status of the law:** The Rules were notified on 13–14 November 2025 with phased commencement. Consent-manager provisions apply 12 months after notification (November 2026). Notice, consent, Data Fiduciary obligations, children's data and Data Principal rights apply 18 months after notification (**May 2027**). This system implements those obligations ahead of that date.
**Role model:** The hospital or laboratory deploying the system is the **Data Fiduciary**. A hosting provider or the software maintainer acting on its instructions is a **Data Processor** (Act s.8(2): processing only under a valid contract).

> This dossier maps legal requirements to technical and organisational controls built into the software. It is not legal advice. Before processing real patient data, the deploying institution should have it reviewed by its legal counsel and Data Protection Officer.

---

## 1. Requirement-to-control matrix

| # | Requirement | Source | How the system meets it | Where (code) |
|---|---|---|---|---|
| 1 | Process only on a lawful ground (consent or a legitimate use) | Act s.4, s.7 | Every patient record needs consent for *diagnostic reporting* before a sample can be registered or a case processed. Consent is checked on every case write and sign-off. | `routers/patients.py` `create_patient`; `routers/cases.py` `_consent_gate` |
| 2 | Notice before or with the consent request: itemised data, specific purposes, services enabled, how to withdraw, how to exercise rights, how to complain to the Board | Act s.5; Rule 3 | A versioned, stand-alone privacy notice is shown at registration and published on a public page. Consent is refused if the notice version shown is not current. | `notice.py`; `frontend/privacy.html`; register view in `app.js` |
| 3 | Notice available in English or any Eighth Schedule language | Act s.5(3) | The notice engine supports per-language versions and records the language on each consent. **Action:** add certified Bengali and Hindi translations before go-live. | `notice.py` `TRANSLATIONS` |
| 4 | Consent free, specific, informed, unambiguous; limited to necessary data | Act s.6(1) | Separate opt-ins per purpose (diagnosis, AI analysis, de-identified research, de-identified teaching). Only the diagnostic purpose is required. No pre-ticked optional boxes. | `models.py` `PURPOSES`; register form |
| 5 | Withdrawal as easy as giving consent; processing stops | Act s.6(4)–(6); Rule 3 | One-click withdrawal per purpose by staff, plus a public request form. Withdrawing diagnostic consent makes the case read-only. Withdrawing AI consent disables the AI counter for that patient. | `routers/patients.py` `withdraw`; `cases.py` gates; workbench `HAEM5_AI_ALLOWED` |
| 6 | Consent records kept as evidence | Act s.6(10) | Consent ledger: purpose, notice version, language, method, who gave it (self or guardian), who recorded it, timestamps of giving and withdrawal. | `models.Consent` |
| 7 | Reasonable security safeguards: encryption, obfuscation or masking; access control; logging and monitoring; continuity | Act s.8(5); Rule 6 | **AES-256-GCM field encryption** of names, contacts, DOB, guardian, nominee, clinical data and reports. Identifiers are masked in lists. Role-based least-privilege access. Argon2id passwords. **Mandatory TOTP 2FA** before any patient data. Account lockout. 30-minute tokens and a 15-minute idle sign-out. HTTPS-only (HSTS). Strict CSP. No patient data in browser storage. Error messages never echo data. | `crypto.py`, `security.py`, `main.py` |
| 8 | Logs to detect and investigate unauthorised access, kept ≥1 year | Rule 6; Rule 8 | Append-only, **hash-chained audit log** of sign-ins, identifier views, case views and edits, consent events, rights actions and breaches. One-click chain verification detects tampering. The log retention floor is enforced at 365 days. | `audit.py`; `/api/audit/verify` |
| 9 | Processors bound by contract with equivalent safeguards | Act s.8(2); Rule 6 | Organisational control. **Action:** sign a data processing agreement with the hosting provider covering security, breach reporting to you without delay, sub-processors, deletion on exit, and Indian region. | `docs/DEPLOY.md` §6 |
| 10 | Accuracy and completeness where data are used for decisions | Act s.8(3) | Correction, completion and updating are audited with a reason. Signed reports are locked, and changes need an addendum. | `patients.py` `correct_patient`; `cases.py` sign |
| 11 | Personal data breach: inform each affected Data Principal without delay; inform the Board without delay, then a detailed report within 72 hours | Act s.8(6); Rule 7 | **Breach register** with a live 72-hour clock from awareness, initial and detailed Board notice tracking, and a check that the detailed report has mitigation and cause findings. Generates a plain-language notice to affected people (what happened, consequences, mitigation, safety steps, contact). The dashboard shows the clock. | `routers/privacy.py` breaches; Breaches view |
| 12 | Erase when the purpose is served or consent is withdrawn, unless retention is required by law | Act s.8(7)–(8); Rule 8 | Configurable record retention (default 5 years; set per institutional and legal requirements). A **retention run** gives **48-hour intimation** before erasure, then crypto-shreds identifiers and clinical text. Only the pseudonym, the diagnosis line and the audit trail remain. | `privacy.py` `schedule_erasure`, `retention_run`, `_erase` |
| 13 | Publish contact of the DPO or designated person | Act s.8(9); Rule 9 | Contact is shown in the notice, the public privacy page, breach notices and access summaries. | `config.py`; `notice.py` |
| 14 | Effective grievance redressal, within 90 days | Act s.8(10), s.13; Rule 14 | **Rights and grievance register** with a 90-day due date, overdue flags and dashboard counters. Public submission needs no account. Rejections need recorded reasons. | `RightsRequest`; Rights view |
| 15 | Right to access a summary of data, processing activities and with whom it was shared | Act s.11 | Generates an **access summary** (identity, consents, reports, processing history from the audit trail, recipients, storage location) only after identity verification. | `/api/rights/{id}/access-summary` |
| 16 | Right to correction, completion, updating and erasure | Act s.12 | Correction endpoint (audited). Erasure workflow per item 12. | as above |
| 17 | Right to nominate | Act s.14; Rule 14 | Nominee captured at registration (encrypted) and via a request type. | `Patient.nominee_enc` |
| 18 | Children (<18): verifiable consent of parent or lawful guardian; no tracking, behavioural monitoring or targeted advertising | Act s.9; Rules 10–12, Fourth Schedule | Age under 18 requires consent given by a guardian, the guardian's name, and the **method used to verify** the guardian's identity and age (photo ID, DigiLocker token, verified record). The system has no tracking, analytics or advertising. The Fourth Schedule exemption for clinical establishments may apply to healthcare processing; confirm with counsel. Guardians of persons with disability: a court or authority order is recorded as the verification method. | `create_patient`; register form |
| 19 | Data minimisation | Act s.6(1), s.8 | Names never enter case data. The workbench uses the pseudonym, and the report carries the pseudonym and lab number. Lists show masked identifiers. No browser storage in server mode. | `cases.py` `STRIP`; bridge |
| 20 | Cross-border transfer | Act s.16; Rule 15 | Deploy in an Indian cloud region or on-premise. The region is declared in config and shown in the notice. No third-party analytics. The AI model runs in the user's browser, so images are not sent to any external service. | `HAEM5_DATA_REGION`; workbench ONNX runtime |
| 21 | Significant Data Fiduciary duties: DPO based in India, annual DPIA and independent audit, algorithmic due diligence | Act s.10; Rule 13 | If notified as an SDF: the hash-chained audit log, the access-summary export and this matrix support DPIA and audit. AI outputs are always pathologist-reviewed, and AI use is recorded per case. | `Case.ai_used` |

**Penalties for context (Act, Schedule):** up to ₹250 crore for failing to take reasonable security safeguards; up to ₹200 crore for failing to notify a breach or for breaching children's-data obligations; up to ₹150 crore for SDF obligations; up to ₹50 crore for other breaches.

---

## 2. AI-specific safeguards
- **Consent-gated:** the AI counter is available only when *AI-assisted analysis* consent is active. The server rejects `ai_used` on cases without it.
- **Human in the loop:** every AI label is shown for review and correction before it enters the count. The pathologist signs the report. The notice says no decision is made by software alone.
- **On-device inference:** the ONNX model runs in the browser through WebAssembly. Cell images are not uploaded to the server or to third parties.
- **Traceability:** AI use is recorded per case, and model metadata (version, training data, test metrics) ships in `cell_labels.json`.

## 3. International crosswalk (for reviewers outside India)

| Theme | DPDP (India) | GDPR (EU/UK) | HIPAA Security Rule (US) | Implemented |
|---|---|---|---|---|
| Lawful basis | s.4–7 consent / legitimate use | Art. 6 + Art. 9 (health data) | Treatment/operations | Purpose-specific consent ledger |
| Transparency | s.5, Rule 3 | Art. 13 | Notice of Privacy Practices | Versioned notice, public page |
| Access & portability | s.11 | Art. 15, 20 | §164.524 | Access summary (JSON) |
| Correction / erasure | s.12 | Art. 16, 17 | §164.526 | Audited correction; 48-h erasure workflow |
| Security of processing | s.8(5), Rule 6 | Art. 32 | §164.312 access/audit/transmission | AES-GCM, RBAC, 2FA, TLS, audit chain |
| Breach notification | Rule 7: Board 72 h, people without delay | Art. 33 (72 h), 34 | §164.404 (60 days) | 72-h clock, notice drafts |
| Privacy by design | s.8 | Art. 25 | — | Masking, pseudonyms, no local storage |
| Automated decisions | — | Art. 22 | — | Human review of all AI output |
| Records / DPIA | s.10 (SDF) | Art. 30, 35 | §164.308 risk analysis | Audit trail, this dossier |

## 4. Other regulations to address before clinical use
- **Medical device software:** an AI tool intended to aid diagnosis may be regulated as a medical device under the Medical Devices Rules, 2017 (CDSCO). Treat this build as research/teaching software until classified and approved.
- **Laboratory quality:** for NABL-accredited use, validate the AI-assisted differential against ISO 15189:2022 requirements: method verification, comparison with manual 200/500-cell counts by two observers, and measurement uncertainty for blast %.
- **Ethics:** follow the ICMR *Ethical Guidelines for Application of Artificial Intelligence in Biomedical Research and Healthcare* (2023). Research use of de-identified data needs ethics committee approval.
- **Record retention:** set `HAEM5_RECORD_RETENTION_YEARS` to the longest period required by applicable clinical-records rules and institutional policy.

## 5. Open actions before go-live with real data
1. Certified Bengali and Hindi notice translations (s.5(3)).
2. Appoint and publish the DPO / grievance officer; configure contacts.
3. Sign a DPA with the hosting provider; confirm an Indian region and encrypted disks and backups.
4. Write the incident-response runbook, including who files the Board intimation and how.
5. Penetration test and vulnerability assessment (e.g. CERT-In empanelled auditor).
6. Legal review of the retention period and of the children's-data exemption scope.
7. Key management: move `HAEM5_DATA_KEY` into a cloud KMS or HSM and rotate it periodically.
