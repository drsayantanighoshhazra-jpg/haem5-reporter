"""JIMSH local pilot analysis for HAEM5 Reporter.

Usage:  python tools/pilot_analysis.py PILOT_SHEET.xlsx  zip1.zip zip2.zip …  [--out OUTDIR]

Inputs
  • the pilot sheet (HAEM5_JIMSH_pilot_sheet.xlsx): manual (reported) vs app results per slide
  • the zips exported from the app: haem5_wbc_*.zip (white cells) and haem5_rbc_*.zip (red cells), each with labels.csv
    holding, per cell, the AI's label (ai_pred) and the reviewing pathologist's final label (label)
Outputs (in OUTDIR): pilot_results.md, pilot_results.json, wbc_confusion.png, rbc_confusion.png, blast_bland_altman.png

Primary endpoint: cell-level agreement AI vs pathologist (accuracy, Cohen's κ with slide-level cluster-bootstrap 95% CI,
per-type sensitivity/PPV, blast sensitivity/specificity). Secondary: slide-level blast % app vs reported manual
(slides with ≥100 counted cells; mean difference and 95% limits of agreement), red-cell agreement, time per slide.
"""
import argparse, io, json, os, sys, zipfile
import numpy as np, pandas as pd

BLAST_EQ = {"blast", "monoblast", "promonocyte"}   # WHO blast equivalents are pooled for blast detection


def read_zips(paths):
    rows = []
    for zp in paths:
        z = zipfile.ZipFile(zp)
        if "labels.csv" not in z.namelist(): continue
        d = pd.read_csv(io.BytesIO(z.read("labels.csv")))
        d["kind"] = d.get("model", pd.Series(["rbc" if str(f).startswith("rbc/") else "wbc" for f in d.file])).fillna("wbc")
        d["zip"] = os.path.basename(zp); rows.append(d)
    if not rows: return pd.DataFrame(columns=["label", "ai_pred", "case", "kind"])
    d = pd.concat(rows, ignore_index=True)
    d = d[d.ai_pred.notna() & (d.ai_pred.astype(str) != "")]
    return d.drop_duplicates(subset=["file"])


def kappa(y, p):
    labs = sorted(set(y) | set(p)); idx = {l: i for i, l in enumerate(labs)}
    m = np.zeros((len(labs), len(labs)))
    for a, b in zip(y, p): m[idx[a], idx[b]] += 1
    n = m.sum(); po = np.trace(m) / n; pe = (m.sum(0) * m.sum(1)).sum() / n ** 2
    return float((po - pe) / (1 - pe)) if pe < 1 else 1.0


def cluster_ci(df, fn, n_boot=2000, seed=42):
    """95% CI by resampling whole slides (cells within a slide are not independent)."""
    cases = df.case.unique(); rng = np.random.default_rng(seed); vals = []
    if len(cases) < 3: return None
    for _ in range(n_boot):
        pick = rng.choice(cases, len(cases), replace=True)
        s = pd.concat([df[df.case == c] for c in pick]); vals.append(fn(s))
    return [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]


def cell_level(d, name):
    if d.empty: return None
    y, p = d.label.astype(str).values, d.ai_pred.astype(str).values
    acc = lambda s: float((s.label.astype(str) == s.ai_pred.astype(str)).mean())
    res = {"set": name, "cells": int(len(d)), "slides": int(d.case.nunique()), "accuracy": acc(d), "accuracy_95ci": cluster_ci(d, acc),
           "kappa": kappa(y, p), "kappa_95ci": cluster_ci(d, lambda s: kappa(s.label.astype(str).values, s.ai_pred.astype(str).values)),
           "relabelled": int((y != p).sum())}
    per = []
    for t in sorted(set(y) | set(p)):
        tp = int(((y == t) & (p == t)).sum()); n_true = int((y == t).sum()); n_pred = int((p == t).sum())
        per.append({"type": t, "n (pathologist)": n_true, "sensitivity": tp / n_true if n_true else None, "PPV": tp / n_pred if n_pred else None})
    res["per_type"] = per
    if name == "white cells":
        yb, pb = np.isin(y, list(BLAST_EQ)), np.isin(p, list(BLAST_EQ))
        res["blast"] = {"n_blasts": int(yb.sum()), "sensitivity": float((yb & pb).sum() / yb.sum()) if yb.sum() else None,
                        "specificity": float((~yb & ~pb).sum() / (~yb).sum()) if (~yb).sum() else None,
                        "PPV": float((yb & pb).sum() / pb.sum()) if pb.sum() else None}
    if name == "red cells":
        ys, ps = y == "schistocyte", p == "schistocyte"
        res["schistocyte"] = {"n": int(ys.sum()), "sensitivity": float((ys & ps).sum() / ys.sum()) if ys.sum() else None,
                              "PPV": float((ys & ps).sum() / ps.sum()) if ps.sum() else None}
    return res


