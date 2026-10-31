"""Builds HAEM5_external_validation.ipynb — tests the deployed white-cell model on public datasets from other centres."""
import ast, json, sys

cells = []
def md(s): cells.append({"cell_type": "markdown", "metadata": {}, "source": s.strip("\n")})
def code(s): cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": s.strip("\n")})

md(r"""
# HAEM5 Reporter — external validation on independent public datasets

Tests **your deployed white-cell model** (`cell_model.onnx` + `cell_labels.json`, exactly as the app runs it: 4-rotation averaging and the calibrated blast threshold) on data **from other centres that were never used in training**:

| Dataset | Centre / equipment | What it tests |
|---|---|---|
| **Raabin-WBC** (Kouzehkanan et al., *Sci Rep* 2022) | Iran; several microscopes and smartphone cameras; Giemsa | Normal 5-part differential: neutrophil, lymphocyte, monocyte, eosinophil, basophil |
| **C-NMC 2019** (Gupta & Gupta, SBILab / AIIMS New Delhi; Jenner-Giemsa) | **India**; segmented single cells on black background | Blast detection: ALL lymphoblasts vs normal B lymphocytes (a hard stress test) |

**Steps:** *Runtime › Change runtime type › T4 GPU* (CPU also works) → run cell 1 → in cell 2 choose `cell_model.onnx` + `cell_labels.json` → *Runtime › Run all*. If asked, paste your Kaggle API token. About 20–30 minutes. Results are printed and saved as `external_validation_results.json` (downloads at the end).

> Research/teaching prototype. Not a medical device.
""")

code(r"""
# 1. Packages
import importlib.util, subprocess, sys
need = [p for p, m in [("onnxruntime-gpu" if __import__("shutil").which("nvidia-smi") else "onnxruntime", "onnxruntime"), ("kagglehub", "kagglehub"), ("scikit-learn", "sklearn")] if importlib.util.find_spec(m) is None]
if need: subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", *need])
print("✓ ready")
""")

code(r"""
# 2. Choose your model files: cell_model.onnx + cell_labels.json (hold Ctrl to select both)
import os, glob, json
WORK = "/content/extval"; os.makedirs(WORK, exist_ok=True)
try:
    from google.colab import files
    for name, data in files.upload().items(): open(os.path.join(WORK, name), "wb").write(data)
except ImportError:
    print("Not on Colab: put the files in", WORK)
ONNX = [p for p in glob.glob(f"{WORK}/*.onnx") if "rbc" not in p.lower() and "malaria" not in p.lower()][0]
META = json.load(open([p for p in glob.glob(f"{WORK}/*.json") if json.load(open(p)).get("format", "haem5-cell-v1") == "haem5-cell-v1"][0]))
print("Model:", os.path.basename(ONNX), "·", len(META["classes"]), "classes · blast threshold", META.get("thresholds", {}).get("blast"))
""")

code(r"""
# 3. Settings
MAX_PER_CLASS = 400      # cells sampled per class per dataset (keeps the run to ~20 min); set None for all
SEED = 42
RAABIN = "raabindata/raabin-wbc"
CNMC = "andrewmvd/leukemia-classification"
""")

code(r"""
# 4. Download (Kaggle). If anonymous download is refused, paste your Kaggle API token when asked.
import kagglehub, getpass
def get(slug):
    try: return kagglehub.dataset_download(slug)
    except Exception as e:
        if not os.environ.get("KAGGLE_API_TOKEN") and not os.path.exists(os.path.expanduser("~/.kaggle/kaggle.json")):
            os.environ["KAGGLE_API_TOKEN"] = getpass.getpass("Kaggle API token (kaggle.com › Settings › API › Create New Token): ").strip()
        return kagglehub.dataset_download(slug)
PATHS = {}
for name, slug in (("raabin", RAABIN), ("cnmc", CNMC)):
    try: PATHS[name] = get(slug); print("✓", name, PATHS[name])
    except Exception as e: print("✗", name, "could not be downloaded:", e)
""")

code(r"""
# 5. Index images and map each dataset's labels to the app's classes
import re, random, pandas as pd
random.seed(SEED)
IMG = (".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff")
def walk(root):
    for d, _, fs in os.walk(root):
        for f in fs:
            if f.lower().endswith(IMG): yield os.path.join(d, f)
rows = []
if "raabin" in PATHS:
    RAABIN_MAP = {"neutrophil": "neutrophil", "lymphocyte": "lymphocyte", "monocyte": "monocyte", "eosinophil": "eosinophil", "basophil": "basophil"}
    for p in walk(PATHS["raabin"]):
        parts = [x.lower() for x in p.split(os.sep)]
        lab = next((RAABIN_MAP[k] for k in RAABIN_MAP for x in parts if x.startswith(k)), None)
        if lab: rows.append({"ds": "Raabin-WBC", "path": p, "truth": lab, "subset": next((x for x in parts if x.startswith("test") or x.startswith("train")), "")})
if "cnmc" in PATHS:
    for p in walk(PATHS["cnmc"]):
        parts = [x.lower() for x in p.split(os.sep)]
        if "all" in parts: rows.append({"ds": "C-NMC 2019", "path": p, "truth": "blast", "subset": ""})
        elif "hem" in parts: rows.append({"ds": "C-NMC 2019", "path": p, "truth": "normal lymphocyte", "subset": ""})
df = pd.DataFrame(rows, columns=["ds", "path", "truth", "subset"]).drop_duplicates("path")
assert len(df), "No images found — check that the downloads in cell 4 succeeded."
if MAX_PER_CLASS:
    df = pd.concat([g.sample(min(len(g), MAX_PER_CLASS), random_state=SEED) for _, g in df.groupby(["ds", "truth"])]).reset_index(drop=True)
print(df.groupby(["ds", "truth"]).size().to_string())
""")

