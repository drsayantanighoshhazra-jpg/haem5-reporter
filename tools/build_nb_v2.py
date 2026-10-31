"""Builds HAEM5_cell_model_v2_training.ipynb — accuracy-focused retraining of the white-cell model:
more varied data (adds Raabin-WBC), phone/stain augmentation, EfficientNet-B2 at 288 px, mixup/cutmix, balanced sampling,
early stopping with Drive checkpoints (survives disconnects), external hold-outs, and a calibrated "confident cells" threshold."""
import ast, json, sys

cells = []
def md(s): cells.append({"cell_type": "markdown", "metadata": {}, "source": s.strip("\n")})
def code(s): cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": s.strip("\n")})

md(r"""
# HAEM5 Reporter — white-cell model **v2** (accuracy-focused)

What changes from v1, and why:

| Change | Why |
|---|---|
| Adds **Raabin-WBC** (many microscopes and smartphone cameras) to training | v1 dropped to 54% on another centre's cameras — variety is the cure |
| **Phone/stain augmentation**: blur, JPEG, gamma, colour casts, stain jitter, noise | teaches the model to ignore camera and stain differences (Leishman, Giemsa, MGG) |
| **EfficientNet-B2 at 288 px** (v1: B0 at 224) | finer chromatin/granule detail: blasts vs lymphocytes, monocytes vs lymphocytes |
| Mixup/CutMix, label smoothing, class-balanced sampling, cosine schedule, early stopping | better generalisation and rare classes |
| **External hold-outs never trained on**: Raabin **Test-B** and **C-NMC 2019** (India) | honest cross-centre numbers to compare with v1 |
| **Confident-cells threshold** calibrated on validation | the app auto-accepts only cells the model is reliably right about; the rest go to the pathologist |
| Checkpoints saved to **Google Drive** every epoch | a disconnect no longer loses the training — just *Run all* again and it resumes |

**Steps:** *Runtime › Change runtime type › T4 GPU* → *Runtime › Run all*. Allow Google Drive access when asked. Paste your Kaggle token if asked. Training takes about **2–3 hours** (set `QUICK = True` in cell 2 for a ~1-hour version). At the end `cell_model.onnx` + `cell_labels.json` download — send them to Claude to build into the app.

> Research/teaching prototype. Not a medical device.
""")

code(r"""
# 1. Packages
import importlib.util, subprocess, sys
need = [p for p, m in [("timm", "timm"), ("onnx", "onnx"), ("onnxruntime", "onnxruntime"), ("kagglehub", "kagglehub"),
                       ("scikit-learn", "sklearn"), ("seaborn", "seaborn")] if importlib.util.find_spec(m) is None]
if need: subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", *need])
import torch; print("GPU:", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "NONE — Runtime › Change runtime type › T4 GPU")
""")

