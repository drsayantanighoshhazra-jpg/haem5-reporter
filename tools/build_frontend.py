"""Builds frontend/workbench.html (server mode) and the standalone demo page from the shared sources."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "frontend"
tpl = (ROOT / "src/workbench_template.html").read_text()
engine = (ROOT / "src/haem5_engine.js").read_text()
detector = (ROOT / "src/cell_detect.js").read_text() + "\n" + (ROOT / "src/rbc_morph.js").read_text() + "\n" + (ROOT / "src/cbc_flags.js").read_text()
body = tpl.replace("/*__ENGINE__*/", engine + "\n" + detector)

# Built-in model (frontend/model/): the ONNX file is split into parts so each stays under hosting file-size limits.
MODEL = ROOT / "model"
def builtin(prefix, b64=False):
    out = ""
    for stem, labels, var in (("cell_model", "cell_labels.json", "HAEM5_BUILTIN_MODEL"), ("rbc_model", "rbc_labels.json", "HAEM5_BUILTIN_RBC")):   # malaria: experimental, loaded by hand only (see docs)
        if not (MODEL / labels).exists():
            continue
        parts = sorted(MODEL.glob(stem + ".part*.bin"))
        cfg = {"parts": [prefix + p.name + (".b64.txt" if b64 else "") for p in parts], "size": sum(p.stat().st_size for p in parts),
               "encoding": "base64" if b64 else "binary", "labels": json.loads((MODEL / labels).read_text())}
        out += "<script>window." + var + " = " + json.dumps(cfg) + ";</script>"
    return out

head = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>')
flags = ('<script>window.HAEM5_NO_LOCAL = true; window.HAEM5_WASM_URL = "/static/ort-wasm-simd-threaded.wasm";</script>') + builtin("/static/model/")
first_script = body.index("<script")
server = head + body[:first_script] + flags + body[first_script:] + '<script src="/static/workbench_bridge.js"></script></body></html>'
(ROOT / "workbench.html").write_text(server)
(ROOT / "standalone_demo.html").write_text(body)
print("built", len(server) // 1024, "KB")

# Published showcase = standalone workbench + DPDP showcase layer
sc = (ROOT / "src/showcase.js").read_text()
i = body.rindex("</script>") + len("</script>")
fs = body.index("<script")
sbody = body[:fs] + builtin("model/", b64=True) + body[fs:]
i = sbody.rindex("</script>") + len("</script>")
(ROOT / "showcase.html").write_text(sbody[:i] + "\n<script>\n" + sc + "\n</script>\n" + sbody[i:])
print("built showcase")

# Base64 text copies of the parts for hosts that only serve text/web types (the published showcase).
import base64
for p in sorted(MODEL.glob("*.part*.bin")) if __import__("os").environ.get("HAEM5_B64") else []:
    (MODEL / (p.name + ".b64.txt")).write_bytes(base64.b64encode(p.read_bytes()))
