// Tests for CBC flagging: node frontend/src/test_cbc.js
const C = require("./cbc_flags.js");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const row = (E, id) => E.rows.find(r => r.id === id);
const rules = E => E.review.map(r => r.rule);

// ranges by age/sex
ok(C.ranges({ age: 40, sex: "F" }).ranges.hb.join() === "12,15", "adult F Hb");
ok(C.ranges({ age: 40, sex: "M" }).ranges.hb.join() === "13,17", "adult M Hb");
ok(C.ranges({ age: 40 }).ranges.hb.join() === "12,17", "adult unknown sex → combined");
ok(C.ranges({ age: 0.01 }).band.startsWith("Newborn"), "newborn band");
ok(C.ranges({ age: 0.3 }).ranges.hb.join() === "9.4,13", "2–6 months Hb");
ok(C.ranges({ age: 0.3 }).ranges.mcv === undefined, "no MCV default <6 months");
ok(C.ranges({ age: 4 }).ranges.alc.join() === "1.5,9.5", "child lymphs");
ok(C.ranges({ age: 15, sex: "F" }).ranges.hb.join() === "12,16", "adolescent F");
ok(C.ranges({ age: 40, sex: "F" }, { F: { hb: [11.5, 15.5] } }).ranges.hb.join() === "11.5,15.5", "lab override");
ok(/laboratory ranges/.test(C.ranges({ age: 40, sex: "F" }, { F: { hb: [11.5, 15.5] } }).band), "lab band label");

// flags
let E = C.evaluate({ age: 60, sex: "F", hb: 7.8, wbc: 2.9, anc: 0.9, plt: 54, mcv: 104, monoPct: 7 });
ok(row(E, "hb").dir === "L" && row(E, "plt").dir === "L" && row(E, "anc").dir === "L", "low flags");
ok(row(E, "amc").derived && Math.abs(row(E, "amc").v - 0.2) < 0.01, "monocytes derived from %");
ok(E.interpretation[0].startsWith("PANCYTOPENIA"), "pancytopenia first: " + E.interpretation[0]);
ok(E.interpretation.some(x => x === "anaemia (severe, WHO severity)"), "anaemia severe (<8)");
ok(E.interpretation.some(x => x.startsWith("neutropenia (moderate)")), "neutropenia moderate");
ok(E.interpretation.some(x => x.startsWith("thrombocytopenia (moderate)")), "thrombocytopenia moderate");
ok([5, 7, 17].every(r => rules(E).includes(r)), "ISLH 5,7,17: " + rules(E));
ok(E.critical.length === 0, "no criticals");
ok(rules(E).includes(10) === false, "MCV 104 not rule 10");
E = C.evaluate({ age: 60, sex: "F", hb: 7.8, mcv: 106 }); ok(rules(E).includes(10), "MCV 106 → rule 10");

// critical values
E = C.evaluate({ age: 50, sex: "M", hb: 6.2, plt: 12, anc: 0.3, wbc: 0.8 });
ok(E.critical.length === 4 && row(E, "hb").critical, "four criticals " + E.critical);
ok(/CRITICAL VALUES: Hb 6.2 g\/dL/.test(C.reportLines({ age: 50, sex: "M", hb: 6.2, plt: 12 }).join("\n")), "critical line");
ok(/communicated to Dr X 14:20/.test(C.reportLines({ age: 50, sex: "M", hb: 6.2, critNotified: "Dr X 14:20" }).join("\n")), "critical communicated");
ok(C.evaluate({ age: 0.01, hb: 6.5 }).critical.length === 0, "no adult criticals for neonate");
ok(C.evaluate({ age: 8, plt: 15 }).critical.length === 1, "child platelet critical");
E = C.evaluate({ age: 50, sex: "M", wbc: 85, anc: 60 });
ok(E.critical.length === 1 && E.interpretation.some(x => /leukaemoid reaction vs CML/.test(x)), "WBC 85");

// interpretation thresholds
ok(C.evaluate({ age: 50, sex: "M", hb: 17.2 }).interpretation.some(x => /polycythaemia vera threshold/.test(x)), "PV threshold");
ok(C.evaluate({ age: 50, sex: "F", aec: 2.1 }).interpretation.some(x => /hypereosinophilia/.test(x)), "HE");
ok(C.evaluate({ age: 50, sex: "F", amc: 1.2, monoPct: 15, wbc: 8 }).interpretation.some(x => /CMML/.test(x)), "CMML hint");
ok(C.evaluate({ age: 50, sex: "F", plt: 620 }).interpretation.some(x => /essential thrombocythaemia/.test(x)), "ET hint");
ok(C.evaluate({ age: 50, sex: "F", alc: 7.5 }).interpretation.some(x => /CLL/.test(x)), "CLL hint");
ok(C.evaluate({ age: 3, sex: "F", alc: 7.5 }).rows.find(r => r.id === "alc").dir === "", "child lymphs 7.5 normal");
ok(C.anaemiaGrade(6.5, 3) === "severe" && C.anaemiaGrade(7.5, 3) === "moderate" && C.anaemiaGrade(7.5, 30) === "severe", "WHO grades");

