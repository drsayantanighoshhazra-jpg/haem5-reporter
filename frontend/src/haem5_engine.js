/* WHO-HAEM5 rule engine — decision support only.
 * Encodes diagnostic criteria from:
 *  Khoury JD et al. Leukemia 2022;36:1703–19 (myeloid & histiocytic/dendritic)
 *  Alaggio R et al. Leukemia 2022;36:1720–48 (lymphoid)
 * Plasma cell rules follow IMWG criteria as adopted by WHO-HAEM5.
 * The final diagnosis is always the reporting pathologist's.
 */
(function (root) {
  "use strict";

  // ---------- catalogue of WHO-HAEM5 entities (for picker & report) ----------
  const CATALOG = {
    "Myeloid precursor lesions": [
      "Clonal haematopoiesis of indeterminate potential (CHIP)",
      "Clonal cytopenia of undetermined significance (CCUS)"],
    "Myeloproliferative neoplasms": [
      "Chronic myeloid leukaemia, chronic phase", "Chronic myeloid leukaemia, blast phase",
      "Polycythaemia vera", "Essential thrombocythaemia",
      "Primary myelofibrosis, early/prefibrotic stage", "Primary myelofibrosis, overt fibrotic stage",
      "Chronic neutrophilic leukaemia", "Chronic eosinophilic leukaemia",
      "Juvenile myelomonocytic leukaemia", "Myeloproliferative neoplasm, not otherwise specified"],
    "Mastocytosis": [
      "Cutaneous mastocytosis", "Bone marrow mastocytosis", "Indolent systemic mastocytosis",
      "Smouldering systemic mastocytosis", "Aggressive systemic mastocytosis",
      "Systemic mastocytosis with an associated haematological neoplasm", "Mast cell leukaemia",
      "Mast cell sarcoma"],
    "Myelodysplastic neoplasms": [
      "MDS with low blasts and isolated 5q deletion (MDS-5q)",
      "MDS with low blasts and SF3B1 mutation (MDS-SF3B1)",
      "MDS with low blasts and ring sideroblasts",
      "MDS with biallelic TP53 inactivation (MDS-biTP53)",
      "MDS with low blasts (MDS-LB)", "MDS, hypoplastic (MDS-h)",
      "MDS with increased blasts-1 (MDS-IB1)", "MDS with increased blasts-2 (MDS-IB2)",
      "MDS with fibrosis (MDS-f)",
      "Childhood MDS with low blasts (cMDS-LB)", "Childhood MDS with increased blasts (cMDS-IB)"],
    "Myelodysplastic/myeloproliferative neoplasms": [
      "Chronic myelomonocytic leukaemia", "MDS/MPN with neutrophilia",
      "MDS/MPN with SF3B1 mutation and thrombocytosis",
      "MDS/MPN with ring sideroblasts and thrombocytosis",
      "MDS/MPN, not otherwise specified"],
    "AML with defining genetic abnormalities": [
      "Acute promyelocytic leukaemia with PML::RARA fusion", "AML with RUNX1::RUNX1T1 fusion",
      "AML with CBFB::MYH11 fusion", "AML with DEK::NUP214 fusion", "AML with RBM15::MRTFA fusion",
      "AML with BCR::ABL1 fusion", "AML with KMT2A rearrangement", "AML with MECOM rearrangement",
      "AML with NUP98 rearrangement", "AML with NPM1 mutation", "AML with CEBPA mutation",
      "AML, myelodysplasia-related", "AML with other defined genetic alterations"],
    "AML defined by differentiation": [
      "AML with minimal differentiation", "AML without maturation", "AML with maturation",
      "Acute basophilic leukaemia", "Acute myelomonocytic leukaemia", "Acute monocytic leukaemia",
      "Acute erythroid leukaemia", "Acute megakaryoblastic leukaemia"],
    "Myeloid sarcoma": ["Myeloid sarcoma"],
    "Secondary myeloid neoplasms": [
      "Myeloid neoplasm post cytotoxic therapy",
      "Myeloid neoplasm associated with germline predisposition",
      "Transient abnormal myelopoiesis associated with Down syndrome",
      "Myeloid leukaemia associated with Down syndrome"],
    "Myeloid/lymphoid neoplasms with eosinophilia and tyrosine kinase gene fusions": [
      "M/LN-eo with PDGFRA rearrangement", "M/LN-eo with PDGFRB rearrangement",
      "M/LN-eo with FGFR1 rearrangement", "M/LN-eo with JAK2 rearrangement",
      "M/LN-eo with FLT3 rearrangement", "M/LN-eo with ETV6::ABL1 fusion",
      "M/LN-eo with other tyrosine kinase fusions"],
    "Acute leukaemias of mixed or ambiguous lineage": [
      "Mixed-phenotype acute leukaemia with BCR::ABL1 fusion",
      "Mixed-phenotype acute leukaemia with KMT2A rearrangement",
      "Acute leukaemia of ambiguous lineage with ZNF384 rearrangement",
      "Acute leukaemia of ambiguous lineage with BCL11B rearrangement",
      "Mixed-phenotype acute leukaemia, B/myeloid", "Mixed-phenotype acute leukaemia, T/myeloid",
      "Mixed-phenotype acute leukaemia, rare types",
      "Acute leukaemia of ambiguous lineage, not otherwise specified",
      "Acute undifferentiated leukaemia"],
    "Histiocytic/dendritic cell neoplasms": [
      "Mature plasmacytoid dendritic cell proliferation associated with myeloid neoplasm",
      "Blastic plasmacytoid dendritic cell neoplasm", "Langerhans cell histiocytosis",
      "Langerhans cell sarcoma", "Indeterminate dendritic cell tumour",
      "Interdigitating dendritic cell sarcoma", "Juvenile xanthogranuloma",
      "Erdheim-Chester disease", "Rosai-Dorfman disease", "ALK-positive histiocytosis",
      "Histiocytic sarcoma"],
    "Precursor B-cell neoplasms": [
      "B-lymphoblastic leukaemia/lymphoma, NOS",
      "B-lymphoblastic leukaemia/lymphoma with high hyperdiploidy",
      "B-lymphoblastic leukaemia/lymphoma with hypodiploidy",
      "B-lymphoblastic leukaemia/lymphoma with iAMP21",
      "B-lymphoblastic leukaemia/lymphoma with BCR::ABL1 fusion",
      "B-lymphoblastic leukaemia/lymphoma with BCR::ABL1-like features",
      "B-lymphoblastic leukaemia/lymphoma with KMT2A rearrangement",
      "B-lymphoblastic leukaemia/lymphoma with ETV6::RUNX1 fusion",
      "B-lymphoblastic leukaemia/lymphoma with ETV6::RUNX1-like features",
      "B-lymphoblastic leukaemia/lymphoma with TCF3::PBX1 fusion",
      "B-lymphoblastic leukaemia/lymphoma with IGH::IL3 fusion",
      "B-lymphoblastic leukaemia/lymphoma with TCF3::HLF fusion",
      "B-lymphoblastic leukaemia/lymphoma with other defined genetic abnormalities"],
    "Mature B-cell neoplasms": [
      "Monoclonal B-cell lymphocytosis", "Chronic lymphocytic leukaemia/small lymphocytic lymphoma",
      "Hairy cell leukaemia", "Splenic marginal zone lymphoma",
      "Splenic diffuse red pulp small B-cell lymphoma",
      "Splenic B-cell lymphoma/leukaemia with prominent nucleoli", "Lymphoplasmacytic lymphoma",
      "Extranodal marginal zone lymphoma of mucosa-associated lymphoid tissue",
      "Primary cutaneous marginal zone lymphoma", "Nodal marginal zone lymphoma",
      "Paediatric marginal zone lymphoma", "In situ follicular B-cell neoplasm", "Follicular lymphoma",
      "Paediatric-type follicular lymphoma", "Duodenal-type follicular lymphoma",
      "Primary cutaneous follicle centre lymphoma", "In situ mantle cell neoplasm",
      "Mantle cell lymphoma", "Leukaemic non-nodal mantle cell lymphoma",
      "Transformations of indolent B-cell lymphomas", "Diffuse large B-cell lymphoma, NOS",
      "T-cell/histiocyte-rich large B-cell lymphoma",
      "Diffuse large B-cell lymphoma/high grade B-cell lymphoma with MYC and BCL2 rearrangements",
      "ALK-positive large B-cell lymphoma", "Large B-cell lymphoma with IRF4 rearrangement",
      "High-grade B-cell lymphoma with 11q aberrations", "Lymphomatoid granulomatosis",
      "EBV-positive diffuse large B-cell lymphoma",
      "Diffuse large B-cell lymphoma associated with chronic inflammation",
      "Fibrin-associated large B-cell lymphoma", "Fluid overload-associated large B-cell lymphoma",
      "Plasmablastic lymphoma", "Primary large B-cell lymphoma of immune-privileged sites",
      "Primary cutaneous diffuse large B-cell lymphoma, leg type",
      "Intravascular large B-cell lymphoma", "Primary mediastinal large B-cell lymphoma",
      "Mediastinal grey zone lymphoma", "High-grade B-cell lymphoma, NOS", "Burkitt lymphoma",
      "Primary effusion lymphoma", "KSHV/HHV8-positive diffuse large B-cell lymphoma",
      "KSHV/HHV8-positive germinotropic lymphoproliferative disorder",
      "Hyperplasias arising in immune deficiency/dysregulation",
      "Polymorphic lymphoproliferative disorders arising in immune deficiency/dysregulation",
      "EBV-positive mucocutaneous ulcer", "Lymphomas arising in immune deficiency/dysregulation",
      "Inborn error of immunity-associated lymphoid proliferations and lymphomas"],
    "Hodgkin lymphoma": ["Classic Hodgkin lymphoma", "Nodular lymphocyte predominant Hodgkin lymphoma"],
    "Plasma cell neoplasms and other diseases with paraproteins": [
      "Cold agglutinin disease", "IgM monoclonal gammopathy of undetermined significance",
      "Non-IgM monoclonal gammopathy of undetermined significance",
      "Monoclonal gammopathy of renal significance",
      "Immunoglobulin-related (AL) amyloidosis", "Monoclonal immunoglobulin deposition disease",
      "Mu heavy chain disease", "Gamma heavy chain disease", "Alpha heavy chain disease",
      "Plasmacytoma", "Plasma cell myeloma", "POEMS syndrome", "TEMPI syndrome", "AESOP syndrome"],
    "Precursor T-cell neoplasms": [
      "T-lymphoblastic leukaemia/lymphoma, NOS",
      "Early T-precursor lymphoblastic leukaemia/lymphoma"],
    "Mature T-cell and NK-cell neoplasms": [
      "T-prolymphocytic leukaemia", "T-large granular lymphocytic leukaemia",
      "NK-large granular lymphocytic leukaemia", "Adult T-cell leukaemia/lymphoma",
      "Sézary syndrome", "Aggressive NK-cell leukaemia",
      "Primary cutaneous CD4-positive small or medium T-cell lymphoproliferative disorder",
      "Primary cutaneous acral CD8-positive lymphoproliferative disorder", "Mycosis fungoides",
      "Lymphomatoid papulosis", "Primary cutaneous anaplastic large cell lymphoma",
      "Subcutaneous panniculitis-like T-cell lymphoma",
      "Primary cutaneous gamma/delta T-cell lymphoma",
      "Primary cutaneous CD8-positive aggressive epidermotropic cytotoxic T-cell lymphoma",
      "Primary cutaneous peripheral T-cell lymphoma, NOS",
      "Indolent T-cell lymphoma of the gastrointestinal tract",
      "Indolent NK-cell lymphoproliferative disorder of the gastrointestinal tract",
      "Enteropathy-associated T-cell lymphoma",
      "Monomorphic epitheliotropic intestinal T-cell lymphoma", "Intestinal T-cell lymphoma, NOS",
      "Hepatosplenic T-cell lymphoma", "ALK-positive anaplastic large cell lymphoma",
      "ALK-negative anaplastic large cell lymphoma",
      "Breast implant-associated anaplastic large cell lymphoma",
      "Nodal T-follicular helper cell lymphoma, angioimmunoblastic-type",
      "Nodal T-follicular helper cell lymphoma, follicular-type",
      "Nodal T-follicular helper cell lymphoma, NOS", "Peripheral T-cell lymphoma, NOS",
      "EBV-positive nodal T- and NK-cell lymphoma", "Extranodal NK/T-cell lymphoma",
      "Severe mosquito bite allergy", "Hydroa vacciniforme lymphoproliferative disorder",
      "Systemic chronic active EBV disease", "Systemic EBV-positive T-cell lymphoma of childhood"],
    "Stroma-derived neoplasms of lymphoid tissues": [
      "Follicular dendritic cell sarcoma", "EBV-positive inflammatory follicular dendritic cell sarcoma",
      "Fibroblastic reticular cell tumour"]
  };

  const AML_FUSIONS = [
    ["PML::RARA", "Acute promyelocytic leukaemia with PML::RARA fusion"],
    ["RUNX1::RUNX1T1", "AML with RUNX1::RUNX1T1 fusion"],
    ["CBFB::MYH11", "AML with CBFB::MYH11 fusion"],
    ["DEK::NUP214", "AML with DEK::NUP214 fusion"],
    ["RBM15::MRTFA", "AML with RBM15::MRTFA fusion"],
    ["KMT2A", "AML with KMT2A rearrangement"],
    ["MECOM", "AML with MECOM rearrangement"],
    ["NUP98", "AML with NUP98 rearrangement"]];
  const TK_FUSIONS = [
    ["PDGFRA", "M/LN-eo with PDGFRA rearrangement"], ["PDGFRB", "M/LN-eo with PDGFRB rearrangement"],
    ["FGFR1", "M/LN-eo with FGFR1 rearrangement"], ["JAK2r", "M/LN-eo with JAK2 rearrangement"],
    ["FLT3r", "M/LN-eo with FLT3 rearrangement"], ["ETV6::ABL1", "M/LN-eo with ETV6::ABL1 fusion"],
    ["otherTK", "M/LN-eo with other tyrosine kinase fusions"]];
  const MR_CYTO = {
    complex: "Complex karyotype (≥3 abnormalities)", del5q: "5q deletion / loss of 5q",
    mono7: "Monosomy 7, 7q deletion or loss of 7q", del11q: "11q deletion",
    del12p: "12p deletion / loss of 12p", mono13: "Monosomy 13 or 13q deletion",
    del17p: "17p deletion / loss of 17p", i17q: "Isochromosome 17q", idicX: "idic(X)(q13)"};
  const MR_GENES = ["ASXL1", "BCOR", "EZH2", "SF3B1", "SRSF2", "STAG2", "U2AF1", "ZRSR2"];

  // ---------- helpers ----------
  const num = v => (v === "" || v === null || v === undefined || isNaN(+v)) ? null : +v;
  const has = (arr, k) => Array.isArray(arr) && arr.includes(k);
  const known = v => v !== null && v !== undefined && v !== "";

  function derive(c) {
    const d = {};
    d.pb = num(c.pbBlast); d.bm = num(c.bmBlast);
    d.maxBlast = Math.max(d.pb ?? -1, d.bm ?? -1);
    d.blastKnown = d.pb !== null || d.bm !== null;
    d.hb = num(c.hb); d.anc = num(c.anc); d.plt = num(c.plt); d.wbc = num(c.wbc);
    d.amc = num(c.amc); d.monoPct = num(c.monoPct); d.aec = num(c.aec); d.age = num(c.age);
    const male = c.sex === "M";
    d.anaemia = d.hb !== null && d.hb < (male ? 13 : 12);
    d.neutropenia = d.anc !== null && d.anc < 1.8;
    d.thrombocytopenia = d.plt !== null && d.plt < 150;
    d.cytopenia = d.anaemia || d.neutropenia || d.thrombocytopenia;
    d.cytopeniaList = [d.anaemia && "anaemia", d.neutropenia && "neutropenia", d.thrombocytopenia && "thrombocytopenia"].filter(Boolean);
    d.dysplasia = !!(c.dysEry || c.dysGran || c.dysMega);
    d.dysList = [c.dysEry && "erythroid", c.dysGran && "granulocytic", c.dysMega && "megakaryocytic"].filter(Boolean);
    d.fus = c.fusions || [];
    d.mrCyto = Object.keys(MR_CYTO).filter(k => has(c.cyto, k));
    d.mrGenes = MR_GENES.filter(g => has(c.mrGenes, g) || (g === "SF3B1" && num(c.sf3b1VAF) > 0));
    const tp53n = num(c.tp53Count) || 0, tp53v = num(c.tp53VAF);
    d.tp53 = tp53n > 0;
    d.biTP53 = tp53n >= 2 || (tp53n === 1 && (!!c.tp53CopyLoss || (tp53v !== null && tp53v >= 50)));
    d.sf3b1 = num(c.sf3b1VAF) > 0 || has(c.mrGenes, "SF3B1");
    d.driver = !!(c.jak2 || c.jak2ex12 || c.calr || c.mpl);
    d.abnKaryo = d.mrCyto.length > 0 || has(c.cyto, "otherAbn") || d.fus.length > 0;
    d.anyMut = d.tp53 || d.mrGenes.length > 0 || d.driver || !!c.npm1 || !!c.cebpa || !!c.csf3r ||
      !!c.kit || !!c.ras || (num(c.otherMutVAF) ?? 0) >= 2;
    d.clonal = d.abnKaryo || d.anyMut;
    d.child = d.age !== null && d.age < 18;
    d.lowBlast = d.blastKnown && (d.bm ?? 0) < 5 && (d.pb ?? 0) < 2;
    d.geneticsDone = !!(c.geneticsDone || d.fus.length || (c.cyto || []).length || (c.mrGenes || []).length || c.npm1 || c.cebpa ||
      known(c.tp53Count) || known(c.sf3b1VAF) || c.karyotype || c.ngsText || c.jak2 || c.calr || c.mpl);
    d.lineageKnown = (c.flowLineage && c.flowLineage !== "unknown") || !!c.auer || c.mpoPos === "yes";
    return d;
  }

  function cand(entity, family, status, met, missing, notes) {
    return { entity, family, status, met: met || [], missing: missing || [], notes: notes || [] };
  }

  // ---------- main ----------
  function classify(c) {
    c = c || {};
    const d = derive(c);
    const out = [], warn = [], qual = [];
    const push = x => out.push(x);
    const blastTxt = `blasts PB ${d.pb ?? "—"}% / BM ${d.bm ?? "—"}%`;

    if (!d.blastKnown) warn.push("Blast percentage not entered — most myeloid categories depend on it (count blasts + blast equivalents; promonocytes are blast equivalents in AML/CMML, abnormal promyelocytes in APL).");

    // qualifiers (apply to myeloid diagnoses)
    if (c.hxCytotoxic) qual.push("post cytotoxic therapy");
    if (c.germline) qual.push(`associated with germline predisposition${typeof c.germline === "string" && c.germline !== "true" ? " (" + c.germline + ")" : ""}`);

    const lineage = c.flowLineage || "unknown";
    const acute = d.maxBlast >= 20;

    // ---- Down syndrome ----
    if (c.downSyndrome && d.age !== null && d.age <= 4 && (c.gata1 || c.megaMarkers)) {
      push(cand(d.age < 0.25 ? "Transient abnormal myelopoiesis associated with Down syndrome" : "Myeloid leukaemia associated with Down syndrome",
        "Secondary myeloid neoplasms", "probable", ["Down syndrome", "age ≤4 years", c.gata1 ? "GATA1 mutation" : "megakaryoblastic phenotype"], [],
        ["TAM: neonatal/infant presentation; ML-DS: usually within first 5 years. Confirm GATA1 mutation."]));
    }

    // ---- acute leukaemia of mixed/ambiguous lineage, ALL ----
    if (acute && ["B/myeloid", "T/myeloid", "MPAL-other", "undiff", "ambiguous"].includes(lineage)) {
      let e, met = [blastTxt, "lineage: " + lineage];
      if (has(d.fus, "BCR::ABL1") && lineage !== "undiff") e = "Mixed-phenotype acute leukaemia with BCR::ABL1 fusion";
      else if (has(d.fus, "KMT2A") && lineage !== "undiff") e = "Mixed-phenotype acute leukaemia with KMT2A rearrangement";
      else if (has(d.fus, "ZNF384")) e = "Acute leukaemia of ambiguous lineage with ZNF384 rearrangement";
      else if (has(d.fus, "BCL11B")) e = "Acute leukaemia of ambiguous lineage with BCL11B rearrangement";
      else e = { "B/myeloid": "Mixed-phenotype acute leukaemia, B/myeloid", "T/myeloid": "Mixed-phenotype acute leukaemia, T/myeloid",
        "MPAL-other": "Mixed-phenotype acute leukaemia, rare types", "undiff": "Acute undifferentiated leukaemia",
        "ambiguous": "Acute leukaemia of ambiguous lineage, not otherwise specified" }[lineage];
      push(cand(e, "Acute leukaemias of mixed or ambiguous lineage", "criteria met", met, [],
        ["Lineage assignment per WHO-HAEM5 MPAL criteria (MPO by flow/cytochemistry or monocytic differentiation; cyCD3; strong CD19 with CD79a/cyCD22/CD10). Exclude AML-defining genetic abnormalities, AML-MR, MN-pCT and CML-BP."]));
    }
    if (acute && lineage === "B") {
      const map = { hyperdiploid: "with high hyperdiploidy", hypodiploid: "with hypodiploidy", iAMP21: "with iAMP21",
        "BCR::ABL1": "with BCR::ABL1 fusion", "BCR::ABL1-like": "with BCR::ABL1-like features", KMT2A: "with KMT2A rearrangement",
        "ETV6::RUNX1": "with ETV6::RUNX1 fusion", "ETV6::RUNX1-like": "with ETV6::RUNX1-like features", "TCF3::PBX1": "with TCF3::PBX1 fusion",
        "IGH::IL3": "with IGH::IL3 fusion", "TCF3::HLF": "with TCF3::HLF fusion", other: "with other defined genetic abnormalities" };
      let g = c.ballGenetic || (has(d.fus, "BCR::ABL1") ? "BCR::ABL1" : has(d.fus, "KMT2A") ? "KMT2A" : "");
      if (has(d.fus, "BCR::ABL1") && c.hxCML) {
        push(cand("Chronic myeloid leukaemia, blast phase (lymphoid)", "Myeloproliferative neoplasms", "criteria met",
          ["BCR::ABL1", "history of CML", "lymphoblasts " + blastTxt], [], ["Increased lymphoblasts in a CML patient define blast phase even below 20%."]));
      } else {
        push(cand("B-lymphoblastic leukaemia/lymphoma, " + (map[g] || "NOS"), "Precursor B-cell neoplasms", "criteria met",
          [blastTxt, "B-lineage blasts"], g ? [] : ["Genetic subgroup (karyotype/FISH/molecular) not entered"],
          ["WHO-HAEM5 recommends avoiding a diagnosis of B-ALL with <20% bone marrow blasts. For BCR::ABL1, distinguish lymphoid blast phase of CML (check for history/MPN features)."]));
      }
    }
    if (acute && lineage === "T") {
      push(cand(c.etp ? "Early T-precursor lymphoblastic leukaemia/lymphoma" : "T-lymphoblastic leukaemia/lymphoma, NOS",
        "Precursor T-cell neoplasms", "criteria met", [blastTxt, "T-lineage blasts (cyCD3)"], [],
        ["ETP immunophenotype: CD7+, CD1a−, CD8−, CD5 weak/negative (<75%), with ≥1 stem/myeloid marker. Exclude ALAL with BCL11B rearrangement."]));
    }
    if (c.hxCML && has(d.fus, "BCR::ABL1") && !acute && c.lymphoblastsIncreased) {
      push(cand("Chronic myeloid leukaemia, blast phase (lymphoid)", "Myeloproliferative neoplasms", "criteria met",
        ["BCR::ABL1", "increased lymphoblasts"], []));
    }

    const myeloidContext = !["B", "T", "B/myeloid", "T/myeloid", "MPAL-other", "undiff", "ambiguous"].includes(lineage) || !acute;
    let amlDefined = false;

    if (myeloidContext) {
      // ---- AML with defining genetic abnormalities (blast-independent ones) ----
      for (const [k, e] of AML_FUSIONS) {
        if (has(d.fus, k)) {
          amlDefined = true;
          const notes = [];
          if (!acute) notes.push(`Blasts <20% (${blastTxt}): WHO-HAEM5 allows this diagnosis irrespective of blast count. Correlate clinically; document blast %.`);
          if (k === "PML::RARA") notes.push("Abnormal promyelocytes count as blast equivalents. Urgent clinical notification (coagulopathy risk).");
          push(cand(e, "AML with defining genetic abnormalities", "criteria met", [k + (k.includes("::") ? " fusion" : " rearrangement")], [], notes));
        }
      }
      if (c.npm1 && !amlDefined) {
        amlDefined = true;
        push(cand("AML with NPM1 mutation", "AML with defining genetic abnormalities", "criteria met", ["NPM1 mutation"], [],
          acute ? [] : [`Blasts <20% (${blastTxt}): diagnosable irrespective of blast count; correlate (NPM1 with low blasts is often seen in early AML).`]));
      }
    }

    // ---- MLN-TK ----
    const tk = TK_FUSIONS.filter(([k]) => has(d.fus, k));
    for (const [k, e] of tk) {
      push(cand(e, "Myeloid/lymphoid neoplasms with eosinophilia and tyrosine kinase gene fusions", "criteria met",
        [k + " rearrangement/fusion", d.aec >= 1.5 ? `eosinophilia (${d.aec} ×10⁹/L)` : null].filter(Boolean),
        [],
        ["May present as chronic-phase MPN/MDS-MPN or in blast phase (myeloid, lymphoid or mixed). Eosinophilia is characteristic but not required. Report the phase."]));
      if (acute) { amlDefined = true; out[out.length - 1].entity += ", blast phase"; }
    }

    // ---- BCR::ABL1: CML vs AML with BCR::ABL1 ----
    const bcr = has(d.fus, "BCR::ABL1");
    if (bcr && myeloidContext) {
      if (acute) {
        if (c.hxCML || c.splenomegaly || num(c.basoPct) >= 2) {
          push(cand("Chronic myeloid leukaemia, blast phase", "Myeloproliferative neoplasms", c.hxCML ? "criteria met" : "probable",
            ["BCR::ABL1", "≥20% blasts", c.hxCML ? "history of CML" : "MPN features (splenomegaly/basophilia)"], [],
            ["Blast phase: ≥20% myeloid blasts in PB/BM, extramedullary blast proliferation, or increased lymphoblasts. Distinguish from de novo AML with BCR::ABL1."]));
        }
        if (!c.hxCML) {
          push(cand("AML with BCR::ABL1 fusion", "AML with defining genetic abnormalities", c.splenomegaly ? "consider" : "criteria met",
            ["BCR::ABL1", "≥20% blasts", "no known CML history"], [],
            ["Requires ≥20% blasts. Difficult to separate from initial myeloid blast phase of CML — look for basophilia, splenomegaly, MPN-type marrow; follow-up after therapy may clarify."]));
        }
        amlDefined = true;
      } else {
        push(cand("Chronic myeloid leukaemia, chronic phase", "Myeloproliferative neoplasms", "criteria met", ["BCR::ABL1", "<20% blasts"], [],
          ["Accelerated phase is no longer defined in WHO-HAEM5; report high-risk features instead (e.g. blasts 10–19%, basophils ≥20%, additional chromosomal abnormalities in Ph+ cells, resistance)."]));
      }
    }

    // ---- AEL (blast-independent, supersedes AML-MR) ----
    const ery = num(c.bmErythroidPct), proE = num(c.proEryPct);
    if (myeloidContext && !amlDefined && ery !== null && proE !== null && proE >= 30 && ery >= 50) {
      amlDefined = true;
      push(cand("Acute erythroid leukaemia", "AML defined by differentiation", ery >= 80 ? "criteria met" : "probable",
        [`proerythroblasts ${proE}%`, `erythroid cells ${ery}%`], ery >= 80 ? [] : ["Erythroid predominance is usually ≥80% (cases <80% are recognised)"],
        ["Diagnosis supersedes AML-MR; does not require 20% myeloblasts. Biallelic TP53 alteration is typical — " + (d.tp53 ? "TP53 mutation entered." : "check TP53.")]));
    }

    // ---- AML with ≥20% blasts ----
    if (myeloidContext && acute && !amlDefined) {
      if (c.hxMPN) {
        push(cand(`${c.hxMPNType || "Myeloproliferative neoplasm"}, blast phase`, "Myeloproliferative neoplasms", "criteria met",
          ["≥20% blasts", "prior MPN"], [], ["AML arising from MPN is retained in the MPN category as blast phase."]));
        amlDefined = true;
      } else if (c.cebpa) {
        push(cand("AML with CEBPA mutation", "AML with defining genetic abnormalities", "criteria met", ["CEBPA mutation (biallelic or single bZIP in-frame)", "≥20% blasts"]));
        amlDefined = true;
      } else if (d.mrCyto.length || d.mrGenes.length || c.hxMDS || c.hxMDSMPN) {
        const met = ["≥20% blasts"].concat(d.mrCyto.map(k => MR_CYTO[k]), d.mrGenes.map(g => g + " mutation"),
          c.hxMDS ? ["history of MDS"] : [], c.hxMDSMPN ? ["history of MDS/MPN"] : []);
        push(cand("AML, myelodysplasia-related", "AML with defining genetic abnormalities", "criteria met", met, [],
          ["Morphological multilineage dysplasia alone no longer qualifies."]));
        amlDefined = true;
      } else if (has(d.fus, "otherAML")) {
        push(cand("AML with other defined genetic alterations", "AML with defining genetic abnormalities", "criteria met", ["≥20% blasts", "other defined genetic alteration"]));
        amlDefined = true;
      } else if (!d.geneticsDone || !d.lineageKnown) {
        const myeloid = d.lineageKnown && !["B", "T"].includes(lineage);
        push(cand(myeloid ? "Acute myeloid leukaemia — WHO-HAEM5 type pending cytogenetic/molecular studies" : "Acute leukaemia — lineage and WHO-HAEM5 type to be determined",
          myeloid ? "AML (provisional)" : "Acute leukaemia (provisional)", "probable",
          ["≥20% blasts (" + blastTxt + ")", c.auer && "Auer rods (myeloid lineage)", c.mpoPos === "yes" && "MPO-positive blasts"].filter(Boolean),
          [!d.lineageKnown && "lineage: flow cytometry / MPO cytochemistry", !d.geneticsDone && "karyotype/FISH (PML::RARA, RUNX1::RUNX1T1, CBFB::MYH11, KMT2A, BCR::ABL1)", !d.geneticsDone && "NGS incl. NPM1, CEBPA, FLT3, TP53 and myelodysplasia-related genes"].filter(Boolean),
          ["WHO-HAEM5 classifies acute leukaemia primarily by defining genetic abnormalities; the specific type can be assigned only after these studies. If promyelocytes are abnormal or there is coagulopathy, exclude APL urgently."]));
        amlDefined = true;
      } else {
        // defined by differentiation
        const mg = num(c.bmMaturingGranPct), mono = num(c.bmMonocyticPct);
        const mpo = c.mpoPos; // "yes" | "no" | ""
        let e = null, why = [];
        if (c.megaMarkers) { e = "Acute megakaryoblastic leukaemia"; why = ["blasts express CD41/CD61/CD42b"]; }
        else if (c.basoMetachromasia) { e = "Acute basophilic leukaemia"; why = ["toluidine blue metachromasia"]; }
        else if (mono !== null && mono >= 80 && (mg === null || mg < 20)) { e = "Acute monocytic leukaemia"; why = [`monocytic cells ${mono}%`]; }
        else if (mono !== null && mono >= 20 && mg !== null && mg >= 20) { e = "Acute myelomonocytic leukaemia"; why = [`monocytic ${mono}%`, `maturing granulocytes ${mg}%`]; }
        else if (mpo === "no") { e = "AML with minimal differentiation"; why = ["<3% MPO/SBB-positive blasts", "≥2 myeloid antigens required"]; }
        else if (mpo === "yes" && mg !== null) { e = mg >= 10 ? "AML with maturation" : "AML without maturation"; why = ["≥3% MPO/SBB-positive blasts", `maturing granulocytes ${mg}%`]; }
        push(cand(e || "AML, defined by differentiation (subtype undetermined)", "AML defined by differentiation", e ? "criteria met" : "probable",
          ["≥20% blasts", "no defining genetic abnormality entered"].concat(why),
          e ? [] : ["MPO/SBB cytochemistry or flow, maturing granulocyte %, monocytic %"],
          ["Applies only once AML-defining genetic abnormalities, AML-MR, MN-pCT and MPAL are excluded — confirm cytogenetics and NGS are complete."]));
        amlDefined = true;
      }
      if (d.tp53) out[out.length - 1].notes.push("TP53 mutation: not a separate AML type in WHO-HAEM5 (ICC 2022 defines AML with mutated TP53) — report VAF and allelic state.");
    }
    if (c.extramedullaryTumour && (acute || amlDefined)) {
      push(cand("Myeloid sarcoma", "Myeloid sarcoma", "consider", ["extramedullary myeloid tumour mass"], [],
        ["Tissue manifestation of AML or transformed MDS/MDS-MPN/MPN; classify the underlying genetic type as for AML."]));
    }

    // ---- chronic myeloid neoplasms (<20% blasts) ----
    const chronic = d.blastKnown && !acute && !amlDefined && myeloidContext && !bcr;
    let mpnMet = false, mdsmpnMet = false;

    if (chronic && tk.length === 0) {
      // PV
      const hct = num(c.hct), male = c.sex === "M";
      const pvM1 = (d.hb !== null && d.hb > (male ? 16.5 : 16.0)) || (hct !== null && hct > (male ? 49 : 48));
      const pvM2 = c.megaMorph === "PV";
      const pvM3 = !!(c.jak2 || c.jak2ex12);
      const pvMin = !!c.epoLow;
      if (pvM1 && pvM3) {
        const ok = (pvM1 && pvM2 && pvM3) || (pvM1 && pvM2 && pvMin);
        push(cand("Polycythaemia vera", "Myeloproliferative neoplasms", ok ? "criteria met" : "probable",
          ["Hb/Hct above threshold", "JAK2 V617F/exon 12", pvM2 && "BM panmyelosis with pleomorphic mature megakaryocytes", pvMin && "subnormal serum EPO"].filter(Boolean),
          [!pvM2 && "BM morphology (trilineage growth, pleomorphic mature megakaryocytes)", !pvMin && !pvM2 && "serum EPO"].filter(Boolean),
          ["Dx: all 3 major, or first 2 major + minor criterion. BM biopsy may be omitted with sustained absolute erythrocytosis (Hb >18.5/16.5 g/dL)."]));
        mpnMet = mpnMet || ok;
      }
      // PMF
      const fib = num(c.fibrosis);
      const pmfMorph = c.megaMorph === "PMF";
      const pmfClonal = d.driver || d.clonal;
      if (pmfMorph && pmfClonal && !mpnMet) {
        const overt = fib !== null && fib >= 2;
        const minors = [d.anaemia && "anaemia", d.wbc !== null && d.wbc >= 11 && "leukocytosis ≥11 ×10⁹/L", c.splenomegaly && "palpable splenomegaly",
          c.ldhHigh && "LDH above ULN", overt && c.leukoerythro && "leukoerythroblastosis"].filter(Boolean);
        push(cand(overt ? "Primary myelofibrosis, overt fibrotic stage" : "Primary myelofibrosis, early/prefibrotic stage",
          "Myeloproliferative neoplasms", minors.length ? "criteria met" : "probable",
          ["megakaryocytic proliferation and atypia", `reticulin fibrosis MF-${fib ?? "?"}`, d.driver ? "JAK2/CALR/MPL" : "other clonal marker"].concat(minors),
          minors.length ? [] : ["≥1 minor criterion (anaemia, WBC ≥11, splenomegaly, raised LDH" + (overt ? ", leukoerythroblastosis" : "") + ")"],
          [overt ? "Overt: fibrosis grade 2–3." : "Prefibrotic: fibrosis ≤grade 1 with increased age-adjusted cellularity, granulocytic proliferation, often decreased erythropoiesis.", "Exclude reactive fibrosis, other myeloid neoplasms."]));
        mpnMet = mpnMet || minors.length > 0;
      }
      // ET
      if (d.plt !== null && d.plt >= 450 && !mpnMet && !(d.sf3b1 && d.anaemia)) {
        const m2 = c.megaMorph === "ET";
        const m4 = d.driver;
        const minor = d.clonal || !!c.noReactive;
        const ok = (m2 && m4) || (m2 && minor);
        if (m4 || m2) {
          push(cand("Essential thrombocythaemia", "Myeloproliferative neoplasms", ok ? "criteria met" : "probable",
            [`platelets ${d.plt} ×10⁹/L`, m2 && "large mature hyperlobulated megakaryocytes", m4 && "JAK2/CALR/MPL"].filter(Boolean),
            [!m2 && "BM megakaryocyte morphology", !m4 && !minor && "driver mutation or other clonal marker / exclusion of reactive thrombocytosis"].filter(Boolean),
            ["Exclude CML (BCR::ABL1), PV, PMF, MDS and other myeloid neoplasms."]));
          mpnMet = mpnMet || ok;
        }
      }
      // CNL
      if (c.csf3r && d.wbc !== null && d.wbc >= 25) {
        push(cand("Chronic neutrophilic leukaemia", "Myeloproliferative neoplasms", "criteria met",
          [`WBC ${d.wbc} ×10⁹/L`, "CSF3R activating mutation"], [],
          ["Requires neutrophils ≥80% of WBC with immature granulocytes <10% and rare blasts; no dysgranulopoiesis or monocytosis."]));
        mpnMet = true;
      }
      // CEL
      if (d.aec !== null && d.aec >= 1.5) {
        const ok = !!c.eosPersist4wk && d.clonal && d.dysplasia;
        push(cand("Chronic eosinophilic leukaemia", "Myeloproliferative neoplasms", ok ? "criteria met" : "consider",
          [`AEC ${d.aec} ×10⁹/L`, c.eosPersist4wk && "sustained ≥4 weeks", d.clonal && "clonality", d.dysplasia && "abnormal BM morphology"].filter(Boolean),
          [!c.eosPersist4wk && "sustained hypereosinophilia ≥4 weeks", !d.clonal && "evidence of clonality", !d.dysplasia && "abnormal BM morphology (e.g. megakaryocytic/erythroid dysplasia)"].filter(Boolean),
          ["Exclude M/LN-eo with TK fusions, reactive eosinophilia, lymphocyte-variant HES and other myeloid neoplasms. Increased blasts no longer substitute for clonality."]));
        mpnMet = mpnMet || ok;
      }
      // JMML
      if (d.child && d.amc !== null && d.amc >= 1 && c.ras) {
        push(cand("Juvenile myelomonocytic leukaemia", "Myeloproliferative neoplasms", c.splenomegaly ? "criteria met" : "probable",
          ["child", `monocytes ${d.amc} ×10⁹/L`, "RAS pathway mutation", c.splenomegaly && "splenomegaly"].filter(Boolean),
          [!c.splenomegaly && "splenomegaly"].filter(Boolean),
          ["Exclude KMT2A rearrangement and BCR::ABL1. Consider germline RASopathy (NF1, Noonan/PTPN11, CBL)."]));
        mpnMet = true;
      }
      if (d.driver && !mpnMet && !(d.sf3b1 && d.plt >= 450)) {
        push(cand("Myeloproliferative neoplasm, not otherwise specified", "Myeloproliferative neoplasms", "consider",
          ["MPN driver mutation"], ["full criteria for PV, ET or PMF not met with data entered"],
          ["Use MPN-NOS only after complete clinicopathological correlation; often reflects early-phase disease or incomplete data."]));
      }
      if ((c.hxMPN || mpnMet) && d.blastKnown && d.maxBlast >= 10) {
        out[out.length - 1].notes.push("Blasts 10–19% in PV/ET/PMF: accelerated phase.");
      }

      // ---- MDS/MPN ----
      if (d.amc !== null && d.monoPct !== null && d.amc >= 0.5 && d.monoPct >= 10 && !mpnMet) {
        const sup = [d.dysplasia && `dysplasia (${d.dysList.join(", ")})`, d.clonal && "clonal cytogenetic/molecular abnormality",
          c.monoPartition && "abnormal monocyte subset partitioning"].filter(Boolean);
        const ok = d.amc >= 1 ? sup.length >= 1 : (d.dysplasia && d.clonal);
        const cmml2 = (d.pb ?? 0) >= 5 || (d.bm ?? 0) >= 10;
        const sub = (d.wbc !== null && d.wbc >= 13 ? "MP-CMML" : "MD-CMML") + ", " + (cmml2 ? "CMML-2" : "CMML-1");
        push(cand("Chronic myelomonocytic leukaemia", "Myelodysplastic/myeloproliferative neoplasms", ok ? "criteria met" : "probable",
          [`monocytes ${d.amc} ×10⁹/L (${d.monoPct}%)`, "<20% blasts"].concat(sup),
          ok ? [] : [d.amc >= 1 ? "≥1 supporting criterion" : "both dysplasia AND a clonal abnormality (monocytes 0.5–<1 ×10⁹/L)"],
          [`Subtype: ${sub} (MD/MP by WBC 13 ×10⁹/L; CMML-2 = PB blasts 5–19% and/or BM 10–19%).`, "Monocytosis must be persistent. Exclude CML, other MPN and M/LN-eo with TK fusions."]));
        mdsmpnMet = ok;
      }
      const imm = num(c.pbImmMyeloidPct);
      if (!mdsmpnMet && d.wbc !== null && d.wbc >= 13 && imm !== null && imm >= 10 && c.dysGran && !mpnMet && !c.csf3r) {
        const ok = (num(c.basoPct) ?? 0) < 2 && (d.monoPct ?? 0) < 10;
        push(cand("MDS/MPN with neutrophilia", "Myelodysplastic/myeloproliferative neoplasms", ok ? "criteria met" : "probable",
          [`WBC ${d.wbc} ×10⁹/L`, `immature myeloid cells ${imm}%`, "dysgranulopoiesis"],
          ok ? [] : ["basophils <2% and monocytes <10% of WBC"], ["Replaces atypical CML. SETBP1/ASXL1 mutations support; CSF3R favours CNL."]));
        mdsmpnMet = ok;
      }
      if (!mdsmpnMet && d.plt !== null && d.plt >= 450 && d.anaemia && (d.sf3b1 || num(c.ringSid) >= 15) &&
          (d.bm ?? 0) < 5 && (d.pb ?? 0) < 1 && !has(c.cyto, "del5q") && !has(c.cyto, "mono7")) {
        push(cand(d.sf3b1 ? "MDS/MPN with SF3B1 mutation and thrombocytosis" : "MDS/MPN with ring sideroblasts and thrombocytosis",
          "Myelodysplastic/myeloproliferative neoplasms", "criteria met",
          [`platelets ${d.plt} ×10⁹/L`, "anaemia", d.sf3b1 ? "SF3B1 mutation" : `ring sideroblasts ${c.ringSid}%`, "BM blasts <5%, PB <1%"], [],
          ["JAK2 V617F/CALR/MPL may co-occur. Exclude del(5q), −7, inv(3)/t(3;3)."]));
        mdsmpnMet = true;
      }
      if (!mdsmpnMet && !mpnMet && d.cytopenia && d.dysplasia && ((d.wbc ?? 0) >= 13 || (d.plt ?? 0) >= 450)) {
        push(cand("MDS/MPN, not otherwise specified", "Myelodysplastic/myeloproliferative neoplasms", "consider",
          ["cytopenia", "dysplasia", "myeloproliferative feature (WBC ≥13 or platelets ≥450)"], [],
          ["Only after excluding all specific MDS/MPN and MPN types."]));
        mdsmpnMet = true;
      }

      // ---- MDS ----
      if (!mdsmpnMet && !mpnMet && (d.cytopenia || !known(c.hb))) {
        const mdsDefGenetic = d.biTP53 || (has(c.cyto, "del5q") && d.lowBlast) || (d.sf3b1 && d.lowBlast);
        if (d.dysplasia || mdsDefGenetic || (d.bm ?? 0) >= 5 || (d.pb ?? 0) >= 2) {
          const met = [d.cytopenia ? "cytopenia: " + d.cytopeniaList.join(", ") : null, d.dysplasia ? "dysplasia: " + d.dysList.join(", ") : null, blastTxt].filter(Boolean);
          const miss = d.cytopenia ? [] : ["CBC (cytopenia required)"];
          const fib = num(c.fibrosis), cell = num(c.bmCellularity), rs = num(c.ringSid);
          let e;
          if (d.child) {
            e = d.lowBlast ? "Childhood MDS with low blasts (cMDS-LB)" : "Childhood MDS with increased blasts (cMDS-IB)";
            if (d.lowBlast && cell !== null) e += cell <= 25 ? " — hypocellular" : " — NOS";
          } else if (d.biTP53) {
            e = "MDS with biallelic TP53 inactivation (MDS-biTP53)"; met.push("multi-hit TP53");
          } else if (d.lowBlast && has(c.cyto, "del5q") && !has(c.cyto, "mono7") && (num(c.del5qOthers) ?? 0) <= 1) {
            e = "MDS with low blasts and isolated 5q deletion (MDS-5q)"; met.push("del(5q) alone or with 1 other abnormality (not −7/del(7q))");
          } else if (d.lowBlast && d.sf3b1 && !has(c.cyto, "del5q") && !has(c.cyto, "mono7") && !has(c.cyto, "complex")) {
            e = "MDS with low blasts and SF3B1 mutation (MDS-SF3B1)"; met.push("SF3B1 mutation" + (num(c.sf3b1VAF) ? ` (VAF ${c.sf3b1VAF}%)` : ""));
          } else if (d.lowBlast && rs !== null && rs >= 15 && !has(c.cyto, "del5q") && !has(c.cyto, "mono7") && !has(c.cyto, "complex")) {
            e = "MDS with low blasts and ring sideroblasts"; met.push(`ring sideroblasts ${rs}% (SF3B1 wild-type)`);
          } else if (fib !== null && fib >= 2 && ((d.bm ?? 0) >= 5 || (d.pb ?? 0) >= 2)) {
            e = "MDS with fibrosis (MDS-f)"; met.push(`fibrosis MF-${fib}`);
          } else if ((d.bm ?? 0) >= 10 || (d.pb ?? 0) >= 5 || c.auer) {
            e = "MDS with increased blasts-2 (MDS-IB2)"; if (c.auer) met.push("Auer rods");
          } else if ((d.bm ?? 0) >= 5 || (d.pb ?? 0) >= 2) {
            e = "MDS with increased blasts-1 (MDS-IB1)";
          } else if (cell !== null && cell <= 25) {
            e = "MDS, hypoplastic (MDS-h)"; met.push(`cellularity ${cell}% (≤25%, age-adjusted)`);
          } else {
            e = "MDS with low blasts (MDS-LB)";
          }
          const notes = ["Exclude non-neoplastic causes of cytopenia/dysplasia (B12/folate, copper, drugs, alcohol, infection incl. HIV, toxins)."];
          if (/IB2/.test(e)) notes.push("ICC 2022 would classify 10–19% blasts as MDS/AML — WHO-HAEM5 keeps MDS-IB2.");
          if (d.tp53 && !d.biTP53) notes.push("Single-hit TP53: report VAF; check for copy-number loss/cnLOH (would make it multi-hit).");
          if (/MDS-h/.test(e)) notes.push("Distinguish from aplastic anaemia / PNH; trephine essential.");
          push(cand(e, "Myelodysplastic neoplasms", miss.length ? "probable" : "criteria met", met, miss, notes));
        }
      }

      // ---- clonal haematopoiesis ----
      const anyMDSish = out.some(o => /Myelodysplastic|Myeloproliferative|AML/.test(o.family));
      const vaf = Math.max(num(c.otherMutVAF) ?? 0, num(c.tp53VAF) ?? 0, num(c.sf3b1VAF) ?? 0, (d.mrGenes.length || d.driver) ? 2 : 0);
      if (!anyMDSish && (d.anyMut) && vaf >= 2 && !d.dysplasia) {
        push(cand(d.cytopenia ? "Clonal cytopenia of undetermined significance (CCUS)" : "Clonal haematopoiesis of indeterminate potential (CHIP)",
          "Myeloid precursor lesions", "criteria met",
          ["somatic myeloid-gene mutation VAF ≥2%", d.cytopenia ? "persistent unexplained cytopenia: " + d.cytopeniaList.join(", ") : "no cytopenia"],
          [], ["Requires absence of diagnostic dysplasia, <5% BM blasts and no defined myeloid neoplasm. VAF threshold ≥4% for X-linked genes in males."]));
      }
    }

    // ---- mastocytosis ----
    const minors = [c.mcAtypical25 && ">25% spindle/atypical mast cells", c.kit && "KIT D816V (or other activating KIT mutation)",
      c.mcCD25 && "CD2 and/or CD25 and/or CD30 expression", num(c.tryptase) > 20 && `serum tryptase ${c.tryptase} ng/mL (>20)`].filter(Boolean);
    if (c.mcAggregates || minors.length >= 1) {
      const ok = (c.mcAggregates && minors.length >= 1) || minors.length >= 3;
      const ahn = out.some(o => /Myelo|AML|leukaemia/.test(o.family + o.entity) && o.status === "criteria met");
      if (ok || c.mcAggregates) {
        push(cand(ahn ? "Systemic mastocytosis with an associated haematological neoplasm" : "Systemic mastocytosis",
          "Mastocytosis", ok ? "criteria met" : "probable",
          [c.mcAggregates && "multifocal dense mast cell infiltrates (≥15 per aggregate)"].concat(minors).filter(Boolean),
          ok ? [] : ["≥1 minor criterion (with major) or ≥3 minor criteria"],
          ["Subtype (BMM, ISM, SSM, ASM, MCL) requires B-findings and C-findings assessment. Tryptase criterion should be adjusted for hereditary α-tryptasaemia and is not valid with an associated myeloid neoplasm."]));
      }
    }

    // ---- plasma cell (IMWG) ----
    const pc = num(c.bmpcPct), mp = num(c.mProtein), pbpc = num(c.pbPlasmaPct);
    if (pbpc !== null && pbpc >= 5 && (pc !== null || mp !== null || c.plasmacytoma || c.pcClonal)) {
      push(cand("Plasma cell myeloma — plasma cell leukaemia", "Plasma cell neoplasms and other diseases with paraproteins", "criteria met",
        [`circulating plasma cells ${pbpc}% of WBC (≥5%)`, pc !== null && `clonal BM plasma cells ${pc}%`].filter(Boolean),
        c.pcClonal ? [] : ["confirm clonality of circulating plasma cells (flow cytometry κ/λ)"],
        ["IMWG 2021 threshold ≥5% circulating plasma cells (previously 20% or 2×10⁹/L). State primary (de novo) or secondary (progression of known myeloma). Aggressive disease: urgent haematology referral; report FISH incl. t(11;14), del(17p)."]));
    }
    if (c.plasmacytoma && c.plasmacytomaSolitary && !(c.crab || c.flc100 || c.mri || (pc !== null && pc >= 10))) {
      const minimal = pc !== null && pc > 0;
      push(cand(minimal ? "Solitary plasmacytoma with minimal marrow involvement" : "Solitary plasmacytoma", "Plasma cell neoplasms and other diseases with paraproteins",
        pc === null ? "probable" : "criteria met",
        ["biopsy-proven single plasmacytoma", "imaging otherwise clear", "no CRAB", pc !== null && (minimal ? `clonal BM plasma cells ${pc}% (<10%)` : "no clonal BM plasma cells")].filter(Boolean),
        pc === null ? ["bone marrow examination for clonal plasma cells"] : [],
        ["Specify bone or extramedullary site. With minimal marrow involvement, progression risk to myeloma is higher; whole-body MRI or PET-CT required to exclude other lesions."]));
    }
    if (pc !== null || mp !== null) {
      const mde = [c.crab && "CRAB feature", pc !== null && pc >= 60 && "clonal BM plasma cells ≥60%", c.flc100 && "involved/uninvolved FLC ratio ≥100", c.mri && ">1 focal lesion on MRI"].filter(Boolean);
      if (((pc ?? 0) >= 10 || c.plasmacytoma) && mde.length) {
        push(cand("Plasma cell myeloma", "Plasma cell neoplasms and other diseases with paraproteins", "criteria met",
          [`clonal BM plasma cells ${pc ?? "—"}%`].concat(mde), [], ["IMWG criteria. Report clonality (light chain restriction), FISH risk markers (t(4;14), t(14;16), del(17p), 1q gain)."]));
      } else if ((pc !== null && pc >= 10) || (mp !== null && mp >= 30)) {
        push(cand("Plasma cell myeloma — smouldering (asymptomatic)", "Plasma cell neoplasms and other diseases with paraproteins", "criteria met",
          [mp !== null && mp >= 30 && `M-protein ${mp} g/L`, pc !== null && pc >= 10 && `clonal BM plasma cells ${pc}%`, "no myeloma-defining event"].filter(Boolean), [],
          ["IMWG: serum M-protein ≥30 g/L (or urinary ≥500 mg/24 h) and/or clonal BM PCs 10–59%, without myeloma-defining events or amyloidosis."]));
      } else if (mp !== null && mp > 0) {
        push(cand(c.mProteinIgM ? "IgM monoclonal gammopathy of undetermined significance" : "Non-IgM monoclonal gammopathy of undetermined significance",
          "Plasma cell neoplasms and other diseases with paraproteins", "criteria met",
          [`M-protein ${mp} g/L (<30)`, `clonal BM plasma cells ${pc ?? "—"}% (<10)`, "no end-organ damage"], [],
          ["Exclude MGRS (renal), AL amyloidosis and lymphoplasmacytic lymphoma (IgM)."]));
      }
    }

    // ---- CLL / MBL ----
    const bcount = num(c.clonalB);
    if (bcount !== null) {
      let e;
      if (c.cllPhenotype === false || c.cllPhenotype === "no") e = (c.lymphadenopathy ? null : "Monoclonal B-cell lymphocytosis (non-CLL/SLL type)");
      else if (bcount >= 5) e = "Chronic lymphocytic leukaemia/small lymphocytic lymphoma";
      else if (c.lymphadenopathy) e = "Chronic lymphocytic leukaemia/small lymphocytic lymphoma (SLL presentation)";
      else if (bcount < 0.5) e = "Monoclonal B-cell lymphocytosis (low-count)";
      else e = "Monoclonal B-cell lymphocytosis (CLL/SLL type)";
      if (e) push(cand(e, "Mature B-cell neoplasms", "criteria met", [`clonal B cells ${bcount} ×10⁹/L`], [],
        ["CLL requires ≥5 ×10⁹/L monoclonal CLL-phenotype B cells in PB. Report CD5/CD23/CD200/sIg; TP53 & IGHV status; 'B-PLL' is no longer an entity."]));
    }

    // qualifiers on myeloid
    if (qual.length) {
      out.forEach(o => {
        if (/Myelo|AML|myeloid|leukaemia, blast/.test(o.family + o.entity) && !/precursor|Mastocytosis/i.test(o.family)) {
          o.qualifiers = qual.slice();
          if (c.hxCytotoxic) o.notes.push("MN-pCT: report as '<type>, post cytotoxic therapy'. Excludes methotrexate; PARP inhibitors are included.");
        }
      });
    }

    const rank = { "criteria met": 0, "probable": 1, "consider": 2 };
    out.sort((a, b) => rank[a.status] - rank[b.status]);
    if (!out.length) warn.push("No WHO-HAEM5 entity matched the data entered. For lymphoma/tissue diagnoses, choose the entity from the catalogue.");
    return { candidates: out, warnings: warn, derived: d };
  }

  function diagnosisLine(cand) {
    if (!cand) return "";
    let s = cand.entity;
    if (cand.qualifiers && cand.qualifiers.length) s += ", " + cand.qualifiers.join(", ");
    return s;
  }

  const API = { classify, diagnosisLine, CATALOG, MR_GENES, MR_CYTO, AML_FUSIONS, TK_FUSIONS, derive };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.HAEM5 = API;
})(typeof window !== "undefined" ? window : globalThis);
