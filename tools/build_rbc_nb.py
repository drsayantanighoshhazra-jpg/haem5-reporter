"""Builds HAEM5_RBC_model_training.ipynb — red cell morphology classifier for the HAEM5 Reporter app."""
import ast, json, sys

cells = []
def md(s): cells.append({"cell_type": "markdown", "metadata": {}, "source": s.strip("\n")})
def code(s): cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": s.strip("\n")})

md(r"""
# HAEM5 Reporter — red cell morphology model (Colab)

Trains the **red cell** classifier used by the HAEM5 Reporter app. From each slide photo the app finds every red cell, crops it, and this model labels it; the counts become **ICSH grades** (2+ / 3+) and a **schistocyte %**, which the pathologist reviews.

**Dataset:** Chula RBC-12 (Naruenatthanaset et al., 2021; MIT licence) — 1000× blood-film images with ~22,000 expert-labelled red cells. Downloaded from GitHub automatically (no Kaggle key needed).

**Classes:** normal · macrocyte · microcyte · spherocyte · target cell · stomatocyte · ovalocyte · teardrop · burr cell (echinocyte) · schistocyte · hypochromia · elliptocyte

**Steps**
1. *Runtime › Change runtime type › T4 GPU › Save*.
2. *Runtime › Run all*. It takes about 20–30 minutes.
3. At the end, `rbc_model.onnx` and `rbc_labels.json` download automatically. Load both in the app (*Differential counter › AI-assisted count › Load model files*), together with or after your white-cell model.

**Not covered by this dataset** (keep grading these by eye in the app): sickle cells, acanthocytes, polychromasia, basophilic stippling, Howell–Jolly and Pappenheimer bodies, rouleaux, parasites.

> Research/teaching prototype. Not a medical device; outputs require pathologist verification.
""")

code(r"""
# 1. GPU check and packages
import importlib.util, subprocess, sys, torch
print("GPU:", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "NONE — Runtime › Change runtime type › T4 GPU")
need = [p for p, m in [("timm", "timm"), ("onnx", "onnx"), ("onnxruntime", "onnxruntime"), ("scikit-learn", "sklearn")] if importlib.util.find_spec(m) is None]
if need: subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", *need])
print("✓ Packages ready")
""")

code(r"""
# 2. Settings
import os
REPO = "https://github.com/Chula-PIC-Lab/Chula-RBC-12-Dataset"
DATA_DIR = "/content/chula"
CROP_DIR = "/content/rbc_crops"
OUT_DIR = "/content/haem5_rbc_model"

# App vocabulary (order = model output order). Do not rename — the app relies on these keys.
CLASSES = ["normal", "macrocyte", "microcyte", "spherocyte", "target_cell", "stomatocyte",
           "ovalocyte", "teardrop", "burr_cell", "schistocyte", "hypochromia", "elliptocyte"]
CHULA_CODE = {0: "normal", 1: "macrocyte", 2: "microcyte", 3: "spherocyte", 4: "target_cell", 5: "stomatocyte",
              6: "ovalocyte", 7: "teardrop", 8: "burr_cell", 9: "schistocyte", 11: "hypochromia", 12: "elliptocyte"}   # 10 = uncategorised, skipped

# Scale: the app crops a square of 2.0 red-cell diameters around each cell. The median red cell in
# Chula images is ~39 px (measured with the app's own detector), so training crops are 2.0 × 39 = 78 px.
RBC_DIAMETER_PX = 39
CROP_DIAMETERS = 2.0
CROP = round(CROP_DIAMETERS * RBC_DIAMETER_PX)      # 78 px
STORE = round(CROP * 1.5)                           # stored larger so rotation/shift augmentation has real pixels
IMG_SIZE = 128
EPOCHS = 25
BATCH = 128
SEED = 42
os.makedirs(OUT_DIR, exist_ok=True)
print(f"crop {CROP}px → {IMG_SIZE}px input · {len(CLASSES)} classes")
""")

code(r"""
# 3. Download the dataset (about 350 MB)
import subprocess, os
if not os.path.isdir(f"{DATA_DIR}/Label"):
    subprocess.check_call(["git", "clone", "-q", "--depth", "1", REPO, DATA_DIR])
imgs = sorted(f for f in os.listdir(f"{DATA_DIR}/Dataset") if f.endswith(".jpg"))
labs = sorted(f for f in os.listdir(f"{DATA_DIR}/Label") if f.endswith(".txt"))
print(f"✓ {len(imgs)} smear images, {len(labs)} label files")
""")

