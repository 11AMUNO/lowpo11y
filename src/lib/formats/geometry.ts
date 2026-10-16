/**
 * Small flat-shaded primitive builders (non-indexed faces get their own
 * vertices so normals stay faceted — the low-poly look).
 */
export interface Geometry {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
}

class Builder {
  p: number[] = [];
  n: number[] = [];
  uv: number[] = [];
  i: number[] = [];
  /** Adds a planar quad (a,b,c,d counter-clockwise when viewed from the front). */
  quad(a: number[], b: number[], c: number[], d: number[], uvs: number[][] = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const base = this.p.length / 3;
    const nrm = normal(a, b, c);
    for (const [k, v] of [a, b, c, d].entries()) {
      this.p.push(v[0]!, v[1]!, v[2]!);
      this.n.push(...nrm);
      this.uv.push(uvs[k]![0]!, uvs[k]![1]!);
    }
    this.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  tri(a: number[], b: number[], c: number[], uvs: number[][] = [[0, 0], [1, 0], [0.5, 1]]) {
    const base = this.p.length / 3;
    const nrm = normal(a, b, c);
    for (const [k, v] of [a, b, c].entries()) {
      this.p.push(v[0]!, v[1]!, v[2]!);
      this.n.push(...nrm);
      this.uv.push(uvs[k]![0]!, uvs[k]![1]!);
    }
    this.i.push(base, base + 1, base + 2);
  }
  build(): Geometry {
    const count = this.p.length / 3;
    return {
      positions: new Float32Array(this.p),
      normals: new Float32Array(this.n),
      uvs: new Float32Array(this.uv),
      indices: count > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i),
    };
  }
}

function normal(a: number[], b: number[], c: number[]): [number, number, number] {
  const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
  const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
  const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
  const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
  return [n[0]! / len, n[1]! / len, n[2]! / len];
}

/** Axis-aligned box centred on (cx, cy, cz). UVs repeat per `uvScale` metres when given. */
export function box(w: number, h: number, d: number, cx = 0, cy = 0, cz = 0, uvScale?: number): Geometry {
  const b = new Builder();
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const uv = (u: number, v: number) => (uvScale ? [[0, 0], [u / uvScale, 0], [u / uvScale, v / uvScale], [0, v / uvScale]] : undefined);
  b.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], uv(w, h)); // front +z
  b.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], uv(w, h)); // back -z
  b.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], uv(d, h)); // right +x
  b.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], uv(d, h)); // left -x
  b.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], uv(w, d)); // top +y
  b.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], uv(w, d)); // bottom -y
  return b.build();
}

/** Faceted cylinder along +Y with `sides` segments, base centred at (cx, cy, cz). */
export function cylinder(radius: number, height: number, sides = 8, cx = 0, cy = 0, cz = 0, capped = true): Geometry {
  const b = new Builder();
  const pt = (k: number, y: number) => {
    const a = (k / sides) * Math.PI * 2;
    return [cx + Math.cos(a) * radius, y, cz - Math.sin(a) * radius];
  };
  for (let k = 0; k < sides; k++) {
    const u0 = k / sides, u1 = (k + 1) / sides;
    b.quad(pt(k, cy), pt(k + 1, cy), pt(k + 1, cy + height), pt(k, cy + height), [[u0, 0], [u1, 0], [u1, 1], [u0, 1]]);
    if (capped) {
      b.tri([cx, cy + height, cz], pt(k, cy + height), pt(k + 1, cy + height));
      b.tri([cx, cy, cz], pt(k + 1, cy), pt(k, cy));
    }
  }
  return b.build();
}

/** Horizontal plane on XZ at height y, facing +Y. */
export function plane(w: number, d: number, y = 0, uvRepeat = 1): Geometry {
  const b = new Builder();
  b.quad([-w / 2, y, d / 2], [w / 2, y, d / 2], [w / 2, y, -d / 2], [-w / 2, y, -d / 2], [[0, 0], [uvRepeat, 0], [uvRepeat, uvRepeat], [0, uvRepeat]]);
  return b.build();
}

/** Concatenate geometries into one indexed geometry. */
export function merge(...parts: Geometry[]): Geometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const g of parts) {
    const base = positions.length / 3;
    positions.push(...g.positions);
    normals.push(...g.normals);
    uvs.push(...g.uvs);
    for (const i of g.indices) indices.push(i + base);
  }
  const count = positions.length / 3;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: count > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
  };
}

/** Truncated cone (frustum) along +Y; rTop = 0 gives a cone. */
export function frustum(rBottom: number, rTop: number, height: number, sides = 8, cx = 0, cy = 0, cz = 0, capped = true): Geometry {
  const b = new Builder();
  const pt = (k: number, r: number, y: number) => {
    const a = (k / sides) * Math.PI * 2;
    return [cx + Math.cos(a) * r, y, cz - Math.sin(a) * r];
  };
  for (let k = 0; k < sides; k++) {
    const u0 = k / sides, u1 = (k + 1) / sides;
    if (rTop > 0) b.quad(pt(k, rBottom, cy), pt(k + 1, rBottom, cy), pt(k + 1, rTop, cy + height), pt(k, rTop, cy + height), [[u0, 0], [u1, 0], [u1, 1], [u0, 1]]);
    else b.tri(pt(k, rBottom, cy), pt(k + 1, rBottom, cy), [cx, cy + height, cz], [[u0, 0], [u1, 0], [(u0 + u1) / 2, 1]]);
    if (capped) {
      if (rTop > 0) b.tri([cx, cy + height, cz], pt(k, rTop, cy + height), pt(k + 1, rTop, cy + height));
      b.tri([cx, cy, cz], pt(k + 1, rBottom, cy), pt(k, rBottom, cy));
    }
  }
  return b.build();
}

/**
 * Extrudes a closed 2D profile (x,y pairs, counter-clockwise) along Z by `depth`,
 * centred on z=0. Caps are fan-triangulated, so the profile must be convex or star-shaped from its first point.
 */
export function extrude(profile: [number, number][], depth: number, uvScale = 1): Geometry {
  const b = new Builder();
  const z0 = -depth / 2, z1 = depth / 2;
  let run = 0;
  for (let i = 0; i < profile.length; i++) {
    const [ax, ay] = profile[i]!;
    const [bx, by] = profile[(i + 1) % profile.length]!;
    const len = Math.hypot(bx - ax, by - ay);
    b.quad([ax, ay, z1], [bx, by, z1], [bx, by, z0], [ax, ay, z0], [[run / uvScale, 0], [(run + len) / uvScale, 0], [(run + len) / uvScale, depth / uvScale], [run / uvScale, depth / uvScale]]);
    run += len;
  }
  const uv = ([x, y]: [number, number]) => [x / uvScale, y / uvScale];
  for (let i = 1; i < profile.length - 1; i++) {
    const a = profile[0]!, p = profile[i]!, q = profile[i + 1]!;
    b.tri([a[0], a[1], z1], [p[0], p[1], z1], [q[0], q[1], z1], [uv(a), uv(p), uv(q)]);
    b.tri([a[0], a[1], z0], [q[0], q[1], z0], [p[0], p[1], z0], [uv(a), uv(q), uv(p)]);
  }
  return b.build();
}
