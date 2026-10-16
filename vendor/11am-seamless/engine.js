/* 11AM-Seamless :: engine
 * Pure pixel operations. No DOM beyond offscreen canvases.
 * Exposes window.SeamlessEngine.
 */
(function () {
  'use strict';

  const DEFAULTS = {
    tile: true,           // false = skip seamless processing (resize / PSX / background only)
    mode: 'blend',        // blend | mirror | edge | offset
    direction: 'both',    // both | x | y
    width: 25,            // blend width, % of image size (2..50)
    strength: 100,        // heal opacity % (0..100)
    offsetX: 50,          // seam position for blend mode, %
    offsetY: 50,
    falloff: 'smooth',    // linear | smooth | sharp
    jitter: 0,            // organic seam, 0..100
    seed: 1,
    flatten: 0,           // remove lighting gradient, 0..100
    pixelSafe: false,     // dithered selection, never invents colors
    mirrorFit: false,     // mirror: scale 2x result back to source size
    size: 0,              // 0 = original, else longest side in px
    square: false,        // center-crop to square before processing
    resample: 'smooth',   // smooth | nearest
    // PSX effects
    psx: false,           // master switch for the PSX module
    psxLimit: true,       // reduce to an adaptive palette
    psxColors: 16,        // palette size, 2..256
    psx15: false,         // snap to PlayStation 15-bit colour (RGB555)
    psxDither: 'bayer4',  // none | bayer4 | bayer8 | fs
    psxDitherAmt: 100,    // dither strength %
    // background
    keyBlack: false,      // pure black -> transparent
    keyConnected: true,   // only black regions touching the border (keeps dark detail inside objects)
    keyTol: 6,            // max channel value that counts as black, 0..64
    keySoft: 10,          // soft edge range above the threshold, 0..64
  };

  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
  const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;
  const smoothstep = t => t * t * (3 - 2 * t);
  const FALLOFF = {
    linear: t => t,
    smooth: smoothstep,
    sharp: t => smoothstep(smoothstep(t)),
  };

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function ctx2d(c) { return c.getContext('2d', { willReadFrequently: true }); }

  // ---- value noise, seeded --------------------------------------------------
  function hash(x, y, seed) {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  function makeNoise(seed, cell) {
    return function (x, y) {
      let sum = 0, amp = 1, norm = 0, c = cell;
      for (let o = 0; o < 3; o++) {
        const gx = x / c, gy = y / c;
        const x0 = Math.floor(gx), y0 = Math.floor(gy);
        const fx = smoothstep(gx - x0), fy = smoothstep(gy - y0);
        const s = seed + o * 101;
        const a = hash(x0, y0, s), b = hash(x0 + 1, y0, s);
        const cc = hash(x0, y0 + 1, s), d = hash(x0 + 1, y0 + 1, s);
        sum += amp * ((a + (b - a) * fx) * (1 - fy) + (cc + (d - cc) * fx) * fy);
        norm += amp; amp *= 0.5; c = Math.max(2, c / 2);
      }
      return sum / norm; // 0..1
    };
  }

  // ---- stage 1: size / crop -------------------------------------------------
  function prepare(img, s) {
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (s.square) {
      const m = Math.min(sw, sh);
      sx = Math.floor((sw - m) / 2); sy = Math.floor((sh - m) / 2); sw = sh = m;
    }
    let w = sw, h = sh;
    if (s.size > 0) {
      const k = s.size / Math.max(sw, sh);
      w = Math.max(1, Math.round(sw * k)); h = Math.max(1, Math.round(sh * k));
    }
    const c = makeCanvas(w, h);
    const x = ctx2d(c);
    x.imageSmoothingEnabled = s.resample !== 'nearest';
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    return c;
  }

  // ---- stage 2: flatten lighting ---------------------------------------------
  function flatten(canvas, amount) {
    if (amount <= 0) return;
    const w = canvas.width, h = canvas.height;
    const k = amount / 100;
    const cells = 6;
    const lw = Math.max(2, Math.round(cells * w / Math.max(w, h)));
    const lh = Math.max(2, Math.round(cells * h / Math.max(w, h)));
    const tiny = makeCanvas(lw, lh);
    const tx = ctx2d(tiny);
    tx.imageSmoothingEnabled = true; tx.imageSmoothingQuality = 'high';
    tx.drawImage(canvas, 0, 0, lw, lh);
    const low = makeCanvas(w, h);
    const lx = ctx2d(low);
    lx.imageSmoothingEnabled = true; lx.imageSmoothingQuality = 'high';
    lx.drawImage(tiny, 0, 0, w, h);
    const L = lx.getImageData(0, 0, w, h).data;
    const cx = ctx2d(canvas);
    const id = cx.getImageData(0, 0, w, h);
    const d = id.data;
    const mean = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { mean[0] += d[i]; mean[1] += d[i + 1]; mean[2] += d[i + 2]; }
    const n = d.length / 4;
    mean[0] /= n; mean[1] /= n; mean[2] /= n;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = d[i] - k * (L[i] - mean[0]);
      d[i + 1] = d[i + 1] - k * (L[i + 1] - mean[1]);
      d[i + 2] = d[i + 2] - k * (L[i + 2] - mean[2]);
    }
    cx.putImageData(id, 0, 0);
  }

  // ---- mask helpers ----------------------------------------------------------
  // t: 0 at the tile edge, 1 at the inner end of the blend zone.
  // Returns the weight of the healing layer (1 = fully healed).
  function edgeWeight(t, f, jitterAmt, n) {
    t = clamp01(t);
    if (jitterAmt > 0) t = clamp01(t + (n - 0.5) * jitterAmt * Math.sin(Math.PI * t) * 1.6);
    return 1 - f(t);
  }

  // ---- mode: blend (offset + heal) -------------------------------------------
  function blend(canvas, s) {
    const w = canvas.width, h = canvas.height;
    const doX = s.direction !== 'y', doY = s.direction !== 'x';
    const cx = ctx2d(canvas);
    const src = cx.getImageData(0, 0, w, h);
    const I = src.data;
    const out = cx.createImageData(w, h);
    const O = out.data;
    const ox = doX ? Math.round(w * s.offsetX / 100) : 0;
    const oy = doY ? Math.round(h * s.offsetY / 100) : 0;
    // the shifted layer has its own seam at w-ox / h-oy; keep the blend zone clear of it
    const seamX = w - ox, seamY = h - oy;
    const bwx = Math.max(1, Math.min(w * s.width / 100, seamX - 1, w - seamX - 1));
    const bwy = Math.max(1, Math.min(h * s.width / 100, seamY - 1, h - seamY - 1));
    const f = FALLOFF[s.falloff] || smoothstep;
    const strength = s.strength / 100;
    const jit = s.jitter / 100;
    const noise = jit > 0 ? makeNoise(s.seed | 0, Math.max(6, Math.min(bwx, bwy) / 2)) : null;
    const pixel = s.pixelSafe;

    const mxCol = new Float32Array(w);
    if (doX && !jit) for (let x = 0; x < w; x++) mxCol[x] = edgeWeight(Math.min(x, w - 1 - x) / bwx, f, 0, 0);

    for (let y = 0; y < h; y++) {
      const sy = (y + oy) % h;
      const myBase = doY ? Math.min(y, h - 1 - y) / bwy : 2;
      const myRow = (doY && !jit) ? edgeWeight(myBase, f, 0, 0) : 0;
      for (let x = 0; x < w; x++) {
        let mx = 0, my = 0;
        if (jit) {
          const n = noise(x, y);
          if (doX) mx = edgeWeight(Math.min(x, w - 1 - x) / bwx, f, jit, n);
          if (doY) my = edgeWeight(myBase, f, jit, 1 - n);
        } else {
          mx = doX ? mxCol[x] : 0;
          my = myRow;
        }
        const m = (1 - (1 - mx) * (1 - my)) * strength;
        const i = (y * w + x) * 4;
        const j = (sy * w + (x + ox) % w) * 4;
        if (pixel) {
          const k = m > BAYER[(y & 3) * 4 + (x & 3)] ? j : i;
          O[i] = I[k]; O[i + 1] = I[k + 1]; O[i + 2] = I[k + 2]; O[i + 3] = I[k + 3];
        } else {
          const a = 1 - m;
          O[i] = I[i] * a + I[j] * m;
          O[i + 1] = I[i + 1] * a + I[j + 1] * m;
          O[i + 2] = I[i + 2] * a + I[j + 2] * m;
          O[i + 3] = I[i + 3] * a + I[j + 3] * m;
        }
      }
    }
    cx.putImageData(out, 0, 0);
    return canvas;
  }

  // ---- mode: edge fix (center untouched) ------------------------------------
  function edgeFixAxis(canvas, s, axis) {
    const w = canvas.width, h = canvas.height;
    const cx = ctx2d(canvas);
    const src = cx.getImageData(0, 0, w, h);
    const I = src.data;
    const O = new Uint8ClampedArray(I);
    const len = axis === 'x' ? w : h;
    const bw = Math.max(1, Math.min(len * s.width / 100, len / 2));
    const f = FALLOFF[s.falloff] || smoothstep;
    const strength = s.strength / 100;
    const jit = s.jitter / 100;
    const noise = jit > 0 ? makeNoise((s.seed | 0) + (axis === 'x' ? 0 : 77), Math.max(6, bw / 2)) : null;
    const zone = Math.ceil(bw);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = axis === 'x' ? x : y;
        const d = Math.min(p, len - 1 - p);
        if (d > zone) continue;
        const t = d / bw;
        const a = 0.5 * edgeWeight(t, f, jit, jit ? noise(x, y) : 0) * strength;
        const px = axis === 'x' ? w - 1 - x : x;
        const py = axis === 'x' ? y : h - 1 - y;
        const i = (y * w + x) * 4, j = (py * w + px) * 4;
        if (s.pixelSafe) {
          if (a > BAYER[(y & 3) * 4 + (x & 3)]) { O[i] = I[j]; O[i + 1] = I[j + 1]; O[i + 2] = I[j + 2]; O[i + 3] = I[j + 3]; }
        } else {
          const b = 1 - a;
          O[i] = I[i] * b + I[j] * a;
          O[i + 1] = I[i + 1] * b + I[j + 1] * a;
          O[i + 2] = I[i + 2] * b + I[j + 2] * a;
          O[i + 3] = I[i + 3] * b + I[j + 3] * a;
        }
      }
    }
    src.data.set(O);
    cx.putImageData(src, 0, 0);
  }
  function edgeFix(canvas, s) {
    if (s.direction !== 'y') edgeFixAxis(canvas, s, 'x');
    if (s.direction !== 'x') edgeFixAxis(canvas, s, 'y');
    return canvas;
  }

  // ---- mode: mirror (kaleidoscope) -------------------------------------------
  function mirror(canvas, s) {
    const w = canvas.width, h = canvas.height;
    const doX = s.direction !== 'y', doY = s.direction !== 'x';
    const W = doX ? w * 2 : w, H = doY ? h * 2 : h;
    const c = makeCanvas(W, H);
    const x = ctx2d(c);
    const quad = (fx, fy, dx, dy) => {
      x.save();
      x.translate(dx + (fx ? w : 0), dy + (fy ? h : 0));
      x.scale(fx ? -1 : 1, fy ? -1 : 1);
      x.drawImage(canvas, 0, 0);
      x.restore();
    };
    quad(false, false, 0, 0);
    if (doX) quad(true, false, w, 0);
    if (doY) quad(false, true, 0, h);
    if (doX && doY) quad(true, true, w, h);
    if (!s.mirrorFit) return c;
    const fit = makeCanvas(w, h);
    const fx = ctx2d(fit);
    fx.imageSmoothingEnabled = !(s.pixelSafe || s.resample === 'nearest');
    fx.imageSmoothingQuality = 'high';
    fx.drawImage(c, 0, 0, w, h);
    return fit;
  }

  // ---- mode: offset only (seam inspection / manual painting) ---------------
  function offset(canvas, s) {
    const w = canvas.width, h = canvas.height;
    const ox = s.direction !== 'y' ? Math.round(w * s.offsetX / 100) : 0;
    const oy = s.direction !== 'x' ? Math.round(h * s.offsetY / 100) : 0;
    const c = makeCanvas(w, h);
    const x = ctx2d(c);
    for (const dx of [-ox, w - ox]) for (const dy of [-oy, h - oy]) x.drawImage(canvas, dx, dy);
    return c;
  }

  // ---- PSX effects: colour limit + dither ------------------------------------
  function bayerMatrix(n) { // n = 2,4,8 -> normalised thresholds in 0..1
    let m = [[0, 2], [3, 1]];
    while (m.length < n) {
      const k = m.length, next = [];
      for (let y = 0; y < k * 2; y++) {
        next.push([]);
        for (let x = 0; x < k * 2; x++) {
          const q = [0, 2, 3, 1][(y >= k ? 2 : 0) + (x >= k ? 1 : 0)];
          next[y].push(4 * m[y % k][x % k] + q);
        }
      }
      m = next;
    }
    const nn = n * n;
    return m.flat().map(v => (v + 0.5) / nn);
  }
  const BAYER4 = bayerMatrix(4), BAYER8 = bayerMatrix(8);
  const to15 = v => { v = v < 0 ? 0 : v > 255 ? 255 : v; const q = Math.round(v / 255 * 31); return (q << 3) | (q >> 2); };

  // Median-cut palette from a pixel sample. Returns [[r,g,b], ...].
  function medianCut(d, count, snap15) {
    const total = d.length / 4;
    const step = Math.max(1, Math.floor(total / 120000));
    const R = [], G = [], B = [];
    for (let i = 0; i < total; i += step) { const j = i * 4; if (d[j + 3] === 0) continue; R.push(d[j]); G.push(d[j + 1]); B.push(d[j + 2]); }
    if (!R.length) { R.push(0); G.push(0); B.push(0); }
    const ch = [R, G, B];
    const range = idx => {
      let best = -1, axis = 0;
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0;
        for (const i of idx) { const v = ch[c][i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (hi - lo > best) { best = hi - lo; axis = c; }
      }
      return { span: best, axis };
    };
    let boxes = [{ idx: R.map((_, i) => i) }];
    boxes[0].r = range(boxes[0].idx);
    while (boxes.length < count) {
      let bi = -1, score = 0;
      boxes.forEach((b, i) => { const sc = b.r.span * Math.sqrt(b.idx.length); if (b.idx.length > 1 && b.r.span > 0 && sc > score) { score = sc; bi = i; } });
      if (bi < 0) break;
      const b = boxes[bi], a = ch[b.r.axis];
      b.idx.sort((x, y) => a[x] - a[y]);
      const mid = b.idx.length >> 1;
      const lo = { idx: b.idx.slice(0, mid) }, hi = { idx: b.idx.slice(mid) };
      lo.r = range(lo.idx); hi.r = range(hi.idx);
      boxes.splice(bi, 1, lo, hi);
    }
    const pal = boxes.map(b => {
      let r = 0, g = 0, bl = 0;
      for (const i of b.idx) { r += R[i]; g += G[i]; bl += B[i]; }
      const n = b.idx.length;
      const c = [r / n, g / n, bl / n].map(Math.round);
      return snap15 ? c.map(to15) : c;
    });
    // drop duplicates created by 15-bit snapping
    const seen = new Set();
    return pal.filter(c => { const k = c.join(); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  const psxActive = s => s.psx && (s.psxLimit || s.psx15);
  function psx(canvas, s) {
    if (!psxActive(s)) return;
    const w = canvas.width, h = canvas.height;
    const cx = ctx2d(canvas);
    const id = cx.getImageData(0, 0, w, h);
    const d = id.data;
    const pal = s.psxLimit ? medianCut(d, Math.max(2, Math.min(256, s.psxColors | 0)), s.psx15) : null;
    const out = [0, 0, 0];
    let nearest;
    if (pal) {
      const cache = new Int16Array(1 << 18).fill(-1); // 6 bits per channel
      nearest = (r, g, b) => {
        r = r < 0 ? 0 : r > 255 ? 255 : r; g = g < 0 ? 0 : g > 255 ? 255 : g; b = b < 0 ? 0 : b > 255 ? 255 : b;
        const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
        let k = cache[key];
        if (k < 0) {
          let best = Infinity;
          for (let p = 0; p < pal.length; p++) {
            const c = pal[p], dr = r - c[0], dg = g - c[1], db = b - c[2];
            const dist = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
            if (dist < best) { best = dist; k = p; }
          }
          cache[key] = k;
        }
        const c = pal[k]; out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
        return out;
      };
    } else {
      nearest = (r, g, b) => { out[0] = to15(r); out[1] = to15(g); out[2] = to15(b); return out; };
    }
    // one palette "step": how far apart neighbouring colours roughly are
    const spread = (pal ? 255 / Math.max(1, Math.cbrt(pal.length) - 0.5) : 255 / 31) * (s.psxDitherAmt / 100);
    const mode = s.psxDitherAmt > 0 ? s.psxDither : 'none';

    if (mode === 'fs') {
      // Floyd–Steinberg, errors wrap horizontally so left/right edges stay continuous
      const buf = new Float32Array(w * h * 3);
      for (let i = 0, j = 0; i < d.length; i += 4, j += 3) { buf[j] = d[i]; buf[j + 1] = d[i + 1]; buf[j + 2] = d[i + 2]; }
      const amt = s.psxDitherAmt / 100;
      const push = (x, y, e0, e1, e2, f) => {
        if (y >= h) return;
        const j = (y * w + ((x + w) % w)) * 3;
        buf[j] += e0 * f; buf[j + 1] += e1 * f; buf[j + 2] += e2 * f;
      };
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const j = (y * w + x) * 3, i = (y * w + x) * 4;
        const r = buf[j], g = buf[j + 1], b = buf[j + 2];
        const c = nearest(Math.round(r), Math.round(g), Math.round(b));
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
        const e0 = (r - c[0]) * amt, e1 = (g - c[1]) * amt, e2 = (b - c[2]) * amt;
        push(x + 1, y, e0, e1, e2, 7 / 16); push(x - 1, y + 1, e0, e1, e2, 3 / 16);
        push(x, y + 1, e0, e1, e2, 5 / 16); push(x + 1, y + 1, e0, e1, e2, 1 / 16);
      }
    } else {
      const M = mode === 'bayer8' ? BAYER8 : mode === 'bayer4' ? BAYER4 : null;
      const n = mode === 'bayer8' ? 8 : 4;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const t = M ? (M[(y % n) * n + (x % n)] - 0.5) * spread : 0;
        const c = nearest(Math.round(d[i] + t), Math.round(d[i + 1] + t), Math.round(d[i + 2] + t));
        d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
      }
    }
    cx.putImageData(id, 0, 0);
  }

  // ---- background: black -> transparent ----------------------------------------
  function keyBlack(canvas, s) {
    if (!s.keyBlack) return;
    const w = canvas.width, h = canvas.height, n = w * h;
    const cx = ctx2d(canvas);
    const id = cx.getImageData(0, 0, w, h);
    const d = id.data;
    // PSX output keeps hard 1-bit alpha and no new colours, like the real hardware
    const hard = psxActive(s);
    const tol = s.keyTol, soft = hard ? 0 : s.keySoft, hi = tol + soft;
    const lum = new Uint8Array(n);
    for (let p = 0, i = 0; p < n; p++, i += 4) lum[p] = Math.max(d[i], d[i + 1], d[i + 2]);
    let reach;
    if (s.keyConnected) {
      reach = new Uint8Array(n);
      const q = new Int32Array(n);
      let head = 0, tail = 0;
      const seed = p => { if (!reach[p] && lum[p] <= hi) { reach[p] = 1; q[tail++] = p; } };
      for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
      for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
      while (head < tail) {
        const p = q[head++], x = p % w;
        if (x > 0) seed(p - 1);
        if (x < w - 1) seed(p + 1);
        if (p >= w) seed(p - w);
        if (p < n - w) seed(p + w);
      }
    }
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const v = lum[p];
      if (v > hi || (reach && !reach[p])) continue;
      if (v <= tol || soft === 0) { d[i + 3] = 0; continue; }
      const a = (v - tol) / soft;
      d[i] = Math.min(255, d[i] / a); d[i + 1] = Math.min(255, d[i + 1] / a); d[i + 2] = Math.min(255, d[i + 2] / a);
      d[i + 3] = d[i + 3] * a;
    }
    cx.putImageData(id, 0, 0);
  }

  // ---- metrics ----------------------------------------------------------------
  // Mean absolute difference across the wrap seams, as % of full range.
  function edgeDiff(canvas, direction) {
    const w = canvas.width, h = canvas.height;
    const d = ctx2d(canvas).getImageData(0, 0, w, h).data;
    let sum = 0, n = 0;
    const px = (x, y) => (y * w + x) * 4;
    if (direction !== 'y') for (let y = 0; y < h; y++) {
      const a = px(0, y), b = px(w - 1, y);
      sum += Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2]); n += 3;
    }
    if (direction !== 'x') for (let x = 0; x < w; x++) {
      const a = px(x, 0), b = px(x, h - 1);
      sum += Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2]); n += 3;
    }
    return n ? (sum / n) / 255 * 100 : 0;
  }
  // Typical difference between neighbouring pixels inside the image: what a seam
  // "should" look like. seam / natural ~ 1.0 means the wrap is invisible.
  function naturalDiff(canvas, direction) {
    const w = canvas.width, h = canvas.height;
    const d = ctx2d(canvas).getImageData(0, 0, w, h).data;
    let sum = 0, n = 0;
    const step = Math.max(1, Math.floor(Math.max(w, h) / 256));
    if (direction !== 'y') for (let y = 0; y < h; y += step) for (let x = 0; x < w - 1; x++) {
      const a = (y * w + x) * 4, b = a + 4;
      sum += Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2]); n += 3;
    }
    if (direction !== 'x') for (let x = 0; x < w; x += step) for (let y = 0; y < h - 1; y++) {
      const a = (y * w + x) * 4, b = a + w * 4;
      sum += Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2]); n += 3;
    }
    return n ? (sum / n) / 255 * 100 : 0;
  }
  function seamScore(canvas, direction) {
    const nat = naturalDiff(canvas, direction);
    return nat > 0.01 ? edgeDiff(canvas, direction) / nat : 0;
  }
  function colorCount(canvas) {
    const d = ctx2d(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
    const set = new Set();
    for (let i = 0; i < d.length; i += 4) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    return set.size;
  }

  // ---- pipeline ---------------------------------------------------------------
  function process(img, settings) {
    const s = Object.assign({}, DEFAULTS, settings);
    const base = prepare(img, s);
    flatten(base, s.flatten);
    const before = seamScore(base, s.direction);
    const work = makeCanvas(base.width, base.height);
    ctx2d(work).drawImage(base, 0, 0);
    let out;
    if (!s.tile) out = work;
    else switch (s.mode) {
      case 'mirror': out = mirror(work, s); break;
      case 'edge': out = edgeFix(work, s); break;
      case 'offset': out = offset(work, s); break;
      default: out = blend(work, s);
    }
    keyBlack(out, s); // before PSX so the palette is built from the subject, not the background
    psx(out, s);
    return {
      canvas: out,
      source: base,
      metrics: {
        before,
        after: seamScore(out, s.direction),
        width: out.width,
        height: out.height,
        colors: colorCount(out),
      },
    };
  }

  window.SeamlessEngine = { DEFAULTS, process, edgeDiff, makeCanvas, psxActive };
})();
