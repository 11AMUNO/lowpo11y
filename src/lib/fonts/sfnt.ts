/**
 * Minimal reader for TrueType / OpenType fonts (.ttf, .otf): enough to know
 * which characters a font really has (the cmap), its vertical metrics, its
 * names (including any licence text the designer embedded) and its
 * embedding permissions. Malformed input throws FontError.
 */

export class FontError extends Error {}

export interface FontInfo {
  format: "truetype" | "opentype-cff";
  unitsPerEm: number;
  ascender: number;
  descender: number;
  lineGap: number;
  numGlyphs: number;
  /** Code point → glyph index, for every mapped character. */
  cmap: Map<number, number>;
  names: { family?: string; subfamily?: string; fullName?: string; version?: string; copyright?: string; designer?: string; license?: string; licenseUrl?: string };
  /** OS/2 fsType embedding bits (0 = installable). */
  fsType: number;
}

/** Plain-language summary of OS/2 fsType embedding permissions. */
export function embeddingNote(fsType: number): string | null {
  if (fsType & 0x0002) return "The font marks itself “restricted licence embedding”. Check its licence allows distributing rendered bitmaps before you ship the atlas.";
  if (fsType & 0x0004) return "The font allows “preview & print” embedding only. Check its licence before shipping a bitmap version.";
  return null;
}

export function readFont(bytes: Uint8Array): FontInfo {
  if (bytes.byteLength < 12) throw new FontError("This file is too small to be a font.");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
  const sig = tag(0);
  if (sig === "wOFF" || sig === "wOF2") throw new FontError("This is a WOFF web font. Use the original .ttf or .otf file (or convert it) so the tool can read every glyph.");
  if (sig === "ttcf") throw new FontError("Font collections (.ttc) aren't supported. Use a single .ttf or .otf.");
  const version = dv.getUint32(0);
  if (version !== 0x00010000 && sig !== "OTTO" && sig !== "true") throw new FontError("Not a TrueType or OpenType font.");
  const numTables = dv.getUint16(4);
  if (12 + numTables * 16 > bytes.byteLength) throw new FontError("The font's table directory is truncated.");
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const offset = dv.getUint32(o + 8),
      length = dv.getUint32(o + 12);
    if (offset + length > bytes.byteLength) throw new FontError(`The font's ${tag(o)} table runs past the end of the file.`);
    tables.set(tag(o), { offset, length });
  }
  const need = (t: string) => {
    const e = tables.get(t);
    if (!e) throw new FontError(`The font has no ${t} table.`);
    return e;
  };

  const head = need("head");
  if (dv.getUint32(head.offset + 12) !== 0x5f0f3cf5) throw new FontError("The font's head table is damaged.");
  const unitsPerEm = dv.getUint16(head.offset + 18);
  if (unitsPerEm < 16 || unitsPerEm > 16384) throw new FontError("The font's units-per-em is out of range.");
  const hhea = need("hhea");
  const ascender = dv.getInt16(hhea.offset + 4),
    descender = dv.getInt16(hhea.offset + 6),
    lineGap = dv.getInt16(hhea.offset + 8);
  const numGlyphs = dv.getUint16(need("maxp").offset + 4);

  /* cmap: prefer full Unicode (format 12), then BMP (format 4) */
  const cmapT = need("cmap");
  const nSub = dv.getUint16(cmapT.offset + 2);
  const subs: { platform: number; encoding: number; offset: number; format: number }[] = [];
  for (let i = 0; i < nSub; i++) {
    const o = cmapT.offset + 4 + i * 8;
    const off = cmapT.offset + dv.getUint32(o + 4);
    if (off + 4 > bytes.byteLength) continue;
    subs.push({ platform: dv.getUint16(o), encoding: dv.getUint16(o + 2), offset: off, format: dv.getUint16(off) });
  }
  const unicode = (s: (typeof subs)[number]) => s.platform === 0 || (s.platform === 3 && (s.encoding === 1 || s.encoding === 10));
  const pick = subs.find((s) => unicode(s) && s.format === 12) ?? subs.find((s) => unicode(s) && s.format === 4) ?? subs.find((s) => s.platform === 3 && s.encoding === 0 && s.format === 4);
  if (!pick) throw new FontError("The font has no Unicode character map, so its characters can't be identified.");
  const cmap = new Map<number, number>();
  if (pick.format === 12) {
    const n = dv.getUint32(pick.offset + 12);
    for (let i = 0; i < n; i++) {
      const g = pick.offset + 16 + i * 12;
      const start = dv.getUint32(g),
        end = dv.getUint32(g + 4),
        gid = dv.getUint32(g + 8);
      if (end - start > 0x110000) throw new FontError("The font's character map is damaged.");
      for (let c = start; c <= end; c++) if (gid + c - start) cmap.set(c, gid + c - start);
    }
  } else {
    const segX2 = dv.getUint16(pick.offset + 6);
    const ends = pick.offset + 14,
      starts = ends + segX2 + 2,
      deltas = starts + segX2,
      ranges = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = dv.getUint16(ends + s * 2),
        start = dv.getUint16(starts + s * 2),
        delta = dv.getInt16(deltas + s * 2),
        ro = dv.getUint16(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let gid: number;
        if (ro === 0) gid = (c + delta) & 0xffff;
        else {
          const at = ranges + s * 2 + ro + (c - start) * 2;
          if (at + 2 > bytes.byteLength) break;
          gid = dv.getUint16(at);
          if (gid) gid = (gid + delta) & 0xffff;
        }
        if (gid) cmap.set(c, gid);
      }
    }
  }

  /* names: prefer Windows Unicode English, then Mac Roman */
  const names: FontInfo["names"] = {};
  const nameT = tables.get("name");
  if (nameT) {
    const count = dv.getUint16(nameT.offset + 2),
      strings = nameT.offset + dv.getUint16(nameT.offset + 4);
    const KEYS: Record<number, keyof FontInfo["names"]> = { 0: "copyright", 1: "family", 2: "subfamily", 4: "fullName", 5: "version", 9: "designer", 13: "license", 14: "licenseUrl" };
    const rank = new Map<string, number>();
    for (let i = 0; i < count; i++) {
      const r = nameT.offset + 6 + i * 12;
      const platform = dv.getUint16(r),
        encoding = dv.getUint16(r + 2),
        lang = dv.getUint16(r + 4),
        id = dv.getUint16(r + 6),
        len = dv.getUint16(r + 8),
        off = strings + dv.getUint16(r + 10);
      const key = KEYS[id];
      if (!key || off + len > bytes.byteLength) continue;
      let text: string | null = null,
        score = 0;
      if (platform === 3 || platform === 0) {
        let s = "";
        for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(dv.getUint16(off + k));
        text = s;
        score = platform === 3 && encoding === 1 && lang === 0x409 ? 3 : 2;
      } else if (platform === 1 && encoding === 0) {
        text = String.fromCharCode(...bytes.subarray(off, off + len));
        score = 1;
      }
      if (text && score > (rank.get(key) ?? 0)) {
        rank.set(key, score);
        names[key] = text.trim();
      }
    }
  }
  const os2 = tables.get("OS/2");
  const fsType = os2 && os2.length >= 10 ? dv.getUint16(os2.offset + 8) : 0;
  return { format: sig === "OTTO" ? "opentype-cff" : "truetype", unitsPerEm, ascender, descender, lineGap, numGlyphs, cmap, names, fsType };
}
