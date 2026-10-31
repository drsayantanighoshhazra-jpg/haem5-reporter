/* Red cell indices interpretation, ICSH red-cell morphology grading and report text.
   Grading: Palmer L et al. ICSH recommendations for the standardization of nomenclature and grading of
   peripheral blood cell morphological features. Int J Lab Hematol 2015;37:287–303.
   Schistocytes: Zini G et al. ICSH 2021 update on schistocyte counting. Int J Lab Hematol 2021;43:1264–71.
   Pure functions on the case object, so they run in the browser and in tests. */
(function (root) {
  "use strict";

  // [id, label, 2+ range, 3+ threshold (% of red cells), model class that suggests it]
  const GRADED = [
    ["aniso", "Anisocytosis", [11, 20], 20, null],
    ["macro", "Macrocytes", [11, 20], 20, "macrocyte"],
    ["ovalMacro", "Oval macrocytes", [2, 5], 5, null],
    ["micro", "Microcytes", [11, 20], 20, "microcyte"],
    ["hypo", "Hypochromic cells", [11, 20], 20, "hypochromia"],
    ["poly", "Polychromasia", [5, 20], 20, null],
    ["target", "Target cells", [5, 20], 20, "target_cell"],
    ["sphero", "Spherocytes", [5, 20], 20, "spherocyte"],
    ["ellipto", "Elliptocytes", [5, 20], 20, "elliptocyte"],
    ["ovalo", "Ovalocytes", [5, 20], 20, "ovalocyte"],
    ["teardrop", "Teardrop cells (dacrocytes)", [5, 20], 20, "teardrop"],
    ["stomato", "Stomatocytes", [5, 20], 20, "stomatocyte"],
    ["echino", "Echinocytes (burr cells)", [5, 20], 20, "burr_cell"],
    ["acantho", "Acanthocytes", [5, 20], 20, null],
    ["sickle", "Sickle cells", [1, 2], 2, null],
    ["bite", "Bite / blister cells", [1, 2], 2, null],
    ["irregContracted", "Irregularly contracted cells", [1, 2], 2, null],
    ["stippling", "Basophilic stippling", [5, 20], 20, null],
    ["hj", "Howell–Jolly bodies", [2, 3], 3, null],
    ["pappen", "Pappenheimer bodies", [2, 3], 3, null],
  ];
  const FROM_INDICES = new Set(["macro", "micro", "hypo"]);
  const PRESENT = [["rouleaux", "Rouleaux"], ["agglut", "Red cell agglutination"], ["dimorphic", "Dimorphic red cell picture"], ["crystals", "Haemoglobin C / SC crystals"]];
  const RBC_CLASSES = ["normal", "macrocyte", "microcyte", "spherocyte", "target_cell", "stomatocyte", "ovalocyte", "teardrop", "burr_cell", "schistocyte", "hypochromia", "elliptocyte"];

  const num = v => (v === "" || v == null || isNaN(+v)) ? null : +v;
  const gradeKey = id => "rbcG_" + id;

  /** ICSH grade from a percentage ("" below the 2+ range). Schistocytes are the only feature with 1+. */
  function gradeFromPct(id, pct) {
    if (pct == null) return "";
    if (id === "schisto") return pct > 2 ? "3+" : pct >= 1 ? "2+" : pct > 0 ? "1+" : "";
    const f = GRADED.find(g => g[0] === id); if (!f) return "";
    return pct > f[3] ? "3+" : pct >= f[2][0] ? "2+" : "";
  }

  function gradeOptions(id) {
    const f = GRADED.find(g => g[0] === id);
    return [["", "—"], ["2+", `2+ moderate (${f[2][0]}–${f[2][1]}%)`], ["3+", `3+ many (>${f[3]}%)`]];
  }

  /** Form definitions for the workbench (field arrays in the app's [id, label, type, opt, hint] format). */
  function formSets() {
    return [
      { legend: "Red cell morphology — ICSH grading", fields: [
        ["schistoPct", "Schistocytes", "num", "% of red cells", "ICSH 2021: count ≥1000 red cells; ≥1% is significant in adults"],
        ...GRADED.map(([id, label]) => [gradeKey(id), label, "sel", gradeOptions(id)]),
        ...PRESENT.map(([id, label]) => ["rbcP_" + id, label, "chk"]),
        ["parasites", "Parasites", "text", null, "e.g. P. falciparum ring forms, parasitaemia 2%"]] },
    ];
  }

  /** Describes the indices with adult reference limits (MCV 80–100 fL, MCH ≥27 pg, RDW ≤14.5%). */
  function describeIndices(s) {
    const mcv = num(s.mcv), mch = num(s.mch), rdw = num(s.rdw), rbc = num(s.rbcCount), age = num(s.age), retic = num(s.retic);
    if (mcv == null && mch == null) return null;
    const child = age != null && age < 12;
    const size = mcv == null ? null : mcv < 80 ? "microcytic" : mcv > 100 ? "macrocytic" : "normocytic";
    const chrom = mch == null ? null : mch < 27 ? "hypochromic" : "normochromic";
    const out = { size, chrom, child, text: [size, chrom].filter(Boolean).join(" ") + " indices" + (child ? " (by adult limits; use age-specific reference ranges)" : "") };
    if (rdw != null) out.rdwHigh = rdw > 14.5;
    if (mcv != null && rbc) out.mentzer = Math.round(mcv / rbc * 10) / 10;
    if (retic != null) out.reticHigh = retic > 2.5;
    return out;
  }

  function featureList(s) {
    const L = [];
    const sp = num(s.schistoPct); if (sp != null && sp > 0) L.push(`schistocytes ${sp}% (${gradeFromPct("schisto", sp)})`);
    for (const [id, label] of GRADED) { const g = s[gradeKey(id)]; if (g) L.push(`${label.toLowerCase()} ${g}`); }
    for (const [id, label] of PRESENT) if (s["rbcP_" + id]) L.push(label.toLowerCase());
    return L;
  }

  /** AI malaria screen. Validated on 8,587 non-malaria red cells (1.3% flagged per cell): judging a slide only after
      ≥500 cells and ≥3 flagged cells at ≥2× the model's false-positive rate (1 − test specificity) gave ~0.4% false
      "suspicious" slides. Fewer than 500 cells = incomplete screen. Default false-positive rate 2% if unknown. */
  const MAL_MIN_CELLS = 500;
  function malariaSuspicious(m) {
    if (!m || !m.n || m.n < MAL_MIN_CELLS) return false;
    const fpr = m.spec != null ? 1 - m.spec : 0.02;
    return m.pos >= 3 && m.pos / m.n >= 2 * fpr;
  }
  const malariaComplete = m => !!(m && m.n >= MAL_MIN_CELLS);

  /** Clinical alerts raised by the red cell findings. Suggestions for the pathologist, not diagnoses. */
  function alerts(s) {
    const A = [], g = id => s[gradeKey(id)] || "", ge2 = id => g(id) === "2+" || g(id) === "3+";
    const sp = num(s.schistoPct), ix = describeIndices(s) || {};
    if (sp != null && sp >= 1) A.push({ level: "urgent", text: `Schistocytes ${sp}% (≥1%): consider thrombotic microangiopathy / MAHA. Correlate urgently with platelet count, LDH, haptoglobin, reticulocytes, DAT, renal function and ADAMTS13.` });
    if (g("sickle")) A.push({ level: "high", text: "Sickle cells seen: haemoglobin HPLC / electrophoresis and sickling test." });
    if (ge2("sphero")) A.push({ level: "info", text: "Spherocytes: consider immune haemolysis or hereditary spherocytosis — DAT, reticulocytes, bilirubin, EMA-binding test." });
    if (ge2("teardrop") && (s.leukoerythro || num(s.nrbc) > 0 || s.splenomegaly)) A.push({ level: "high", text: "Teardrop cells with a leukoerythroblastic picture or splenomegaly: consider marrow fibrosis or infiltration (e.g. primary myelofibrosis) — trephine biopsy with reticulin stain." });
    else if (ge2("teardrop")) A.push({ level: "info", text: "Teardrop cells: consider marrow fibrosis/infiltration, thalassaemia or megaloblastic anaemia." });
    if (s.rbcP_rouleaux) A.push({ level: "info", text: "Rouleaux: consider a paraprotein — serum protein electrophoresis, immunofixation and serum free light chains." });
    if (s.rbcP_agglut) A.push({ level: "info", text: "Agglutination: consider cold agglutinins — warm the sample and repeat the count; DAT (C3d)." });
    if (s.rbcP_dimorphic) A.push({ level: "info", text: "Dimorphic picture: consider recent transfusion, treated deficiency or sideroblastic anaemia / MDS with ring sideroblasts (Perls stain)." });
    if (ix.size === "microcytic") A.push({ level: "info", text: "Microcytic indices: iron deficiency vs thalassaemia trait — ferritin and Hb HPLC." + (ix.mentzer != null ? ` Mentzer index ${ix.mentzer} (${ix.mentzer < 13 ? "<13 favours thalassaemia trait" : "≥13 favours iron deficiency"}).` : "") });
    if (ix.size === "macrocytic" || ge2("ovalMacro")) A.push({ level: "info", text: "Macrocytosis: vitamin B12/folate, reticulocytes, liver and thyroid function; if cytopenias are unexplained, consider MDS." });
    if (ge2("stippling")) A.push({ level: "info", text: "Basophilic stippling: consider thalassaemia, lead exposure or dyserythropoiesis (MDS)." });
    if (ge2("hj")) A.push({ level: "info", text: "Howell–Jolly bodies: consider hyposplenism / splenectomy." });
    if (ge2("pappen")) A.push({ level: "info", text: "Pappenheimer bodies: confirm siderotic granules with Perls stain; consider sideroblastic anaemia or hyposplenism." });
    if (ge2("target")) A.push({ level: "info", text: "Target cells: consider haemoglobinopathy (Hb HPLC), liver disease or hyposplenism." });
    if (ge2("poly") || ix.reticHigh) A.push({ level: "info", text: "Polychromasia / reticulocytosis: marrow response to haemolysis or blood loss." });
    if (malariaSuspicious(s.malariaAI)) A.push({ level: "urgent", text: `AI malaria screen suspicious (${s.malariaAI.pos}/${s.malariaAI.n} red cells flagged): examine thick and thin films, confirm species and parasitaemia by microscopy before reporting.` });
    if (s.parasites) A.push({ level: "urgent", text: "Parasites reported: notify the clinician urgently; confirm species and parasitaemia on thick and thin films." });
    return A;
  }

  /** Report lines for the peripheral smear section. */
  function reportLines(s) {
    const L = [], ix = describeIndices(s);
    if (ix) L.push("Red cell indices: " + ix.text + (ix.rdwHigh ? ", raised RDW" : "") + (ix.mentzer != null && ix.size === "microcytic" ? `; Mentzer index ${ix.mentzer}` : "") + ".");
    const f = featureList(s);
    if (f.length) L.push("Red cell morphology (ICSH grading): " + f.join("; ") + ".");
    if (s.rbcMorph) L.push("Red cells: " + s.rbcMorph);
    if (num(s.nrbc) > 0) L.push(`Nucleated red cells: ${s.nrbc}/100 WBC.`);
    if (s.parasites) L.push("Parasites: " + s.parasites);
    if (s.malariaAI && s.malariaAI.n) L.push(`Malaria AI screen: ${s.malariaAI.pos}/${s.malariaAI.n} red cells flagged (${!malariaComplete(s.malariaAI) ? `incomplete — fewer than ${MAL_MIN_CELLS} red cells analysed` : malariaSuspicious(s.malariaAI) ? "suspicious — microscopy confirmation required" : "not suspicious; a negative screen does not exclude malaria, especially at low parasitaemia"}).`);
    if (s.rbcAI && s.rbcAI.n) L.push(`Method: ${s.rbcAI.n} red cells classified with AI assistance; grades reviewed by the reporting pathologist.`);
    const A = alerts(s); if (A.length) L.push(...A.map(a => (a.level === "urgent" ? "URGENT — " : "Note: ") + a.text));
    return L;
  }

  /** Converts AI red-cell counts into suggested grades: {gradeKey: grade, schistoPct}. */
  function gradesFromCounts(counts) {
    const n = Object.values(counts || {}).reduce((a, b) => a + b, 0); if (!n) return {};
    const pct = c => 100 * (counts[c] || 0) / n, out = {};
    out.schistoPct = Math.round(pct("schistocyte") * 10) / 10;
    // Size and haemoglobinisation are graded from MCV / MCH, not from the image: ICSH prefers analyser indices,
    // and the trained model's precision for macrocytes, microcytes and hypochromic cells is low (0.47–0.68).
    for (const [id, , , , cls] of GRADED) if (cls && !FROM_INDICES.has(id)) out[gradeKey(id)] = gradeFromPct(id, pct(cls));
    return out;
  }

  const API = { malariaSuspicious, malariaComplete, MAL_MIN_CELLS, FROM_INDICES, GRADED, PRESENT, RBC_CLASSES, formSets, gradeFromPct, describeIndices, featureList, alerts, reportLines, gradesFromCounts, gradeKey };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.HAEM5RBC = API;
})(typeof window !== "undefined" ? window : globalThis);