code(r"""
# 2. Settings
import os, re, glob, json, time, hashlib, io, random
QUICK = False                      # True: B0 @ 256 px, 12 epochs (~1 h). False: B2 @ 288 px, up to 30 epochs (~2–3 h)
TRAIN_SETS = ["walkersneps/aml-cytomorphology-lmu",              # Munich AML blood (blasts)
              "orvile/microscopic-peripheral-blood-cell-images", # Barcelona PBC
              "andrewmvd/bone-marrow-cell-classification",       # Munich marrow (plasma, hairy, immature lymphoid…)
              "raabindata/raabin-wbc"]                           # Iran, many microscopes / phone cameras (Test-B held out)
EXTERNAL_ONLY = ["andrewmvd/leukemia-classification"]            # C-NMC 2019 (India) — never trained on
CLASSES = ["blast", "promyelocyte", "myelocyte", "metamyelocyte", "band_neutrophil", "segmented_neutrophil", "eosinophil",
           "basophil", "monocyte", "lymphocyte", "atypical_lymphocyte", "erythroblast", "platelet", "smudge",
           "plasma_cell", "hairy_cell", "immature_lymphocyte", "proerythroblast", "artefact"]   # app vocabulary — do not rename
LABEL_MAP = {"MYO": "blast", "MOB": "blast", "PMO": "promyelocyte", "PMB": "promyelocyte", "MYB": "myelocyte", "MMZ": "metamyelocyte",
             "NGB": "band_neutrophil", "NGS": "segmented_neutrophil", "EOS": "eosinophil", "BAS": "basophil", "MON": "monocyte",
             "LYT": "lymphocyte", "LYA": "atypical_lymphocyte", "EBO": "erythroblast", "KSC": "smudge",
             "BLA": "blast", "PLM": "plasma_cell", "HAC": "hairy_cell", "LYI": "immature_lymphocyte", "PEB": "proerythroblast", "ART": "artefact",
             "BA": "basophil", "EO": "eosinophil", "LY": "lymphocyte", "MO": "monocyte", "SNE": "segmented_neutrophil", "BNE": "band_neutrophil",
             "NEUTROPHIL": "segmented_neutrophil", "MY": "myelocyte", "MMY": "metamyelocyte", "PMY": "promyelocyte",
             "ERB": "erythroblast", "PLATELET": "platelet", "PLT": "platelet"}
SKIP_CODES = {"IG", "NIF", "OTH", "ABE", "FGC"}
MODEL_NAME, IMG_SIZE, EPOCHS, BATCH = ("efficientnet_b0", 256, 12, 64) if QUICK else ("efficientnet_b2", 288, 30, 48)
MAX_PER_CLASS = 2500 if QUICK else 5000
LR, WD, PATIENCE, SEED = 3e-4, 0.02, 5, 42
ACCEPT_TARGET = 0.95               # confident-cells mode: validation accuracy required for auto-accepted cells
OUT_DIR = "/content/haem5_v2"; os.makedirs(OUT_DIR, exist_ok=True)
CKPT_DIR = OUT_DIR
try:                                # keep checkpoints in Drive so a disconnect does not lose training
    from google.colab import drive; drive.mount("/content/drive"); CKPT_DIR = "/content/drive/MyDrive/haem5_v2"; os.makedirs(CKPT_DIR, exist_ok=True)
except Exception as e:
    print("Drive not mounted — checkpoints stay in", OUT_DIR, f"({e.__class__.__name__})")
random.seed(SEED); torch.manual_seed(SEED)
print(f"{MODEL_NAME} @ {IMG_SIZE}px · ≤{MAX_PER_CLASS}/class · up to {EPOCHS} epochs · checkpoints → {CKPT_DIR}")
""")

code(r"""
# 3. Download datasets from Kaggle (paste your API token if asked: kaggle.com › Settings › API › Create New Token)
import kagglehub, getpass
def kget(slug):
    try: return kagglehub.dataset_download(slug)
    except Exception:
        if not os.environ.get("KAGGLE_API_TOKEN"):
            tok = getpass.getpass(f"Kaggle API token needed for {slug}: ").strip()
            os.environ["KAGGLE_API_TOKEN"] = tok
            if ":" in tok: os.environ["KAGGLE_USERNAME"], os.environ["KAGGLE_KEY"] = tok.split(":", 1)
        return kagglehub.dataset_download(slug)
PATHS = {}
for slug in TRAIN_SETS + EXTERNAL_ONLY:
    try: PATHS[slug] = kget(slug); print("✓", slug)
    except Exception as e: print("✗", slug, "—", e)
""")