// derived reticulocytes
E = C.evaluate({ age: 30, sex: "F", retic: 5, rbcCount: 3.0, hct: 27 });
ok(E.derived.reticAbs === 150 && E.derived.reticCorrected === 3, "retic abs/corrected " + JSON.stringify(E.derived));
ok(rules(E).includes(23) && E.interpretation.some(x => /reticulocytosis/.test(x)), "retic rule 23");

ok(C.evaluate({ age: 60, sex: "M", hb: 7.8, retic: 0.4, rbcCount: 2.3 }).interpretation.some(x => /hypoproliferative/.test(x)), "low retic response");
// ISLH rules from flags and delta
E = C.evaluate({ age: 30, sex: "F", wbc: 12, anc: 8, anFlags: ["blasts", "pltclumps", "nrbc"] });
ok([37, 30, 40].every(r => rules(E).includes(r)), "flag rules " + rules(E));
E = C.evaluate({ age: 30, sex: "F", wbc: 2, anc: 0.5, anFlags: ["blasts", "pltclumps"], priorReviewed: true });
ok(!rules(E).includes(5) && !rules(E).includes(37) && rules(E).includes(30), "prior review suppresses first-time rules");
ok(rules(C.evaluate({ age: 30, wbc: 8 })).includes(16), "rule 16 incomplete diff");
ok(rules(C.evaluate({ age: 0.02, wbc: 15 })).includes(1), "rule 1 neonate");
ok(rules(C.evaluate({ age: 30, sex: "M", mchc: 37.5 })).includes(13), "rule 13 MCHC");
ok(rules(C.evaluate({ age: 30, sex: "M", hb: 19.5 })).includes(9), "rule 9 Hb > ULN+2");

// delta checks
const prev = { lab_no: "PBS/1", date: new Date(Date.now() - 864e5).toISOString(), cbc: { hb: 11.2, plt: 210, mcv: 88, wbc: 6.5 } };
E = C.evaluate({ age: 50, sex: "F", hb: 8.0, plt: 90, mcv: 95, wbc: 2.5 }, { previous: prev });
ok(row(E, "hb").deltaFail && row(E, "plt").deltaFail && row(E, "mcv").deltaFail && row(E, "wbc").deltaFail, "delta fails");
ok([6, 8, 12].every(r => rules(E).includes(r)), "ISLH delta rules 6, 8, 12: " + rules(E));
ok(/Previous CBC PBS\/1 .*Hb 11.2 → 8 \(delta check failed\)/.test(C.reportLines({ age: 50, sex: "F", hb: 8.0 }, { previous: prev }).join("\n")), "previous line");
E = C.evaluate({ age: 50, sex: "F", hb: 11.0, plt: 200 }, { previous: prev });
ok(!row(E, "hb").deltaFail && !row(E, "plt").deltaFail, "stable values pass delta");
// analyser paste import
const sysmex = `WBC 2.90 10^3/uL\nRBC 2.30 10^6/uL\nHGB 78 g/L\nHCT 0.236 L/L\nMCV 104.0 fL\nMCH 34.0 pg\nMCHC 330 g/L\nPLT 54 10^3/uL\nRDW-CV 17.5 %\nPDW 15.2 fL\nMPV 12.1 fL\nNEUT# 0.90\nLYMPH# 1.70\nMONO% 7.0\nEO% 2.0\nBASO# 0.02\nRET% 0.4`;
const P = C.parseAnalyser(sysmex);
ok(P.hb === 7.8 && P.hct === 23.6 && P.mchc === 33 && P.mch === 34 && P.mcv === 104 && P.rdw === 17.5, "units + MCH/MCHC " + JSON.stringify(P));
ok(P.wbc === 2.9 && P.anc === 0.9 && P.alc === 1.7 && P.monoPct === 7 && P.aec === 0.06 && P.abc === 0.02 && P.plt === 54 && P.retic === 0.4 && P.pdw === 15.2, "counts " + JSON.stringify(P));
const P2 = C.parseAnalyser("Haemoglobin: 11.4 g/dL\nTLC 7400 /cumm\nPlatelet count 2,10,000"); 
ok(P2.hb === 11.4 && P2.wbc === 7.4 && P2.plt === 210, "Indian-style labels " + JSON.stringify(P2));
// report
const L = C.reportLines({ age: 60, sex: "F", hb: 7.8, wbc: 2.9, anc: 0.9, plt: 54 }).join("\n");
ok(/Blood count \(reference: Adult female\)/.test(L) && /Hb 7.8 g\/dL \[L; 12–15\]/.test(L), "report rows: " + L);
ok(/CBC interpretation: PANCYTOPENIA/.test(L) && /ISLH consensus rules 5, 7, 17/.test(L), "report interp + rules");
ok(C.reportLines({}).length === 0, "empty");
ok(C.formSets()[0].fields.length === 22, "form fields");
console.log(`${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);
