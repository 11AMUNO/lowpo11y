/**
 * State model and helpers for the Seamless tool, ported from the owner's
 * original app (vendor/11am-seamless/app.js): collections from folders,
 * per-file settings, summaries, naming and ZIP layout rules.
 */
import { DEFAULTS, psxActive, type SeamlessSettings } from "@/lib/processing/seamless/engine";
import { EXT, type ExportFormat } from "./protocol";

export const LOOSE = "UNSORTED";

export interface Item {
  id: number;
  file: File;
  /** Original filename without extension. */
  base: string;
  /** Export name (editable, batch-renamable). */
  name: string;
  col: string;
  thumb: string;
  settings: SeamlessSettings;
  /** Previous settings for undo, newest last. */
  history: SeamlessSettings[];
  w: number;
  h: number;
}

export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export const safeName = (s: string) => (s || "").trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/^\.+/, "") || "texture";
export const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export const extOf = (f: ExportFormat) => EXT[f];

export const isCustom = (it: Pick<Item, "settings">) =>
  (Object.keys(DEFAULTS) as (keyof SeamlessSettings)[]).some((k) => it.settings[k] !== DEFAULTS[k]);

export function colNames(cols: Record<string, { collapsed: boolean }>): string[] {
  return Object.keys(cols).sort((a, b) => (a === LOOSE ? 1 : b === LOOSE ? -1 : collator.compare(a, b)));
}
export const itemsIn = (items: Item[], col: string) => items.filter((i) => i.col === col).sort((a, b) => collator.compare(a.base, b.base));
export const ordered = (items: Item[], cols: Record<string, { collapsed: boolean }>) => colNames(cols).flatMap((c) => itemsIn(items, c));

export const MODE_DESC: Record<SeamlessSettings["mode"], string> = {
  blend: "Offset + heal. Natural, feathered seams. Best for wood, rust, stone, photos.",
  mirror: "Kaleidoscope. Always seamless. Output is 2× unless MIRROR FIT is on.",
  edge: "Heals only the borders. The center stays untouched.",
  offset: "Wrap-shift only, to inspect or hand-paint the seam elsewhere.",
};
const DITHER_LBL: Record<SeamlessSettings["psxDither"], string> = { none: "NO DITHER", bayer4: "4×4", bayer8: "8×8", fs: "F-S" };

/** Module header summaries, exactly as the original shows them. */
export function summaries(s: SeamlessSettings) {
  const src = [s.size ? `${s.size} PX` : "ORIGINAL SIZE"];
  if (s.resample === "nearest") src.push("NEAREST");
  if (s.square) src.push("SQUARE");
  if (s.flatten) src.push(`FLAT ${s.flatten}%`);
  let tile = "OFF";
  if (s.tile) {
    tile =
      s.mode === "mirror" ? (s.mirrorFit ? "MIRROR 1×" : "MIRROR 2×") : s.mode === "offset" ? "OFFSET ONLY" : `${s.mode.toUpperCase()} ${s.width}% · ${s.strength}%`;
    if (s.direction !== "both") tile += ` · ${s.direction.toUpperCase()} ONLY`;
  }
  const key = s.keyBlack ? `BLACK ≤ ${s.keyTol} · ${s.keyConnected ? "EDGE" : "ALL"}` : "OFF";
  let psx = "OFF";
  if (s.psx) {
    const p: string[] = [];
    if (s.psxLimit) p.push(`${s.psxColors} COL`);
    if (s.psx15) p.push("15-BIT");
    psx = p.length ? p.join(" · ") + (s.psxDither !== "none" ? ` · ${DITHER_LBL[s.psxDither]}` : "") : "NOTHING PICKED";
  }
  return { source: src.join(" · "), tile, key, psx };
}

export function rowSub(it: Item) {
  const s = it.settings,
    tags: string[] = [];
  tags.push(s.tile ? s.mode.toUpperCase() : "NO TILE");
  if (s.size) tags.push(String(s.size));
  if (s.keyBlack) tags.push("α");
  if (psxActive(s)) tags.push("PSX");
  return (it.w ? `${it.w}×${it.h} // ` : "") + tags.join(" · ");
}

/** Batch rename tokens: {name} {n} {collection} {mode}, counted per collection. */
export function applyPattern(items: Item[], pattern: string): Map<number, string> {
  const counters = new Map<string, number>();
  const out = new Map<number, string>();
  for (const it of items) {
    const n = (counters.get(it.col) ?? 0) + 1;
    counters.set(it.col, n);
    out.set(
      it.id,
      safeName(
        (pattern || "{name}")
          .replace(/\{name\}/g, it.base)
          .replace(/\{n\}/g, pad(n))
          .replace(/\{collection\}/g, it.col)
          .replace(/\{mode\}/g, it.settings.tile ? it.settings.mode : "flat"),
      ),
    );
  }
  return out;
}