code(r"""
# 4. Index, map labels, remove duplicates, set aside external hold-outs, split 70/15/15
import pandas as pd, numpy as np
from sklearn.model_selection import train_test_split
IMG_EXT = (".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp")
def code_to_class(folder, fname):
    keys = []; m = re.match(r"([A-Za-z]+)", os.path.basename(fname))
    if m: keys.append(m.group(1).upper())
    keys.append(os.path.basename(folder).upper())
    for k in keys:
        if k in SKIP_CODES: return None
        if k in LABEL_MAP: return LABEL_MAP[k]
    f = os.path.basename(folder).lower()
    for word, cls in [("metamyelo", "metamyelocyte"), ("promyelo", "promyelocyte"), ("myelocyte", "myelocyte"), ("baso", "basophil"),
                      ("eosin", "eosinophil"), ("lympho", "lymphocyte"), ("mono", "monocyte"), ("neutro", "segmented_neutrophil"),
                      ("erythroblast", "erythroblast"), ("platelet", "platelet")]:
        if word in f: return cls
    return None
rows, ext = [], []
for slug, root in PATHS.items():
    name = slug.split("/")[-1]
    for p in glob.glob(f"{root}/**/*", recursive=True):
        if not p.lower().endswith(IMG_EXT) or "__MACOSX" in p: continue
        low = p.lower().split(os.sep)
        if slug in EXTERNAL_ONLY:
            if "all" in low: ext.append({"set": "C-NMC 2019", "path": p, "truth": "blast"})
            elif "hem" in low: ext.append({"set": "C-NMC 2019", "path": p, "truth": "normal lymphocyte"})
            continue
        cls = code_to_class(os.path.dirname(p), p)
        if cls is None: continue
        if name == "raabin-wbc" and any("testb" in x.replace("-", "").replace("_", "") for x in low):
            ext.append({"set": "Raabin Test-B", "path": p, "truth": cls}); continue
        rows.append({"path": p, "cls": cls, "source": name})
df = pd.DataFrame(rows); EXT = pd.DataFrame(ext, columns=["set", "path", "truth"])
assert len(df), "No training images found — check the downloads in cell 3."
if "raabin-wbc" in set(df.source) and not (EXT.set == "Raabin Test-B").any():
    r = df[df.source == "raabin-wbc"].sample(frac=0.2, random_state=SEED)   # no Test-B folder: hold out 20% of Raabin instead
    EXT = pd.concat([EXT, pd.DataFrame({"set": "Raabin hold-out", "path": r.path, "truth": r.cls})]); df = df.drop(r.index)
    print("ℹ Raabin Test-B folder not found — 20% of Raabin held out as the external set.")
df = pd.concat([g.sample(min(len(g), int(MAX_PER_CLASS * 1.3)), random_state=SEED) for _, g in df.groupby("cls")]).reset_index(drop=True)
df["md5"] = [hashlib.md5(open(p, "rb").read()).hexdigest() for p in df.path]
n0 = len(df); df = df.drop_duplicates("md5"); print(f"Removed {n0 - len(df)} duplicate images")
df = df[df.cls.isin(CLASSES)]
df = pd.concat([g.sample(min(len(g), MAX_PER_CLASS), random_state=SEED) for _, g in df.groupby("cls")]).reset_index(drop=True)
present = [c for c in CLASSES if c in set(df.cls)]
strat = df.cls + "|" + df.source; strat = strat.where(strat.map(strat.value_counts()) >= 7, df.cls)
tr, te = train_test_split(df, test_size=0.15, stratify=strat, random_state=SEED)
tr, va = train_test_split(tr, test_size=0.15 / 0.85, stratify=strat.loc[tr.index], random_state=SEED)
assert not (set(tr.md5) & set(te.md5) or set(tr.md5) & set(va.md5) or set(va.md5) & set(te.md5))
pd.concat([tr.assign(split="train"), va.assign(split="val"), te.assign(split="test")]).to_csv(f"{OUT_DIR}/split_manifest.csv", index=False)
print(f"train {len(tr)} · val {len(va)} · test {len(te)} · external {len(EXT)}")
print(pd.crosstab(df.cls, df.source).reindex(present).to_string())
print(EXT.groupby(["set", "truth"]).size().to_string() if len(EXT) else "no external sets")
""")

