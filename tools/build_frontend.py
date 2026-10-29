"""Builds frontend/workbench.html (server mode) and the standalone demo page from the shared sources."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "frontend"
tpl = (ROOT / "src/workbench_template.html").read_text()
engine = (ROOT / "src/haem5_engine.js").read_text()
detector = (ROOT / "src/cell_detect.js").read_text()
body = tpl.replace("/*__ENGINE__*/", engine + "\n" + detector)

# Built-in model (frontend/model/): the ONNX file is split into parts so each stays under hosting file-size limits.
MODEL = ROOT / "model"
def builtin(prefix, b64=False):
    if not (MODEL / "cell_labels.json").exists():
        return ""
    parts = sorted(MODEL.glob("cell_model.part*.bin"))
    cfg = {"parts": [prefix + p.name + (".b64.txt" if b64 else "") for p in parts], "size": sum(p.stat().st_size for p in parts),
           "encoding": "base64" if b64 else "binary",
           "labels": json.loads((MODEL / "cell_labels.json").read_text())}
    return "<script>window.HAEM5_BUILTIN_MODEL = " + json.dumps(cfg) + ";</script>"

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
for p in sorted(MODEL.glob("cell_model.part*.bin")) if __import__("os").environ.get("HAEM5_B64") else []:
    (MODEL / (p.name + ".b64.txt")).write_bytes(base64.b64encode(p.read_bytes()))