code(r"""
# 4. Cut one crop per labelled red cell (grouped by smear image so the split never leaks a field)
import numpy as np, pandas as pd, os
from PIL import Image
os.makedirs(CROP_DIR, exist_ok=True)
rows, half = [], STORE // 2
for lf in labs:
    stem = lf[:-4]; ip = f"{DATA_DIR}/Dataset/{stem}.jpg"
    if not os.path.exists(ip): continue
    im = np.asarray(Image.open(ip).convert("RGB"))
    pad = np.pad(im, ((half, half), (half, half), (0, 0)), mode="edge")
    for k, line in enumerate(open(f"{DATA_DIR}/Label/{lf}").read().split("\n")):
        p = line.split()
        if len(p) < 3: continue
        x, y, t = int(float(p[0])), int(float(p[1])), int(float(p[2]))
        if t not in CHULA_CODE: continue
        crop = pad[y:y + STORE, x:x + STORE]          # centred on (x, y) after padding
        if crop.shape[:2] != (STORE, STORE): continue
        fp = f"{CROP_DIR}/{stem}_{k}.png"
        if not os.path.exists(fp): Image.fromarray(crop).save(fp)
        rows.append({"path": fp, "cls": CHULA_CODE[t], "image": stem})
df = pd.DataFrame(rows)
print(f"✓ {len(df)} red-cell crops from {df.image.nunique()} images")
print(df.cls.value_counts().reindex(CLASSES).to_string())
""")

code(r"""
# 5. Split 70 / 15 / 15, stratified by class and grouped by smear image
from sklearn.model_selection import StratifiedGroupKFold
df["y"] = df.cls.map({c: i for i, c in enumerate(CLASSES)})
sgk = StratifiedGroupKFold(n_splits=7, shuffle=True, random_state=SEED)
folds = list(sgk.split(df, df.y, groups=df.image))
df["split"] = "train"
df.loc[df.index[folds[0][1]], "split"] = "test"
df.loc[df.index[folds[1][1]], "split"] = "val"
assert not (set(df[df.split == "test"].image) & set(df[df.split != "test"].image)), "image leak"
df.to_csv(f"{OUT_DIR}/rbc_split_manifest.csv", index=False)
print(pd.crosstab(df.cls, df.split).reindex(CLASSES).to_string())
""")

code(r"""
# 6. Look at a few crops per class — you are the ground truth here
import matplotlib.pyplot as plt
fig, ax = plt.subplots(len(CLASSES), 6, figsize=(9, 1.6 * len(CLASSES)))
for i, c in enumerate(CLASSES):
    sub = df[df.cls == c].sample(min(6, (df.cls == c).sum()), random_state=SEED)
    for j in range(6):
        ax[i, j].axis("off")
        if j < len(sub):
            im = Image.open(sub.path.iloc[j]); o = (STORE - CROP) // 2
            ax[i, j].imshow(im.crop((o, o, o + CROP, o + CROP)))
    ax[i, 0].set_title(c, fontsize=8, loc="left")
plt.tight_layout(); plt.show()
""")

code(r"""
# 7. Data loaders — rotation, shift (±0.2 cell diameters), scale and colour augmentation
import torch, torchvision.transforms as T
from torch.utils.data import Dataset, DataLoader
torch.manual_seed(SEED)
MEAN, STD = [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]
shift = 0.2 * RBC_DIAMETER_PX / STORE
train_tf = T.Compose([T.RandomAffine(degrees=180, translate=(shift, shift), scale=(0.9, 1.1), fill=(232, 224, 226)),
                      T.CenterCrop(CROP), T.Resize(IMG_SIZE), T.RandomHorizontalFlip(), T.RandomVerticalFlip(),
                      T.ColorJitter(0.25, 0.25, 0.25, 0.03), T.ToTensor(), T.Normalize(MEAN, STD)])
eval_tf = T.Compose([T.CenterCrop(CROP), T.Resize(IMG_SIZE), T.ToTensor(), T.Normalize(MEAN, STD)])
class Cells(Dataset):
    def __init__(self, d, tf): self.p, self.y, self.tf = d.path.tolist(), d.y.tolist(), tf
    def __len__(self): return len(self.p)
    def __getitem__(self, i): return self.tf(Image.open(self.p[i]).convert("RGB")), self.y[i]
dl = {s: DataLoader(Cells(df[df.split == s], train_tf if s == "train" else eval_tf), batch_size=BATCH,
                    shuffle=(s == "train"), num_workers=2, pin_memory=True) for s in ("train", "val", "test")}
print({s: len(d.dataset) for s, d in dl.items()})
""")

code(r"""
# 8. Train EfficientNet-B0 (ImageNet weights), class-weighted loss capped at 10, best epoch by validation macro-F1
import timm, numpy as np, torch.nn as nn
from sklearn.metrics import f1_score
dev = "cuda" if torch.cuda.is_available() else "cpu"
model = timm.create_model("efficientnet_b0", pretrained=True, num_classes=len(CLASSES), drop_rate=0.2).to(dev)
cnt = np.bincount(df[df.split == "train"].y, minlength=len(CLASSES)).astype(float)
w = cnt.sum() / (len(CLASSES) * np.maximum(cnt, 1)); w = np.minimum(w, 10.0)
criterion = nn.CrossEntropyLoss(weight=torch.tensor(w, dtype=torch.float32, device=dev), label_smoothing=0.05)
opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=1e-3, epochs=EPOCHS, steps_per_epoch=len(dl["train"]))
scaler = torch.amp.GradScaler(enabled=(dev == "cuda"))

def predict(loader):
    model.eval(); P, Y = [], []
    with torch.no_grad(), torch.autocast(device_type="cuda", enabled=(dev == "cuda")):
        for x, y in loader: P.append(model(x.to(dev)).float().softmax(1).cpu()); Y.append(y)
    return torch.cat(P).numpy(), torch.cat(Y).numpy()

best, best_ep = -1, 0
for ep in range(1, EPOCHS + 1):
    model.train(); tl = 0
    for x, y in dl["train"]:
        x, y = x.to(dev), y.to(dev); opt.zero_grad()
        with torch.autocast(device_type="cuda", enabled=(dev == "cuda")): loss = criterion(model(x), y)
        scaler.scale(loss).backward(); scaler.step(opt); scaler.update(); sched.step(); tl += loss.item()
    P, Y = predict(dl["val"]); f1 = f1_score(Y, P.argmax(1), average="macro")
    if f1 > best: best, best_ep = f1, ep; torch.save(model.state_dict(), f"{OUT_DIR}/best_rbc.pt")
    print(f"Ep {ep:02d} loss {tl / len(dl['train']):.3f} | val macro-F1 {f1:.4f}{'  ★' if ep == best_ep else ''}")
print(f"Best epoch {best_ep}: val macro-F1 {best:.4f}")
""")