code(r"""
# 5. Phone- and stain-robust augmentation, balanced sampling
import torchvision.transforms as T
from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler
from PIL import Image, ImageFilter, ImageFile
ImageFile.LOAD_TRUNCATED_IMAGES = True
MEAN, STD = [0.485, 0.456, 0.406], [0.229, 0.224, 0.225]
class Jpeg:      # phone compression
    def __call__(self, im):
        b = io.BytesIO(); im.save(b, "JPEG", quality=random.randint(35, 95)); b.seek(0); return Image.open(b).convert("RGB")
class Gamma:     # exposure
    def __call__(self, im): return T.functional.adjust_gamma(im, random.uniform(0.7, 1.4))
class Stain:     # per-channel gain/offset: Leishman vs Giemsa vs MGG tones, white balance
    def __call__(self, im):
        a = np.asarray(im, dtype=np.float32); g = np.random.uniform(0.85, 1.15, 3); o = np.random.uniform(-15, 15, 3)
        return Image.fromarray(np.clip(a * g + o, 0, 255).astype(np.uint8))
class Noise:
    def __call__(self, t): return (t + torch.randn_like(t) * random.uniform(0.0, 0.04)).clamp(0, 1)
train_tf = T.Compose([T.RandomRotation(180, interpolation=T.InterpolationMode.BILINEAR, fill=(230, 224, 226)),
                      T.RandomResizedCrop(IMG_SIZE, scale=(0.7, 1.0), ratio=(0.9, 1.1)), T.RandomHorizontalFlip(), T.RandomVerticalFlip(),
                      T.RandomApply([T.ColorJitter(0.35, 0.35, 0.35, 0.06)], p=0.9), T.RandomApply([Stain()], p=0.5),
                      T.RandomApply([Gamma()], p=0.3), T.RandomApply([T.GaussianBlur(5, sigma=(0.1, 2.0))], p=0.3),
                      T.RandomAdjustSharpness(2, p=0.2), T.RandomApply([Jpeg()], p=0.4),
                      T.ToTensor(), T.RandomApply([Noise()], p=0.3), T.Normalize(MEAN, STD)])
eval_tf = T.Compose([T.Resize((IMG_SIZE, IMG_SIZE)), T.ToTensor(), T.Normalize(MEAN, STD)])   # = the app: crop resized directly
c2i = {c: i for i, c in enumerate(CLASSES)}
class DS(Dataset):
    def __init__(s, paths, ys, tf): s.p, s.y, s.tf = list(paths), list(ys), tf
    def __len__(s): return len(s.p)
    def __getitem__(s, i):
        for _ in range(10):   # a few dataset files are damaged: skip them instead of stopping the run
            try: return s.tf(Image.open(s.p[i]).convert("RGB")), s.y[i]
            except Exception: i = random.randrange(len(s.p))
        raise RuntimeError("too many unreadable images")
ytr = np.array([c2i[c] for c in tr.cls]); cnt = np.bincount(ytr, minlength=len(CLASSES))
sampler = WeightedRandomSampler(torch.tensor(1 / np.sqrt(cnt[ytr]), dtype=torch.double), num_samples=len(ytr), replacement=True)
kw = dict(batch_size=BATCH, num_workers=min(4, os.cpu_count() or 2), pin_memory=True)
train_dl = DataLoader(DS(tr.path, ytr, train_tf), sampler=sampler, drop_last=True, **kw)
val_dl = DataLoader(DS(va.path, [c2i[c] for c in va.cls], eval_tf), **kw)
test_dl = DataLoader(DS(te.path, [c2i[c] for c in te.cls], eval_tf), **kw)
print("✓ loaders ready")
""")

