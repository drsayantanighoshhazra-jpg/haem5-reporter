const H = require('./haem5_engine.js');
const cases = [
 ["APL", {pbBlast:5,bmBlast:60,fusions:["PML::RARA"]}, /promyelocytic/],
 ["NPM1 low blast", {pbBlast:2,bmBlast:12,npm1:true,hb:9,sex:"F"}, /NPM1/],
 ["AML-MR by ASXL1", {pbBlast:30,bmBlast:35,mrGenes:["ASXL1"],flowLineage:"myeloid"}, /myelodysplasia-related/],
 ["AML-MR by history", {bmBlast:25,hxMDS:true}, /myelodysplasia-related/],
 ["CEBPA", {bmBlast:40,cebpa:true}, /CEBPA/],
 ["CEBPA <20 -> not AML", {bmBlast:12,cebpa:true,hb:8,sex:"M",dysGran:true}, /MDS with increased blasts-2/],
 ["AML with maturation", {bmBlast:30,mpoPos:"yes",bmMaturingGranPct:25,bmMonocyticPct:5,flowLineage:"myeloid",geneticsDone:true}, /AML with maturation/],
 ["Acute monocytic", {bmBlast:50,bmMonocyticPct:85,bmMaturingGranPct:5,flowLineage:"myeloid",geneticsDone:true}, /Acute monocytic/],
 ["AEL", {bmBlast:8,bmErythroidPct:85,proEryPct:40,tp53Count:2,cyto:["complex"]}, /Acute erythroid/],
 ["MDS-5q", {pbBlast:0,bmBlast:2,hb:8.5,sex:"F",plt:400,cyto:["del5q"],del5qOthers:0,dysMega:true}, /MDS-5q/],
 ["MDS-SF3B1", {pbBlast:0,bmBlast:1,hb:9,sex:"M",sf3b1VAF:35,dysEry:true,ringSid:30}, /MDS-SF3B1/],
 ["MDS-biTP53", {bmBlast:8,hb:8,sex:"M",tp53Count:1,tp53VAF:62,cyto:["complex"]}, /biTP53/],
 ["MDS-IB1", {pbBlast:1,bmBlast:7,anc:1.0,dysGran:true}, /IB1/],
 ["MDS-IB2 Auer", {pbBlast:1,bmBlast:6,anc:1.0,dysGran:true,auer:true}, /IB2/],
 ["MDS-f", {pbBlast:3,bmBlast:8,plt:60,dysMega:true,fibrosis:3}, /MDS-f/],
 ["MDS-h", {pbBlast:0,bmBlast:1,plt:60,dysMega:true,bmCellularity:15,age:60}, /MDS-h/],
 ["MDS-LB", {pbBlast:0,bmBlast:2,hb:10,sex:"F",dysEry:true}, /MDS-LB/],
 ["Child MDS", {age:10,pbBlast:0,bmBlast:2,plt:50,dysMega:true,bmCellularity:20}, /cMDS-LB.*hypocellular/],
 ["CMML", {wbc:9,amc:2.1,monoPct:23,pbBlast:1,bmBlast:4,dysGran:true,mrGenes:["SRSF2"],hb:10,sex:"M"}, /Chronic myelomonocytic/],
 ["CMML low mono needs both", {wbc:6,amc:0.7,monoPct:12,pbBlast:0,bmBlast:3,dysGran:true,hb:10,sex:"M"}, /Chronic myelomonocytic/, "probable"],
 ["CML CP", {wbc:120,pbBlast:3,bmBlast:4,fusions:["BCR::ABL1"]}, /chronic phase/],
 ["CML BP", {pbBlast:35,bmBlast:40,fusions:["BCR::ABL1"],hxCML:true}, /blast phase/],
 ["AML BCR", {pbBlast:35,bmBlast:40,fusions:["BCR::ABL1"]}, /AML with BCR::ABL1/],
 ["PV", {hb:18.5,sex:"M",jak2:true,megaMorph:"PV",pbBlast:0,bmBlast:1,epoLow:true}, /Polycythaemia vera/],
 ["ET", {plt:900,calr:true,megaMorph:"ET",pbBlast:0,bmBlast:1,hb:13.5,sex:"F"}, /Essential thrombocythaemia/],
 ["PMF overt", {plt:300,jak2:true,megaMorph:"PMF",fibrosis:3,hb:9,sex:"M",splenomegaly:true,pbBlast:1,bmBlast:2}, /overt fibrotic/],
 ["MDS/MPN-SF3B1-T", {plt:700,hb:9,sex:"F",sf3b1VAF:30,pbBlast:0,bmBlast:1,jak2:true}, /SF3B1 mutation and thrombocytosis/],
 ["MDS/MPN-N", {wbc:40,pbImmMyeloidPct:20,dysGran:true,basoPct:1,monoPct:4,pbBlast:2,bmBlast:4,amc:1.6}, /neutrophilia/],
 ["CNL", {wbc:50,csf3r:true,pbBlast:0,bmBlast:1}, /neutrophilic leukaemia/],
 ["MLN-eo PDGFRA", {aec:4,fusions:["PDGFRA"],pbBlast:0,bmBlast:2}, /PDGFRA/],
 ["MLN-eo FGFR1 BP", {fusions:["FGFR1"],bmBlast:40}, /FGFR1 rearrangement, blast phase/],
 ["CCUS", {pbBlast:0,bmBlast:1,anc:1.2,otherMutVAF:12}, /CCUS/],
 ["CHIP", {pbBlast:0,bmBlast:1,hb:14,sex:"M",anc:3,plt:250,otherMutVAF:5}, /CHIP/],
 ["MPAL B/my", {bmBlast:70,flowLineage:"B/myeloid"}, /B\/myeloid/],
 ["B-ALL ETV6", {bmBlast:80,flowLineage:"B",ballGenetic:"ETV6::RUNX1"}, /ETV6::RUNX1 fusion/],
 ["T-ALL ETP", {bmBlast:80,flowLineage:"T",etp:true}, /Early T-precursor/],
 ["Post-therapy AML-MR", {bmBlast:30,cyto:["mono7"],hxCytotoxic:true}, /myelodysplasia-related/, null, /post cytotoxic/],
 ["MPN BP", {bmBlast:30,hxMPN:true,hxMPNType:"Primary myelofibrosis"}, /Primary myelofibrosis, blast phase/],
 ["SM", {mcAggregates:true,kit:true,tryptase:80,pbBlast:0,bmBlast:1}, /Systemic mastocytosis/],
 ["Myeloma", {bmpcPct:30,mProtein:42,crab:true}, /^Plasma cell myeloma$/],
 ["SMM", {bmpcPct:15,mProtein:20}, /smouldering/],
 ["MGUS", {bmpcPct:4,mProtein:12}, /Non-IgM/],
 ["CLL", {clonalB:12,cllPhenotype:"yes"}, /Chronic lymphocytic/],
 ["PCL", {pbPlasmaPct:12,bmpcPct:60,mProtein:35,crab:true}, /plasma cell leukaemia/],
 ["PCL below threshold", {pbPlasmaPct:3,bmpcPct:40,crab:true}, /^Plasma cell myeloma$/],
 ["Solitary plasmacytoma", {plasmacytoma:true,plasmacytomaSolitary:true,bmpcPct:0}, /^Solitary plasmacytoma$/],
 ["Plasmacytoma minimal BM", {plasmacytoma:true,plasmacytomaSolitary:true,bmpcPct:5}, /minimal marrow involvement/],
 ["Plasmacytoma + CRAB = myeloma", {plasmacytoma:true,plasmacytomaSolitary:true,bmpcPct:5,crab:true}, /^Plasma cell myeloma$/],
 ["MBL", {clonalB:2,cllPhenotype:"yes"}, /CLL\/SLL type/],
 ["Myeloid AML NOS undetermined", {bmBlast:30,flowLineage:"myeloid",geneticsDone:true}, /subtype undetermined/],
 ["PB only, no genetics, Auer", {pbBlast:46,auer:true}, /pending cytogenetic/],
 ["PB only, lineage unknown", {pbBlast:46}, /lineage and WHO-HAEM5 type to be determined/],
 ["Down ML-DS", {downSyndrome:true,age:2,gata1:true,bmBlast:30,megaMarkers:true,geneticsDone:true,flowLineage:"myeloid"}, /Down syndrome/],
];
let pass=0, fail=0;
for (const [name, c, re, status, qualRe] of cases) {
  const r = H.classify(c); const top = r.candidates[0];
  const hit = r.candidates.find(x => re.test(x.entity));
  let ok = !!hit && (top === hit || r.candidates.filter(x=>x.status===hit.status)[0]===hit || status);
  if (ok && status) ok = hit.status === status;
  if (ok && qualRe) ok = qualRe.test(H.diagnosisLine(hit));
  if (ok) pass++; else { fail++; console.log("FAIL", name, "→", r.candidates.map(x=>`${x.entity} [${x.status}]`).join(" | ") || r.warnings); }
}
console.log(`${pass}/${pass+fail} passed`);
