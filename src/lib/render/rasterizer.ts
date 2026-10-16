/**
 * Software rasterizer for model thumbnails. No GPU, no DOM: runs in Node
 * (server-side previews, seeds, bulk import) and in workers.
 * Flat face shading, perspective-correct UVs, z-buffer, alpha cutout,
 * supersampled and box-filtered down.
 */
import type { ExtractedMesh } from "@/lib/formats/gltf-meshes";
import { createImage, type RGBA, type RGBAImage } from "@/lib/processing/image";

export interface RenderTexture {
  image: RGBAImage;
  nearest: boolean;
}

export interface RenderOptions {
  width: number;
  height: number;
  /** Supersampling factor per axis (2 = 4 samples per pixel). */
  supersample?: number;
  azimuthDeg?: number;
  elevationDeg?: number;
  fovDeg?: number;
  /** null = transparent background. */
  background?: RGBA | null;
  ambient?: number;
  /** Fraction of the frame left empty around the model. */
  padding?: number;
}

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function sceneBounds(meshes: ExtractedMesh[]): { min: V3; max: V3 } | null {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes)
    for (let i = 0; i < m.positions.length; i += 3)
      for (let k = 0; k < 3; k++) {
        const v = m.positions[i + k]!;
        if (v < min[k]!) min[k] = v;
        if (v > max[k]!) max[k] = v;
      }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

function sample(tex: RenderTexture, u: number, v: number, out: number[]) {
  const { image } = tex;
  const w = image.width;
  const h = image.height;
  const d = image.data;
  let x = (u - Math.floor(u)) * w;
  let y = (v - Math.floor(v)) * h;
  if (tex.nearest) {
    const xi = Math.min(w - 1, Math.floor(x));
    const yi = Math.min(h - 1, Math.floor(y));
    const i = (yi * w + xi) * 4;
    out[0] = d[i]!;
    out[1] = d[i + 1]!;
    out[2] = d[i + 2]!;
    out[3] = d[i + 3]!;
    return;
  }
  x -= 0.5;
  y -= 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const wrapX = (n: number) => ((n % w) + w) % w;
  const wrapY = (n: number) => ((n % h) + h) % h;
  const i00 = (wrapY(y0) * w + wrapX(x0)) * 4;
  const i10 = (wrapY(y0) * w + wrapX(x0 + 1)) * 4;
  const i01 = (wrapY(y0 + 1) * w + wrapX(x0)) * 4;
  const i11 = (wrapY(y0 + 1) * w + wrapX(x0 + 1)) * 4;
  for (let c = 0; c < 4; c++) {
    const a = d[i00 + c]! + (d[i10 + c]! - d[i00 + c]!) * fx;
    const b = d[i01 + c]! + (d[i11 + c]! - d[i01 + c]!) * fx;
    out[c] = a + (b - a) * fy;
  }
}