/** ZIP layout preview lines: SIZE / COLLECTION / file, or COLLECTION / file with no size ticked. */
export function treeLines(items: Item[], sizes: number[]): string[] {
  const cols: string[] = [];
  for (const it of items) if (!cols.includes(it.col)) cols.push(it.col);
  const lines: string[] = [];
  const colLines = (indent: string) =>
    cols.forEach((c, i) => {
      const n = items.filter((it) => it.col === c).length;
      lines.push(`${indent}${i === cols.length - 1 ? "└─" : "├─"} ${safeName(c)}/  ${n} file${n > 1 ? "s" : ""}`);
    });
  if (sizes.length) {
    sizes.forEach((s, i) => {
      const last = i === sizes.length - 1;
      lines.push(`${last ? "└─" : "├─"} ${s}/`);
      colLines(last ? "   " : "│  ");
    });
  } else {
    lines.push("(no size ticked: each file exports at its own SOURCE size)");
    colLines("");
  }
  return lines;
}

/** Unique ZIP entry names, case-insensitive, with _2, _3… like the original. */
export function zipEntryName(used: Set<string>, dir: string, name: string, format: ExportFormat): string {
  let fn = dir + safeName(name),
    n = 2;
  while (used.has((fn + extOf(format)).toLowerCase())) fn = `${dir}${safeName(name)}_${n++}`;
  fn += extOf(format);
  used.add(fn.toLowerCase());
  return fn;
}

/* ------------------------------------------------------------------ ingest */

const IMG_RE = /\.(png|jpe?g|webp|bmp|gif|avif|tiff?)$/i;
export const isImage = (f: File) => (f.type && f.type.startsWith("image/")) || IMG_RE.test(f.name);
/** Folder name a file belongs to: its parent directory. */
export const parentOf = (path: string) => {
  const p = path.split("/").filter(Boolean);
  return p.length > 1 ? p[p.length - 2]! : null;
};

export interface Entry {
  file: File;
  col: string;
}

interface FsHandle {
  kind: "file" | "directory";
  name: string;
  getFile?: () => Promise<File>;
  values?: () => AsyncIterable<FsHandle>;
}
interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  fullPath: string;
  file?: (ok: (f: File) => void, err: () => void) => void;
  createReader?: () => { readEntries: (ok: (list: FsEntry[]) => void, err: () => void) => void };
}

async function walkHandle(h: FsHandle, parent: string | null, out: Entry[]) {
  if (h.kind === "file") {
    out.push({ file: await h.getFile!(), col: parent || LOOSE });
    return;
  }
  for await (const child of h.values!()) await walkHandle(child, h.name, out);
}
function readEntry(entry: FsEntry, out: Entry[], status: { failed: boolean }): Promise<void> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file!(
        (file) => {
          out.push({ file, col: parentOf(entry.fullPath) || LOOSE });
          resolve();
        },
        () => {
          status.failed = true;
          resolve();
        },
      );
    } else if (entry.isDirectory) {
      const reader = entry.createReader!();
      const batch = () =>
        reader.readEntries(
          async (list) => {
            if (!list.length) return resolve();
            for (const child of list) await readEntry(child, out, status);
            batch();
          },
          () => {
            status.failed = true;
            resolve();
          },
        );
      batch();
    } else resolve();
  });
}

/**
 * Reads a drop, including whole folders. Everything on the DataTransfer must
 * be grabbed synchronously, before the first await. The File System Access
 * handle API is tried first, the older entry API is the fallback.
 */
export async function readDrop(dt: DataTransfer): Promise<{ entries: Entry[]; failed: boolean }> {
  const items = [...(dt.items || [])].filter((i) => i.kind === "file");
  const handles = items.map((i) => ((i as unknown as { getAsFileSystemHandle?: () => Promise<FsHandle | null> }).getAsFileSystemHandle?.() ?? null));
  const entries = items.map((i) => (i.webkitGetAsEntry ? (i.webkitGetAsEntry() as unknown as FsEntry | null) : null));
  const loose = [...dt.files];
  const out: Entry[] = [];
  const status = { failed: false };
  for (let k = 0; k < Math.max(items.length, loose.length); k++) {
    if (handles[k]) {
      try {
        const h = await handles[k];
        if (h) {
          await walkHandle(h, null, out);
          continue;
        }
      } catch {
        // fall back to the entry API
      }
    }
    if (entries[k]) await readEntry(entries[k]!, out, status);
    else if (loose[k]) out.push({ file: loose[k]!, col: LOOSE });
  }
  return { entries: out, failed: status.failed };
}
