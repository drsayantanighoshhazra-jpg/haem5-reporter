// Tests for the red-cell module: node frontend/src/test_rbc.js
const R = require("./rbc_morph.js");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
// ICSH grading thresholds
ok(R.gradeFromPct("schisto", 0.5) === "1+", "schisto 0.5 → 1+");
ok(R.gradeFromPct("schisto", 1) === "2+", "schisto 1 → 2+");
ok(R.gradeFromPct("schisto", 2.5) === "3+", "schisto 2.5 → 3+");
ok(R.gradeFromPct("target", 4) === "", "target 4 → none");
ok(R.gradeFromPct("target", 5) === "2+", "target 5 → 2+");
ok(R.gradeFromPct("target", 25) === "3+", "target 25 → 3+");
ok(R.gradeFromPct("micro", 15) === "2+", "micro 15 → 2+");
ok(R.gradeFromPct("sickle", 1) === "2+" && R.gradeFromPct("sickle", 3) === "3+", "sickle");
ok(R.gradeFromPct("hj", 2) === "2+", "HJ 2 → 2+");
// indices
let ix = R.describeIndices({ mcv: 68, mch: 21, rbcCount: 5.6, rdw: 13.5 });
ok(ix.size === "microcytic" && ix.chrom === "hypochromic" && ix.mentzer === 12.1 && !ix.rdwHigh, "thal trait indices " + JSON.stringify(ix));
ix = R.describeIndices({ mcv: 112, mch: 35 }); ok(ix.size === "macrocytic", "macrocytic");
ix = R.describeIndices({ mcv: 90, mch: 30, age: 5 }); ok(ix.child && /age-specific/.test(ix.text), "child note");
ok(R.describeIndices({}) === null, "no indices");
// alerts
const has = (s, re) => R.alerts(s).some(a => re.test(a.text));
ok(has({ schistoPct: 1.5 }, /thrombotic microangiopathy/), "TMA alert");
ok(!has({ schistoPct: 0.5 }, /thrombotic/), "no TMA <1%");
ok(R.alerts({ schistoPct: 3 })[0].level === "urgent", "TMA urgent");
ok(has({ rbcG_teardrop: "2+", leukoerythro: true }, /primary myelofibrosis/), "teardrop + LE → fibrosis");
ok(has({ rbcG_teardrop: "2+" }, /thalassaemia or megaloblastic/), "teardrop alone");
ok(has({ rbcP_rouleaux: true }, /paraprotein/), "rouleaux → paraprotein");
ok(has({ mcv: 70, mch: 22, rbcCount: 4.0 }, /Mentzer index 17.5 \(≥13 favours iron deficiency\)/), "Mentzer IDA");
ok(has({ rbcG_sickle: "2+" }, /HPLC/), "sickle");
ok(has({ rbcG_sphero: "3+" }, /DAT/), "spherocytes");
ok(has({ parasites: "P. vivax" }, /Parasites/), "parasites");
ok(R.alerts({ mcv: 90, mch: 30 }).length === 0, "normal → no alerts");
// report lines
const L = R.reportLines({ mcv: 92, mch: 30, rdw: 13, rbcG_target: "2+", schistoPct: 1.2, rbcP_rouleaux: true, nrbc: 3, rbcMorph: "occasional fragments" });
const txt = L.join("\n");
ok(/normocytic normochromic indices/.test(txt), "indices line");
ok(/schistocytes 1.2% \(2\+\); target cells 2\+; rouleaux/.test(txt), "features line: " + txt);
ok(/Nucleated red cells: 3\/100 WBC/.test(txt), "nrbc");
ok(/Red cells: occasional fragments/.test(txt), "free text kept");
ok(/URGENT — Schistocytes 1.2%/.test(txt), "urgent line");
ok(R.reportLines({}).length === 0, "empty case → no lines");
ok(!/poikilocytosis/.test(R.reportLines({ mcv: 90, mch: 30 }).join()), "no unreviewed morphology claim");
// AI counts → grades (size/colour classes are left to MCV/MCH)
ok(!("rbcG_macro" in R.gradesFromCounts({ normal: 60, macrocyte: 40 })), "macrocytes not graded from images");
const g = R.gradesFromCounts({ normal: 80, target_cell: 10, schistocyte: 2, spherocyte: 1, microcyte: 7 });
ok(g.rbcG_target === "2+" && g.schistoPct === 2 && g.rbcG_sphero === "" && !("rbcG_micro" in g), "grades from counts " + JSON.stringify(g));
ok(R.formSets().length === 1 && R.formSets()[0].fields.length === 1 + R.GRADED.length + R.PRESENT.length + 1, "form sets");
// malaria screen rule
ok(!R.malariaSuspicious({ n: 600, pos: 6, spec: 0.98 }), "1% flagged with 2% FPR → not suspicious");
ok(R.malariaSuspicious({ n: 600, pos: 30, spec: 0.98 }), "5% flagged → suspicious");
ok(!R.malariaSuspicious({ n: 600, pos: 2, spec: 0.99 }), "<3 cells → not suspicious");
ok(!R.malariaSuspicious({ n: 300, pos: 60, spec: 0.98 }) && !R.malariaComplete({ n: 300 }), "<500 cells → incomplete, never suspicious");
ok(/incomplete/.test(R.reportLines({ malariaAI: { n: 200, pos: 1, spec: 0.98 } }).join()), "incomplete report line");
ok(R.alerts({ malariaAI: { n: 700, pos: 50, spec: 0.97 } }).some(a => a.level === "urgent" && /malaria/.test(a.text)), "malaria alert");
console.log(`${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);