export function renderMeshes(meshes: ExtractedMesh[], textures: Map<number, RenderTexture>, opts: RenderOptions): RGBAImage {
  const ss = Math.max(1, Math.min(4, Math.round(opts.supersample ?? 2)));
  const W = opts.width * ss;
  const H = opts.height * ss;
  const bg = opts.background ?? null;
  const color = new Float32Array(W * H * 4);
  if (bg) for (let i = 0; i < W * H; i++) color.set([bg[0], bg[1], bg[2], bg[3]], i * 4);
  const depth = new Float32Array(W * H).fill(Infinity);

  const bounds = sceneBounds(meshes);
  if (!bounds) return downsample(color, W, H, ss, opts.width, opts.height);

  const center: V3 = [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2];
  const radius = Math.max(1e-6, Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]) / 2);
  const fov = ((opts.fovDeg ?? 28) * Math.PI) / 180;
  const az = ((opts.azimuthDeg ?? 35) * Math.PI) / 180;
  const el = ((opts.elevationDeg ?? 22) * Math.PI) / 180;
  const dir: V3 = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  const dist = radius / Math.sin(fov / 2);
  const eye: V3 = [center[0] + dir[0] * dist, center[1] + dir[1] * dist, center[2] + dir[2] * dist];
  const fwd = norm(sub(center, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const near = Math.max(1e-4, dist - radius * 1.5) * 0.5;

  // Key light from the camera's upper left, plus a dim fill from behind-right.
  const key = norm([right[0] * -0.6 + up[0] * 0.8 - fwd[0] * 0.5, right[1] * -0.6 + up[1] * 0.8 - fwd[1] * 0.5, right[2] * -0.6 + up[2] * 0.8 - fwd[2] * 0.5]);
  const fill = norm([right[0] * 0.7 - up[0] * 0.2 + fwd[0] * 0.6, right[1] * 0.7 - up[1] * 0.2 + fwd[1] * 0.6, right[2] * 0.7 - up[2] * 0.2 + fwd[2] * 0.6]);
  const ambient = opts.ambient ?? 0.5;

  // Pass 1: project to view space and find the framing that fills the image.
  const projected = meshes.map((m) => {
    const n = m.positions.length / 3;
    const vx = new Float32Array(n), vy = new Float32Array(n), vz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p: V3 = [m.positions[i * 3]! - eye[0], m.positions[i * 3 + 1]! - eye[1], m.positions[i * 3 + 2]! - eye[2]];
      const z = dot(p, fwd);
      vx[i] = dot(p, right) / z;
      vy[i] = dot(p, up) / z;
      vz[i] = z;
    }
    return { vx, vy, vz };
  });
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of projected)
    for (let i = 0; i < p.vx.length; i++) {
      if (p.vz[i]! <= near) continue;
      minX = Math.min(minX, p.vx[i]!);
      maxX = Math.max(maxX, p.vx[i]!);
      minY = Math.min(minY, p.vy[i]!);
      maxY = Math.max(maxY, p.vy[i]!);
    }
  const pad = opts.padding ?? 0.08;
  const scale = Math.min((W * (1 - pad * 2)) / Math.max(1e-9, maxX - minX), (H * (1 - pad * 2)) / Math.max(1e-9, maxY - minY));
  const offX = W / 2 - ((minX + maxX) / 2) * scale;
  const offY = H / 2 + ((minY + maxY) / 2) * scale;

  const texel = [0, 0, 0, 0];
  meshes.forEach((m, mi) => {
    const { vx, vy, vz } = projected[mi]!;
    const tex = m.imageIndex !== null ? textures.get(m.imageIndex) : undefined;
    const [br, bgc, bb, ba] = m.baseColor;
    for (let t = 0; t < m.indices.length; t += 3) {
      const a = m.indices[t]!, b = m.indices[t + 1]!, c = m.indices[t + 2]!;
      if (vz[a]! <= near || vz[b]! <= near || vz[c]! <= near) continue;
      const pa: V3 = [m.positions[a * 3]!, m.positions[a * 3 + 1]!, m.positions[a * 3 + 2]!];
      const pb: V3 = [m.positions[b * 3]!, m.positions[b * 3 + 1]!, m.positions[b * 3 + 2]!];
      const pc: V3 = [m.positions[c * 3]!, m.positions[c * 3 + 1]!, m.positions[c * 3 + 2]!];
      let n = norm(cross(sub(pb, pa), sub(pc, pa)));
      if (dot(n, sub(eye, pa)) < 0) n = [-n[0], -n[1], -n[2]]; // treat as double-sided
      const light = Math.min(1.35, ambient + 0.8 * Math.max(0, dot(n, key)) + 0.2 * Math.max(0, dot(n, fill)));

      const x0 = offX + vx[a]! * scale, y0 = offY - vy[a]! * scale;
      const x1 = offX + vx[b]! * scale, y1 = offY - vy[b]! * scale;
      const x2 = offX + vx[c]! * scale, y2 = offY - vy[c]! * scale;
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(area) < 1e-12) continue;
      const ix0 = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const ix1 = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      const iy0 = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const iy1 = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      const wa = 1 / vz[a]!, wb = 1 / vz[b]!, wc = 1 / vz[c]!;
      for (let py = iy0; py <= iy1; py++) {
        const sy = py + 0.5;
        for (let px = ix0; px <= ix1; px++) {
          const sx = px + 0.5;
          const l0 = ((x1 - sx) * (y2 - sy) - (x2 - sx) * (y1 - sy)) / area;
          const l1 = ((x2 - sx) * (y0 - sy) - (x0 - sx) * (y2 - sy)) / area;
          const l2 = 1 - l0 - l1;
          if (l0 < 0 || l1 < 0 || l2 < 0) continue;
          const invW = l0 * wa + l1 * wb + l2 * wc;
          const z = 1 / invW;
          const di = py * W + px;
          if (z >= depth[di]!) continue;
          let r = br * 255, g = bgc * 255, bl = bb * 255, al = ba;
          if (tex && m.uvs) {
            const u = (l0 * m.uvs[a * 2]! * wa + l1 * m.uvs[b * 2]! * wb + l2 * m.uvs[c * 2]! * wc) / invW;
            const v = (l0 * m.uvs[a * 2 + 1]! * wa + l1 * m.uvs[b * 2 + 1]! * wb + l2 * m.uvs[c * 2 + 1]! * wc) / invW;
            sample(tex, u, v, texel);
            r *= texel[0]! / 255;
            g *= texel[1]! / 255;
            bl *= texel[2]! / 255;
            al *= texel[3]! / 255;
          }
          if (m.colors) {
            r *= l0 * m.colors[a * 4]! + l1 * m.colors[b * 4]! + l2 * m.colors[c * 4]!;
            g *= l0 * m.colors[a * 4 + 1]! + l1 * m.colors[b * 4 + 1]! + l2 * m.colors[c * 4 + 1]!;
            bl *= l0 * m.colors[a * 4 + 2]! + l1 * m.colors[b * 4 + 2]! + l2 * m.colors[c * 4 + 2]!;
          }
          if (m.alphaMode !== "OPAQUE" && al < (m.alphaMode === "MASK" ? m.alphaCutoff : 0.5)) continue;
          depth[di] = z;
          const o = di * 4;
          color[o] = Math.min(255, r * light);
          color[o + 1] = Math.min(255, g * light);
          color[o + 2] = Math.min(255, bl * light);
          color[o + 3] = 255;
        }
      }
    }
  });
  return downsample(color, W, H, ss, opts.width, opts.height);
}

/** Box filter with alpha weighting, so transparent edges don't darken. */
function downsample(src: Float32Array, W: number, H: number, ss: number, w: number, h: number): RGBAImage {
  const out = createImage(w, h);
  const n = ss * ss;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const i = ((y * ss + sy) * W + (x * ss + sx)) * 4;
          const al = src[i + 3]! / 255;
          r += src[i]! * al;
          g += src[i + 1]! * al;
          b += src[i + 2]! * al;
          a += al;
        }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out.data[o] = r / a;
        out.data[o + 1] = g / a;
        out.data[o + 2] = b / a;
      }
      out.data[o + 3] = (a / n) * 255;
    }
  return out;
}
