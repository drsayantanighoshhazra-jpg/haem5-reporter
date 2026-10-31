/* Complete blood count flagging: age/sex reference ranges, high/low and critical flags, haematological
   interpretation, and smear-review triggers from the ISLH consensus rules.
   Sources (defaults — every laboratory must replace them with its own verified ranges, ISO 15189 / NABL):
   - Adults: Bain BJ, Bates I, Laffan MA (eds). Dacie and Lewis Practical Haematology, 12th ed. 2017, Table 2.1.
   - Children: North Bristol NHS Trust children's FBC reference ranges (HA/WE/003), after Dacie and Lewis.
   - Smear review: Barnes PW et al. The International Consensus Group for Hematology Review: suggested criteria
     for action following automated CBC and WBC differential analysis. Lab Hematol 2005;11:83–90 (41 rules).
   - Anaemia severity: WHO. Haemoglobin concentrations for the diagnosis of anaemia and assessment of severity, 2011.
   Pure functions on the case object, so they run in the browser and in tests. */
(function (root) {
  "use strict";

  // [id, label, unit, decimals for display]
  const PARAMS = [
    ["hb", "Hb", "g/dL"], ["hct", "Hct", "%"], ["rbcCount", "RBC", "×10¹²/L"], ["mcv", "MCV", "fL"], ["mch", "MCH", "pg"],
    ["mchc", "MCHC", "g/dL"], ["rdw", "RDW-CV", "%"], ["retic", "Reticulocytes", "%"],
    ["wbc", "WBC", "×10⁹/L"], ["anc", "Neutrophils", "×10⁹/L"], ["alc", "Lymphocytes", "×10⁹/L"], ["amc", "Monocytes", "×10⁹/L"],
    ["aec", "Eosinophils", "×10⁹/L"], ["abc", "Basophils", "×10⁹/L"], ["plt", "Platelets", "×10⁹/L"], ["mpv", "MPV", "fL"], ["pdw", "PDW", "fL"],
  ];
  const LABEL = Object.fromEntries(PARAMS.map(p => [p[0], p[1]])), UNIT = Object.fromEntries(PARAMS.map(p => [p[0], p[2]]));

  // Adult defaults (Dacie & Lewis 12th ed.). PDW is analyser-specific: no default.
  const ADULT = {
    M: { hb: [13.0, 17.0], hct: [40, 50], rbcCount: [4.5, 5.5] },
    F: { hb: [12.0, 15.0], hct: [36, 46], rbcCount: [3.8, 4.8] },
    both: { mcv: [83, 101], mch: [27, 32], mchc: [31.5, 34.5], rdw: [11.6, 14.0], retic: [0.5, 2.5], wbc: [4.0, 10.0], anc: [2.0, 7.0],
      alc: [1.0, 3.0], amc: [0.2, 1.0], aec: [0.02, 0.5], abc: [0.02, 0.1], plt: [150, 410], mpv: [7.5, 11.5] },
  };
  // Children (NBT, g/L converted to g/dL; Hct fraction to %). Platelets 150–450 at all ages after the neonatal period.
  // MCV/MCH defaults are given only from 6 months; under 6 months enter laboratory ranges.
  const CHILD = [
    { to: 14 / 365, name: "Newborn (0–2 weeks)", hb: [14.0, 24.0], hct: [47, 75], rbcCount: [3.7, 6.5], wbc: [10.0, 26.0], anc: [2.7, 14.4], alc: [2.0, 8.0], amc: [0, 2.0], aec: [0, 0.8], plt: [150, 450] },
    { to: 2 / 12, name: "Infant (2 weeks–2 months)", hb: [13.4, 19.8], hct: [41, 65], rbcCount: [3.2, 5.9], wbc: [6.0, 21.0], anc: [1.5, 5.4], alc: [2.8, 9.1], amc: [0.1, 1.7], aec: [0, 0.9], plt: [150, 450] },
    { to: 0.5, name: "Infant (2–6 months)", hb: [9.4, 13.0], hct: [28, 42], rbcCount: [3.1, 4.3], wbc: [5.0, 15.0], anc: [1.0, 5.0], alc: [4.0, 10.0], amc: [0.4, 1.2], aec: [0, 0.8], plt: [150, 400] },
    { to: 1, name: "Infant (6 months–1 year)", hb: [11.1, 14.1], hct: [33, 41], rbcCount: [4.1, 5.3], mcv: [70, 85], mch: [23, 29], wbc: [6.0, 17.5], anc: [1.0, 8.5], alc: [4.0, 12.0], amc: [0.2, 1.0], aec: [0, 0.8], plt: [150, 450] },
    { to: 6, name: "Child (1–6 years)", hb: [11.5, 14.0], hct: [34, 40], rbcCount: [3.9, 5.3], mcv: [71, 87], mch: [23, 30], wbc: [5.0, 17.0], anc: [1.0, 8.5], alc: [1.5, 9.5], amc: [0.2, 1.0], aec: [0, 0.8], plt: [150, 450] },
    { to: 12, name: "Child (6–12 years)", hb: [11.5, 15.5], hct: [35, 40], rbcCount: [4.0, 5.2], mcv: [73, 95], mch: [23.6, 33], wbc: [4.5, 14.5], anc: [1.0, 8.0], alc: [1.5, 7.0], amc: [0.2, 1.0], aec: [0, 1.0], plt: [150, 450] },
    { to: 18, name: "Adolescent (12–18 years)", M: { hb: [13.0, 17.0], hct: [37, 49], rbcCount: [4.5, 5.3] }, F: { hb: [12.0, 16.0], hct: [36, 46], rbcCount: [4.1, 5.1] },
      mcv: [78, 95], mch: [25, 33], wbc: [4.5, 13.0], anc: [1.5, 8.0], alc: [1.1, 4.5], amc: [0.2, 1.0], aec: [0, 0.8], plt: [150, 450] },
  ];
  // Critical (panic) limits — laboratory policy; defaults are widely used values and are editable.
  const CRITICAL = { hb: [7.0, 20.0], plt: [20, 1000], anc: [0.5, null], wbc: [1.0, 50.0] };

  // Delta-check limits (laboratory-defined in ISLH; these are common defaults): absolute or relative change vs the previous CBC.
  const DELTA = { wbc: { rel: 0.5 }, plt: { rel: 0.5 }, mcv: { abs: 3 }, hb: { abs: 2 } };
  const num = v => (v === "" || v == null || isNaN(+v)) ? null : +v;
  const fmt = v => (Math.round(v * 100) / 100).toString();
  const union = (a, b) => a && b ? [Math.min(a[0], b[0]), Math.max(a[1], b[1])] : (a || b);

  /** Reference ranges for this patient. `lab` = {M:{id:[lo,hi]}, F:{...}} adult overrides from the laboratory. */
  function ranges(s, lab) {
    const age = num(s.age), sex = s.sex === "M" || s.sex === "F" ? s.sex : null;
    let out = {}, band;
    const child = age != null && age < 18 ? CHILD.find(b => age < b.to) : null;
    if (child) {
      band = child.name;
      for (const [k, v] of Object.entries(child)) if (Array.isArray(v)) out[k] = v;
      if (child.M) for (const k of Object.keys(child.M)) out[k] = sex ? child[sex][k] : union(child.M[k], child.F[k]);
      if (age >= 0.5) { out.rdw = ADULT.both.rdw; out.mchc = ADULT.both.mchc; out.mpv = ADULT.both.mpv; out.retic = ADULT.both.retic; out.abc = ADULT.both.abc; }
      band += " — children's defaults (NBT / Dacie & Lewis)";
    } else {
      const ad = (sx) => ({ ...ADULT.both, ...ADULT[sx], ...((lab && lab.both) || {}), ...((lab && lab[sx]) || {}) });
      if (sex) out = ad(sex); else { const m = ad("M"), f = ad("F"); for (const k of Object.keys(m)) out[k] = union(m[k], f[k]); }
      band = (sex === "M" ? "Adult male" : sex === "F" ? "Adult female" : "Adult, sex not stated (combined range)") +
        (lab && (lab.M || lab.F || lab.both) ? " — laboratory ranges" : " — Dacie & Lewis defaults");
    }
    return { ranges: out, band, child: !!child, age, sex };
  }

  /** Values with absolute counts derived from % where only % was entered. */
  function values(s) {
    const v = {}; for (const [id] of PARAMS) v[id] = num(s[id]);
    const wbc = v.wbc;
    if (wbc != null) {
      if (v.amc == null && num(s.monoPct) != null) v.amc = Math.round(wbc * s.monoPct) / 100;
      if (v.abc == null && num(s.basoPct) != null) v.abc = Math.round(wbc * s.basoPct) / 100;
    }
    return v;
  }

  function anaemiaGrade(hb, age, sex) {
    if (hb == null) return null;
    const under5 = age != null && age < 5;
    if (under5 ? hb < 7 : hb < 8) return "severe";
    if (under5 ? hb < 10 : hb < 11) return "moderate";
    return "mild";
  }

  /**
   * @param s case object; @param opt {lab: adult range overrides, critical: overrides}
   * @returns {band, rows:[{id,label,unit,v,lo,hi,dir,critical}], critical:[], review:[{rule,text}], interpretation:[], derived:{}}
   */
  function evaluate(s, opt = {}) {
    const R = ranges(s, opt.lab), v = values(s), crit = { ...CRITICAL, ...(opt.critical || {}) };
    const rows = [], critical = [], review = [], interp = [], derived = {};
    for (const [id, label, unit] of PARAMS) {
      if (v[id] == null) continue;
      const r = R.ranges[id], row = { id, label, unit, v: v[id], lo: r ? r[0] : null, hi: r ? r[1] : null, dir: "", critical: false, derived: num(s[id]) == null };
      if (r) row.dir = v[id] < r[0] ? "L" : v[id] > r[1] ? "H" : "";
      const c = crit[id];
      if (c && !(R.age != null && R.age < 28 / 365) && ((c[0] != null && v[id] < c[0]) || (c[1] != null && v[id] > c[1]))) {
        row.critical = true; critical.push(`${label} ${fmt(v[id])} ${unit}`);
      }
      const pv = opt.previous && opt.previous.cbc ? num(opt.previous.cbc[id]) : null;
      if (pv != null) { row.prev = pv; row.delta = Math.round((v[id] - pv) * 100) / 100;
        const L = DELTA[id]; if (L) row.deltaFail = L.abs != null ? Math.abs(row.delta) > L.abs : pv > 0 && Math.abs(row.delta) / pv > L.rel; }
      rows.push(row);
    }
    const f = Object.fromEntries(rows.map(r => [r.id, r]));
    const low = id => f[id] && f[id].dir === "L", high = id => f[id] && f[id].dir === "H";
    // derived values
    if (v.retic != null && v.rbcCount != null) derived.reticAbs = Math.round(v.retic / 100 * v.rbcCount * 1000);   // ×10⁹/L
    if (v.retic != null && v.hct != null) derived.reticCorrected = Math.round(v.retic * v.hct / 45 * 10) / 10;
    // interpretation
    if (low("hb")) interp.push(`anaemia (${anaemiaGrade(v.hb, R.age, R.sex)}, WHO severity)`);
    if (high("hb") || high("hct")) interp.push("raised haemoglobin / haematocrit" + ((R.sex === "M" && (v.hb > 16.5 || v.hct > 49)) || (R.sex === "F" && (v.hb > 16.0 || v.hct > 48)) ? " — above the WHO-HAEM5 polycythaemia vera threshold (Hb >16.5 g/dL men, >16.0 g/dL women, or Hct >49% / >48%): exclude secondary causes; JAK2 V617F / exon 12" : ""));
    if (low("wbc")) interp.push("leucopenia"); if (high("wbc")) interp.push(v.wbc > 50 ? "marked leucocytosis (>50 ×10⁹/L): leukaemoid reaction vs CML / leukaemia — film and BCR::ABL1" : "leucocytosis");
    if (v.anc != null && low("anc")) interp.push(`neutropenia (${v.anc < 0.5 ? "severe" : v.anc < 1.0 ? "moderate" : "mild"})`);
    if (high("anc")) interp.push("neutrophilia");
    if (high("alc")) interp.push(!R.child && v.alc >= 5 ? "lymphocytosis ≥5 ×10⁹/L — if persistent, flow cytometry for a clonal B-cell population (CLL ≥5 ×10⁹/L clonal B cells)" : "lymphocytosis");
    if (low("alc")) interp.push("lymphopenia");
    if (v.amc != null && v.amc >= 0.5 && num(s.monoPct) != null && s.monoPct >= 10) interp.push("monocytosis ≥0.5 ×10⁹/L and ≥10% — if persistent ≥3 months, consider CMML (WHO-HAEM5)");
    else if (high("amc")) interp.push("monocytosis");
    if (v.aec != null && v.aec >= 1.5) interp.push("hypereosinophilia (≥1.5 ×10⁹/L) — exclude reactive causes; if persistent, PDGFRA/PDGFRB/FGFR1/JAK2/FLT3 rearrangement studies");
    else if (high("aec")) interp.push("eosinophilia");
    if (high("abc")) interp.push("basophilia — consider a myeloproliferative neoplasm (e.g. CML)");
    if (low("plt")) interp.push(`thrombocytopenia (${v.plt < 50 ? "severe" : v.plt < 100 ? "moderate" : "mild"}) — exclude platelet clumping on the film`);
    if (high("plt")) interp.push(v.plt >= 450 && !R.child ? "thrombocytosis ≥450 ×10⁹/L — if persistent and reactive causes are excluded, consider essential thrombocythaemia (JAK2 / CALR / MPL)" : "thrombocytosis");
    const cyt = [low("hb"), low("anc") || (v.anc == null && low("wbc")), low("plt")].filter(Boolean).length;
    if (cyt === 3) interp.unshift("PANCYTOPENIA — film review, reticulocytes, B12/folate; bone marrow examination if unexplained");
    else if (cyt === 2) interp.unshift("bicytopenia");
    if (low("hb") && derived.reticAbs != null && derived.reticAbs < 50) interp.push(`low reticulocyte response (absolute ${derived.reticAbs} ×10⁹/L) — hypoproliferative anaemia / inadequate marrow response`);
    if (derived.reticAbs != null && derived.reticAbs > 100) interp.push(`reticulocytosis (absolute ${derived.reticAbs} ×10⁹/L) — haemolysis or blood loss`);
    // ISLH smear-review rules (subset that can be evaluated from the data entered)
    const first = !s.priorReviewed, adult = !R.child, flags = new Set(s.anFlags || []);
    const add = (rule, text) => review.push({ rule, text });
    if (R.age != null && R.age < 28 / 365 && first) add(1, "neonate, first sample");
    if (first && v.wbc != null && (v.wbc < 4.0 || v.wbc > 30.0)) add(5, `WBC ${fmt(v.wbc)} (<4.0 or >30.0)`);
    if (first && v.plt != null && (v.plt < 100 || v.plt > 1000)) add(7, `platelets ${fmt(v.plt)} (<100 or >1000)`);
    if (first && v.hb != null && (v.hb < 7 || (R.ranges.hb && v.hb > R.ranges.hb[1] + 2))) add(9, `Hb ${fmt(v.hb)} (<7 or >2 g/dL above the upper limit) — also verify sample integrity`);
    if (first && adult && v.mcv != null && (v.mcv < 75 || v.mcv > 105)) add(10, `MCV ${fmt(v.mcv)} (<75 or >105 fL)`);
    if (v.mchc != null && R.ranges.mchc && v.mchc >= R.ranges.mchc[1] + 2) add(13, `MCHC ${fmt(v.mchc)} ≥2 above the upper limit — check lipaemia, haemolysis, agglutination, spherocytes`);
    if (v.mchc != null && v.mchc < 30 && v.mcv != null && R.ranges.mcv && v.mcv >= R.ranges.mcv[0]) add(14, `MCHC ${fmt(v.mchc)} <30 with normal/high MCV — check for IV-fluid contamination`);
    if (first && v.rdw != null && v.rdw > 22) add(15, `RDW ${fmt(v.rdw)} (>22%)`);
    if (v.wbc != null && v.anc == null && v.alc == null && !s.diffPB) add(16, "no or incomplete differential — manual differential and film review");
    if (first && v.anc != null && (v.anc < 1.0 || v.anc > 20.0)) add(17, `neutrophils ${fmt(v.anc)} (<1.0 or >20.0)`);
    if (first && v.alc != null && v.alc > (adult ? 5.0 : 7.0)) add(18, `lymphocytes ${fmt(v.alc)} (>${adult ? "5.0" : "7.0"})`);
    if (first && v.amc != null && v.amc > (adult ? 1.5 : 3.0)) add(19, `monocytes ${fmt(v.amc)} (>${adult ? "1.5" : "3.0"})`);
    if (first && v.aec != null && v.aec > 2.0) add(20, `eosinophils ${fmt(v.aec)} (>2.0)`);
    if (first && v.abc != null && v.abc > 0.5) add(21, `basophils ${fmt(v.abc)} (>0.5)`);
    if (first && (num(s.nrbc) > 0 || flags.has("nrbc"))) add(flags.has("nrbc") ? 40 : 22, "nucleated red cells — enumerate and correct the WBC if appropriate");
    if (first && derived.reticAbs != null && derived.reticAbs > 100) add(23, `absolute reticulocytes ${derived.reticAbs} (>100 ×10⁹/L)`);
    const pdays = opt.previous && opt.previous.date ? (Date.now() - new Date(opt.previous.date).getTime()) / 864e5 : null;
    const recent = pdays != null && pdays <= 3;
    if (f.wbc && f.wbc.deltaFail && recent && (v.wbc < 4.0 || v.wbc > 30.0)) add(6, `WBC delta check failed (${f.wbc.prev} → ${fmt(v.wbc)}) within 3 days`);
    if (f.plt && f.plt.deltaFail) add(8, `platelet delta check failed (${f.plt.prev} → ${fmt(v.plt)})`);
    if (f.mcv && f.mcv.deltaFail && (pdays == null || pdays <= 30)) add(12, `MCV delta check failed (${f.mcv.prev} → ${fmt(v.mcv)} fL) — verify sample identity and integrity`);
    if (flags.has("blasts") && first) add(37, "analyser blast flag");
    if (flags.has("ig") && first) add(32, "immature granulocyte flag");
    if (flags.has("atyplymph") && first) add(35, "atypical / variant lymphocyte flag");
    if (flags.has("leftshift")) add(34, "left-shift flag (follow laboratory SOP)");
    if (flags.has("rbcfrag")) add(27, "RBC fragment flag — count schistocytes");
    if (flags.has("dimorphic") && first) add(28, "dimorphic RBC flag");
    if (flags.has("pltclumps")) add(30, "platelet clump flag — check for clots; film platelet estimate; re-collect in citrate if clumps persist");
    if (flags.has("pltmpv")) add(31, "platelet / MPV flag");
    if (flags.has("wbcunrel")) add(26, "WBC unreliability flag — check sample, rerun, review scattergram");
    if (flags.has("lyseres")) add(29, "lyse-resistant RBC flag — review WBC scattergram and film");
    if (flags.has("other") && first) add(24, "other suspect flag");
    return { band: R.band, child: R.child, rows, critical, review, interpretation: interp, derived, previous: opt.previous && opt.previous.cbc ? opt.previous : null };
  }

  const ANALYSER_FLAGS = [["blasts", "Blasts?"], ["ig", "Immature granulocytes?"], ["leftshift", "Left shift?"], ["atyplymph", "Atypical / variant lymphocytes?"],
    ["nrbc", "NRBC?"], ["rbcfrag", "RBC fragments?"], ["dimorphic", "Dimorphic RBC?"], ["pltclumps", "Platelet clumps?"], ["pltmpv", "Platelet / MPV abnormal"],
    ["wbcunrel", "WBC unreliable"], ["lyseres", "Lyse-resistant RBC"], ["other", "Other suspect flag"]];

  function formSets() {
    return [
      { legend: "Full blood count (analyser)", fields: [
        ["hb", "Haemoglobin", "num", "g/dL"], ["hct", "Haematocrit", "num", "%"], ["rbcCount", "RBC count", "num", "×10¹²/L"],
        ["mcv", "MCV", "num", "fL"], ["mch", "MCH", "num", "pg"], ["mchc", "MCHC", "num", "g/dL"], ["rdw", "RDW-CV", "num", "%"], ["retic", "Reticulocytes", "num", "%"],
        ["wbc", "WBC", "num", "×10⁹/L"], ["anc", "Neutrophils (absolute)", "num", "×10⁹/L"], ["alc", "Lymphocytes (absolute)", "num", "×10⁹/L"],
        ["amc", "Monocytes (absolute)", "num", "×10⁹/L"], ["monoPct", "Monocytes", "num", "% WBC"], ["aec", "Eosinophils (absolute)", "num", "×10⁹/L"],
        ["abc", "Basophils (absolute)", "num", "×10⁹/L"], ["basoPct", "Basophils", "num", "% WBC"],
        ["plt", "Platelets", "num", "×10⁹/L"], ["mpv", "MPV", "num", "fL"], ["pdw", "PDW", "num", "fL"], ["nrbc", "Nucleated red cells", "num", "/100 WBC"],
        ["pbBlast", "PB blasts + equivalents", "num", "%"], ["pbImmMyeloidPct", "PB immature myeloid (pro-/myelo-/metamyelocytes)", "num", "%"]] },
      { legend: "Analyser flags & review", fields: [
        ["anFlags", "Analyser flags", "multi", ANALYSER_FLAGS],
        ["priorReviewed", "Film reviewed in the last 3 days with stable counts (delta check passed)", "chk"],
        ["critNotified", "Critical value communicated to (name, time, read-back)", "text", null, "e.g. Dr A. Sen, ward 4, 14:20, read back"]] },
    ];
  }

  /** Report lines: the flagged blood count, interpretation, critical values and smear-review triggers. */
  function reportLines(s, opt) {
    const E = evaluate(s, opt), L = [];
    if (!E.rows.length) return L;
    L.push(`Blood count (reference: ${E.band.split(" — ")[0]}):`);
    const parts = E.rows.map(r => {
      const tag = r.critical ? `CRITICAL ${r.dir || ""}`.trim() : r.dir;
      const ref = r.lo != null ? `${r.lo}–${r.hi}` : "no reference range";
      return `${r.label} ${fmt(r.v)} ${r.unit}${r.derived ? " (calculated)" : ""}${tag ? ` [${tag}; ${ref}]` : ` [${ref}]`}`;
    });
    L.push("  " + parts.join("; "));
    const ch = E.rows.filter(r => r.prev != null);
    if (ch.length) { const d = E.previous.date ? new Date(E.previous.date).toLocaleDateString("en-GB") : "";
      L.push(`  Previous CBC${E.previous.lab_no ? " " + E.previous.lab_no : ""}${d ? " (" + d + ")" : ""}: ` + ch.map(r => `${r.label} ${fmt(r.prev)} → ${fmt(r.v)}${r.deltaFail ? " (delta check failed)" : ""}`).join("; ")); }
    if (E.derived.reticAbs != null) L.push(`  Absolute reticulocytes ${E.derived.reticAbs} ×10⁹/L${E.derived.reticCorrected != null ? `; corrected reticulocyte count ${E.derived.reticCorrected}%` : ""}`);
    if (E.interpretation.length) L.push("CBC interpretation: " + E.interpretation.join("; ") + ".");
    if (E.critical.length) L.push(`CRITICAL VALUE${E.critical.length > 1 ? "S" : ""}: ${E.critical.join("; ")} — ` + (s.critNotified ? `communicated to ${s.critNotified}.` : "clinician to be informed immediately (record name, time and read-back)."));
    if (E.review.length) L.push(`Film review triggered by ISLH consensus rule${E.review.length > 1 ? "s" : ""} ${E.review.map(r => r.rule).join(", ")}.`);
    return L;
  }


  /* Reads a pasted analyser printout or LIS text (Sysmex / Mindray / Horiba / Beckman style "KEY value unit" lines).
     Converts common unit variants: Hb g/L → g/dL, Hct fraction → %, counts per µL → ×10⁹/L. */
  const ALIASES = [
    ["mchc", ["MCHC"]], ["mch", ["MCH"]], ["mcv", ["MCV"]], ["rdw", ["RDW-CV", "RDW CV", "RDW"]], ["mpv", ["MPV"]], ["pdw", ["PDW"]],
    ["hb", ["HGB", "HB", "HAEMOGLOBIN", "HEMOGLOBIN"]], ["hct", ["HCT", "PCV", "HAEMATOCRIT", "HEMATOCRIT"]], ["rbcCount", ["RBC"]],
    ["wbc", ["WBC", "TLC", "TOTAL LEUCOCYTE COUNT", "TOTAL LEUKOCYTE COUNT"]], ["plt", ["PLT", "PLATELETS", "PLATELET COUNT", "PLATELET"]],
    ["anc", ["NEUT#", "NEU#", "NE#", "ANC", "NEUTROPHILS#"]], ["alc", ["LYMPH#", "LYM#", "LY#", "ALC"]], ["amc", ["MONO#", "MON#", "MO#"]],
    ["aec", ["EO#", "EOS#", "AEC"]], ["abc", ["BASO#", "BAS#", "BA#"]], ["monoPct", ["MONO%", "MON%", "MO%"]], ["basoPct", ["BASO%", "BAS%", "BA%"]],
    ["neutPct", ["NEUT%", "NEU%", "NE%"]], ["lymphPct", ["LYMPH%", "LYM%", "LY%"]], ["eosPct", ["EO%", "EOS%"]],
    ["retic", ["RET%", "RETIC%", "RETIC", "RETICULOCYTES"]], ["nrbc", ["NRBC/100WBC", "NRBC%", "NRBC"]],
  ];
  function parseAnalyser(text) {
    const out = {}, seen = [];
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.toUpperCase();
      for (const [id, keys] of ALIASES) {
        if (out[id] != null) continue;
        const k = keys.find(k => { const re = new RegExp("^\\s*" + k.replace(/[#%/\-]/g, m => "\\" + m) + "(?![A-Z0-9%#])"); return re.test(line); });
        if (!k) continue;
        const rest = line.slice(line.indexOf(k) + k.length).replace(/\d{1,3}(?:,\d{2})*,\d{3}(?![\d,])/g, g => g.replace(/,/g, ""));   // 2,10,000 / 210,000
        const m = rest.match(/-?\d+(?:[.,]\d+)?/);
        if (!m) continue;
        out[id] = +m[0].replace(",", "."); seen.push(id); break;
      }
    }
    if (out.hb != null && out.hb > 30) out.hb = Math.round(out.hb) / 10;               // g/L
    if (out.mchc != null && out.mchc > 100) out.mchc = Math.round(out.mchc) / 10;       // g/L
    if (out.hct != null && out.hct < 1) out.hct = Math.round(out.hct * 1000) / 10;      // L/L
    for (const id of ["wbc", "anc", "alc", "amc", "aec", "abc"]) if (out[id] != null && out[id] > 1000) out[id] = Math.round(out[id] / 10) / 100;   // /µL
    if (out.plt != null && out.plt > 5000) out.plt = Math.round(out.plt / 1000);       // /µL
    if (out.wbc != null) {
      const abs = (pct, id) => { if (out[id] == null && out[pct] != null) out[id] = Math.round(out.wbc * out[pct]) / 100; };
      abs("neutPct", "anc"); abs("lymphPct", "alc"); abs("eosPct", "aec");
    }
    for (const t of ["neutPct", "lymphPct", "eosPct"]) delete out[t];
    return out;
  }

  const API = { parseAnalyser, DELTA, PARAMS, ADULT, CHILD, CRITICAL, ANALYSER_FLAGS, ranges, values, evaluate, formSets, reportLines, anaemiaGrade, LABEL, UNIT };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.HAEM5CBC = API;
})(typeof window !== "undefined" ? window : globalThis);