code(r"""
# 6. Train: mixup/cutmix, cosine schedule with warm-up, early stopping, resumable checkpoints in Drive
import timm, math
from timm.data import Mixup
from timm.loss import SoftTargetCrossEntropy
from sklearn.metrics import f1_score
dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model = timm.create_model(MODEL_NAME, pretrained=True, num_classes=len(CLASSES), drop_rate=0.3, drop_path_rate=0.2).to(dev)
mix = Mixup(mixup_alpha=0.2, cutmix_alpha=1.0, prob=0.5, switch_prob=0.5, label_smoothing=0.1, num_classes=len(CLASSES))
crit = SoftTargetCrossEntropy()
opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=WD)
steps = EPOCHS * len(train_dl); warm = len(train_dl)
sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1, (s + 1) / warm) * 0.5 * (1 + math.cos(math.pi * min(1, s / steps))))
scaler = torch.amp.GradScaler(enabled=dev.type == "cuda")
labs = [c2i[c] for c in present]
@torch.no_grad()
def predict(dl, m=None):
    m = m or model; m.eval(); P, Y = [], []
    for x, y in dl:
        with torch.autocast(dev.type, enabled=dev.type == "cuda"): P.append(m(x.to(dev)).float().softmax(1).cpu())
        Y.append(torch.as_tensor(y))
    return torch.cat(P).numpy(), torch.cat(Y).numpy()
last, best_p = f"{CKPT_DIR}/last_{MODEL_NAME}.pt", f"{CKPT_DIR}/best_{MODEL_NAME}.pt"
start, best, bad = 1, -1.0, 0
if os.path.exists(last):
    ck = torch.load(last, map_location=dev); model.load_state_dict(ck["model"]); opt.load_state_dict(ck["opt"]); sched.load_state_dict(ck["sched"])
    scaler.load_state_dict(ck["scaler"]); start, best, bad = ck["epoch"] + 1, ck["best"], ck["bad"]; print(f"↻ Resuming after epoch {ck['epoch']} (best val macro-F1 {best:.4f})")
for ep in range(start, EPOCHS + 1):
    if bad >= PATIENCE: print("Early stop: no improvement for", PATIENCE, "epochs"); break
    model.train(); t0, L, n = time.time(), 0.0, 0
    for x, y in train_dl:
        x, y = x.to(dev), torch.as_tensor(y).to(dev); x, ys = mix(x, y)
        opt.zero_grad(set_to_none=True)
        with torch.autocast(dev.type, enabled=dev.type == "cuda"): loss = crit(model(x), ys)
        scaler.scale(loss).backward(); scaler.step(opt); scaler.update(); sched.step(); L += loss.item() * len(x); n += len(x)
    p, yv = predict(val_dl); f1 = f1_score(yv, p.argmax(1), average="macro", labels=labs); flag = ""
    if f1 > best: best, bad, flag = f1, 0, " ★"; torch.save(model.state_dict(), best_p)
    else: bad += 1
    torch.save({"model": model.state_dict(), "opt": opt.state_dict(), "sched": sched.state_dict(), "scaler": scaler.state_dict(),
                "epoch": ep, "best": best, "bad": bad}, last)
    print(f"Ep {ep:02d} loss {L / max(n, 1):.4f} | val macro-F1 {f1:.4f} | {time.time() - t0:.0f}s{flag}")
model.load_state_dict(torch.load(best_p, map_location=dev)); print(f"Best val macro-F1 {best:.4f}")
""")

