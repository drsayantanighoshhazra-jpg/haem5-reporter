"""Builds HAEM5_malaria_model_v2_training.ipynb (recalibrated on app-style crops) — — malaria parasite screening model for the HAEM5 Reporter app."""
import ast, json, sys

cells = []
def md(s): cells.append({"cell_type": "markdown", "metadata": {}, "source": s.strip("\n")})
def code(s): cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": s.strip("\n")})

md(r"""
# HAEM5 Reporter — malaria screening model **v2** (recalibrated for the app)

Trains a **parasitized vs uninfected red cell** classifier. In the app, every red cell found in a slide photo is screened; if the share of flagged cells is clearly above the model's false-positive rate, the report shows **"AI malaria screen suspicious — confirm by microscopy"**. It never reports malaria by itself.

**Dataset:** NIH / NLM malaria cell images (Rajaraman et al., *PeerJ* 2018) — 27,558 segmented red cells from Giemsa-stained thin films of 150 *P. falciparum*-infected and 50 healthy patients (Chittagong Medical College Hospital). Public domain.

**Split by patient** (not by image), so no patient's cells are in both training and testing.

**What v2 fixes:** v1 scored AUC 0.98 on NIH cells but flagged 10–13% of *normal* red cells cut automatically from whole slide photos — the app cuts small cells (~40 px) and enlarges them ~3×, which the model had never seen. v2 adds (1) **≈8,000 malaria-free red cells from Chula RBC-12 cut exactly the way the app cuts them** (with jitter in position and size) as "uninfected", and (2) **down-and-up resampling** of NIH cells so infected cells also look app-cut. It reports the false-flag rate on held-out Chula smears — the number that decides whether the app can switch the screen on (target ≤2%).

**Steps:** *Runtime › Change runtime type › T4 GPU* → *Runtime › Run all* (about 30–40 minutes). At the end `malaria_model.onnx` and `malaria_labels.json` download; load both in the app with *Load model files*.

> Research/teaching prototype. Not a medical device. Malaria is diagnosed by thick and thin film microscopy or RDT.
""")

code(r"""
# 1. GPU and packages
import importlib.util, subprocess, sys, torch
print("GPU:", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "NONE — Runtime › Change runtime type › T4 GPU")
need = [p for p, m in [("timm", "timm"), ("onnx", "onnx"), ("onnxruntime", "onnxruntime"), ("scikit-learn", "sklearn"), ("kagglehub", "kagglehub")] if importlib.util.find_spec(m) is None]
if need: subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", *need])
print("✓ Packages ready")
""")

code(r"""
# 2. Settings
import os
NIH_URL = "https://data.lhncbc.nlm.nih.gov/public/Malaria/cell_images.zip"
KAGGLE = "iarunava/cell-images-for-detecting-malaria"     # mirror, used if the NIH link fails
DATA = "/content/malaria"; OUT_DIR = "/content/haem5_malaria_model"
CLASSES = ["uninfected", "parasitized"]                   # app vocabulary — do not rename
IMG_SIZE, EPOCHS, BATCH, SEED = 128, 8, 128, 42
CHULA_REPO = "https://github.com/Chula-PIC-Lab/Chula-RBC-12-Dataset"   # malaria-free smears (MIT licence) → app-style negatives
RBC_D = 39                                                            # median red-cell diameter in Chula images (px), as the app measures it
TARGET_SPECIFICITY = 0.98                                 # threshold chosen on validation so ≤2% of uninfected cells are flagged
os.makedirs(DATA, exist_ok=True); os.makedirs(OUT_DIR, exist_ok=True)
CHULA = f"{DATA}/chula"
""")

