/**
 * Writes a TrueType font from pixel-grid glyphs: each lit pixel becomes part
 * of a rectangle contour (runs merged across rows), so the outlines are
 * exact squares at any size. Produces every table browsers' font sanitisers
 * require (cmap, glyf, head, hhea, hmtx, loca, maxp, name, OS/2, post).
 */

export interface PixelGlyph {
  codepoint: number;
  /** Rows from the top; "#" is a lit pixel. Row `ascent - 1` sits on the baseline. */
  rows: string[];
  /** Advance in pixels (defaults to the font's). */
  advance?: number;
}

export interface PixelFontInput {
  family: string;
  version: string;
  copyright: string;
  license: string;
  licenseUrl: string;
  /** Font units per pixel; unitsPerEm = unit × (ascent + descent). */
  unit: number;
  /** Pixels above the baseline (rows[0] top edge) and below it. */
  ascent: number;
  descent: number;
  capHeight: number;
  xHeight: number;
  advance: number;
  glyphs: PixelGlyph[];
}

interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Lit pixels as rectangles: horizontal runs, merged with identical runs in the rows below. */
export function glyphRects(rows: string[]): Rect[] {
  const runs: (Rect & { open: boolean })[] = [];
  rows.forEach((row, r) => {
    let x = 0;
    const found: [number, number][] = [];
    while (x < row.length) {
      if (row[x] !== "#") {
        x++;
        continue;
      }
      const s = x;
      while (row[x] === "#") x++;
      found.push([s, x]);
    }
    for (const run of runs) if (run.open && !found.some(([a, b]) => a === run.x0 && b === run.x1)) run.open = false;
    for (const [a, b] of found) {
      const cont = runs.find((u) => u.open && u.x0 === a && u.x1 === b && u.y1 === r);
      if (cont) cont.y1 = r + 1;
      else runs.push({ x0: a, x1: b, y0: r, y1: r + 1, open: true });
    }
  });
  return runs.map(({ x0, x1, y0, y1 }) => ({ x0, x1, y0, y1 }));
}

class Writer {
  private parts: number[] = [];
  u8(v: number) {
    this.parts.push(v & 255);
  }
  u16(v: number) {
    this.parts.push((v >> 8) & 255, v & 255);
  }
  i16(v: number) {
    this.u16(v < 0 ? v + 65536 : v);
  }
  u32(v: number) {
    this.u16((v >>> 16) & 0xffff);
    this.u16(v & 0xffff);
  }
  tag(s: string) {
    for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i));
  }
  bytes(b: ArrayLike<number>) {
    for (let i = 0; i < b.length; i++) this.parts.push(b[i]!);
  }
  pad4() {
    while (this.parts.length % 4) this.parts.push(0);
  }
  get length() {
    return this.parts.length;
  }
  done() {
    return Uint8Array.from(this.parts);
  }
}

function checksum(b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < b.length; i += 4) sum = (sum + (((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0))) >>> 0;
  return sum;
}

