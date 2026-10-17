/**
 * Blue-noise threshold mask by void-and-cluster (Ulichney 1993) on a torus,
 * so it tiles. Generated deterministically once per size and cached.
 * Values are ranks normalised to (0, 1): every threshold appears once.
 */
import { mulberry32 } from "./random";

const cache = new Map<number, Float32Array>();

export function blueNoise(size = 64, seed = 1): Float32Array {
  const key = size * 1000 + seed;
  const hit = cache.get(key);
  if (hit) return hit;
  const n = size * size;
  const sigma = 1.5;
  const radius = 5;
  const kernel: { dx: number; dy: number; w: number }[] = [];
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) kernel.push({ dx, dy, w: Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)) });
  const energy = new Float64Array(n);
  const on = new Uint8Array(n);
  const wrap = (v: number) => ((v % size) + size) % size;
  const splat = (p: number, sign: 1 | -1) => {
    const x = p % size,
      y = (p / size) | 0;
    for (const k of kernel) energy[wrap(y + k.dy) * size + wrap(x + k.dx)]! += sign * k.w;
  };
  const tightest = () => {
    let best = -Infinity,
      bi = 0;
    for (let i = 0; i < n; i++)
      if (on[i] && energy[i]! > best) {
        best = energy[i]!;
        bi = i;
      }
    return bi;
  };
  const largestVoid = () => {
    let best = Infinity,
      bi = 0;
    for (let i = 0; i < n; i++)
      if (!on[i] && energy[i]! < best) {
        best = energy[i]!;
        bi = i;
      }
    return bi;
  };

  // 1. random initial pattern (~10%), relaxed until clusters and voids swap no more
  const rnd = mulberry32(seed);
  const initial = Math.max(1, Math.round(n * 0.1));
  let placed = 0;
  while (placed < initial) {
    const p = Math.floor(rnd() * n);
    if (on[p]) continue;
    on[p] = 1;
    splat(p, 1);
    placed++;
  }
  for (let guard = 0; guard < n; guard++) {
    const c = tightest();
    on[c] = 0;
    splat(c, -1);
    const v = largestVoid();
    if (v === c) {
      on[c] = 1;
      splat(c, 1);
      break;
    }
    on[v] = 1;
    splat(v, 1);
  }

  const rank = new Int32Array(n);
  // 2. rank the initial points by removing the tightest cluster each time
  const savedOn = new Uint8Array(on);
  const savedEnergy = new Float64Array(energy);
  for (let r = initial - 1; r >= 0; r--) {
    const c = tightest();
    on[c] = 0;
    splat(c, -1);
    rank[c] = r;
  }
  on.set(savedOn);
  energy.set(savedEnergy);
  // 3. fill the largest voids for the remaining ranks
  for (let r = initial; r < n; r++) {
    const v = largestVoid();
    on[v] = 1;
    splat(v, 1);
    rank[v] = r;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (rank[i]! + 0.5) / n;
  cache.set(key, out);
  return out;
}