code(r"""
# 3. Download (about 340 MB)
import urllib.request, zipfile, glob, shutil, subprocess
def find_root():
    hits = [d for d in glob.glob(f"{DATA}/**/Parasitized", recursive=True) if os.path.isdir(d)]
    return os.path.dirname(hits[0]) if hits else None
if not find_root():
    try:
        print("Downloading from NIH…"); urllib.request.urlretrieve(NIH_URL, f"{DATA}/cell_images.zip")
        zipfile.ZipFile(f"{DATA}/cell_images.zip").extractall(DATA)
    except Exception as e:
        print("NIH download failed (", e, ") — trying the Kaggle mirror")
        import kagglehub; p = kagglehub.dataset_download(KAGGLE); shutil.copytree(p, f"{DATA}/kaggle", dirs_exist_ok=True)
ROOT = find_root(); print("✓ data at", ROOT)
if not os.path.isdir(f"{CHULA}/Label"):
    subprocess.check_call(["git", "clone", "-q", "--depth", "1", CHULA_REPO, CHULA])
print("✓ Chula RBC-12 (malaria-free) at", CHULA)
""")

code(r"""
# 4. Index images and split 70/15/15 BY PATIENT (file names start with the patient/slide code, e.g. C33P1thinF…)
import re, pandas as pd, numpy as np
from sklearn.model_selection import GroupShuffleSplit
rows = []
for cls, folder in (("parasitized", "Parasitized"), ("uninfected", "Uninfected")):
    for f in glob.glob(f"{ROOT}/{folder}/*.png"):
        m = re.match(r"(C\d+[A-Za-z]*P\d+)", os.path.basename(f))
        rows.append({"path": f, "cls": cls, "y": CLASSES.index(cls), "patient": m.group(1) if m else os.path.basename(f)[:8]})
df = pd.DataFrame(rows)
g1 = GroupShuffleSplit(n_splits=1, test_size=0.15, random_state=SEED)
tr, te = next(g1.split(df, groups=df.patient)); df["split"] = "train"; df.loc[df.index[te], "split"] = "test"
rest = df[df.split == "train"]
g2 = GroupShuffleSplit(n_splits=1, test_size=0.15 / 0.85, random_state=SEED)
_, va = next(g2.split(rest, groups=rest.patient)); df.loc[rest.index[va], "split"] = "val"
assert not (set(df[df.split == "test"].patient) & set(df[df.split != "test"].patient)), "patient leak"
# --- App-style negatives: cut each expert-marked Chula red cell the way the app does (tight square ≈1.1 diameters,
#     circular black mask), with random shifts/sizes so detector imperfections are covered. Split by smear image.
from PIL import Image, ImageDraw
NEG = f"{DATA}/chula_negatives"; os.makedirs(NEG, exist_ok=True); rng = np.random.default_rng(SEED); neg = []
for lf in sorted(glob.glob(f"{CHULA}/Label/*.txt")):
    stem = os.path.basename(lf)[:-4]; ip = f"{CHULA}/Dataset/{stem}.jpg"
    try: im = Image.open(ip).convert("RGB")
    except Exception: continue
    for k, line in enumerate(open(lf).read().split("\n")):
        p = line.split()
        if len(p) < 3: continue
        x, y = int(float(p[0])), int(float(p[1]))
        side = RBC_D * rng.uniform(0.85, 1.4); x += rng.normal(0, 0.12 * RBC_D); y += rng.normal(0, 0.12 * RBC_D)
        fp = f"{NEG}/{stem}_{k}.png"
        if not os.path.exists(fp): im.crop((round(x - side / 2), round(y - side / 2), round(x + side / 2), round(y + side / 2))).save(fp)
        neg.append({"path": fp, "cls": "uninfected", "y": 0, "patient": "CHULA_" + stem, "source": "chula"})
neg = pd.DataFrame(neg); df["source"] = "nih"
keep = neg.patient.drop_duplicates().sample(frac=1, random_state=SEED)                      # whole smears, so the split stays by image
neg = neg[neg.patient.isin(keep[: max(1, int(len(keep) * min(1, 9000 / max(1, len(neg)))))])]  # ≈9,000 cells: balanced against ~27,000 NIH cells
gs = GroupShuffleSplit(n_splits=1, test_size=0.3, random_state=SEED); a, b = next(gs.split(neg, groups=neg.patient))
neg["split"] = "train"; rest = neg.index[b]; neg.loc[rest[: len(rest) // 2], "split"] = "val"; neg.loc[rest[len(rest) // 2:], "split"] = "test"
df = pd.concat([df, neg], ignore_index=True)
print(f"+ {len(neg)} app-style malaria-free red cells from {neg.patient.nunique()} Chula smears")
df.to_csv(f"{OUT_DIR}/malaria_split_manifest.csv", index=False)
print(f"{len(df)} cells from {df.patient.nunique()} patients/slides"); print(pd.crosstab(df.cls, df.split).to_string())
""")

