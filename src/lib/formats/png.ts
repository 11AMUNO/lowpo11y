/**
 * Minimal PNG encoder for 8-bit RGBA buffers. Canvas encoders premultiply
 * alpha internally, which can shift semi-transparent pixels by a level; this
 * writes the exact bytes it is given, identically in every browser and Node.
 * Per-row filter chosen by the usual minimum-sum-of-absolutes heuristic.
 */
import { zlibSync } from "fflate";
import type { RGBAImage } from "@/lib/processing/image";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  const t = new TextEncoder().encode(type);
  out.set(t, 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32([t, data]));
  return out;
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c,
    pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

export function encodePng(img: RGBAImage, level: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 9): Uint8Array {
  const { width: w, height: h, data } = img;
  const stride = w * 4;
  const raw = new Uint8Array((stride + 1) * h);
  const cand = Array.from({ length: 5 }, () => new Uint8Array(stride));
  for (let y = 0; y < h; y++) {
    const row = data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null;
    let best = 0,
      bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const o = cand[f]!;
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? row[i - 4]! : 0,
          b = prev ? prev[i]! : 0,
          c = prev && i >= 4 ? prev[i - 4]! : 0,
          x = row[i]!;
        const v = f === 0 ? x : f === 1 ? x - a : f === 2 ? x - b : f === 3 ? x - ((a + b) >> 1) : x - paeth(a, b, c);
        o[i] = v & 0xff;
        sum += o[i]! < 128 ? o[i]! : 256 - o[i]!;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    raw[y * (stride + 1)] = best;
    raw.set(cand[best]!, y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", zlibSync(raw, { level })), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