code(r"""
# 6. Classify exactly as the app does: resize to 224, 4 rotations averaged, absent classes masked, blast threshold applied
import numpy as np, onnxruntime as ort
from PIL import Image
prov = ["CUDAExecutionProvider", "CPUExecutionProvider"] if "CUDAExecutionProvider" in ort.get_available_providers() else ["CPUExecutionProvider"]
sess = ort.InferenceSession(ONNX, providers=prov); INP = sess.get_inputs()[0].name
C = META["classes"]; SIZE = META.get("img_size", 224); THR = META.get("thresholds", {}).get("blast")
allowed = np.array([c in set(META.get("present_classes", C)) for c in C])
mean = np.array(META["mean"], dtype=np.float32).reshape(3, 1, 1); std = np.array(META["std"], dtype=np.float32).reshape(3, 1, 1)
def tensor(p):
    a = np.asarray(Image.open(p).convert("RGB").resize((SIZE, SIZE), Image.BICUBIC), dtype=np.float32).transpose(2, 0, 1) / 255
    a = (a - mean) / std
    return np.stack([np.rot90(a, k, axes=(1, 2)) for k in range(4)])
def softmax(z): z = z - z.max(1, keepdims=True); e = np.exp(z); return e / e.sum(1, keepdims=True)
preds, pblast = [], []
B = 16
for i in range(0, len(df), B):
    chunk = df.path.iloc[i:i + B].tolist(); x = np.concatenate([tensor(p) for p in chunk]).astype(np.float32)
    lg = sess.run(None, {INP: x})[0]; lg[:, ~allowed] = -1e9
    pr = softmax(lg).reshape(len(chunk), 4, -1).mean(1)
    for row in pr:
        k = int(row.argmax()); b = C.index("blast")
        if THR and k != b and row[b] >= THR: k = b
        preds.append(C[k]); pblast.append(float(row[b]))
    if i % 800 == 0: print(f"{i}/{len(df)}")
df["pred"], df["p_blast"] = preds, pblast
""")

code(r"""
# 7. Results
from sklearn.metrics import accuracy_score, f1_score, cohen_kappa_score, confusion_matrix, classification_report
RES = {}
# Raabin-WBC: 5-part differential (app classes collapsed to the 5 normal types)
COLLAPSE = {"segmented_neutrophil": "neutrophil", "band_neutrophil": "neutrophil", "lymphocyte": "lymphocyte", "atypical_lymphocyte": "lymphocyte",
            "immature_lymphocyte": "lymphocyte", "monocyte": "monocyte", "eosinophil": "eosinophil", "basophil": "basophil"}
r = df[df.ds == "Raabin-WBC"].copy()
if len(r):
    r["pred5"] = r.pred.map(lambda c: COLLAPSE.get(c, "other (" + c + ")"))
    labs = ["neutrophil", "lymphocyte", "monocyte", "eosinophil", "basophil"]
    print("=== Raabin-WBC (Iran; different microscopes/cameras) ===")
    print(classification_report(r.truth, r.pred5.where(r.pred5.isin(labs), "other"), labels=labs, digits=3, zero_division=0))
    RES["raabin"] = {"n": int(len(r)), "accuracy": float(accuracy_score(r.truth, r.pred5)),
                     "macro_f1": float(f1_score(r.truth, r.pred5, labels=labs, average="macro", zero_division=0)),
                     "kappa": float(cohen_kappa_score(r.truth, r.pred5)), "false_blast_rate": float((r.pred == "blast").mean()),
                     "per_class_recall": {l: float((r[r.truth == l].pred5 == l).mean()) for l in labs if (r.truth == l).any()}}
    print({k: (round(v, 3) if isinstance(v, float) else v) for k, v in RES["raabin"].items() if k != "per_class_recall"})
    print("Normal cells wrongly called blast:", f"{100 * RES['raabin']['false_blast_rate']:.1f}%")
# C-NMC: blast detection
c = df[df.ds == "C-NMC 2019"].copy()
if len(c):
    y = (c.truth == "blast").values; yhat = (c.pred == "blast").values
    tp, fn, fp, tn = (y & yhat).sum(), (y & ~yhat).sum(), (~y & yhat).sum(), (~y & ~yhat).sum()
    from sklearn.metrics import roc_auc_score
    RES["cnmc"] = {"n": int(len(c)), "sensitivity": float(tp / max(1, tp + fn)), "specificity": float(tn / max(1, tn + fp)),
                   "ppv": float(tp / max(1, tp + fp)), "auc_p_blast": float(roc_auc_score(y, c.p_blast))}
    print("\n=== C-NMC 2019 (India; ALL lymphoblasts vs normal lymphocytes) ===")
    print({k: (round(v, 3) if isinstance(v, float) else v) for k, v in RES["cnmc"].items()})
    print("What normal lymphocytes were called:", c[~y].pred.value_counts().head(5).to_dict())
    print("What lymphoblasts were called:", c[y].pred.value_counts().head(5).to_dict())
json.dump(RES, open(f"{WORK}/external_validation_results.json", "w"), indent=2)
try:
    from google.colab import files; files.download(f"{WORK}/external_validation_results.json")
except ImportError:
    pass
print("\nPaste the printed results (or the JSON file) back to Claude.")
""")

nb = {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"provenance": []}, "kernelspec": {"display_name": "Python 3", "name": "python3"},
      "language_info": {"name": "python"}}, "nbformat": 4, "nbformat_minor": 5}
for c in cells:
    if c["cell_type"] == "code": ast.parse(c["source"])
out = sys.argv[1] if len(sys.argv) > 1 else "HAEM5_external_validation.ipynb"
json.dump(nb, open(out, "w"), indent=1); print("wrote", out)