code(r"""
# 5. Loaders — rotation, flips, stain-colour jitter; a circular mask matches how the app cuts each red cell
import torch, torchvision.transforms as T
from torch.utils.data import Dataset, DataLoader
from PIL import Image, ImageDraw
torch.manual_seed(SEED)
MEAN, STD = [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]
circle = Image.new("L", (IMG_SIZE, IMG_SIZE), 0); ImageDraw.Draw(circle).ellipse([IMG_SIZE * 0.03] * 2 + [IMG_SIZE * 0.97] * 2, fill=255)
def masked(im): out = Image.new("RGB", im.size, (0, 0, 0)); out.paste(im, (0, 0), circle); return out
import random
class AppCut:   # like the app: the cell is small (≈30–60 px) and is enlarged to 128 px with varied resampling
    def __call__(self, im):
        if random.random() < 0.7:
            s0 = random.randint(28, 64); im = im.resize((s0, s0), random.choice([Image.BILINEAR, Image.BICUBIC, Image.BOX, Image.NEAREST]))
        return im.resize((IMG_SIZE, IMG_SIZE), random.choice([Image.BILINEAR, Image.BICUBIC]))
train_tf = T.Compose([AppCut(), T.RandomRotation(180), T.RandomHorizontalFlip(), T.RandomVerticalFlip(),
                      T.ColorJitter(0.3, 0.3, 0.3, 0.05), T.Lambda(masked), T.ToTensor(), T.Normalize(MEAN, STD)])
eval_tf = T.Compose([T.Resize((IMG_SIZE, IMG_SIZE)), T.Lambda(masked), T.ToTensor(), T.Normalize(MEAN, STD)])
class Cells(Dataset):
    def __init__(self, d, tf): self.p, self.y, self.tf = d.path.tolist(), d.y.tolist(), tf
    def __len__(self): return len(self.p)
    def __getitem__(self, i): return self.tf(Image.open(self.p[i]).convert("RGB")), self.y[i]
dl = {s: DataLoader(Cells(df[df.split == s], train_tf if s == "train" else eval_tf), batch_size=BATCH, shuffle=(s == "train"), num_workers=2, pin_memory=True)
      for s in ("train", "val", "test")}
print({s: len(d.dataset) for s, d in dl.items()})
""")

code(r"""
# 6. Train EfficientNet-B0; best epoch by validation AUC
import timm, torch.nn as nn
from sklearn.metrics import roc_auc_score
dev = "cuda" if torch.cuda.is_available() else "cpu"
model = timm.create_model("efficientnet_b0", pretrained=True, num_classes=2, drop_rate=0.2).to(dev)
criterion = nn.CrossEntropyLoss(label_smoothing=0.05)
opt = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=1e-3, epochs=EPOCHS, steps_per_epoch=len(dl["train"]))
scaler = torch.amp.GradScaler(enabled=(dev == "cuda"))
def predict(loader):
    model.eval(); P, Y = [], []
    with torch.no_grad(), torch.autocast(device_type="cuda", enabled=(dev == "cuda")):
        for x, y in loader: P.append(model(x.to(dev)).float().softmax(1)[:, 1].cpu()); Y.append(y)
    return torch.cat(P).numpy(), torch.cat(Y).numpy()
best, best_ep = -1, 0
for ep in range(1, EPOCHS + 1):
    model.train(); tl = 0
    for x, y in dl["train"]:
        x, y = x.to(dev), y.to(dev); opt.zero_grad()
        with torch.autocast(device_type="cuda", enabled=(dev == "cuda")): loss = criterion(model(x), y)
        scaler.scale(loss).backward(); scaler.step(opt); scaler.update(); sched.step(); tl += loss.item()
    P, Y = predict(dl["val"]); auc = roc_auc_score(Y, P)
    if auc > best: best, best_ep = auc, ep; torch.save(model.state_dict(), f"{OUT_DIR}/best_malaria.pt")
    print(f"Ep {ep:02d} loss {tl / len(dl['train']):.3f} | val AUC {auc:.4f}{'  ★' if ep == best_ep else ''}")
""")

