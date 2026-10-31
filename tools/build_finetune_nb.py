"""Builds HAEM5_finetune_local_stain.ipynb — adapts the white-cell model to a laboratory's own stain (e.g. Leishman)
using cells exported from the app's gallery with the pathologist's confirmed labels."""
import ast, json, sys

cells = []
def md(s): cells.append({"cell_type": "markdown", "metadata": {}, "source": s.strip("\n")})
def code(s): cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": s.strip("\n")})

md(r"""
# HAEM5 Reporter — fine-tune the white-cell or red-cell model on your stain (Leishman)

The original model learned from May-Grünwald-Giemsa smears (Munich, Barcelona). This notebook adapts it to **your laboratory's stain** using the cells you reviewed in the app.

**You need:**
1. Zip files exported from the app — **either** white cells (`haem5_wbc_….zip`, *Cell gallery › Export reviewed cells*) **or** red cells (`haem5_rbc_….zip`, *Review & correct red cells › Export reviewed red cells*). Run the notebook once per model. Aim for **≥30 cells per common type and ≥300 cells in total**, from **≥10 different slides**.
2. The matching current model: `cell_model.onnx` + `cell_labels.json` (white cells) **or** `rbc_model.onnx` + `rbc_labels.json` (red cells).

**Steps:** *Runtime › Change runtime type › T4 GPU* → run cell 1 → in cell 2 choose all the files → *Runtime › Run all* below it (about 5–15 minutes).

**What it reports:** accuracy on held-out slides of **your** stain **before and after** fine-tuning — good evidence for your capstone. Slides used for testing are never used for training. **Safeguard:** the best epoch is chosen on separate validation slides, and the new model is offered for download only if it is better than your current one.

> Research/teaching prototype. Not a medical device.
""")

code(r"""
# 1. Packages
import importlib.util, subprocess, sys
need = [p for p, m in [("onnx2torch", "onnx2torch"), ("onnx", "onnx"), ("onnxruntime", "onnxruntime"), ("scikit-learn", "sklearn")] if importlib.util.find_spec(m) is None]
if need: subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", *need])
import torch; print("GPU:", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "none (CPU works, slower)")
""")

code(r"""
# 2. Choose files: all exported .zip files + cell_model.onnx + cell_labels.json (hold Ctrl to select several)
import os, glob
WORK = "/content/finetune"; os.makedirs(WORK, exist_ok=True)
try:
    from google.colab import files
    up = files.upload()
    for name, data in up.items(): open(os.path.join(WORK, name), "wb").write(data)
except ImportError:
    print("Not on Colab: put the files in", WORK)
print(sorted(os.listdir(WORK)))
""")

code(r"""
# 3. Settings
EPOCHS = 10            # small data: a few passes are enough
LR = 1e-4              # gentle — keeps what the model already knows
FREEZE_FRAC = 0.7      # first 70% of layers stay fixed; only the later layers adapt to the new colours
TEST_FRAC = 0.25       # share of SLIDES held out for testing
SEED = 42
# Gallery labels that are blast equivalents or not in the model
LABEL_MAP = {"monoblast": "blast", "promonocyte": "blast"}
""")

code(r"""
# 4. Read the exported cells
import zipfile, io, json, pandas as pd, numpy as np
from PIL import Image
zips = glob.glob(f"{WORK}/*.zip")
KIND = "rbc" if any(n.startswith("rbc/") for zp in zips for n in zipfile.ZipFile(zp).namelist()) else "wbc"
def fmt(p):
    try: return json.load(open(p)).get("format", "")
    except Exception: return ""
jsons = [p for p in glob.glob(f"{WORK}/*.json") if (fmt(p) == "haem5-rbc-v1") == (KIND == "rbc") and fmt(p) != "haem5-malaria-v1"]
onnxs = [p for p in glob.glob(f"{WORK}/*.onnx") if ("rbc" in os.path.basename(p).lower()) == (KIND == "rbc") and "malaria" not in p.lower()]
assert jsons and onnxs, f"Upload the {'rbc_model.onnx + rbc_labels.json' if KIND == 'rbc' else 'cell_model.onnx + cell_labels.json'} files too."
meta = json.load(open(sorted(jsons)[0])); CLASSES = meta["classes"]; onnx_path = sorted(onnxs)[0]
if KIND == "rbc": LABEL_MAP.clear()
print("Model being fine-tuned:", "RED CELLS" if KIND == "rbc" else "WHITE CELLS", "·", os.path.basename(onnx_path))
rows = []
for zp in zips:
    z = zipfile.ZipFile(zp); lab = pd.read_csv(io.BytesIO(z.read("labels.csv")))
    if lab.file.str.startswith("rbc/").any() != (KIND == "rbc"): print("skipping", os.path.basename(zp), "(other model)"); continue
    for _, r in lab.iterrows():
        rows.append({"zip": zp, "file": r.file, "label": LABEL_MAP.get(r.label, r.label), "ai_pred": r.ai_pred if isinstance(r.ai_pred, str) else "",
                     "case": r.case, "stain": r.stain})
df = pd.DataFrame(rows)
skipped = df[~df.label.isin(CLASSES)].label.value_counts()
df = df[df.label.isin(CLASSES)].reset_index(drop=True); df["y"] = df.label.map(CLASSES.index)
print(f"{len(df)} cells from {df.case.nunique()} slide(s) · stain: {', '.join(df.stain.unique())}")
if len(skipped): print("Not in the model, skipped:", dict(skipped))
print(df.label.value_counts().to_string())
assert len(df) >= 40, "Too few cells — export more reviewed cells from the app (aim for ≥300)."
""")

