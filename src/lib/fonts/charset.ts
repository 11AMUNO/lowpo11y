/** Character sets for the bitmap font tool: presets, typed characters and U+ ranges. */

export const CHARSET_PRESETS: { id: string; label: string; ranges: [number, number][] }[] = [
  { id: "ascii", label: "Basic Latin (ASCII)", ranges: [[0x20, 0x7e]] },
  { id: "latin1", label: "Latin-1 Supplement", ranges: [[0xa0, 0xff]] },
  { id: "latinA", label: "Latin Extended-A", ranges: [[0x100, 0x17f]] },
  { id: "greek", label: "Greek", ranges: [[0x370, 0x3ff]] },
  { id: "cyrillic", label: "Cyrillic", ranges: [[0x400, 0x4ff]] },
  { id: "punct", label: "Punctuation & symbols", ranges: [[0x2010, 0x205e], [0x20ac, 0x20ac], [0x2122, 0x2122]] },
  { id: "arrows", label: "Arrows", ranges: [[0x2190, 0x21ff]] },
  { id: "box", label: "Box drawing & blocks", ranges: [[0x2500, 0x259f]] },
];

export const MAX_CHARS = 4096;

/** Parses "U+0020-007E, U+2190–U+21FF, 0x41" into ranges. Throws with a readable message. */
export function parseRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const raw of text.split(/[,;\s]+/)) {
    const t = raw.trim();
    if (!t) continue;
    const m = /^(?:U\+|0x)?([0-9a-f]{1,6})(?:[-–](?:U\+|0x)?([0-9a-f]{1,6}))?$/i.exec(t);
    if (!m) throw new Error(`“${t}” isn't a range. Use U+0020-007E style ranges.`);
    const a = parseInt(m[1]!, 16),
      b = m[2] ? parseInt(m[2], 16) : a;
    if (a > 0x10ffff || b > 0x10ffff) throw new Error(`${t} is beyond the last Unicode code point (U+10FFFF).`);
    out.push([Math.min(a, b), Math.max(a, b)]);
  }
  return out;
}

/** Unique code points from presets, ranges and literal characters, sorted, without control characters. */
export function buildCharset(presets: string[], extra: string, ranges: string): number[] {
  const set = new Set<number>();
  const add = (a: number, b: number) => {
    for (let c = a; c <= b && set.size <= MAX_CHARS; c++) if (c >= 0x20 && !(c >= 0x7f && c < 0xa0) && !(c >= 0xd800 && c <= 0xdfff)) set.add(c);
  };
  for (const id of presets) for (const [a, b] of CHARSET_PRESETS.find((p) => p.id === id)?.ranges ?? []) add(a, b);
  for (const [a, b] of parseRanges(ranges)) add(a, b);
  for (const ch of extra) add(ch.codePointAt(0)!, ch.codePointAt(0)!);
  if (set.size > MAX_CHARS) throw new Error(`That's more than ${MAX_CHARS} characters. Choose fewer ranges.`);
  return [...set].sort((a, b) => a - b);
}
