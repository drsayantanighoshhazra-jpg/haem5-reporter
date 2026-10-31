/* Finds cells on a Romanowsky-stained (MGG / Leishman / Giemsa / Wright) blood-film photograph.
   Pure function on RGBA pixels — no libraries — so it runs in the browser and in tests.
   Returns nucleated cells (to be cropped and classified), platelet and red-cell counts.

   Method: purple chromatin is separated from pink red cells and pale background by a
   "blue-minus-green" score with an Otsu threshold; red cells are found from the pink mask and
   their median size calibrates every other size, so the method works at any magnification. */
(function (root) {
  "use strict";

  function otsu(hist, total) {
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thr = 0;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue; const wF = total - wB; if (!wF) break;
      sumB += t * hist[t]; const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) ** 2;
      if (v > best) { best = v; thr = t; }
    }
    return thr;
  }

  // separable box dilation / erosion on a 0/1 mask
  function morph(mask, w, h, r, dilate) {
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) { let run = 0; const row = y * w;
      for (let x = 0; x < w; x++) { // horizontal
        let v = dilate ? 0 : 1;
        for (let k = -r; k <= r; k++) { const xx = x + k; const m = xx < 0 || xx >= w ? (dilate ? 0 : 1) : mask[row + xx];
          if (dilate ? m : !m) { v = dilate ? 1 : 0; break; } }
        tmp[row + x] = v; } }
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
      let v = dilate ? 0 : 1;
      for (let k = -r; k <= r; k++) { const yy = y + k; const m = yy < 0 || yy >= h ? (dilate ? 0 : 1) : tmp[yy * w + x];
        if (dilate ? m : !m) { v = dilate ? 1 : 0; break; } }
      out[y * w + x] = v; }
    return out;
  }

  function components(mask, w, h) {
    const lab = new Int32Array(w * h).fill(-1), comps = [], stack = [];
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || lab[i] >= 0) continue;
      const id = comps.length; let n = 0, sx = 0, sy = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
      lab[i] = id; stack.push(i);
      while (stack.length) {
        const p = stack.pop(), x = p % w, y = (p / w) | 0; n++; sx += x; sy += y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && mask[p - 1] && lab[p - 1] < 0) { lab[p - 1] = id; stack.push(p - 1); }
        if (x < w - 1 && mask[p + 1] && lab[p + 1] < 0) { lab[p + 1] = id; stack.push(p + 1); }
        if (y > 0 && mask[p - w] && lab[p - w] < 0) { lab[p - w] = id; stack.push(p - w); }
        if (y < h - 1 && mask[p + w] && lab[p + w] < 0) { lab[p + w] = id; stack.push(p + w); }
      }
      comps.push({ id, area: n, cx: sx / n, cy: sy / n, x0, y0, x1, y1 });
    }
    return { comps, lab };
  }


  /* Single red cells for morphology, including cells touching their neighbours: holes (central pallor) are filled,
     a chamfer distance transform is taken and its peaks are the cell centres. Peak height ≈ cell radius, so
     fragments (schistocytes) are kept down to ~0.35 diameters. */
  function findRedCells(pm, w, h, rbcD, wbcF, pad) {
    const N = w * h, m = pm.slice(), inv = new Uint8Array(N);
    for (let i = 0; i < N; i++) inv[i] = m[i] ? 0 : 1;
    const holes = components(inv, w, h), maxHole = 0.6 * Math.PI * rbcD * rbcD / 4;
    const fill = new Set(holes.comps.filter(c => c.area < maxHole && c.x0 > 0 && c.y0 > 0 && c.x1 < w - 1 && c.y1 < h - 1).map(c => c.id));
    for (let i = 0; i < N; i++) if (holes.lab[i] >= 0 && fill.has(holes.lab[i])) m[i] = 1;
    const BIG = 1e9, d = new Float32Array(N);
    for (let i = 0; i < N; i++) d[i] = m[i] ? BIG : 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1); else v = Math.min(v, 1);
      if (y > 0) { v = Math.min(v, d[i - w] + 1); if (x > 0) v = Math.min(v, d[i - w - 1] + 1.4142); if (x < w - 1) v = Math.min(v, d[i - w + 1] + 1.4142); } else v = Math.min(v, 1);
      d[i] = v; }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; if (!d[i]) continue;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1); else v = Math.min(v, 1);
      if (y < h - 1) { v = Math.min(v, d[i + w] + 1); if (x < w - 1) v = Math.min(v, d[i + w + 1] + 1.4142); if (x > 0) v = Math.min(v, d[i + w - 1] + 1.4142); } else v = Math.min(v, 1);
      d[i] = v; }
    const minR = 0.17 * rbcD, maxR = 0.75 * rbcD, peaks = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x, v = d[i];
      if (v < minR || v > maxR) continue;
      if (v >= d[i - 1] && v >= d[i + 1] && v >= d[i - w] && v >= d[i + w] && v >= d[i - w - 1] && v >= d[i - w + 1] && v >= d[i + w - 1] && v >= d[i + w + 1]) peaks.push([v, x, y]); }
    peaks.sort((a, b) => b[0] - a[0]);
    const out = [], edge = 0.45 * rbcD;
    for (const [r, x, y] of peaks) {
      if (out.some(c => Math.hypot(c.cx - x, c.cy - y) < Math.max(0.55 * rbcD, (c.d / 2 + r) * 0.75))) continue;
      out.push({ cx: x, cy: y, d: Math.round(2 * r) });
    }
    return out.filter(c => c.cx > edge && c.cy > edge && c.cx < w - edge && c.cy < h - edge &&
      !wbcF.some(k => c.cx > k.x0 - pad && c.cx < k.x1 + pad && c.cy > k.y0 - pad && c.cy < k.y1 + pad));
  }

  /**
   * @param {Uint8ClampedArray|Uint8Array} rgba  pixels (already downscaled; ~800–1600 px wide is ideal)
   * @returns {{wbc: Array<{cx:number, cy:number, size:number, x0:number,y0:number,x1:number,y1:number, area:number, touchesEdge:boolean}>,
   *           platelets:number, rbc:number, rbcCells:Array<{cx:number,cy:number,d:number}>, rbcDiameter:number, nucleusThreshold:number}}
   */
  function detect(rgba, w, h, opts = {}) {
    const N = w * h, score = new Uint8Array(N), bright = new Uint8Array(N);
    const hist = new Float64Array(256); let cnt = 0;
    for (let i = 0; i < N; i++) {
      const r = rgba[4 * i], g = rgba[4 * i + 1], b = rgba[4 * i + 2];
      const s = Math.max(0, Math.min(255, (b - g) * 2 + (r - g) * 0.3 - 30));   // purple chromatin
      score[i] = s; bright[i] = (r + g + b) / 3;
      if (bright[i] < 235) { hist[s | 0]++; cnt++; }
    }
    const thr = Math.max(opts.minThreshold ?? 70, otsu(hist, cnt));
    const nuc = new Uint8Array(N);
    for (let i = 0; i < N; i++) nuc[i] = score[i] > thr && bright[i] < 200 ? 1 : 0;

    // red cells: pink / non-background, not chromatin. Size from bounding boxes (central pallor would shrink areas).
    const bh = new Float64Array(256); for (let i = 0; i < N; i++) bh[bright[i] | 0]++;
    let acc = 0, bg = 255; for (let t = 255; t >= 0; t--) { acc += bh[t]; if (acc >= 0.15 * N) { bg = t; break; } }   // background = brightest 15%
    const pink = new Uint8Array(N);
    for (let i = 0; i < N; i++) pink[i] = !nuc[i] && bright[i] < bg - 14 ? 1 : 0;
    const pm = morph(morph(pink, w, h, 2, true), w, h, 2, false);           // close pallor gaps
    const pinkC = components(pm, w, h).comps.filter(c => c.area > 40 && c.x0 > 1 && c.y0 > 1 && c.x1 < w - 2 && c.y1 < h - 2);
    const minD = Math.sqrt(w * h) / 60;   // a red cell is never smaller than this fraction of the field
    const round = pinkC.filter(c => { const bw = c.x1 - c.x0 + 1, bh2 = c.y1 - c.y0 + 1; const ar = Math.max(bw, bh2) / Math.min(bw, bh2);
      return ar <= 1.35 && c.area / (bw * bh2) > 0.45 && (bw + bh2) / 2 >= minD; });
    const diams = round.map(c => ((c.x1 - c.x0) + (c.y1 - c.y0)) / 2).sort((a, b) => a - b);
    // the most common size among compact blobs = single red cells (clumps are larger)
    const single = diams.filter(d => d >= diams[Math.floor(diams.length * 0.25)] && d <= diams[Math.floor(diams.length * 0.75)]);
    const rbcD = single.length >= 3 ? single[Math.floor(single.length / 2)] : (opts.rbcDiameter || Math.sqrt(w * h) / 20);
    const rbcArea = Math.PI * rbcD * rbcD / 4;
    // nucleated cells: merge nearby lobes (segmented neutrophils) by dilating ~0.35 RBC diameters
    const clean = morph(morph(nuc, w, h, 1, false), w, h, 1, true);
    const raw = components(clean, w, h).comps;
    const plateletMax = 0.10 * rbcArea, nucleusMin = 0.22 * rbcArea;
    const pltCand = raw.filter(c => c.area >= 0.01 * rbcArea && c.area < plateletMax);
    const big = new Uint8Array(N);
    const keep = new Set(raw.filter(c => c.area >= nucleusMin).map(c => c.id));
    const lab0 = components(clean, w, h).lab;
    for (let i = 0; i < N; i++) if (lab0[i] >= 0 && keep.has(lab0[i])) big[i] = 1;
    const merged = components(morph(big, w, h, Math.max(2, Math.round(rbcD * 0.35)), true), w, h).comps;
    const wbc = merged.map(c => {
      const size = Math.round(Math.max(c.x1 - c.x0, c.y1 - c.y0, rbcD * 1.6) * 1.9);   // crop side ≈ CellaVision framing
      return { cx: Math.round((c.x0 + c.x1) / 2), cy: Math.round((c.y0 + c.y1) / 2), size, area: c.area, x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1,
        touchesEdge: c.x0 <= 1 || c.y0 <= 1 || c.x1 >= w - 2 || c.y1 >= h - 2 };
    }).filter(c => c.area >= nucleusMin);
    // drop specks far smaller than the largest nucleus in view (platelet clumps, stain precipitate)
    const maxA = Math.max(0, ...wbc.map(c => c.area));
    const wbcF = wbc.filter(c => c.area >= 0.08 * maxA);
    const rbcCount = pinkC.reduce((n, c) => { const d = ((c.x1 - c.x0) + (c.y1 - c.y0)) / 2; return n + (d < 0.6 * rbcD ? 0 : Math.max(1, Math.round((d / rbcD) ** 2 * 0.8))); }, 0);
    const pad = rbcD * 0.8;
    const platelets = pltCand.filter(p => !wbcF.some(c => p.cx > c.x0 - pad && p.cx < c.x1 + pad && p.cy > c.y0 - pad && p.cy < c.y1 + pad)).length;
    const rbcCells = findRedCells(pm, w, h, rbcD, wbcF, pad);
    return { wbc: wbcF, platelets, rbc: rbcCount, rbcCells, rbcDiameter: rbcD, nucleusThreshold: thr };
  }


  /* Photo quality: focus (variance of the Laplacian on a 800-px greyscale copy, normalised by contrast so that
     pale and dense fields compare fairly), exposure (mean brightness) and clipping (share of near-white pixels). */
  function quality(rgba, w, h) {
    const sc = Math.min(1, 800 / Math.max(w, h)), W = Math.max(8, Math.round(w * sc)), H = Math.max(8, Math.round(h * sc));
    const g = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = 4 * (Math.min(h - 1, Math.floor(y / sc)) * w + Math.min(w - 1, Math.floor(x / sc)));
      g[y * W + x] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    }
    let s = 0, s2 = 0, n = 0, m = 0, clip = 0, dark = 0;
    for (let i = 0; i < W * H; i++) { m += g[i]; if (g[i] > 250) clip++; if (g[i] < 40) dark++; }
    m /= W * H;
    let sd = 0; for (let i = 0; i < W * H; i++) sd += (g[i] - m) ** 2; sd = Math.sqrt(sd / (W * H)) || 1;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, l = g[i - 1] + g[i + 1] + g[i - W] + g[i + W] - 4 * g[i];
      s += l; s2 += l * l; n++;
    }
    const lapVar = s2 / n - (s / n) ** 2;
    return { focus: lapVar / (sd * sd), brightness: m, clipped: clip / (W * H), dark: dark / (W * H) };
  }

  const API = { detect, quality };
  if (typeof module !== "undefined" && module.exports) module.exports = API; else root.HAEM5DETECT = API;
})(typeof window !== "undefined" ? window : globalThis);