export function writePixelFont(f: PixelFontInput): Uint8Array {
  const u = f.unit;
  const upem = u * (f.ascent + f.descent);
  const glyphs = [...f.glyphs].sort((a, b) => a.codepoint - b.codepoint);

  /* glyf + loca + hmtx. Glyph 0 is .notdef: a hollow box. */
  type Outline = { contours: [number, number][][]; advance: number };
  const outlines: Outline[] = [];
  const box = (x0: number, y0: number, x1: number, y1: number, cw: boolean): [number, number][] =>
    cw
      ? [
          [x0, y0],
          [x0, y1],
          [x1, y1],
          [x1, y0],
        ]
      : [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ];
  outlines.push({ contours: [box(0, 0, 4 * u, (f.ascent - 1) * u, true), box(u, u, 3 * u, (f.ascent - 2) * u, false)], advance: f.advance * u });
  for (const g of glyphs) {
    // rows[r] spans (ascent - r - 1 .. ascent - r) pixels above the baseline
    const contours = glyphRects(g.rows).map((r) => box(r.x0 * u, (f.ascent - r.y1) * u, r.x1 * u, (f.ascent - r.y0) * u, true));
    outlines.push({ contours, advance: (g.advance ?? f.advance) * u });
  }

  const glyf = new Writer();
  const loca: number[] = [];
  let maxPoints = 0,
    maxContours = 0;
  const bounds = { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity };
  const lsb: number[] = [];
  for (const o of outlines) {
    loca.push(glyf.length);
    if (!o.contours.length) {
      lsb.push(0);
      continue;
    }
    const pts = o.contours.flat();
    const xs = pts.map((p) => p[0]),
      ys = pts.map((p) => p[1]);
    const b = { xMin: Math.min(...xs), yMin: Math.min(...ys), xMax: Math.max(...xs), yMax: Math.max(...ys) };
    bounds.xMin = Math.min(bounds.xMin, b.xMin);
    bounds.yMin = Math.min(bounds.yMin, b.yMin);
    bounds.xMax = Math.max(bounds.xMax, b.xMax);
    bounds.yMax = Math.max(bounds.yMax, b.yMax);
    lsb.push(b.xMin);
    maxPoints = Math.max(maxPoints, pts.length);
    maxContours = Math.max(maxContours, o.contours.length);
    glyf.i16(o.contours.length);
    glyf.i16(b.xMin);
    glyf.i16(b.yMin);
    glyf.i16(b.xMax);
    glyf.i16(b.yMax);
    let end = -1;
    for (const c of o.contours) glyf.u16((end += c.length));
    glyf.u16(0); // no instructions
    for (let i = 0; i < pts.length; i++) glyf.u8(0x01); // on-curve, 16-bit deltas
    let px = 0,
      py = 0;
    for (const [x] of pts) {
      glyf.i16(x - px);
      px = x;
    }
    for (const [, y] of pts) {
      glyf.i16(y - py);
      py = y;
    }
    glyf.pad4();
  }
  loca.push(glyf.length);
  const numGlyphs = outlines.length;

  const hmtx = new Writer();
  outlines.forEach((o, i) => {
    hmtx.u16(o.advance);
    hmtx.i16(lsb[i]!);
  });
  const locaW = new Writer();
  for (const off of loca) locaW.u32(off);

  /* cmap format 4: one segment per run of consecutive code points */
  const bmp = glyphs.map((g, i) => ({ c: g.codepoint, gid: i + 1 })).filter((m) => m.c < 0xffff);
  const segs: { start: number; end: number; delta: number }[] = [];
  for (const m of bmp) {
    const last = segs[segs.length - 1];
    if (last && m.c === last.end + 1 && m.gid - m.c === last.delta) last.end = m.c;
    else segs.push({ start: m.c, end: m.c, delta: m.gid - m.c });
  }
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const segX2 = segs.length * 2;
  const sr = 2 * 2 ** Math.floor(Math.log2(segs.length));
  const sub = new Writer();
  sub.u16(4);
  sub.u16(16 + segs.length * 8);
  sub.u16(0);
  sub.u16(segX2);
  sub.u16(sr);
  sub.u16(Math.log2(sr / 2));
  sub.u16(segX2 - sr);
  for (const s of segs) sub.u16(s.end);
  sub.u16(0);
  for (const s of segs) sub.u16(s.start);
  for (const s of segs) sub.i16(((s.delta + 32768) % 65536) - 32768);
  for (let i = 0; i < segs.length; i++) sub.u16(0);
  const cmap = new Writer();
  cmap.u16(0);
  cmap.u16(2);
  for (const [p, e] of [
    [0, 3],
    [3, 1],
  ]) {
    cmap.u16(p!);
    cmap.u16(e!);
    cmap.u32(4 + 2 * 8);
  }
  cmap.bytes(sub.done());

  /* name */
  const psName = f.family.replace(/[^A-Za-z0-9-]/g, "");
  const records: [number, string][] = [
    [0, f.copyright],
    [1, f.family],
    [2, "Regular"],
    [3, `${psName}-Regular;${f.version}`],
    [4, `${f.family} Regular`],
    [5, `Version ${f.version}`],
    [6, `${psName}-Regular`],
    [13, f.license],
    [14, f.licenseUrl],
  ];
  const strings = new Writer();
  const name = new Writer();
  name.u16(0);
  name.u16(records.length);
  name.u16(6 + records.length * 12);
  const offsets: [number, number][] = [];
  for (const [, text] of records) {
    const start = strings.length;
    for (const ch of text) strings.u16(ch.charCodeAt(0));
    offsets.push([start, strings.length - start]);
  }
  records.forEach(([id], i) => {
    name.u16(3);
    name.u16(1);
    name.u16(0x409);
    name.u16(id);
    name.u16(offsets[i]![1]);
    name.u16(offsets[i]![0]);
  });
  name.bytes(strings.done());

  /* head, hhea, maxp, OS/2, post */
  const head = new Writer();
  head.u32(0x00010000);
  head.u32(0x00010000);
  head.u32(0); // checksumAdjustment, patched below
  head.u32(0x5f0f3cf5);
  head.u16(0x000b);
  head.u16(upem);
  for (let i = 0; i < 4; i++) head.u32(0); // created, modified: fixed for reproducible builds
  head.i16(bounds.xMin);
  head.i16(bounds.yMin);
  head.i16(bounds.xMax);
  head.i16(bounds.yMax);
  head.u16(0);
  head.u16(8);
  head.i16(2);
  head.i16(1); // long loca
  head.i16(0);

  const advMax = Math.max(...outlines.map((o) => o.advance));
  const hhea = new Writer();
  hhea.u32(0x00010000);
  hhea.i16(f.ascent * u);
  hhea.i16(-f.descent * u);
  hhea.i16(0);
  hhea.u16(advMax);
  hhea.i16(Math.min(...lsb));
  hhea.i16(Math.min(...outlines.map((o, i) => o.advance - lsb[i]! - (o.contours.length ? Math.max(...o.contours.flat().map((p) => p[0])) - lsb[i]! : 0))));
  hhea.i16(bounds.xMax);
  hhea.i16(1);
  hhea.i16(0);
  hhea.i16(0);
  for (let i = 0; i < 4; i++) hhea.i16(0);
  hhea.i16(0);
  hhea.u16(numGlyphs);

  const maxp = new Writer();
  maxp.u32(0x00010000);
  maxp.u16(numGlyphs);
  maxp.u16(maxPoints);
  maxp.u16(maxContours);
  maxp.u16(0);
  maxp.u16(0);
  maxp.u16(2);
  for (let i = 0; i < 7; i++) maxp.u16(0);
  maxp.u16(0);

  const os2 = new Writer();
  os2.u16(4);
  os2.i16(f.advance * u);
  os2.u16(400);
  os2.u16(5);
  os2.u16(0); // fsType: installable
  for (const v of [upem * 0.6, upem * 0.6, 0, upem * 0.1, upem * 0.6, upem * 0.6, 0, upem * 0.4, u, upem * 0.3]) os2.i16(Math.round(v));
  os2.i16(0);
  for (let i = 0; i < 10; i++) os2.u8(0);
  os2.u32(1); // Basic Latin
  os2.u32(0);
  os2.u32(0);
  os2.u32(0);
  os2.tag("LP11");
  os2.u16(0x0040);
  os2.u16(Math.min(0xffff, glyphs[0]?.codepoint ?? 0x20));
  os2.u16(Math.min(0xffff, glyphs[glyphs.length - 1]?.codepoint ?? 0x20));
  os2.i16(f.ascent * u);
  os2.i16(-f.descent * u);
  os2.i16(0);
  os2.u16(f.ascent * u);
  os2.u16(f.descent * u);
  os2.u32(1);
  os2.u32(0);
  os2.i16(f.xHeight * u);
  os2.i16(f.capHeight * u);
  os2.u16(0);
  os2.u16(32);
  os2.u16(0);

  const post = new Writer();
  post.u32(0x00030000);
  post.u32(0);
  post.i16(-u);
  post.i16(u);
  post.u32(1); // fixed pitch
  for (let i = 0; i < 4; i++) post.u32(0);

  /* sfnt container, tables sorted by tag */
  const tables: [string, Uint8Array][] = (
    [
      ["OS/2", os2.done()],
      ["cmap", cmap.done()],
      ["glyf", glyf.done()],
      ["head", head.done()],
      ["hhea", hhea.done()],
      ["hmtx", hmtx.done()],
      ["loca", locaW.done()],
      ["maxp", maxp.done()],
      ["name", name.done()],
      ["post", post.done()],
    ] as [string, Uint8Array][]
  ).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const n = tables.length;
  const searchRange = 16 * 2 ** Math.floor(Math.log2(n));
  const out = new Writer();
  out.u32(0x00010000);
  out.u16(n);
  out.u16(searchRange);
  out.u16(Math.log2(searchRange / 16));
  out.u16(n * 16 - searchRange);
  let offset = 12 + n * 16;
  const placed: number[] = [];
  for (const [tag, data] of tables) {
    out.tag(tag);
    out.u32(checksum(data));
    out.u32(offset);
    out.u32(data.length);
    placed.push(offset);
    offset += (data.length + 3) & ~3;
  }
  for (const [, data] of tables) {
    out.bytes(data);
    out.pad4();
  }
  const font = out.done();
  const headAt = placed[tables.findIndex(([t]) => t === "head")]!;
  const adj = (0xb1b0afba - checksum(font)) >>> 0;
  new DataView(font.buffer).setUint32(headAt + 8, adj);
  return font;
}