code(r"""
# 5. Split by SLIDE, so test slides are never seen in training
from sklearn.model_selection import GroupShuffleSplit, train_test_split
if df.case.nunique() >= 4:
    tr, te = next(GroupShuffleSplit(n_splits=1, test_size=TEST_FRAC, random_state=SEED).split(df, groups=df.case))
    df["split"] = "train"; df.loc[df.index[te], "split"] = "test"
    rest = df[df.split == "train"]
    if rest.case.nunique() >= 4:   # a validation slide set picks the best epoch, so the test slides are used only once
        _, va = next(GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED).split(rest, groups=rest.case))
        df.loc[rest.index[va], "split"] = "val"
else:
    print("⚠ Fewer than 4 slides: splitting by cell instead — results will look better than they really are. Export more slides.")
    tr, te = train_test_split(df.index, test_size=TEST_FRAC, random_state=SEED, stratify=df.y if df.y.value_counts().min() > 1 else None)
    df["split"] = "train"; df.loc[te, "split"] = "test"
print(pd.crosstab(df.label, df.split).to_string())
""")

code(r"""
# 6. Data — same preprocessing as the app (crop resized to 224 px, ImageNet normalisation)
import torch, torchvision.transforms as T
from torch.utils.data import Dataset, DataLoader
torch.manual_seed(SEED)
SIZE = meta.get("img_size", 224); MEAN, STD = meta["mean"], meta["std"]   # red cells: exported crops are already the model's 128-px input
ZIPS = {zp: zipfile.ZipFile(zp) for zp in df.zip.unique()}
train_tf = T.Compose([T.Resize((SIZE, SIZE)), T.RandomRotation(180), T.RandomHorizontalFlip(), T.RandomVerticalFlip(),
                      T.ColorJitter(0.2, 0.2, 0.2, 0.03), T.ToTensor(), T.Normalize(MEAN, STD)])
eval_tf = T.Compose([T.Resize((SIZE, SIZE)), T.ToTensor(), T.Normalize(MEAN, STD)])
class Cells(Dataset):
    def __init__(self, d, tf): self.d, self.tf = d.reset_index(drop=True), tf
    def __len__(self): return len(self.d)
    def __getitem__(self, i):
        r = self.d.iloc[i]; im = Image.open(io.BytesIO(ZIPS[r.zip].read(r.file))).convert("RGB")
        return self.tf(im), int(r.y)
dl_tr = DataLoader(Cells(df[df.split == "train"], train_tf), batch_size=32, shuffle=True, num_workers=2)
dl_te = DataLoader(Cells(df[df.split == "test"], eval_tf), batch_size=64, num_workers=2)
dl_va = DataLoader(Cells(df[df.split == "val"], eval_tf), batch_size=64, num_workers=2) if (df.split == "val").any() else None
""")

code(r"""
# 7. Load your model from ONNX as a trainable PyTorch model and measure it BEFORE fine-tuning
import onnx2torch, onnxruntime as ort
from sklearn.metrics import accuracy_score, f1_score, classification_report
dev = "cuda" if torch.cuda.is_available() else "cpu"
model = onnx2torch.convert(onnx_path).to(dev)
present = sorted(df.y.unique())
def evaluate(loader=None):
    loader = loader or dl_te; model.eval(); P, Y = [], []
    with torch.no_grad():
        for x, y in loader: P.append(model(x.to(dev)).argmax(1).cpu()); Y.append(y)
    P, Y = torch.cat(P).numpy(), torch.cat(Y).numpy()
    lab = sorted(np.unique(Y))   # macro-F1 over the cell types actually present in this set
    return {"accuracy": accuracy_score(Y, P), "macro_f1": f1_score(Y, P, labels=lab, average="macro", zero_division=0)}, P, Y
BEFORE, Pb, Yt = evaluate(); print("Before fine-tuning:", {k: round(v, 3) for k, v in BEFORE.items()})
""")