code(r"""
# 7. Internal test + blast threshold + confident-cells threshold (both chosen on VALIDATION, reported on TEST)
from sklearn.metrics import accuracy_score, balanced_accuracy_score, cohen_kappa_score, classification_report, confusion_matrix
import matplotlib.pyplot as plt, seaborn as sns
tp, ty = predict(test_dl); vp, vy = predict(val_dl); pred = tp.argmax(1)
TEST = {"accuracy": float(accuracy_score(ty, pred)), "balanced_accuracy": float(balanced_accuracy_score(ty, pred)),
        "macro_f1": float(f1_score(ty, pred, average="macro", labels=labs)), "kappa": float(cohen_kappa_score(ty, pred))}
print({k: round(v, 4) for k, v in TEST.items()})
print(classification_report(ty, pred, labels=labs, target_names=present, digits=3, zero_division=0))
cm = confusion_matrix(ty, pred, labels=labs); cmn = cm / np.maximum(cm.sum(1, keepdims=True), 1)
plt.figure(figsize=(11, 9)); sns.heatmap(cmn, annot=True, fmt=".2f", cmap="Blues", xticklabels=present, yticklabels=present)
plt.title("v2 — test set (row-normalised)"); plt.tight_layout(); plt.savefig(f"{OUT_DIR}/confusion_matrix_v2.png", dpi=150); plt.show()
b = c2i["blast"]; BLAST_THR = None
def bstats(P, Y, t):
    pr = P.argmax(1).copy(); pr[P[:, b] >= t] = b; tb, pb = Y == b, pr == b; k = (tb & pb).sum()
    s, p = k / max(tb.sum(), 1), k / max(pb.sum(), 1); return s, p, 5 * p * s / max(4 * p + s, 1e-9)
tab = pd.DataFrame([(t, *bstats(vp, vy, t)) for t in np.round(np.arange(0.10, 0.51, 0.05), 2)], columns=["thr", "sens", "ppv", "f2"])
ok = tab[tab.ppv >= 0.70]
if len(ok): BLAST_THR = float(ok.sort_values("f2").iloc[-1].thr); s_, p_, _ = bstats(tp, ty, BLAST_THR); print(f"Blast threshold {BLAST_THR}: TEST sensitivity {s_:.3f}, PPV {p_:.3f}")
# confident cells: lowest confidence whose accepted cells reach ACCEPT_TARGET accuracy on validation
conf_v, ok_v = vp.max(1), vp.argmax(1) == vy; ACCEPT = None
for t in np.round(np.arange(0.50, 0.995, 0.01), 2):
    m = conf_v >= t
    if m.sum() >= 50 and ok_v[m].mean() >= ACCEPT_TARGET: ACCEPT = float(t); break
if ACCEPT:
    m = tp.max(1) >= ACCEPT
    ACC = {"threshold": ACCEPT, "target": ACCEPT_TARGET, "val_accuracy": float(ok_v[conf_v >= ACCEPT].mean()), "val_coverage": float((conf_v >= ACCEPT).mean()),
           "test_accuracy": float((pred[m] == ty[m]).mean()), "test_coverage": float(m.mean())}
    print(f"Confident cells ≥{ACCEPT:.2f}: TEST accuracy {ACC['test_accuracy']:.3f} on {100 * ACC['test_coverage']:.0f}% of cells (rest → pathologist)")
else: ACC = None; print("No confidence level reached the target on validation — confident-cells mode stays off.")
""")

code(r"""
# 8. External validation (never trained on), classified exactly as the app does: 4 rotations averaged + blast threshold
def ext_predict(paths):
    out = []
    for i in range(0, len(paths), 32):
        ims = []
        for p in paths[i:i + 32]:
            try: ims.append(eval_tf(Image.open(p).convert("RGB")))
            except Exception: ims.append(torch.zeros(3, IMG_SIZE, IMG_SIZE))   # unreadable file: scored as blank (rare)
        xs = torch.stack(ims).to(dev)
        with torch.no_grad(), torch.autocast(dev.type, enabled=dev.type == "cuda"):
            pr = sum(model(torch.rot90(xs, k, (2, 3))).float().softmax(1) for k in range(4)) / 4
        out.append(pr.cpu().numpy())
    return np.concatenate(out) if out else np.zeros((0, len(CLASSES)))
def decide(P):
    k = P.argmax(1).copy()
    if BLAST_THR: k[(P[:, b] >= BLAST_THR)] = b
    return np.array([CLASSES[i] for i in k])
EXTERNAL = {}
COLLAPSE = {"segmented_neutrophil": "neutrophil", "band_neutrophil": "neutrophil", "lymphocyte": "lymphocyte", "atypical_lymphocyte": "lymphocyte",
            "immature_lymphocyte": "lymphocyte", "monocyte": "monocyte", "eosinophil": "eosinophil", "basophil": "basophil"}
for setname in [s for s in EXT.set.unique() if s.startswith("Raabin")]:
    r = EXT[EXT.set == setname]; r = pd.concat([g.sample(min(len(g), 400), random_state=SEED) for _, g in r.groupby("truth")])
    P = ext_predict(r.path.tolist()); pr = pd.Series(decide(P)).map(lambda c: COLLAPSE.get(c, "other")).values
    tr5 = r.truth.map(lambda c: COLLAPSE.get(c, c)).values; L5 = ["neutrophil", "lymphocyte", "monocyte", "eosinophil", "basophil"]
    res = {"n": int(len(r)), "accuracy": float((pr == tr5).mean()), "macro_f1": float(f1_score(tr5, pr, labels=L5, average="macro", zero_division=0)),
           "kappa": float(cohen_kappa_score(tr5, pr)), "false_blast_rate": float((decide(P) == "blast").mean()),
           "per_class_recall": {l: float((pr[tr5 == l] == l).mean()) for l in L5 if (tr5 == l).any()}}
    if ACCEPT: m = P.max(1) >= ACCEPT; res["confident"] = {"coverage": float(m.mean()), "accuracy": float((pr[m] == tr5[m]).mean()) if m.any() else None}
    EXTERNAL[setname] = res; print(f"=== {setname} ===", json.dumps(res, indent=1))
c = EXT[EXT.set == "C-NMC 2019"]
if len(c):
    c = pd.concat([g.sample(min(len(g), 400), random_state=SEED) for _, g in c.groupby("truth")])
    P = ext_predict(c.path.tolist()); y = (c.truth == "blast").values; yh = decide(P) == "blast"
    from sklearn.metrics import roc_auc_score
    EXTERNAL["C-NMC 2019"] = {"n": int(len(c)), "sensitivity": float((y & yh).sum() / max(y.sum(), 1)), "specificity": float((~y & ~yh).sum() / max((~y).sum(), 1)),
                              "ppv": float((y & yh).sum() / max(yh.sum(), 1)), "auc_p_blast": float(roc_auc_score(y, P[:, b]))}
    print("=== C-NMC 2019 ===", json.dumps(EXTERNAL["C-NMC 2019"], indent=1))
print("\nv1 for comparison — Raabin: accuracy 0.541, κ 0.461, monocyte recall 0.005 · C-NMC: sensitivity 0.995, specificity 0.278, AUC 0.783")
""")

