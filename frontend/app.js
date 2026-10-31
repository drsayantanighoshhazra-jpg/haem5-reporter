"use strict";
/* HAEM5 Reporter — staff console. Token lives in sessionStorage only (cleared when the tab closes);
   no patient data is written to browser storage. */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = d => d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const toast = m => { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on"), 2200); };
let ME = null, NOTICE = null;
const tok = { get: () => sessionStorage.getItem("haem5.t"), set: t => sessionStorage.setItem("haem5.t", t), clear: () => sessionStorage.removeItem("haem5.t") };

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", ...(tok.get() ? { Authorization: "Bearer " + tok.get() } : {}), ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body });
  if (r.status === 401 && ME) { logout("Your session ended. Sign in again."); throw new Error("Session ended"); }
  const data = r.headers.get("content-type")?.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error(typeof data === "object" ? (Array.isArray(data.detail) ? data.detail.map(d => d.msg).join("; ") : data.detail) : data);
  return data;
}
const can = p => ME && ME.permissions.includes(p);

/* idle timeout: 15 minutes */
let idleT; const resetIdle = () => { clearTimeout(idleT); if (ME) idleT = setTimeout(() => logout("Signed out after 15 minutes of inactivity."), 15 * 60e3); };
["click", "keydown"].forEach(e => document.addEventListener(e, resetIdle));

function logout(msg) { tok.clear(); ME = null; $("#tabs").hidden = $("#who").hidden = true; renderLogin(msg); }

const TABS = [["dashboard", "Dashboard", null], ["patients", "Patients", "patients.read"], ["cases", "Cases", "cases.read"],
  ["rights", "Rights requests", "rights"], ["breaches", "Breaches", "breaches"], ["audit", "Audit log", "audit"], ["users", "Users", "users"], ["account", "Account", null]];
