"""Runs slide photos through the same pipeline as the HAEM5 Reporter app, offline, for the local pilot.

Usage: python tools/offline_pipeline.py PHOTO_DIR --wbc cell_model.onnx cell_labels.json --rbc rbc_model.onnx rbc_labels.json --out OUT
  PHOTO_DIR holds one sub-folder per slide (V01, V02, …) with that slide's 100× photographs.

Same steps as the app: photo downscaled to ≤1400 px, the app's detector (frontend/src/cell_detect.js, run with node),
white cells cut as the app does (square of the detector's size → 360 px → model size), 4-rotation averaging, absent
classes masked, blast threshold from the labels file; red cells cut at 2 × the field's red-cell diameter → 128 px,
4-rotation averaging. Outputs per slide: differential (%), red-cell type %, ICSH-style suggestions, quality flags, and a
numbered contact sheet of every white cell with its AI label (for the pathologist's cell-level review).
"""
import argparse, json, os, subprocess, sys, tempfile
import numpy as np, onnxruntime as ort
from PIL import Image, ImageDraw, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = (".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".heic", ".webp")
BLAST_EQ = {"blast"}


def load_model(onnx_path, labels_path):
    s = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"]); m = json.load(open(labels_path))
    return s, m


def softmax(z):
    z = z - z.max(-1, keepdims=True); e = np.exp(z); return e / e.sum(-1, keepdims=True)


def tensor(im, size, mean, std):
    a = np.asarray(im.convert("RGB").resize((size, size), Image.BILINEAR), dtype=np.float32).transpose(2, 0, 1) / 255
    a = (a - np.array(mean, np.float32).reshape(3, 1, 1)) / np.array(std, np.float32).reshape(3, 1, 1)
    return np.stack([np.rot90(a, k, axes=(1, 2)) for k in range(4)])


def classify(sess, meta, crops, thr_key="blast"):
    if not crops: return []
    C = meta["classes"]; size = meta.get("img_size", 224); allowed = np.array([c in set(meta.get("present_classes", C)) for c in C])
    out = []
    for i in range(0, len(crops), 16):
        x = np.concatenate([tensor(c, size, meta["mean"], meta["std"]) for c in crops[i:i + 16]]).astype(np.float32)
        lg = sess.run(None, {sess.get_inputs()[0].name: x})[0]; lg[:, ~allowed] = -1e9
        pr = softmax(lg).reshape(-1, 4, len(C)).mean(1)
        for p in pr:
            k = int(p.argmax()); thr = (meta.get("thresholds") or {}).get(thr_key)
            if thr and "blast" in C and k != C.index("blast") and p[C.index("blast")] >= thr: k = C.index("blast")
            out.append((C[k], float(p[k])))
    return out


def detect(im):
    sc = min(1, 1400 / max(im.size)); W, H = round(im.width * sc), round(im.height * sc); im = im.resize((W, H), Image.BILINEAR)
    with tempfile.NamedTemporaryFile(suffix=".rgba", delete=False) as f: f.write(im.convert("RGBA").tobytes()); fn = f.name
    try: r = json.loads(subprocess.check_output(["node", os.path.join(HERE, "detect_cli.cjs"), fn, str(W), str(H)]))
    finally: os.remove(fn)
    return im, r


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("photos"); ap.add_argument("--wbc", nargs=2, required=True); ap.add_argument("--rbc", nargs=2)
    ap.add_argument("--out", default="pilot_offline"); a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    ws, wm = load_model(*a.wbc); rs, rm = load_model(*a.rbc) if a.rbc else (None, None)
    slides = sorted(d for d in os.listdir(a.photos) if os.path.isdir(os.path.join(a.photos, d))
                    and os.path.abspath(os.path.join(a.photos, d)) != os.path.abspath(a.out)) or ["."]
    summary = {}
    for v in slides:
        folder = os.path.join(a.photos, v); files = sorted(f for f in os.listdir(folder) if f.lower().endswith(IMG))
        wcrops, wmeta, rcrops, quality, fields = [], [], [], [], 0
        for fn in files:
            try: im = ImageOps.exif_transpose(Image.open(os.path.join(folder, fn))).convert("RGB")
            except Exception as e: quality.append(f"{fn}: unreadable ({e.__class__.__name__})"); continue
            im, r = detect(im); fields += 1; W, H = im.size; q = r["quality"]
            issues = [x for x in ["likely blurred" if q["focus"] < 0.03 else "may be soft" if q["focus"] < 0.045 else None,
                                  "too dark" if q["brightness"] < 70 or q["dark"] > 0.3 else None, "overexposed" if q["clipped"] > 0.35 else None] if x]
            if issues: quality.append(f"{fn}: {', '.join(issues)}")
            for c in r["wbc"]:
                side = min(c["size"], W, H); x = max(0, min(W - side, c["cx"] - side / 2)); y = max(0, min(H - side, c["cy"] - side / 2))
                wcrops.append(im.crop((round(x), round(y), round(x + side), round(y + side))).resize((360, 360), Image.BILINEAR))
                wmeta.append({"photo": fn, "edge": c["touchesEdge"]})
            if rs is not None:
                side = rm.get("crop_rbc_diameters", 2) * r["rbcDiameter"]; cells = r["rbcCells"]
                if len(cells) > 150: cells = cells[:: int(np.ceil(len(cells) / 150))]
                for c in cells:
                    bg = Image.new("RGB", (round(side), round(side)), (232, 224, 226)); x0, y0 = round(c["cx"] - side / 2), round(c["cy"] - side / 2)
                    bg.paste(im.crop((x0, y0, x0 + round(side), y0 + round(side))), (0, 0)); rcrops.append(bg)
        wl = classify(ws, wm, wcrops); rl = classify(rs, rm, rcrops, thr_key="none") if rs is not None else []
        n = len(wl); counts = {}
        for (lab, _) in wl: counts[lab] = counts.get(lab, 0) + 1
        excl = {"smudge", "platelet", "artefact"}; nn = sum(v_ for k, v_ in counts.items() if k not in excl)
        diff = {k: round(100 * v_ / nn, 1) for k, v_ in sorted(counts.items(), key=lambda t: -t[1]) if k not in excl} if nn else {}
        rc = {}
        for (lab, _) in rl: rc[lab] = rc.get(lab, 0) + 1
        rpct = {k: round(100 * v_ / len(rl), 1) for k, v_ in sorted(rc.items(), key=lambda t: -t[1])} if rl else {}
        summary[v] = {"photos": len(files), "fields_analysed": fields, "white_cells": n, "white_cells_counted": nn, "differential_pct": diff,
                      "excluded": {k: counts[k] for k in excl if k in counts}, "red_cells": len(rl), "red_cell_pct": rpct, "quality": quality,
                      "cells": [{"n": i + 1, "ai": lab, "conf": round(cf, 3), **wmeta[i]} for i, (lab, cf) in enumerate(wl)]}
        if wcrops:   # numbered contact sheet for the pathologist's review
            cols = 8; tile = 140; rows_ = (len(wcrops) + cols - 1) // cols; sheet = Image.new("RGB", (cols * tile, rows_ * (tile + 30)), "white"); dr = ImageDraw.Draw(sheet)
            for i, (c, (lab, cf)) in enumerate(zip(wcrops, wl)):
                x, y = (i % cols) * tile, (i // cols) * (tile + 30); sheet.paste(c.resize((tile - 6, tile - 6)), (x + 3, y + 3))
                dr.text((x + 4, y + tile - 2), f"{i + 1}. {lab.replace('_', ' ')} {round(100 * cf)}%", fill=(0, 0, 0))
            sheet.save(os.path.join(a.out, f"{v}_cells.png"))
        print(f"{v}: {fields} photos · {nn} white cells · " + ", ".join(f"{k} {p}%" for k, p in diff.items()) + (f" · {len(rl)} red cells" if rl else ""))
    json.dump(summary, open(os.path.join(a.out, "offline_results.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
