/* Showcase layer for the published demo: DPDP notice & consent, privacy centre (rights, breaches,
   hash-chained audit, export/erase), compliance overview, and a private per-viewer backend
   (artifact db under data/users/<id>/, which nobody else — the owner included — can read). */
(function () {
  "use strict";
  const PURPOSES = [
    ["diagnostic_reporting", "Laboratory diagnosis and reporting of the sample", true],
    ["ai_assisted_analysis", "AI-assisted counting of blood/marrow cell images, reviewed by the pathologist", false],
    ["research_deidentified", "De-identified data for ethics-approved research", false],
    ["teaching_deidentified", "De-identified images for medical teaching", false]];
  const RIGHTS = [["access", "Access: summary of data & sharing (s.11)"], ["correction", "Correction (s.12)"], ["completion", "Completion (s.12)"], ["updating", "Updating (s.12)"],
    ["erasure", "Erasure (s.12)"], ["nomination", "Nomination (s.14)"], ["grievance", "Grievance (s.13)"], ["withdraw_consent", "Withdraw consent (s.6(4))"]];
  const DAY = 864e5;
  const use = n => (window.claude && typeof window.claude.use === "function") ? window.claude.use(n).catch(() => null) : Promise.resolve(null);
  const fmt = t => t ? new Date(t).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const rid = p => p + "-" + Math.random().toString(16).slice(2, 6).toUpperCase();

  let priv = (store.get("haem5.priv")) || { consents: {}, consentBy: "self", guardian: "", guardianVerify: "", rights: [], breaches: [], audit: [] };
  let cloud = { db: null, ref: null, mode: "local" };

  /* ---------- hash-chained audit ---------- */
  async function sha(s) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
  const body = e => JSON.stringify({ prev: e.prev, ts: e.ts, action: e.action, detail: e.detail ?? null });
  let auditQ = Promise.resolve();
  function audit(action, detail) {
    auditQ = auditQ.then(async () => {
      const prev = priv.audit.length ? priv.audit[priv.audit.length - 1].hash : "0".repeat(64);
      const e = { ts: new Date().toISOString(), action, detail, prev }; e.hash = await sha(body(e));
      priv.audit.push(e); if (priv.audit.length > 400) priv.audit = priv.audit.slice(-400);
      persist(); if (current === "privacy") drawAudit();
    });
  }
  async function verifyChain(list) {
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (i > 0 && e.prev !== list[i - 1].hash) return { ok: false, at: i + 1, why: "link broken" };
      if (await sha(body(e)) !== e.hash) return { ok: false, at: i + 1, why: "entry altered" };
    }
    return { ok: true, n: list.length };
  }

  /* ---------- persistence ---------- */
  let saveT;
  function persist() {
    store.set("haem5.priv", priv);
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      if (!cloud.ref) return;
      try { const cs = { ...state, cellGallery: (state.cellGallery || []).map(g => ({ ...g, thumb: null })) }; await cloud.ref.set({ v: 1, savedAt: new Date().toISOString(), case: cs, counts: cnt, priv }); setSync("cloud"); }
      catch (e) { setSync(e && e.code === "quota_exceeded" ? "full" : "local"); }
    }, 1500);
  }
  const origSet = store.set.bind(store);
  store.set = (k, v) => { origSet(k, v); if (k === "haem5.case" || k === "haem5.counts") persist(); };
  function setSync(m) {
    cloud.mode = m; const s = document.getElementById("syncState"); if (!s) return;
    s.textContent = m === "cloud" ? "Saved to your private workspace" : m === "full" ? "Workspace full: delete old data" : "Saved in this browser only";
  }

  /* ---------- AI & consent gating ---------- */
  const active = p => !!(priv.consents[p] && priv.consents[p].given && !priv.consents[p].withdrawn);
  function applyGates() { window.HAEM5_AI_ALLOWED = active("ai_assisted_analysis"); }
  const origRecompute = window.recompute;
  window.recompute = function () {
    origRecompute();
    const L = document.getElementById("live"); if (!L) return;
    const msgs = [];
    if (!active("diagnostic_reporting")) msgs.push("No active consent for diagnostic reporting — processing this case is not permitted (DPDP Act s.6). Record consent in Notice & consent.");
    if (!active("ai_assisted_analysis")) msgs.push("AI-assisted counting is off: no AI consent recorded.");
    msgs.forEach(m => L.insertBefore(el("div", { class: "warnbox" }, m), L.children[1] || null));
  };

  /* ---------- Notice & consent section ---------- */
  function consentUI() {
    const box = el("div");
    box.append(el("fieldset", {}, el("legend", {}, "Privacy notice v2026-10 (shown before consent)"),
      el("div", { class: "notice-txt" },
        el("p", {}, el("b", {}, "Data we process: "), "name, age/date of birth, sex, laboratory number; phone or e-mail; clinical details, blood count, smear and marrow findings and images, flow cytometry, cytogenetic and molecular results, diagnosis and report; for a child, the parent or guardian's name; optionally a nominee."),
        el("p", {}, el("b", {}, "Why: "), "to examine the sample and issue a WHO-HAEM5 integrated report to you and your doctor. If you agree, an AI model helps count cells; a pathologist reviews every result and signs the report."),
        el("p", {}, el("b", {}, "Storage & retention: "), "encrypted, on servers in India; kept for the configured retention period (e.g. 5 years) or longer where law requires, then erased or de-identified; security logs kept at least one year."),
        el("p", {}, el("b", {}, "Your rights: "), "withdraw consent at any time as easily as you gave it; get a summary of your data; correct, complete, update or erase it; nominate someone; raise a grievance. We reply within 90 days. You may complain to the Data Protection Board of India."),
        el("p", { class: "hint" }, "Available in English; production deployments add certified translations in Eighth Schedule languages (Act s.5(3)) such as Bengali and Hindi."))));
    const minor = (+state.age || 99) < 18;
    const g = el("fieldset", {}, el("legend", {}, "Consent for this case"));
    if (minor) {
      const gi = el("input", { id: "f_guardian", type: "text", value: priv.guardian || "", placeholder: "Name and relationship" });
      gi.oninput = () => { priv.guardian = gi.value; persist(); };
      const gv = el("select", { id: "f_guardianVerify" }, ["", "Government photo ID seen", "DigiLocker token", "Existing verified hospital record", "Court/authority appointment order"].map(v => el("option", { value: v }, v || "—")));
      gv.value = priv.guardianVerify || ""; gv.onchange = () => { priv.guardianVerify = gv.value; persist(); };
      g.append(el("p", { class: "hint" }, "Patient is under 18: consent must come from a parent or lawful guardian whose identity and age are verified (Act s.9; Rule 10)."),
        el("div", { class: "grid" }, el("div", { class: "f" }, el("label", { for: "f_guardian" }, "Parent / guardian"), gi), el("div", { class: "f" }, el("label", { for: "f_guardianVerify" }, "Verified by"), gv)));
    }
    for (const [k, label, req] of PURPOSES) {
      const c = priv.consents[k] || {};
      const on = active(k);
      const row = el("div", { class: "consent-row" },
        el("div", {}, el("div", { class: "nm" }, label, req ? " (needed to process the sample)" : " (optional)"),
          el("div", { class: "hint" }, on ? `Given ${fmt(c.given)} by ${c.by}` : c.withdrawn ? `Withdrawn ${fmt(c.withdrawn)}` : "Not given")),
        el("button", { class: "btn sm" + (on ? "" : " primary"), onclick: () => {
          if (!on) {
            if (minor && (!priv.guardian || !priv.guardianVerify)) { toast("Record the verified guardian first"); return; }
            priv.consents[k] = { given: Date.now(), by: minor ? "guardian" : "self", notice: "2026-10-v1" }; audit("consent.given", { purpose: k, by: minor ? "guardian" : "self" });
          } else { priv.consents[k] = { ...c, withdrawn: Date.now() }; audit("consent.withdrawn", { purpose: k }); }
          applyGates(); persist(); renderForms(); show("consent"); recompute();
        } }, on ? "Withdraw" : "Record consent"));
      g.append(row);
    }
    box.append(g);
    return box;
  }

  /* ---------- Privacy centre ---------- */
  function privacyUI() {
    const box = el("div");
    // rights
    const kind = el("select", { id: "f_rrKind" }, RIGHTS.map(([k, n]) => el("option", { value: k }, n)));
    const det = el("input", { id: "f_rrDet", type: "text", placeholder: "Details (optional)" });
    box.append(el("fieldset", {}, el("legend", {}, "Rights requests & grievances — 90-day clock (Rule 14)"),
      el("div", { class: "toolbar" }, kind, det, el("button", { class: "btn primary sm", onclick: () => {
        const r = { ref: rid("RR"), kind: kind.value, details: det.value, received: Date.now(), due: Date.now() + 90 * DAY, status: "open" };
        priv.rights.unshift(r); audit("rights.received", { ref: r.ref, kind: r.kind }); det.value = ""; persist(); drawRights();
      } }, "Record request")),
      el("div", { class: "tblwrap" }, el("table", { class: "ptbl", id: "rrTbl" }))));
    // breaches
    const bd = el("input", { id: "f_brDesc", type: "text", placeholder: "What happened, e.g. report e-mailed to wrong recipient" });
    box.append(el("fieldset", {}, el("legend", {}, "Breach register — Board report within 72 h (Rule 7)"),
      el("div", { class: "toolbar" }, bd, el("button", { class: "btn primary sm", onclick: () => {
        if (bd.value.trim().length < 5) { toast("Describe the breach first"); return; }
        const b = { ref: rid("BR"), desc: bd.value.trim(), aware: Date.now(), mitigation: "", cause: "" };
        priv.breaches.unshift(b); audit("breach.recorded", { ref: b.ref }); bd.value = ""; persist(); drawBreaches();
      } }, "Record breach & start clock")),
      el("div", { id: "brList" })));
    // audit
    box.append(el("fieldset", {}, el("legend", {}, "Audit trail — hash-chained, append-only"),
      el("div", { class: "toolbar" }, el("button", { class: "btn sm", onclick: async () => { const v = await verifyChain(priv.audit); document.getElementById("auVer").textContent = v.ok ? `Chain intact: ${v.n} entries verified` : `Chain broken at entry ${v.at} (${v.why})`; } }, "Verify chain"),
        el("button", { class: "btn sm ghost", onclick: async () => {
          if (priv.audit.length < 2) { toast("Record a few actions first"); return; }
          const copy = priv.audit.map(e => ({ ...e })); copy[Math.floor(copy.length / 2)].action = "tampered";
          const v = await verifyChain(copy); document.getElementById("auVer").textContent = `Tamper test on a copy: ${v.ok ? "not detected" : "detected at entry " + v.at + " (" + v.why + ")"}`;
        } }, "Simulate tampering"), el("span", { class: "hint", id: "auVer" })),
      el("div", { class: "tblwrap" }, el("table", { class: "ptbl", id: "auTbl" }))));
    // data controls
    const eraseWrap = el("span");
    const eraseBtn = () => { eraseWrap.innerHTML = ""; eraseWrap.append(el("button", { class: "btn sm", onclick: askErase }, "Erase all my data")); };
    function askErase() {
      eraseWrap.innerHTML = "";
      eraseWrap.append(el("span", { class: "confirm" }, "Erase case, counts and privacy records?", el("button", { class: "btn sm", onclick: eraseAll }, "Erase"), el("button", { class: "btn sm ghost", onclick: eraseBtn }, "Cancel")));
    }
    eraseBtn();
    box.append(el("fieldset", {}, el("legend", {}, "Your data in this workspace"),
      el("p", { class: "hint" }, "Your workspace is private: stored under your own account path that no other viewer, including the page owner, can read. If you are signed out it stays in this browser only."),
      el("div", { class: "toolbar" }, el("button", { class: "btn sm primary", onclick: exportData }, "Download my data (JSON)"), eraseWrap,
        el("span", { class: "hint", id: "syncState2" }, ""))));
    setTimeout(() => { drawRights(); drawBreaches(); drawAudit(); });
    return box;
  }
  function drawRights() {
    const T = document.getElementById("rrTbl"); if (!T) return; T.innerHTML = "";
    T.append(el("tr", {}, ["Ref", "Request", "Received", "Due", "Status"].map(h => el("th", {}, h))));
    if (!priv.rights.length) T.append(el("tr", {}, el("td", { colspan: 5, class: "hint" }, "No requests yet.")));
    for (const r of priv.rights) {
      const left = Math.ceil((r.due - Date.now()) / DAY), done = r.status === "fulfilled" || r.status === "rejected";
      const st = el("select", { "aria-label": "Status " + r.ref }, ["open", "in_progress", "fulfilled", "rejected"].map(s => el("option", { value: s }, s.replace("_", " "))));
      st.value = r.status; st.onchange = () => { r.status = st.value; if (done !== (st.value === "fulfilled" || st.value === "rejected")) r.resolved = Date.now(); audit("rights.updated", { ref: r.ref, status: r.status }); persist(); drawRights(); };
      T.append(el("tr", {}, el("td", { class: "mono" }, r.ref), el("td", {}, RIGHTS.find(x => x[0] === r.kind)[1].split(":")[0].replace(/ \(.*/, ""), r.details ? el("div", { class: "hint" }, r.details) : null),
        el("td", { class: "mono" }, fmt(r.received)), el("td", {}, done ? el("span", { class: "pill met" }, "closed") : el("span", { class: "pill " + (left < 0 ? "prob" : left <= 7 ? "prob" : "cons") }, left < 0 ? "overdue" : left + " days")), el("td", {}, st)));
    }
  }
  function drawBreaches() {
    const B = document.getElementById("brList"); if (!B) return; B.innerHTML = "";
    if (!priv.breaches.length) B.append(el("p", { class: "hint" }, "No breaches recorded."));
    for (const b of priv.breaches) {
      const due = b.aware + 72 * 36e5, hrs = Math.round((due - Date.now()) / 36e5);
      const mi = el("input", { type: "text", value: b.mitigation, placeholder: "Mitigation measures", "aria-label": "Mitigation " + b.ref }); mi.oninput = () => { b.mitigation = mi.value; persist(); };
      const ca = el("input", { type: "text", value: b.cause, placeholder: "Findings on cause", "aria-label": "Cause " + b.ref }); ca.oninput = () => { b.cause = ca.value; persist(); };
      const mark = (f, label, need) => el("button", { class: "btn sm", disabled: b[f] ? true : null, onclick: () => {
        if (need && !(b.mitigation && b.cause)) { toast("The detailed report needs mitigation and cause findings"); return; }
        b[f] = Date.now(); audit("breach." + f, { ref: b.ref }); persist(); drawBreaches(); } }, b[f] ? label + " ✓" : label);
      const out = el("pre", { class: "notice-draft", hidden: true });
      B.append(el("div", { class: "breach" },
        el("div", { class: "row-sb" }, el("b", { class: "mono" }, b.ref), b.boardDetailed ? el("span", { class: "pill met" }, "Board report sent") : el("span", { class: "pill " + (hrs < 0 ? "prob" : "cons") }, hrs < 0 ? "Board deadline passed" : `${hrs} h to Board deadline`)),
        el("div", {}, b.desc), el("div", { class: "hint" }, `Aware ${fmt(b.aware)} · detailed report due ${fmt(due)}`),
        el("div", { class: "grid" }, mi, ca),
        el("div", { class: "toolbar" }, mark("boardInitial", "Initial Board notice"), mark("boardDetailed", "Detailed Board report", true), mark("peopleNotified", "People notified"),
          el("button", { class: "btn sm ghost", onclick: () => { out.hidden = !out.hidden; out.textContent = `Notice of a personal data breach\n\nWhat happened: ${b.desc} (we became aware on ${fmt(b.aware)}).\nPossible consequences: under assessment.\nWhat we have done: ${b.mitigation || "containment in progress"}.\nWhat you can do: be cautious of unexpected messages mentioning your laboratory tests.\nContact: Data Protection Officer, dpo@example.org.`; } }, "Draft notice to people")), out));
    }
  }
  function drawAudit() {
    const T = document.getElementById("auTbl"); if (!T) return; T.innerHTML = "";
    T.append(el("tr", {}, ["#", "Time", "Action", "Detail", "Hash"].map(h => el("th", {}, h))));
    priv.audit.slice().reverse().slice(0, 60).forEach((e, i) => T.append(el("tr", {}, el("td", { class: "mono" }, priv.audit.length - i), el("td", { class: "mono" }, fmt(e.ts)), el("td", {}, e.action),
      el("td", { class: "mono" }, e.detail ? JSON.stringify(e.detail) : ""), el("td", { class: "mono" }, e.hash.slice(0, 12)))));
    if (!priv.audit.length) T.append(el("tr", {}, el("td", { colspan: 5, class: "hint" }, "Actions you take are logged here.")));
  }
  async function exportData() {
    audit("rights.access_export", null); await auditQ;
    const blob = JSON.stringify({ exportedAt: new Date().toISOString(), note: "Synthetic showcase data", case: state, counts: cnt, privacy: priv }, null, 2);
    const d = await use("downloads");
    if (d) { try { await d.save({ filename: "haem5-my-data.json", data: blob }); return; } catch (e) { if (!e || e.code !== "unavailable") return; } }
    const pre = el("pre", { class: "notice-draft" }, blob); document.getElementById("p_privacy").append(pre); toast("Download not available here — data shown below");
  }
  async function eraseAll() {
    priv = { consents: {}, consentBy: "self", guardian: "", guardianVerify: "", rights: [], breaches: [], audit: [] };
    cnt.PB = {}; cnt.BM = {}; origSet("haem5.counts", cnt); store.set("haem5.priv", priv);
    loadCase(blank(), false); origSet("haem5.case", state);
    if (cloud.ref) { try { await cloud.ref.delete(); } catch {} }
    applyGates(); audit("data.erased_by_user", null); renderForms(); show("privacy"); toast("Your data was erased");
  }

  /* ---------- Compliance overview ---------- */
  const MATRIX = [
    ["Notice before consent: itemised data, purposes, withdrawal, rights, Board complaint", "s.5; Rule 3", "Versioned stand-alone notice; consent refused on outdated version"],
    ["Free, specific, informed consent; withdrawal as easy as giving", "s.6", "Per-purpose opt-in; one-click withdrawal stops processing / AI"],
    ["Children: verifiable parent/guardian consent", "s.9; Rule 10", "Under-18 needs guardian + recorded verification method"],
    ["Reasonable security safeguards", "s.8(5); Rule 6", "AES-256-GCM field encryption, masking, RBAC, mandatory 2FA, HTTPS/HSTS, CSP"],
    ["Logs to detect misuse, kept ≥ 1 year", "Rule 6; Rule 8", "Append-only hash-chained audit log with verification"],
    ["Breach: people without delay; Board detailed report in 72 h", "s.8(6); Rule 7", "Breach register with live 72-h clock and notice drafts"],
    ["Erase when purpose served / consent withdrawn", "s.8(7); Rule 8", "Retention policy, 48-h intimation, crypto-shredding"],
    ["Published DPO / contact; grievance redressal ≤ 90 days", "s.8(9)–(10); Rules 9, 14", "Contact on notice; 90-day rights & grievance register"],
    ["Access, correction, erasure, nomination", "ss.11–14", "Access summary export; audited correction; nominee"],
    ["Data in India; no third-party transfers", "s.16; Rule 15", "Indian-region deployment; AI runs in the browser"]];
  function complianceUI() {
    const box = el("div");
    const node = (t, sub) => el("div", { class: "an" }, el("b", {}, t), el("span", {}, sub));
    box.append(el("fieldset", {}, el("legend", {}, "Architecture & data flow"),
      el("div", { class: "arch" },
        el("div", { class: "acol" }, el("div", { class: "ah" }, "People"), node("Patient / guardian", "reads notice, gives per-purpose consent, files rights requests on the public form"), node("Pathologist & staff", "sign in with password + authenticator code; role-limited")),
        el("div", { class: "aarrow", "aria-hidden": "true" }, "→"),
        el("div", { class: "acol" }, el("div", { class: "ah" }, "Browser"), node("WHO-HAEM5 workbench", "counter, rule engine, synoptic report"), node("On-device AI", "ONNX model in WebAssembly; images never leave the device")),
        el("div", { class: "aarrow", "aria-hidden": "true" }, "→"),
        el("div", { class: "acol" }, el("div", { class: "ah" }, "Server (India region)"), node("API", "consent gates, RBAC, 2FA, 30-min sessions"), node("PostgreSQL", "AES-256-GCM encrypted identifiers & reports"), node("Audit log", "append-only, hash-chained")),
        el("div", { class: "aarrow", "aria-hidden": "true" }, "→"),
        el("div", { class: "acol" }, el("div", { class: "ah" }, "Governance"), node("DPO console", "rights 90 d · breaches 72 h · erasure 48 h notice"), node("Data Protection Board", "breach intimation & complaints")))));
    const t = el("table", { class: "ptbl" }, el("tr", {}, ["Requirement", "DPDP", "Control"].map(h => el("th", {}, h))), MATRIX.map(r => el("tr", {}, r.map((c, i) => el("td", { class: i === 1 ? "mono" : "" }, c)))));
    box.append(el("fieldset", {}, el("legend", {}, "DPDP Act 2023 & Rules 2025 → controls"), el("div", { class: "tblwrap" }, t),
      el("p", { class: "hint" }, "Substantive obligations commence 18 months after the Rules' notification (May 2027). GDPR crosswalk: Art. 6/9 lawful basis, 13 notice, 15–17 rights, 22 human review of AI, 25 privacy by design, 32 security, 33–34 breach. Prototype for research and teaching; not a medical device. Clinical use needs CDSCO classification and ISO 15189 validation.")));
    return box;
  }

  /* ---------- styles & wiring ---------- */
  document.head.append(el("style", {}, `
    .sc-banner{background:var(--eosin-soft);border-bottom:1px solid var(--line);font-size:13px}
    .sc-banner .wrap{display:flex;gap:12px;flex-wrap:wrap;justify-content:space-between;padding-block:6px;max-width:1500px;margin:0 auto}
    .consent-row{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--line)}
    .consent-row:last-child{border-bottom:0} .consent-row .nm{font-weight:500}
    .notice-txt p{margin:0 0 8px;max-width:75ch}
    .tblwrap{overflow-x:auto} .ptbl{border-collapse:collapse;width:100%;font-size:13.5px}
    .ptbl th,.ptbl td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
    .ptbl th{font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
    .ptbl .mono,.mono{font-family:var(--f-mono);font-size:12.5px}
    .toolbar input[type=text],.toolbar select,.breach input{border:1px solid var(--line);background:var(--sunken);border-radius:6px;padding:6px 8px;min-width:0}
    .toolbar input[type=text]{flex:1 1 220px}
    .breach{border:1px solid var(--line);border-radius:8px;padding:12px;margin-top:10px;display:flex;flex-direction:column;gap:6px;background:var(--surface)}
    .row-sb{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
    .notice-draft{white-space:pre-wrap;font:12.5px/1.5 var(--f-mono);background:var(--sunken);border:1px solid var(--line);border-radius:6px;padding:10px;overflow:auto;max-height:360px}
    .arch{display:grid;grid-template-columns:1fr auto 1fr auto 1fr auto 1fr;gap:8px;align-items:stretch}
    .acol{display:flex;flex-direction:column;gap:8px;min-width:0} .ah{font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:700}
    .an{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--sunken);display:flex;flex-direction:column;gap:2px;font-size:13px}
    .an span{color:var(--muted);font-size:12.5px} .aarrow{align-self:center;color:var(--accent);font-size:20px}
    @media (max-width:900px){.arch{grid-template-columns:1fr}.aarrow{transform:rotate(90deg);justify-self:center}}`));
  const banner = el("div", { class: "sc-banner" }, el("div", { class: "wrap" },
    el("span", {}, el("b", {}, "Showcase · synthetic data only. "), "Do not enter real patient information."),
    el("span", { class: "hint", id: "syncState" }, "Saved in this browser only")));
  document.querySelector("header.top").after(banner);

  const caseIdx = SECTIONS.findIndex(s => s.id === "case");
  SECTIONS.splice(caseIdx + 1, 0, { id: "consent", title: "Notice & consent", lede: "Show the notice, then record consent per purpose. AI counting unlocks only with AI consent; withdrawing diagnostic consent stops processing.", render: consentUI });
  SECTIONS.push({ id: "privacy", title: "Privacy centre", lede: "The Data Protection Officer's view: rights requests with 90-day clocks, the breach register with its 72-hour Board deadline, and the tamper-evident audit trail.", render: privacyUI });
  SECTIONS.push({ id: "compliance", title: "DPDP compliance", lede: "How the platform maps India's Digital Personal Data Protection Act 2023 and Rules 2025 to concrete controls.", render: complianceUI });

  // seed the example case with consent so the demo opens in a working state
  if (!Object.keys(priv.consents).length && isExample) {
    priv.consents = { diagnostic_reporting: { given: Date.now(), by: "self", notice: "2026-10-v1" } };
    audit("consent.given", { purpose: "diagnostic_reporting", by: "self", example: true });
  }
  const origUse = window.show;
  window.show = function (id) { origUse(id); if (id === "privacy") { drawRights(); drawBreaches(); drawAudit(); const s2 = document.getElementById("syncState2"); if (s2) s2.textContent = document.getElementById("syncState").textContent; } };
  const origLoad = window.loadCase;
  applyGates(); renderForms(); recompute();

  /* ---------- private per-viewer backend ---------- */
  (async () => {
    try {
      const [db, user] = await Promise.all([use("db"), use("user")]);
      const uid = user ? await user.id() : null;
      if (!db || !uid) return;
      cloud.db = db; cloud.ref = db.doc(`data/users/${uid}/workspace`);
      const snap = await cloud.ref.get();
      if (snap.exists) {
        const d = snap.data();
        if (d.priv) priv = JSON.parse(JSON.stringify(d.priv));
        if (d.counts) { cnt.PB = { ...(d.counts.PB || {}) }; cnt.BM = { ...(d.counts.BM || {}) }; }
        if (d.case) origLoad(d.case, false);
        applyGates(); renderForms(); recompute();
      }
      setSync("cloud");
    } catch { setSync("local"); }
  })();
})();