def confusion_png(d, path, title):
    try:
        import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    except ImportError: return
    labs = sorted(set(d.label.astype(str)) | set(d.ai_pred.astype(str)))
    m = pd.crosstab(d.label.astype(str), d.ai_pred.astype(str)).reindex(index=labs, columns=labs, fill_value=0)
    mn = m.div(m.sum(axis=1).replace(0, 1), axis=0)
    fig, ax = plt.subplots(figsize=(1 + 0.55 * len(labs), 0.8 + 0.5 * len(labs)))
    ax.imshow(mn.values, cmap="Blues", vmin=0, vmax=1)
    ax.set_xticks(range(len(labs))); ax.set_xticklabels([l.replace("_", " ") for l in labs], rotation=60, ha="right", fontsize=8)
    ax.set_yticks(range(len(labs))); ax.set_yticklabels([l.replace("_", " ") for l in labs], fontsize=8)
    for i in range(len(labs)):
        for j in range(len(labs)):
            if m.values[i, j]: ax.text(j, i, int(m.values[i, j]), ha="center", va="center", fontsize=7, color="white" if mn.values[i, j] > 0.5 else "black")
    ax.set_xlabel("AI label"); ax.set_ylabel("Pathologist label"); ax.set_title(title, fontsize=10); fig.tight_layout(); fig.savefig(path, dpi=180); plt.close(fig)


def slide_level(sheet):
    df = pd.read_excel(sheet, sheet_name=0)
    df.columns = [str(c).strip() for c in df.columns]
    num = lambda c: pd.to_numeric(df.get(c), errors="coerce")
    s = pd.DataFrame({"V": df.get("V-no"), "category": df.get("Category"), "manual_blast": num("Manual: Blast %"), "app_blast": num("App: Blast %"),
                      "wbc_counted": num("App: WBC counted"), "relabelled": num("App: cells relabelled"), "minutes": num("App: time (min)")})
    s = s[s.app_blast.notna() | s.manual_blast.notna()]
    out = {"slides_in_sheet": int(len(s))}
    big = s[(s.wbc_counted >= 100) & s.app_blast.notna() & s.manual_blast.notna()]
    if len(big) >= 2:
        diff = big.app_blast - big.manual_blast
        out["blast_slide_level"] = {"slides_ge100_cells": int(len(big)), "mean_difference": float(diff.mean()), "sd": float(diff.std(ddof=1)),
                                    "loa_low": float(diff.mean() - 1.96 * diff.std(ddof=1)), "loa_high": float(diff.mean() + 1.96 * diff.std(ddof=1)),
                                    "pearson_r": float(np.corrcoef(big.app_blast, big.manual_blast)[0, 1]) if len(big) > 2 else None}
    both = s[s.app_blast.notna() & s.manual_blast.notna()]
    if len(both):
        mb, ab = both.manual_blast >= 5, both.app_blast >= 5    # slide-level "blasts present" at a 5% cut-off
        out["blast_present_5pct"] = {"slides": int(len(both)), "agree": int((mb == ab).sum()), "manual_pos": int(mb.sum()), "app_pos": int(ab.sum())}
    if s.minutes.notna().any():
        out["time_per_slide_min"] = {"median": float(s.minutes.median()), "iqr": [float(s.minutes.quantile(.25)), float(s.minutes.quantile(.75))]}
    if s.wbc_counted.notna().any():
        out["wbc_counted"] = {"median": float(s.wbc_counted.median()), "min": float(s.wbc_counted.min()), "max": float(s.wbc_counted.max())}
    return out, s, big


