// Runs the app's own cell detector on raw RGBA files: node detect_cli.cjs file.rgba W H  → JSON on stdout
const fs = require("fs");
const D = require(require("path").join(__dirname, "../frontend/src/cell_detect.js"));
const [, , f, W, H] = process.argv, w = +W, h = +H;
const px = new Uint8ClampedArray(fs.readFileSync(f));
const r = D.detect(px, w, h), q = D.quality(px, w, h);
process.stdout.write(JSON.stringify({ wbc: r.wbc, rbcCells: r.rbcCells, rbcDiameter: r.rbcDiameter, platelets: r.platelets, rbc: r.rbc, quality: q }));
