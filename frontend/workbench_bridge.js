/* Connects the WHO-HAEM5 workbench to the platform API and runs the prepare → authorise workflow.
   Loaded after the workbench script: uses its globals (state, cnt, loadCase, buildReport, lastResult, HAEM5, el, toast). */
(function () {
  "use strict";
  const token = sessionStorage.getItem("haem5.t");
  const caseId = new URLSearchParams(location.search).get("case");
  const api = async (path, opts = {}) => {
    const r = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: opts.body ? JSON.stringify(opts.body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { location.href = "/"; throw new Error("Signed out"); }
    if (!r.ok) throw new Error(Array.isArray(d.detail) ? d.detail.map(x => x.msg).join("; ") : d.detail || "Request failed");
    return d;
  };
  if (!token || !caseId) { location.href = "/"; return; }

  const hdr = document.querySelector("header.top .wrap");
  document.getElementById("exampleSel").hidden = true;
  document.getElementById("newWrap").hidden = true;
  const back = el("a", { class: "btn sm ghost", href: "/#cases" }, "← Cases");
  const info = el("span", { class: "hint", id: "srvInfo" }, "Loading case…");
  const actions = el("span", { class: "row", id: "srvActions", style: "display:flex;gap:6px;flex-wrap:wrap" });
  hdr.insertBefore(back, hdr.firstChild);
  hdr.append(info, actions);
  const banner = el("div", { id: "wfBanner", class: "warnbox", hidden: true, style: "margin:12px auto 0;max-width:1500px" });
  document.querySelector("header.top").after(el("div", { class: "wrap" }, banner));

  let meta = null, me = null;
  const canSign = () => me && me.permissions.includes("cases.sign");
  const canWrite = () => me && me.permissions.includes("cases.write");
  const today = () => new Date().toLocaleDateString("en-GB");
  const btn = (label, fn, primary) => el("button", { class: "btn sm" + (primary ? " primary" : ""), onclick: fn }, label);

  function render() {
    const st = meta.status, ok = meta.permissions.processing_allowed;
    info.textContent = `${meta.lab_no} · ${meta.pseudonym} · ` + ({ draft: "draft", prepared: "awaiting authorisation", signed: "authorised " + new Date(meta.signed_at).toLocaleString("en-IN") })[st] +
      (ok ? "" : " · consent withdrawn — read only") + (meta.permissions.ai_allowed ? " · AI consented" : " · no AI consent");
    actions.innerHTML = "";
    if (ok && st === "draft" && canWrite()) {
      actions.append(btn("Save draft", () => run(persist, "Draft saved")));
      if (canSign()) actions.append(btn("Authorise & sign", askSign, true));
      else actions.append(btn("Send for authorisation", () => run(prepare, "Sent to the pathologist for authorisation"), true));
    }
    if (ok && st === "prepared" && canSign()) actions.append(btn("Save changes", () => run(persist, "Saved")), btn("Return for correction", askReturn), btn("Authorise & sign", askSign, true));
    // banner
    const g = state.cellGallery || [], flagged = g.filter(isFlagged).length;
    let msg = "";
    if (st === "prepared") msg = `Prepared by ${meta.prepared_by || "—"} on ${new Date(meta.prepared_at).toLocaleString("en-IN")}.` +
      (g.length ? ` ${g.length} cells counted${meta.ai_used ? " with AI assistance" : ""}; ${flagged} flagged for review in Differential counter › Cell gallery.` : "") +
      (canSign() ? " Review the report, then authorise or return it." : " Waiting for the pathologist.");
    if (st === "draft" && meta.return_note) msg = `Returned by the pathologist: “${meta.return_note}”. Make the corrections and send it again.`;
    if (st === "signed") msg = `Authorised by ${meta.signed_by || "—"}. The report is locked; issue an addendum for changes.`;
    banner.hidden = !msg; banner.textContent = msg;
  }
  async function run(fn, done) { try { await fn(); toast(done); } catch (e) { toast(e.message); } render(); }

  async function load() {
    try {
      [me, meta] = await Promise.all([api("/api/auth/me"), api(`/api/cases/${caseId}`)]);
      window.HAEM5_AI_ALLOWED = !!meta.permissions.ai_allowed;
      loadCase(Object.assign({ labNo: meta.lab_no, patient: meta.pseudonym }, meta.data || {}), false);
      if (meta.status === "prepared" && canSign()) show("report");
      render();
    } catch (e) { info.textContent = e.message; }
  }
  function reportText() {
    const rt = document.getElementById("reportText");
    return rt && rt.value && typeof reportEdited !== "undefined" && reportEdited ? rt.value : buildReport();
  }
  async function persist() {
    state.counts = cnt;
    const data = Object.assign({}, state); delete data.patient;
    meta = await api(`/api/cases/${caseId}`, { method: "PUT", body: { data, diagnosis: state.dx || null, report: reportText(), ai_used: !!state.aiUsed } });
  }
  async function prepare() {
    if (!state.dx && lastResult && lastResult.candidates.length) {
      const top = lastResult.candidates[0];
      state.dx = HAEM5.diagnosisLine(top); state.dxFamily = top.family; state.dxAuto = true;
    }
    if (!state.dx) throw new Error("No impression yet: enter the blood count and differential first");
    state.preparedBy = me.full_name; state.preparedOn = today();
    await persist();
    meta = await api(`/api/cases/${caseId}/prepare`, { method: "POST" });
  }
  function askSign() {
    actions.innerHTML = "";
    actions.append(el("span", { class: "confirm" }, "Authorise and lock this report as yours?",
      btn("Authorise", () => run(async () => {
        state.pathologist = me.full_name; state.reportDate = today(); state.authorised = true; state.dxAuto = false;
        if (typeof reportEdited !== "undefined") reportEdited = false;   // regenerate so the signature line is current
        await persist();
        meta = await api(`/api/cases/${caseId}/sign`, { method: "POST" });
      }, "Report authorised"), true), btn("Cancel", render)));
  }
  function askReturn() {
    actions.innerHTML = "";
    const note = el("input", { id: "retNote", type: "text", placeholder: "What needs correcting?", style: "padding:5px 8px;border:1px solid var(--line);border-radius:6px;background:var(--sunken);min-width:220px" });
    actions.append(note, btn("Return", () => run(async () => {
      meta = await api(`/api/cases/${caseId}/return`, { method: "POST", body: { note: note.value } });
    }, "Returned to the preparer")), btn("Cancel", render));
    note.focus();
  }
  load();
})();
