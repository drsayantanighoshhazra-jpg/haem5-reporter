"""Builds HAEM5_compare_v1_v2.ipynb — head-to-head external test of two white-cell models on cells neither was trained on."""
import ast, json, sys

cells = []
def md(s): cells.append({"cell_type": "markdown", "metadata": {}, "source": s.strip("\n")})
def code(s): cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": s.strip("\n")})

md(r"""
# HAEM5 Reporter — v1 vs v2 head-to-head

Tests both white-cell models, exactly as the app runs them (crop resized to the model's size, 4 rotations averaged), on cells **neither model was trained on**:

- **Raabin-WBC Test-B** (Iran; held out of v2's training; v1 never saw Raabin at all)
- **C-NMC 2019** (India; ALL lymphoblasts vs normal lymphocytes; never trained on)

**Steps:** *Runtime › Change runtime type › T4 GPU* → run cell 1 → in cell 2 choose **all four files**: v1 `cell_model.onnx` + `cell_labels.json` **and** v2 `cell_model.onnx` + `cell_labels.json` (names like `cell_model (1).onnx` are fine — the notebook tells the models apart by their input size, 224 vs 256) → *Runtime › Run all*. About 15 minutes. Paste the final table back to Claude.
""")

code(r"""
# 1. Packages
import importlib.util, subprocess, sys
need = [p for p, m in [("onnxruntime-gpu" if __import__("shutil").which("nvidia-smi") else "onnxruntime", "onnxruntime"), ("kagglehub", "kagglehub"), ("scikit-learn", "sklearn"), ("onnx", "onnx")] if importlib.util.find_spec(m) is None]
if need: subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", *need])
print("✓ ready")
""")

code(r"""
# 2. Choose all four model files (v1 + v2: .onnx and .json each)
import os, glob, json
WORK = "/content/compare"; os.makedirs(WORK, exist_ok=True)
try:
    from google.colab import files
    for name, data in files.upload().items(): open(os.path.join(WORK, name), "wb").write(data)
except ImportError:
    print("Not on Colab: put the files in", WORK)
import onnxruntime as ort
MODELS = {}
metas = [json.load(open(p)) for p in glob.glob(f"{WORK}/*.json")]
for p in glob.glob(f"{WORK}/*.onnx"):
    s = ort.InferenceSession(p, providers=[x for x in ("CUDAExecutionProvider", "CPUExecutionProvider") if x in ort.get_available_providers()])
    H = s.get_inputs()[0].shape[2]
    m = next((m for m in metas if m.get("img_size") == H and m.get("format", "haem5-cell-v1") == "haem5-cell-v1"), None)
    if m is None: print("⚠ no labels file with img_size", H, "for", os.path.basename(p)); continue
    name = m.get("version", "v1" if H == 224 else f"model {H}px")
    MODELS[name] = {"sess": s, "meta": m, "size": H}
    print(f"✓ {name}: {os.path.basename(p)} · input {H}px")
assert len(MODELS) >= 2, "Upload both models' .onnx and .json files."
""")

code(r"""
# 3. Download the external sets (Kaggle token if asked)
import kagglehub, getpass
def kget(slug):
    try: return kagglehub.dataset_download(slug)
    except Exception:
        if not os.environ.get("KAGGLE_API_TOKEN"): os.environ["KAGGLE_API_TOKEN"] = getpass.getpass("Kaggle API token: ").strip()
        return kagglehub.dataset_download(slug)
RAABIN, CNMC = kget("raabindata/raabin-wbc"), kget("andrewmvd/leukemia-classification"); print("✓ downloaded")
""")

code(r"""
# 4. Index: Raabin Test-B only (the part held out of v2's training) and C-NMC
import pandas as pd, numpy as np
IMG = (".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"); rows = []
T5 = {"neutrophil": "neutrophil", "lymphocyte": "lymphocyte", "monocyte": "monocyte", "eosinophil": "eosinophil", "basophil": "basophil"}
for d, _, fs in os.walk(RAABIN):
    parts = [x.lower() for x in d.split(os.sep)]
    if not any("testb" in x.replace("-", "").replace("_", "") for x in parts): continue
    lab = next((T5[k] for k in T5 for x in parts if x.startswith(k)), None)
    if lab: rows += [{"set": "Raabin Test-B", "path": os.path.join(d, f), "truth": lab} for f in fs if f.lower().endswith(IMG)]
for d, _, fs in os.walk(CNMC):
    parts = [x.lower() for x in d.split(os.sep)]
    t = "blast" if "all" in parts else "normal lymphocyte" if "hem" in parts else None
    if t: rows += [{"set": "C-NMC 2019", "path": os.path.join(d, f), "truth": t} for f in fs if f.lower().endswith(IMG)]
df = pd.DataFrame(rows)
df = pd.concat([g.sample(min(len(g), 400), random_state=42) for _, g in df.groupby(["set", "truth"])]).reset_index(drop=True)
print(df.groupby(["set", "truth"]).size().to_string())
""")