code(r"""
# 7. Threshold on validation (specificity ≥ target), then test once
from sklearn.metrics import roc_curve, confusion_matrix
model.load_state_dict(torch.load(f"{OUT_DIR}/best_malaria.pt", map_location=dev))
Pv, Yv = predict(dl["val"])
fpr, tpr, thr = roc_curve(Yv, Pv); ok = fpr <= 1 - TARGET_SPECIFICITY
THR = float(thr[ok][np.argmax(tpr[ok])]) if ok.any() else 0.5; THR = min(max(THR, 0.05), 0.99)
P, Y = predict(dl["test"]); pred = (P >= THR).astype(int)
tn, fp, fn, tp = confusion_matrix(Y, pred, labels=[0, 1]).ravel()
TEST = {"auc": float(roc_auc_score(Y, P)), "accuracy": float((tp + tn) / len(Y)), "sensitivity": float(tp / (tp + fn)),
        "specificity": float(tn / (tn + fp)), "ppv": float(tp / max(1, tp + fp)), "threshold": THR}
nih_t = (df[df.split == "test"].source == "nih").values
tn2, fp2, fn2, tp2 = confusion_matrix(Y[nih_t], pred[nih_t], labels=[0, 1]).ravel()
TEST.update({"nih_sensitivity": float(tp2 / max(1, tp2 + fn2)), "nih_specificity": float(tn2 / max(1, tn2 + fp2)),
             "app_style_false_flag_rate": float(pred[~nih_t].mean()) if (~nih_t).any() else None})
print({k: round(v, 4) for k, v in TEST.items() if v is not None})
print(f"App-style malaria-free red cells falsely flagged: {100 * TEST['app_style_false_flag_rate']:.2f}% (v1: ~10–13% in the app; target ≤2%)")
""")

code(r"""
# 8. Export for the app
import json, onnxruntime as ort
model.eval().cpu(); dummy = torch.randn(2, 3, IMG_SIZE, IMG_SIZE); path = f"{OUT_DIR}/malaria_model.onnx"
torch.onnx.export(model, dummy, path, input_names=["input"], output_names=["logits"],
                  dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}}, opset_version=17, dynamo=False)
with torch.no_grad(): ref = model(dummy).numpy()
print("ONNX ✓ max difference", float(abs(ort.InferenceSession(path).run(None, {"input": dummy.numpy()})[0] - ref).max()))
meta = {"format": "haem5-malaria-v1", "classes": CLASSES, "img_size": IMG_SIZE, "mean": MEAN, "std": STD, "input_name": "input",
        "crop": "single red cell, tight square, circular mask", "threshold": THR, "model": "efficientnet_b0",
        "trained_on": ["NIH-NLM malaria cell images (Rajaraman 2018)", "Chula RBC-12 app-style negatives"], "version": "v2", "split": "by patient 70/15/15", "best_epoch": best_ep, "test": TEST}
json.dump(meta, open(f"{OUT_DIR}/malaria_labels.json", "w"), indent=2)
try:
    from google.colab import files; files.download(path); files.download(f"{OUT_DIR}/malaria_labels.json")
except ImportError:
    print("Files are in", OUT_DIR)
""")

nb = {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"provenance": []}, "kernelspec": {"display_name": "Python 3", "name": "python3"},
      "language_info": {"name": "python"}}, "nbformat": 4, "nbformat_minor": 5}
for c in cells:
    if c["cell_type"] == "code": ast.parse(c["source"])
out = sys.argv[1] if len(sys.argv) > 1 else "HAEM5_malaria_model_v2_training.ipynb"
json.dump(nb, open(out, "w"), indent=1); print("wrote", out)