def bland_altman_png(big, path):
    if len(big) < 2: return
    try:
        import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    except ImportError: return
    mean = (big.app_blast + big.manual_blast) / 2; diff = big.app_blast - big.manual_blast; md, sd = diff.mean(), diff.std(ddof=1)
    fig, ax = plt.subplots(figsize=(5.5, 4)); ax.scatter(mean, diff, s=28)
    for v, ls in ((md, "-"), (md + 1.96 * sd, "--"), (md - 1.96 * sd, "--")): ax.axhline(v, ls=ls, lw=1)
    ax.set_xlabel("Mean blast % (app, manual)"); ax.set_ylabel("App − manual (blast %)"); ax.set_title("Blast %: Bland–Altman (slides with ≥100 cells)", fontsize=10)
    fig.tight_layout(); fig.savefig(path, dpi=180); plt.close(fig)


def fmt(x, pct=True):
    if x is None: return "—"
    return f"{100 * x:.1f}%" if pct else f"{x:.2f}"


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("sheet"); ap.add_argument("zips", nargs="*"); ap.add_argument("--out", default="pilot_out")
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    cells = read_zips(a.zips); R = {}
    for kind, name in (("wbc", "white cells"), ("rbc", "red cells")):
        d = cells[cells.kind == kind] if len(cells) else cells
        R[kind] = cell_level(d, name)
        if R[kind]: confusion_png(d, f"{a.out}/{kind}_confusion.png", f"Pilot — {name}: pathologist vs AI (n={len(d)})")
    R["slides"], s, big = slide_level(a.sheet); bland_altman_png(big, f"{a.out}/blast_bland_altman.png")
    json.dump(R, open(f"{a.out}/pilot_results.json", "w"), indent=2, default=float)
    L = ["# JIMSH local pilot — results", ""]
    for kind in ("wbc", "rbc"):
        r = R[kind]
        if not r: continue
        ci = lambda v: f" (95% CI {fmt(v[0])}–{fmt(v[1])})" if v else ""
        cik = lambda v: f" (95% CI {v[0]:.2f}–{v[1]:.2f})" if v else ""
        L += [f"## {r['set'].capitalize()} — cell level", f"- Cells {r['cells']} from {r['slides']} slides; relabelled by the pathologist: {r['relabelled']}",
              f"- Accuracy {fmt(r['accuracy'])}{ci(r['accuracy_95ci'])}; Cohen's κ {r['kappa']:.2f}{cik(r['kappa_95ci'])}"]
        if "blast" in r: b = r["blast"]; L.append(f"- Blast (incl. equivalents): n={b['n_blasts']}, sensitivity {fmt(b['sensitivity'])}, specificity {fmt(b['specificity'])}, PPV {fmt(b['PPV'])}")
        if "schistocyte" in r: b = r["schistocyte"]; L.append(f"- Schistocytes: n={b['n']}, sensitivity {fmt(b['sensitivity'])}, PPV {fmt(b['PPV'])}")
        L += ["", "| Type | n (pathologist) | Sensitivity | PPV |", "|---|---|---|---|"]
        L += [f"| {p['type'].replace('_', ' ')} | {p['n (pathologist)']} | {fmt(p['sensitivity'])} | {fmt(p['PPV'])} |" for p in r["per_type"]] + [""]
    sl = R["slides"]; L += ["## Slide level", f"- Slides in sheet: {sl['slides_in_sheet']}"]
    if "wbc_counted" in sl: L.append(f"- White cells counted per slide: median {sl['wbc_counted']['median']:.0f} (range {sl['wbc_counted']['min']:.0f}–{sl['wbc_counted']['max']:.0f})")
    if "blast_slide_level" in sl:
        b = sl["blast_slide_level"]; L.append(f"- Blast % (slides with ≥100 cells, n={b['slides_ge100_cells']}): mean difference app − manual {b['mean_difference']:+.1f} points, 95% limits of agreement {b['loa_low']:+.1f} to {b['loa_high']:+.1f}" + (f", r = {b['pearson_r']:.2f}" if b.get("pearson_r") is not None else ""))
    if "blast_present_5pct" in sl: b = sl["blast_present_5pct"]; L.append(f"- Blasts ≥5% (slide call): agreement {b['agree']}/{b['slides']} (manual positive {b['manual_pos']}, app positive {b['app_pos']})")
    if "time_per_slide_min" in sl: t = sl["time_per_slide_min"]; L.append(f"- Time with the app: median {t['median']:.1f} min per slide (IQR {t['iqr'][0]:.1f}–{t['iqr'][1]:.1f})")
    open(f"{a.out}/pilot_results.md", "w").write("\n".join(L) + "\n"); print("\n".join(L))


if __name__ == "__main__":
    main()