code(r"""
# 5. Classify with each model exactly as the app does
from PIL import Image, ImageFile
ImageFile.LOAD_TRUNCATED_IMAGES = True
def run(model):
    s, m, H = model["sess"], model["meta"], model["size"]; C = m["classes"]
    mean = np.array(m["mean"], dtype=np.float32).reshape(3, 1, 1); std = np.array(m["std"], dtype=np.float32).reshape(3, 1, 1)
    allowed = np.array([c in set(m.get("present_classes", C)) for c in C]); out = []
    for i in range(0, len(df), 16):
        xs = []
        for p in df.path.iloc[i:i + 16]:
            try: a = np.asarray(Image.open(p).convert("RGB").resize((H, H), Image.BICUBIC), dtype=np.float32).transpose(2, 0, 1) / 255
            except Exception: a = np.zeros((3, H, H), np.float32)
            a = (a - mean) / std; xs += [np.rot90(a, k, axes=(1, 2)) for k in range(4)]
        lg = s.run(None, {s.get_inputs()[0].name: np.ascontiguousarray(np.stack(xs), dtype=np.float32)})[0]; lg[:, ~allowed] = -1e9
        e = np.exp(lg - lg.max(1, keepdims=True)); pr = (e / e.sum(1, keepdims=True)).reshape(-1, 4, len(C)).mean(1); out.append(pr)
    return np.concatenate(out)
PROBS = {n: run(m) for n, m in MODELS.items()}; print("✓ classified")
""")

code(r"""
# 6. Head-to-head results (same cells, same rules; blast threshold 0.15 = v1's calibrated value, also applied to v2)
from sklearn.metrics import f1_score, cohen_kappa_score, roc_auc_score
COLLAPSE = {"segmented_neutrophil": "neutrophil", "band_neutrophil": "neutrophil", "lymphocyte": "lymphocyte", "atypical_lymphocyte": "lymphocyte",
            "immature_lymphocyte": "lymphocyte", "monocyte": "monocyte", "eosinophil": "eosinophil", "basophil": "basophil"}
R, rows = df.set == "Raabin Test-B", []
for n, P in PROBS.items():
    C = MODELS[n]["meta"]["classes"]; b = C.index("blast")
    for rule, thr in (("argmax", None), ("blast thr 0.15", 0.15)):
        k = P.argmax(1).copy()
        if thr: k[P[:, b] >= thr] = b
        lab = np.array([C[i] for i in k]); r = {"model": n, "rule": rule}
        if R.any():
            pr = np.array([COLLAPSE.get(c, "other") for c in lab[R]]); tr = df.truth[R].values; L = sorted(set(tr))
            r.update({"Raabin acc": (pr == tr).mean(), "Raabin macro-F1": f1_score(tr, pr, labels=L, average="macro", zero_division=0),
                      **{f"Raabin {l} recall": (pr[tr == l] == l).mean() for l in L}, "Raabin false blast": (lab[R] == "blast").mean()})
        c = (df.set == "C-NMC 2019").values
        if c.any():
            y = (df.truth[c] == "blast").values; yh = lab[c] == "blast"
            r.update({"C-NMC sens": (y & yh).sum() / max(y.sum(), 1), "C-NMC spec": (~y & ~yh).sum() / max((~y).sum(), 1), "C-NMC AUC": roc_auc_score(y, P[c][:, b])})
        rows.append(r)
TABLE = pd.DataFrame(rows).set_index(["model", "rule"]).round(3)
pd.set_option("display.width", 200); print(TABLE.T.to_string())
TABLE.to_csv(f"{WORK}/v1_vs_v2.csv")
print("\nPaste this table back to Claude.")
""")

nb = {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"provenance": []}, "kernelspec": {"display_name": "Python 3", "name": "python3"},
      "language_info": {"name": "python"}}, "nbformat": 4, "nbformat_minor": 5}
for c in cells:
    if c["cell_type"] == "code": ast.parse(c["source"])
out = sys.argv[1] if len(sys.argv) > 1 else "HAEM5_compare_v1_v2.ipynb"
json.dump(nb, open(out, "w"), indent=1); print("wrote", out)