code(r"""
# 9. Test-set results (never seen during training or model selection)
from sklearn.metrics import classification_report, confusion_matrix, balanced_accuracy_score, accuracy_score, cohen_kappa_score
import seaborn as sns
model.load_state_dict(torch.load(f"{OUT_DIR}/best_rbc.pt", map_location=dev))
P, Y = predict(dl["test"]); pred = P.argmax(1)
print(classification_report(Y, pred, labels=range(len(CLASSES)), target_names=CLASSES, digits=3, zero_division=0))
TEST = {"accuracy": accuracy_score(Y, pred), "balanced_accuracy": balanced_accuracy_score(Y, pred),
        "macro_f1": f1_score(Y, pred, average="macro"), "kappa": cohen_kappa_score(Y, pred)}
print({k: round(v, 4) for k, v in TEST.items()})
s = CLASSES.index("schistocyte"); tp = ((pred == s) & (Y == s)).sum()
SCH = {"sensitivity": tp / max(1, (Y == s).sum()), "ppv": tp / max(1, (pred == s).sum())}
print(f"Schistocytes: sensitivity {SCH['sensitivity']:.3f} · PPV {SCH['ppv']:.3f}")
cm = confusion_matrix(Y, pred, labels=range(len(CLASSES)), normalize="true")
plt.figure(figsize=(9, 7.5)); sns.heatmap(cm, annot=True, fmt=".2f", xticklabels=CLASSES, yticklabels=CLASSES, cmap="Blues", cbar=False)
plt.xlabel("Predicted"); plt.ylabel("True"); plt.title("Red cell model — test set (row-normalised)"); plt.tight_layout()
plt.savefig(f"{OUT_DIR}/rbc_confusion_matrix.png", dpi=150); plt.show()
""")

code(r"""
# 10. Export for the app: rbc_model.onnx + rbc_labels.json (and a check that ONNX matches PyTorch)
import json, onnxruntime as ort
model.eval().cpu()
dummy = torch.randn(2, 3, IMG_SIZE, IMG_SIZE)
onnx_path = f"{OUT_DIR}/rbc_model.onnx"
torch.onnx.export(model, dummy, onnx_path, input_names=["input"], output_names=["logits"],
                  dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}}, opset_version=17, dynamo=False)
with torch.no_grad(): ref = model(dummy).numpy()
out = ort.InferenceSession(onnx_path).run(None, {"input": dummy.numpy()})[0]
print(f"ONNX ✓ max difference {abs(out - ref).max():.2e} · {os.path.getsize(onnx_path) / 1e6:.1f} MB")
meta = {"format": "haem5-rbc-v1", "classes": CLASSES, "img_size": IMG_SIZE, "mean": MEAN, "std": STD,
        "input_name": "input", "layout": "NCHW", "crop_rbc_diameters": CROP_DIAMETERS, "model": "efficientnet_b0",
        "trained_on": ["Chula-RBC-12"], "n_train": int((df.split == "train").sum()), "best_epoch": best_ep,
        "test": {k: float(v) for k, v in TEST.items()}, "test_schistocyte": {k: float(v) for k, v in SCH.items()}}
json.dump(meta, open(f"{OUT_DIR}/rbc_labels.json", "w"), indent=2)
try:
    from google.colab import files
    files.download(onnx_path); files.download(f"{OUT_DIR}/rbc_labels.json"); files.download(f"{OUT_DIR}/rbc_confusion_matrix.png")
except ImportError:
    print("Files are in", OUT_DIR)
""")

nb = {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"provenance": []},
      "kernelspec": {"display_name": "Python 3", "name": "python3"}, "language_info": {"name": "python"}},
      "nbformat": 4, "nbformat_minor": 5}
for c in cells:
    if c["cell_type"] == "code": ast.parse(c["source"])
out = sys.argv[1] if len(sys.argv) > 1 else "HAEM5_RBC_model_training.ipynb"
json.dump(nb, open(out, "w"), indent=1)
print("wrote", out, len(cells), "cells")