code(r"""
# 9. Export for the app (ONNX + labels), verified on real cells; download; copy to Drive
import onnxruntime as ort
model.eval().cpu(); xb = next(iter(test_dl))[0][:16]
onnx_path = f"{OUT_DIR}/cell_model.onnx"
torch.onnx.export(model, xb[:2], onnx_path, input_names=["input"], output_names=["logits"],
                  dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}}, opset_version=17, dynamo=False)
with torch.no_grad(): ref = model(xb).numpy()
out = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"]).run(None, {"input": xb.numpy()})[0]
print(f"ONNX vs PyTorch max |Δlogit| {np.abs(out - ref).max():.2e}", "✓" if (out.argmax(1) == ref.argmax(1)).all() else "⚠")
meta = {"format": "haem5-cell-v1", "version": "v2", "classes": CLASSES, "present_classes": present, "img_size": IMG_SIZE, "mean": MEAN, "std": STD,
        "input_name": "input", "layout": "NCHW", "resize": "direct", "model": MODEL_NAME, "trained_on": [s.split("/")[-1] for s in TRAIN_SETS if s in PATHS],
        "n_train": int(len(tr)), "thresholds": {k: v for k, v in (("blast", BLAST_THR), ("accept", ACCEPT)) if v}, "accept": ACC,
        "test": TEST, "external": EXTERNAL}
json.dump(meta, open(f"{OUT_DIR}/cell_labels.json", "w"), indent=2)
print(f"Model size {os.path.getsize(onnx_path) / 1e6:.1f} MB")
import shutil
if os.path.abspath(CKPT_DIR) != os.path.abspath(OUT_DIR):
    for f in ("cell_model.onnx", "cell_labels.json", "confusion_matrix_v2.png"):
        if os.path.exists(f"{OUT_DIR}/{f}"): shutil.copy(f"{OUT_DIR}/{f}", CKPT_DIR)
try:
    from google.colab import files; files.download(onnx_path); files.download(f"{OUT_DIR}/cell_labels.json"); files.download(f"{OUT_DIR}/confusion_matrix_v2.png")
except ImportError: print("Files in", OUT_DIR)
""")

nb = {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"provenance": []}, "kernelspec": {"display_name": "Python 3", "name": "python3"},
      "language_info": {"name": "python"}}, "nbformat": 4, "nbformat_minor": 5}
for c in cells:
    if c["cell_type"] == "code": ast.parse(c["source"])
out = sys.argv[1] if len(sys.argv) > 1 else "HAEM5_cell_model_v2_training.ipynb"
json.dump(nb, open(out, "w"), indent=1); print("wrote", out)