function renderShell() {
  $("#tabs").hidden = $("#who").hidden = false;
  $("#tabs").innerHTML = TABS.filter(t => !t[2] || can(t[2])).map(([k, n]) => `<a href="#${k}" data-k="${k}">${n}</a>`).join("");
  $("#who").innerHTML = `<span class="hint">${esc(ME.full_name)} · ${esc(ME.role)}</span><button class="btn sm" id="out">Sign out</button>`;
  $("#out").onclick = () => logout("Signed out.");
}
window.addEventListener("hashchange", route);
async function route() {
  if (!ME) return;
  if (ME.require_2fa && !ME.totp_enabled) return renderAccount(true);
  const k = (location.hash || "#dashboard").slice(1);
  document.querySelectorAll("#tabs a").forEach(a => a.classList.toggle("on", a.dataset.k === k));
  const V = { dashboard: renderDashboard, patients: renderPatients, register: renderRegister, cases: renderCases, rights: renderRights,
    breaches: renderBreaches, audit: renderAudit, users: renderUsers, account: () => renderAccount(false) }[k] || renderDashboard;
  try { await V(); } catch (e) { $("#view").innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}

/* ---------------- login ---------------- */
function renderLogin(msg) {
  $("#view").innerHTML = `<div class="login card">
    <h1>Sign in</h1><p class="lede">Staff access only. Every access to patient data is recorded.</p>
    ${msg ? `<div class="okmsg">${esc(msg)}</div>` : ""}
    <form id="lf" class="grid" style="grid-template-columns:1fr">
      <div class="f"><label for="le">Email</label><input id="le" type="email" autocomplete="username" required></div>
      <div class="f"><label for="lp">Password</label><input id="lp" type="password" autocomplete="current-password" required></div>
      <div class="f" id="codeRow" hidden><label for="lc">Authenticator code</label><input id="lc" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div>
      <div id="lerr"></div><button class="btn primary">Sign in</button>
    </form>
    <p class="hint">Patients: read our <a href="/privacy">privacy notice</a> or make a request about your data.</p></div>`;
  $("#lf").onsubmit = async e => {
    e.preventDefault(); $("#lerr").innerHTML = "";
    try {
      const r = await api("/api/auth/login", { method: "POST", body: { email: $("#le").value, password: $("#lp").value, code: $("#lc").value || null } });
      if (r.need_2fa) { $("#codeRow").hidden = false; $("#lc").focus(); return; }
      tok.set(r.token); ME = r.user; renderShell(); resetIdle(); if (!location.hash) location.hash = "#dashboard"; route();
    } catch (err) { $("#lerr").innerHTML = `<div class="err">${esc(err.message)}</div>`; }
  };
}

/* ---------------- account / 2FA ---------------- */
async function renderAccount(forced) {
  const v = $("#view");
  v.innerHTML = `<h1>Account security</h1><p class="lede">${forced ? "Set up two-factor authentication before you can open patient data." : "Manage your password and two-factor authentication."}</p>
    <div class="card" id="tfa"></div>
    <div class="card"><h2>Change password</h2><form id="pf" class="grid">
      <div class="f"><label for="p1">Current password</label><input id="p1" type="password" autocomplete="current-password" required></div>
      <div class="f"><label for="p2">New password</label><input id="p2" type="password" autocomplete="new-password" required minlength="12"></div>
      <div class="f"><label>&nbsp;</label><button class="btn">Update password</button></div></form>
      <p class="hint">At least 12 characters with upper- and lower-case letters and a digit.</p><div id="pmsg"></div></div>`;
  const T = $("#tfa");
  if (ME.totp_enabled) T.innerHTML = `<h2>Two-factor authentication</h2><span class="pill ok">On</span>`;
  else {
    T.innerHTML = `<h2>Two-factor authentication</h2><button class="btn primary" id="go2">Set up authenticator app</button><div id="s2"></div>`;
    $("#go2").onclick = async () => {
      const s = await api("/api/auth/2fa/setup", { method: "POST" });
      $("#s2").innerHTML = `<p>Scan with Google Authenticator, Microsoft Authenticator or similar, then enter the 6-digit code.</p>
        <img class="qr" src="${s.qr}" alt="QR code for authenticator app"><p class="hint">Or enter this key: <span class="mono">${esc(s.secret)}</span></p>
        <form id="ef" class="row"><input id="ec" class="mono" inputmode="numeric" maxlength="6" placeholder="123456" aria-label="Code" style="padding:7px;border:1px solid var(--line);border-radius:6px;background:var(--sunken)"><button class="btn primary">Turn on</button></form><div id="em"></div>`;
      $("#ef").onsubmit = async e => { e.preventDefault(); try { ME = await api("/api/auth/2fa/enable", { method: "POST", body: { code: $("#ec").value } }); renderShell(); toast("Two-factor authentication is on"); location.hash = "#dashboard"; route(); } catch (err) { $("#em").innerHTML = `<div class="err">${esc(err.message)}</div>`; } };
    };
  }
  $("#pf").onsubmit = async e => { e.preventDefault(); try { ME = await api("/api/auth/password", { method: "POST", body: { current_password: $("#p1").value, new_password: $("#p2").value } }); $("#pmsg").innerHTML = `<div class="okmsg">Password updated.</div>`; } catch (err) { $("#pmsg").innerHTML = `<div class="err">${esc(err.message)}</div>`; } };
}

/* ---------------- dashboard ---------------- */
async function renderDashboard() {
  const d = await api("/api/dashboard");
  $("#org").textContent = `${d.org.fiduciary} · data stored in ${d.org.region}`;
  $("#demo").hidden = !d.org.demo;
  const st = (n, l, cls = "") => `<div class="stat ${cls}"><div class="n">${n ?? "—"}</div><div class="l">${l}</div></div>`;
  $("#view").innerHTML = `<h1>Dashboard</h1><p class="lede">Workload and DPDP compliance clocks at a glance.</p>
    <div class="stats">
      ${st(d.cases_awaiting, "Awaiting authorisation", d.cases_awaiting && can("cases.sign") ? "warnc" : "")}${st(d.patients, "Patients on record")}${st(d.cases_draft, "Draft reports")}${st(d.cases_signed, "Authorised reports")}${d.ai_qa && d.ai_qa.cells ? st((100 * d.ai_qa.agreement).toFixed(1) + "%", `AI–pathologist agreement (${d.ai_qa.agree}/${d.ai_qa.cells} cells, ${d.ai_qa.cases} reports)`) : ""}
      ${st(d.rights_open, "Open rights requests", d.rights_overdue ? "alert" : d.rights_due_7d ? "warnc" : "")}
      ${st(d.rights_overdue, "Requests past 90 days", d.rights_overdue ? "alert" : "")}
      ${st(d.breaches_open, "Open breaches", d.breaches_open ? "warnc" : "")}
      ${st(d.next_breach_deadline_h === null ? "—" : d.next_breach_deadline_h + " h", "Until next Board deadline (72 h)", d.breach_board_overdue ? "alert" : "")}
      ${st(d.erasures_scheduled, "Erasures scheduled (48 h notice)")}
    </div>
    <div class="row">${can("cases.sign") && d.cases_awaiting ? `<a class="btn primary" href="#cases">Review ${d.cases_awaiting} report${d.cases_awaiting === 1 ? "" : "s"} awaiting authorisation</a>` : ""}${can("patients.write") ? `<a class="btn ${can("cases.sign") && d.cases_awaiting ? "" : "primary"}" href="#register">Register patient &amp; consent</a>` : ""}${can("cases.read") ? `<a class="btn" href="#cases">Open cases</a>` : ""}</div>`;
}

/* ---------------- patients ---------------- */
async function renderPatients() {
  const list = await api("/api/patients");
  $("#view").innerHTML = `<h1>Patients</h1><p class="lede">Identifiers are masked in this list. Viewing them is logged.</p>
    <div class="row" style="margin-bottom:12px">${can("patients.write") ? `<a class="btn primary" href="#register">Register patient</a>` : ""}</div>
    <div class="card tbl"><table><thead><tr><th>Pseudonym</th><th>Name</th><th>Age/Sex</th><th>Consents</th><th>Retain until</th><th></th></tr></thead><tbody>
    ${list.map(p => `<tr><td class="mono">${esc(p.pseudonym)}</td><td>${esc(p.name)}</td><td>${p.age_years ?? "—"} / ${esc(p.sex || "—")}${p.is_minor ? ' <span class="pill warn">minor</span>' : ""}</td>
      <td>${p.erased ? '<span class="pill mut">erased</span>' : p.active_purposes.map(x => `<span class="pill ok">${esc(x.replace(/_/g, " "))}</span>`).join(" ")}</td>
      <td class="mono">${p.erasure_scheduled_for ? '<span class="pill bad">erasure ' + fmt(p.erasure_scheduled_for) + "</span>" : fmt(p.retain_until).slice(0, 11)}</td>
      <td><button class="btn sm" data-p="${p.id}">Open</button></td></tr>`).join("") || `<tr><td colspan="6">No patients yet.</td></tr>`}
    </tbody></table></div><div id="pd"></div>`;
  document.querySelectorAll("[data-p]").forEach(b => b.onclick = () => patientDetail(b.dataset.p));
}
async function patientDetail(id, reveal = false) {
  const p = await api(`/api/patients/${id}?reveal=${reveal}`);
  const D = $("#pd");
  D.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><h2>${esc(p.pseudonym)} · ${esc(p.name)}</h2>
    <div class="row">${!reveal && can("patients.reveal") && !p.erased ? `<button class="btn sm" id="rv">Show identifiers (logged)</button>` : ""}
    ${can("cases.write") && !p.erased && p.active_purposes.includes("diagnostic_reporting") ? `<button class="btn sm primary" id="nc">New case</button>` : ""}
    ${can("rights.create") ? `<button class="btn sm" id="nr">Record rights request</button>` : ""}</div></div>
    ${reveal ? `<p>Contact: ${esc(p.contact || "—")} · DOB: ${esc(p.dob || "—")} · Guardian: ${esc(p.guardian || "—")} ${p.guardian_verified_by ? "(verified: " + esc(p.guardian_verified_by) + ")" : ""} · Nominee: ${esc(p.nominee || "—")}</p>` : ""}
    <h3>Consent ledger</h3><div class="tbl"><table><thead><tr><th>Purpose</th><th>Given</th><th>By</th><th>Notice</th><th>Status</th><th></th></tr></thead><tbody>
    ${p.consents.map(c => `<tr><td>${esc(c.purpose_text)}</td><td class="mono">${fmt(c.given_at)}</td><td>${esc(c.given_by)}</td><td class="mono">${esc(c.notice_version)}</td>
      <td>${c.active ? '<span class="pill ok">active</span>' : '<span class="pill mut">withdrawn ' + fmt(c.withdrawn_at) + "</span>"}</td>
      <td>${c.active && can("consents") ? `<button class="btn sm danger" data-w="${c.id}">Withdraw</button>` : ""}</td></tr>`).join("")}</tbody></table></div><div id="pmsg"></div></div>`;
  $("#rv") && ($("#rv").onclick = () => patientDetail(id, true));
  $("#nc") && ($("#nc").onclick = async () => {
    $("#pmsg").innerHTML = `<form id="ncf" class="row" style="margin-top:10px"><input id="lab" placeholder="Lab / accession no." required style="padding:7px;border:1px solid var(--line);border-radius:6px;background:var(--sunken)"><button class="btn primary">Create case</button></form>`;
    $("#ncf").onsubmit = async e => { e.preventDefault(); try { const c = await api("/api/cases", { method: "POST", body: { patient_id: id, lab_no: $("#lab").value, data: { labNo: $("#lab").value, age: p.age_years, sex: p.sex } } }); location.href = "/workbench?case=" + c.id; } catch (err) { $("#pmsg").innerHTML = `<div class="err">${esc(err.message)}</div>`; } };
  });
  $("#nr") && ($("#nr").onclick = () => {
    $("#pmsg").innerHTML = `<form id="rf" class="grid" style="margin-top:10px"><div class="f"><label for="rk">Request</label><select id="rk">${["access", "correction", "completion", "updating", "erasure", "nomination", "grievance", "withdraw_consent"].map(k => `<option value="${k}">${k.replace(/_/g, " ")}</option>`).join("")}</select></div>
      <div class="f wide"><label for="rd">Details</label><textarea id="rd"></textarea></div><div><button class="btn primary">Record request</button></div></form>`;
    $("#rf").onsubmit = async e => { e.preventDefault(); try { const r = await api("/api/rights", { method: "POST", body: { patient_id: id, kind: $("#rk").value, details: $("#rd").value } }); $("#pmsg").innerHTML = `<div class="okmsg">Request ${esc(r.ref)} recorded. Due by ${fmt(r.due_at)}.</div>`; } catch (err) { $("#pmsg").innerHTML = `<div class="err">${esc(err.message)}</div>`; } };
  });
  document.querySelectorAll("[data-w]").forEach(b => b.onclick = () => {
    b.outerHTML = `<span class="row"><input id="wr" placeholder="Reason (optional)" style="padding:4px;border:1px solid var(--line);border-radius:6px;background:var(--sunken)"><button class="btn sm danger" id="wc">Confirm</button></span>`;
    $("#wc").onclick = async () => { try { await api(`/api/consents/${b.dataset.w}/withdraw`, { method: "POST", body: { reason: $("#wr").value || null } }); toast("Consent withdrawn"); patientDetail(id, reveal); } catch (err) { toast(err.message); } };
  });
}

async function renderRegister() {
  NOTICE = NOTICE || await api("/api/public/notice");
  const n = NOTICE;
  $("#view").innerHTML = `<h1>Register patient &amp; record consent</h1><p class="lede">Show or read the privacy notice to the patient (or parent/guardian) before recording consent. Each purpose is consented separately.</p>
    <div class="card notice"><h2>${esc(n.title)}</h2><p class="hint">Notice version ${esc(n.version)} · ${esc(n.data_fiduciary)}</p>
      <h3>Personal data we process</h3><ul>${n.personal_data.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
      <h3>Why</h3><p>${esc(n.services_enabled)} ${esc(n.ai_statement)}</p><h3>Storage and retention</h3><p>${esc(n.storage)} ${esc(n.retention)}</p>
      <h3>Withdrawing consent and your rights</h3><p>${esc(n.withdrawal)} ${esc(n.rights)}</p>
      <h3>Contact</h3><p>${esc(n.contact.name)} · ${esc(n.contact.email)} · ${esc(n.contact.phone)}. ${esc(n.board)}</p></div>
    <form id="rg" class="card"><h2>Patient</h2><div class="grid">
      <div class="f"><label for="nm">Full name</label><input id="nm" required></div>
      <div class="f"><label for="ag">Age (years)</label><input id="ag" type="number" min="0" max="130" required></div>
      <div class="f"><label for="sx">Sex</label><select id="sx"><option value="">—</option><option>F</option><option>M</option><option>O</option></select></div>
      <div class="f"><label for="ct">Phone or email</label><input id="ct"></div>
      <div class="f"><label for="nmn">Nominee (optional)</label><input id="nmn" placeholder="Name, relationship, contact"></div></div>
      <div id="guard" hidden><h2 style="margin-top:14px">Parent or lawful guardian</h2><div class="grid">
        <div class="f"><label for="gd">Name and relationship</label><input id="gd"></div>
        <div class="f"><label for="gv">How identity/age was verified</label><select id="gv"><option value="">—</option><option>Government photo ID seen</option><option>DigiLocker token</option><option>Existing verified hospital record</option><option>Court/authority appointment order (guardian of person with disability)</option></select></div></div></div>
      <h2 style="margin-top:14px">Consent</h2>
      ${n.purposes.map(p => `<label class="chk"><input type="checkbox" data-purpose="${p.id}" ${p.required ? "checked" : ""}> <span>${esc(p.description)}${p.required ? " <b>(needed to process the sample)</b>" : ""}</span></label>`).join("")}
      <div id="rerr"></div><div class="row" style="margin-top:10px"><button class="btn primary">Register and record consent</button></div></form>`;
  $("#ag").oninput = () => { $("#guard").hidden = !($("#ag").value !== "" && +$("#ag").value < 18); };
  $("#rg").onsubmit = async e => {
    e.preventDefault(); $("#rerr").innerHTML = "";
    const minor = +$("#ag").value < 18;
    const purposes = [...document.querySelectorAll("[data-purpose]")].filter(x => x.checked).map(x => x.dataset.purpose);
    try {
      const p = await api("/api/patients", { method: "POST", body: { name: $("#nm").value, age_years: +$("#ag").value, sex: $("#sx").value, contact: $("#ct").value || null,
        nominee: $("#nmn").value || null, guardian: minor ? $("#gd").value : null, guardian_verified_by: minor ? $("#gv").value || null : null,
        consent: { purposes, notice_version: n.version, given_by: minor ? "guardian" : "self" } } });
      toast(`Registered as ${p.pseudonym}`); location.hash = "#patients"; setTimeout(() => patientDetail(p.id), 300);
    } catch (err) { $("#rerr").innerHTML = `<div class="err">${esc(err.message)}</div>`; }
  };
}

/* ---------------- cases ---------------- */
async function renderCases() {
  const list = await api("/api/cases");
  const pill = c => c.status === "signed" ? '<span class="pill ok">authorised</span>' : c.status === "prepared" ? '<span class="pill warn">awaiting authorisation</span>'
    : c.return_note ? '<span class="pill bad">returned</span>' : '<span class="pill mut">draft</span>';
  const row = c => `<tr><td class="mono">${esc(c.lab_no)}</td><td class="mono">${esc(c.pseudonym)}</td><td>${esc(c.diagnosis || "—")}</td>
      <td>${pill(c)}${c.permissions.processing_allowed ? "" : ' <span class="pill bad">consent withdrawn</span>'}</td>
      <td>${c.ai_used ? '<span class="pill ok">AI-assisted</span>' : c.permissions.ai_allowed ? '<span class="pill mut">consented</span>' : '<span class="pill mut">no</span>'}</td>
      <td>${esc(c.prepared_by || "—")}</td><td class="mono">${fmt(c.status === "prepared" ? c.prepared_at : c.updated_at)}</td>
      <td><a class="btn sm ${c.status === "prepared" && can("cases.sign") ? "primary" : ""}" href="/workbench?case=${c.id}">${c.status === "prepared" && can("cases.sign") ? "Review" : "Open"}</a></td></tr>`;
  const head = `<thead><tr><th>Lab no.</th><th>Patient</th><th>Impression</th><th>Status</th><th>AI</th><th>Prepared by</th><th>Updated</th><th></th></tr></thead>`;
  const waiting = list.filter(c => c.status === "prepared").sort((a, b) => new Date(a.prepared_at) - new Date(b.prepared_at));
  const others = list.filter(c => c.status !== "prepared");
  $("#view").innerHTML = `<h1>Cases</h1><p class="lede">${can("cases.sign") ? "Reports prepared by staff wait here for your review and authorisation, oldest first." : "Prepare the report, then send it for authorisation. A pathologist authorises every report."}</p>
    ${waiting.length ? `<h2>Awaiting authorisation (${waiting.length})</h2><div class="card tbl"><table>${head}<tbody>${waiting.map(row).join("")}</tbody></table></div>` : ""}
    <h2>${waiting.length ? "Other cases" : "All cases"}</h2>
    <div class="card tbl"><table>${head}<tbody>${others.map(row).join("") || `<tr><td colspan="8">No cases yet. Create one from a patient record.</td></tr>`}</tbody></table></div>`;
}

/* ---------------- rights ---------------- */
async function renderRights() {
  const list = await api("/api/rights");
  $("#view").innerHTML = `<h1>Rights requests &amp; grievances</h1><p class="lede">Every request must be answered within 90 days. Verify the requester's identity before acting.</p>
    <div class="row" style="margin-bottom:12px">${can("retention") ? `<button class="btn" id="rr">Run retention &amp; scheduled erasures</button>` : ""}<span id="rrm" class="hint"></span></div>
    <div class="card tbl"><table><thead><tr><th>Ref</th><th>Type</th><th>Patient</th><th>Channel</th><th>Received</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map(r => `<tr><td class="mono">${esc(r.ref)}</td><td>${esc(r.kind.replace(/_/g, " "))}</td><td class="mono">${esc(r.pseudonym || "not linked")}</td><td>${esc(r.channel)}${r.identity_verified ? "" : ' <span class="pill warn">ID not verified</span>'}</td>
      <td class="mono">${fmt(r.received_at)}</td><td>${r.overdue ? '<span class="pill bad">overdue</span>' : r.status === "fulfilled" || r.status === "rejected" ? "" : `<span class="pill ${r.days_left <= 7 ? "warn" : "mut"}">${r.days_left} days</span>`}</td>
      <td>${esc(r.status)}</td><td><button class="btn sm" data-r="${r.id}">Handle</button></td></tr>`).join("") || `<tr><td colspan="8">No requests.</td></tr>`}
    </tbody></table></div><div id="rd"></div>`;
  $("#rr") && ($("#rr").onclick = async () => { const o = await api("/api/retention/run", { method: "POST" }); $("#rrm").textContent = `Erased ${o.erased.length}; erasure intimated for ${o.erasure_intimated.length}; ${o.logs_pruned} log entries older than the retention period pruned.`; });
  document.querySelectorAll("[data-r]").forEach(b => b.onclick = () => handleRight(list.find(x => x.id === b.dataset.r)));
}
async function handleRight(r) {
  const pats = r.pseudonym ? [] : await api("/api/patients");
  $("#rd").innerHTML = `<div class="card"><h2>${esc(r.ref)} · ${esc(r.kind.replace(/_/g, " "))}</h2>
    <p>${esc(r.details?.identifier ? "Identifier given: " + r.details.identifier + ". " : "")}${esc(r.details?.details || "")} ${r.requester_contact ? "Contact: " + esc(r.requester_contact) : ""}</p>
    <form id="hf" class="grid">
      ${r.pseudonym ? "" : `<div class="f"><label for="hp">Link to patient</label><select id="hp"><option value="">—</option>${pats.map(p => `<option value="${p.id}">${esc(p.pseudonym)} · ${esc(p.name)}</option>`).join("")}</select></div>`}
      <label class="chk"><input type="checkbox" id="hv" ${r.identity_verified ? "checked" : ""}> Identity verified</label>
      <div class="f"><label for="hs">Status</label><select id="hs">${["open", "in_progress", "fulfilled", "rejected"].map(s => `<option ${s === r.status ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <div class="f wide"><label for="hr">Response to the Data Principal</label><textarea id="hr">${esc(r.response || "")}</textarea></div>
      <div class="row wide"><button class="btn primary">Save</button>
        ${r.kind === "access" && can("export") ? `<button type="button" class="btn" id="hx">Generate access summary</button>` : ""}
        ${r.kind === "erasure" ? `<button type="button" class="btn danger" id="he">Schedule erasure (48 h notice)</button>` : ""}</div></form><div id="hm"></div></div>`;
  $("#hf").onsubmit = async e => { e.preventDefault(); try { await api(`/api/rights/${r.id}`, { method: "PATCH", body: { patient_id: $("#hp")?.value || null, identity_verified: $("#hv").checked, status: $("#hs").value, response: $("#hr").value || null } }); toast("Saved"); renderRights(); } catch (err) { $("#hm").innerHTML = `<div class="err">${esc(err.message)}</div>`; } };
  $("#hx") && ($("#hx").onclick = async () => { try { const s = await api(`/api/rights/${r.id}/access-summary`); $("#hm").innerHTML = `<p class="hint">Give this summary to the verified requester through a secure channel.</p><pre class="out">${esc(JSON.stringify(s, null, 2))}</pre>`; } catch (err) { $("#hm").innerHTML = `<div class="err">${esc(err.message)}</div>`; } });
  $("#he") && ($("#he").onclick = async () => { try { const s = await api(`/api/rights/${r.id}/schedule-erasure`, { method: "POST" }); $("#hm").innerHTML = `<div class="okmsg">${esc(s.intimation)}</div>`; } catch (err) { $("#hm").innerHTML = `<div class="err">${esc(err.message)}</div>`; } });
}

/* ---------------- breaches ---------------- */
async function renderBreaches() {
  const list = await api("/api/breaches");
  $("#view").innerHTML = `<h1>Personal data breaches</h1><p class="lede">Inform affected people without delay and the Data Protection Board with a detailed report within 72 hours of becoming aware.</p>
    <form id="bf" class="card grid"><h2 class="wide" style="grid-column:1/-1">Record a breach</h2>
      <div class="f wide"><label for="bd">What happened</label><textarea id="bd" required></textarea></div>
      <div class="f"><label for="bc">Data categories</label><input id="bc" placeholder="e.g. names, lab numbers, reports"></div>
      <div class="f"><label for="bn">People affected</label><input id="bn" type="number" min="0"></div>
      <div class="f"><label for="bw">Became aware at</label><input id="bw" type="datetime-local"></div>
      <div class="row wide" style="grid-column:1/-1"><button class="btn primary">Record breach &amp; start 72 h clock</button></div></form>
    ${list.map(b => `<div class="card"><div class="row" style="justify-content:space-between"><h2>${esc(b.ref)}</h2>
      ${b.board_detailed_at ? '<span class="pill ok">Board report sent</span>' : b.board_overdue ? '<span class="pill bad">Board deadline passed</span>' : `<span class="pill warn">${b.hours_to_board_deadline} h to Board deadline</span>`}</div>
      <p>${esc(b.description)}</p><p class="hint">Aware ${fmt(b.became_aware_at)} · detailed report due ${fmt(b.board_detailed_due)} · initial notice ${fmt(b.board_initial_at)} · people notified ${fmt(b.principals_notified_at)}</p>
      <div class="grid"><div class="f wide"><label>Mitigation</label><textarea data-b="${b.id}" data-f="mitigation">${esc(b.mitigation || "")}</textarea></div>
      <div class="f wide"><label>Findings on cause / responsible party</label><textarea data-b="${b.id}" data-f="cause_findings">${esc(b.cause_findings || "")}</textarea></div></div>
      <div class="row" style="margin-top:8px"><button class="btn sm" data-act="save" data-id="${b.id}">Save</button><button class="btn sm" data-act="board_initial" data-id="${b.id}">Mark initial Board notice sent</button>
      <button class="btn sm" data-act="board_detailed" data-id="${b.id}">Mark detailed Board report sent</button><button class="btn sm" data-act="principals_notified" data-id="${b.id}">Mark people notified</button>
      <button class="btn sm" data-act="draft" data-id="${b.id}">Draft notice to people</button></div><div id="bm_${b.id}"></div></div>`).join("")}`;
  $("#bf").onsubmit = async e => { e.preventDefault(); try { await api("/api/breaches", { method: "POST", body: { description: $("#bd").value, data_categories: $("#bc").value || null, affected_count: $("#bn").value ? +$("#bn").value : null, became_aware_at: $("#bw").value ? new Date($("#bw").value).toISOString() : null } }); toast("Breach recorded"); renderBreaches(); } catch (err) { toast(err.message); } };
  document.querySelectorAll("[data-act]").forEach(b => b.onclick = async () => {
    const id = b.dataset.id, body = {}; document.querySelectorAll(`[data-b="${id}"]`).forEach(t => body[t.dataset.f] = t.value || null);
    try {
      if (b.dataset.act === "draft") { const d = await api(`/api/breaches/${id}/principal-notice`); $("#bm_" + id).innerHTML = `<pre class="out">${esc(d.text)}</pre>`; return; }
      if (b.dataset.act !== "save") body[b.dataset.act] = true;
      await api(`/api/breaches/${id}`, { method: "PATCH", body }); toast("Updated"); renderBreaches();
    } catch (err) { $("#bm_" + id).innerHTML = `<div class="err">${esc(err.message)}</div>`; }
  });
}

/* ---------------- audit ---------------- */
async function renderAudit() {
  const [rows, v] = await Promise.all([api("/api/audit?limit=300"), api("/api/audit/verify")]);
  $("#view").innerHTML = `<h1>Audit log</h1><p class="lede">Append-only and hash-chained: any change to a past entry breaks the chain.</p>
    <div class="card">${v.ok ? `<span class="pill ok">Chain intact</span> <span class="hint">${v.checked} entries verified</span>` : `<span class="pill bad">Chain broken at entry ${v.broken_at}: ${esc(v.reason)}</span>`}</div>
    <div class="card tbl"><table><thead><tr><th>#</th><th>Time</th><th>Actor</th><th>Action</th><th>Subject</th><th>Detail</th><th>Hash</th></tr></thead><tbody>
    ${rows.map(a => `<tr><td class="mono">${a.id}</td><td class="mono">${fmt(a.ts)}</td><td class="mono">${esc(a.actor.slice(0, 10))}</td><td>${esc(a.action)}</td><td class="mono">${esc([a.entity, a.entity_id].filter(Boolean).join(" "))}</td><td class="mono">${esc(a.detail ? JSON.stringify(a.detail) : "")}</td><td class="mono">${esc(a.hash)}</td></tr>`).join("")}
    </tbody></table></div>`;
}

/* ---------------- users ---------------- */
async function renderUsers() {
  const list = await api("/api/users");
  $("#view").innerHTML = `<h1>Users</h1><p class="lede">Least privilege: give each person the narrowest role that lets them work.</p>
    <form id="uf" class="card grid"><div class="f"><label for="ue">Email</label><input id="ue" type="email" required></div><div class="f"><label for="un">Full name</label><input id="un" required></div>
      <div class="f"><label for="ur">Role</label><select id="ur">${["pathologist", "resident", "technician", "dpo", "admin"].map(r => `<option>${r}</option>`).join("")}</select></div>
      <div class="f"><label>&nbsp;</label><button class="btn primary">Add user</button></div></form><div id="um"></div>
    <div class="card tbl"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>2FA</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map(u => `<tr><td>${esc(u.full_name)}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${u.totp_enabled ? '<span class="pill ok">on</span>' : '<span class="pill warn">not set</span>'}</td>
      <td>${u.active ? "active" : '<span class="pill mut">inactive</span>'}</td><td>${u.id !== ME.id ? `<button class="btn sm" data-u="${u.id}" data-a="${!u.active}">${u.active ? "Deactivate" : "Reactivate"}</button>` : ""}</td></tr>`).join("")}
    </tbody></table></div>`;
  $("#uf").onsubmit = async e => { e.preventDefault(); try { const r = await api("/api/users", { method: "POST", body: { email: $("#ue").value, full_name: $("#un").value, role: $("#ur").value } }); $("#um").innerHTML = `<div class="okmsg">${esc(r.message)}<br>Temporary password: <span class="mono">${esc(r.temporary_password)}</span></div>`; } catch (err) { $("#um").innerHTML = `<div class="err">${esc(err.message)}</div>`; } };
  document.querySelectorAll("[data-u]").forEach(b => b.onclick = async () => { await api(`/api/users/${b.dataset.u}`, { method: "PATCH", body: { active: b.dataset.a === "true" } }); renderUsers(); });
}

/* ---------------- boot ---------------- */
(async () => {
  try { const h = await api("/api/health"); $("#demo").hidden = !h.demo; } catch {}
  if (tok.get()) { try { ME = await api("/api/auth/me"); renderShell(); resetIdle(); return route(); } catch { tok.clear(); } }
  renderLogin();
})();