code(r"""
# 8. Fine-tune the later layers (batch-norm statistics kept fixed, which is safest with small data)
import torch.nn as nn, copy
params = list(model.parameters())
for p in params[:int(len(params) * FREEZE_FRAC)]: p.requires_grad = False
cnt = np.bincount(df[df.split == "train"].y, minlength=len(CLASSES)).astype(float)
w = np.where(cnt > 0, np.sqrt(cnt.sum() / (len(present) * np.maximum(cnt, 1))), 0.0); w = np.clip(w, 0.5, 3.0)   # gentle: rare types are not over-called
crit = nn.CrossEntropyLoss(weight=torch.tensor(w, dtype=torch.float32, device=dev), label_smoothing=0.05)
opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=LR, weight_decay=1e-4)
score = lambda r: r["macro_f1"] + r["accuracy"]
base_val = evaluate(dl_va)[0] if dl_va else None
best_state, best_score, best_ep = copy.deepcopy(model.state_dict()), (score(base_val) if base_val else -1), 0
for ep in range(1, EPOCHS + 1):
    model.eval(); tl = 0   # eval mode = frozen batch-norm statistics; gradients still flow
    for x, y in dl_tr:
        x, y = x.to(dev), y.to(dev); opt.zero_grad(); loss = crit(model(x), y); loss.backward(); opt.step(); tl += loss.item()
    msg = f"Ep {ep:02d} loss {tl / max(1, len(dl_tr)):.3f}"
    if dl_va:
        v = evaluate(dl_va)[0]; msg += f" | validation acc {v['accuracy']:.3f} macro-F1 {v['macro_f1']:.3f}"
        if score(v) > best_score: best_score, best_ep, best_state = score(v), ep, copy.deepcopy(model.state_dict()); msg += "  ★"
    else: best_state, best_ep = copy.deepcopy(model.state_dict()), ep
    print(msg)
model.load_state_dict(best_state)
if best_ep == 0: print("\nNo epoch beat the original model on the validation slides — keeping the original.")
AFTER, Pa, _ = evaluate()
IMPROVED = AFTER["accuracy"] >= BEFORE["accuracy"] and AFTER["macro_f1"] >= BEFORE["macro_f1"] and best_ep > 0
print("\nBefore:", {k: round(v, 3) for k, v in BEFORE.items()}, "\nAfter: ", {k: round(v, 3) for k, v in AFTER.items()}, f"(best epoch {best_ep})")
print(classification_report(Yt, Pa, labels=sorted(np.unique(Yt)), target_names=[CLASSES[i] for i in sorted(np.unique(Yt))], digits=3, zero_division=0))
print("✅ Fine-tuned model is better on held-out slides — use it." if IMPROVED else
      "⚠ Fine-tuning did NOT improve the held-out slides. Keep your current model; export more reviewed cells from more slides and try again.")
""")

code(r"""
# 9. Export the adapted model for the app (load with "Load model files" — it replaces the built-in model for that session)
model.eval().cpu(); dummy = next(iter(dl_te))[0][:8]   # real cells: random noise exaggerates harmless rounding differences
stem = "rbc" if KIND == "rbc" else "cell"
out_onnx = f"{WORK}/{stem}_model_{df.stain.iloc[0].split('-')[0].lower()}.onnx"
torch.onnx.export(model, dummy, out_onnx, input_names=["input"], output_names=["logits"],
                  dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}}, opset_version=17, dynamo=False)
with torch.no_grad(): ref = model(dummy).numpy()
print("ONNX ✓ max difference", float(abs(ort.InferenceSession(out_onnx).run(None, {"input": dummy.numpy()})[0] - ref).max()))
m2 = dict(meta); m2["fine_tuned_on"] = {"stain": ", ".join(df.stain.unique()), "cells": int((df.split == "train").sum()), "slides": int(df[df.split == "train"].case.nunique())}
m2["local_test"] = {"before": {k: float(v) for k, v in BEFORE.items()}, "after": {k: float(v) for k, v in AFTER.items()},
                    "cells": int((df.split == "test").sum()), "slides": int(df[df.split == "test"].case.nunique())}
m2["model"] = meta.get("model", "efficientnet_b0") + " (fine-tuned)"
out_json = out_onnx.replace(f"{stem}_model", f"{stem}_labels").replace(".onnx", ".json"); json.dump(m2, open(out_json, "w"), indent=2)
if IMPROVED:
    try:
        from google.colab import files; files.download(out_onnx); files.download(out_json)
    except ImportError:
        print("Saved:", out_onnx, out_json)
else:
    print("Not downloaded because it is not better than your current model. Files are still in", WORK, "if you want to inspect them.")
""")

nb = {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"provenance": []}, "kernelspec": {"display_name": "Python 3", "name": "python3"},
      "language_info": {"name": "python"}}, "nbformat": 4, "nbformat_minor": 5}
for c in cells:
    if c["cell_type"] == "code": ast.parse(c["source"])
out = sys.argv[1] if len(sys.argv) > 1 else "HAEM5_finetune_local_stain.ipynb"
json.dump(nb, open(out, "w"), indent=1); print("wrote", out)
