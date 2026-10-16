/**
 * Bulk import: turn a folder of files (or a JSON/CSV manifest) into draft
 * assets. Planning is pure and runs in the browser and the CLI alike;
 * validation checks the plan against the database; running it goes through
 * the same storeAssetFile/derive pipeline as single uploads. Imports never
 * publish and never invent licence terms: unknown rights stay unset.
 */
import { z } from "zod";
import type { Queryable, Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { AssetStorage } from "@/lib/storage";
import { extensionOf } from "@/lib/validation/file-types";
import { generateDerivatives } from "./derive";
import { FileRejectedError, storeAssetFile } from "./files";
import { createAsset } from "./repository";
import { ASSET_TYPES, ENGINES, PROVENANCE_KINDS, slugify, type AssetType } from "./schemas";

export const IMPORT_SCHEMA = "lowpo11y.import/1";

const MODEL_EXT = new Set(["fbx", "glb", "gltf", "obj"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const IGNORED = /(^|\/)(\.ds_store|thumbs\.db|desktop\.ini|__macosx(\/.*)?|\._[^/]*)$/i;

const csvList = z.union([z.array(z.string()), z.string().transform((s) => s.split(/[,;]/))]).transform((a) => a.map((x) => x.trim()).filter(Boolean));

export const importEntrySchema = z.object({
  title: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(80)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  type: z.enum(ASSET_TYPES),
  /** Paths relative to the import folder. */
  files: csvList.pipe(z.array(z.string().max(500)).min(1).max(200)),
  /** Path of the file to mark primary (defaults to the first model, else the first file). */
  primary: z.string().max(500).optional(),
  category: z.string().trim().max(60).optional().or(z.literal("").transform(() => undefined)),
  licence: z.string().trim().max(60).optional().or(z.literal("").transform(() => undefined)),
  attribution: z.string().trim().max(1000).optional().or(z.literal("").transform(() => undefined)),
  sourceUrl: z.url({ protocol: /^https?$/ }).optional().or(z.literal("").transform(() => undefined)),
  provenance: z.enum(PROVENANCE_KINDS).optional().or(z.literal("").transform(() => undefined)),
  provenanceNotes: z.string().trim().max(4000).optional().or(z.literal("").transform(() => undefined)),
  shortDescription: z.string().trim().max(240).default(""),
  description: z.string().max(20_000).default(""),
  usageNotes: z.string().max(20_000).default(""),
  tags: csvList.pipe(z.array(z.string().max(40)).max(30)).default([]),
  engines: csvList.pipe(z.array(z.enum(ENGINES)).max(4)).default([]),
});
export type ImportEntry = z.infer<typeof importEntrySchema>;

export const importDefaultsSchema = importEntrySchema
  .pick({ category: true, licence: true, attribution: true, provenance: true, provenanceNotes: true, tags: true, engines: true, usageNotes: true })
  .partial();
export type ImportDefaults = z.infer<typeof importDefaultsSchema>;

export const manifestSchema = z.object({
  schema: z.literal(IMPORT_SCHEMA).optional(),
  defaults: importDefaultsSchema.default({}),
  assets: z.array(z.unknown()).min(1).max(2000),
});

/* --------------------------------------------------------------- parsing */

/** RFC 4180-ish CSV: quoted fields, doubled quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

export interface ParsedManifest {
  defaults: ImportDefaults;
  entries: ImportEntry[];
  problems: string[];
}

/** Parses a JSON or CSV manifest. Invalid rows are reported, not thrown. */
export function parseManifest(text: string, format: "json" | "csv"): ParsedManifest {
  const problems: string[] = [];
  let defaults: ImportDefaults = {};
  let raw: unknown[] = [];
  if (format === "json") {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { defaults, entries: [], problems: ["The manifest isn't valid JSON."] };
    }
    const m = manifestSchema.safeParse(Array.isArray(json) ? { assets: json } : json);
    if (!m.success) return { defaults, entries: [], problems: [`The manifest needs an "assets" list: ${m.error.issues[0]?.message ?? "invalid"}.`] };
    defaults = m.data.defaults;
    raw = m.data.assets;
  } else {
    const rows = parseCsv(text);
    const header = (rows.shift() ?? []).map((h) => h.trim());
    if (!header.includes("title") || !header.includes("files")) return { defaults, entries: [], problems: ['The CSV needs at least "title", "type" and "files" columns.'] };
    raw = rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
  }
  const entries: ImportEntry[] = [];
  raw.forEach((r, i) => {
    const merged = { ...defaults, ...(r as object) };
    const e = importEntrySchema.safeParse(merged);
    if (e.success) entries.push(e.data);
    else problems.push(`Row ${i + 1}: ${e.error.issues.map((x) => `${x.path.join(".") || "row"} ${x.message}`).join("; ")}`);
  });
  return { defaults, entries, problems };
}

/** Fills an entry's unset fields from import-wide defaults (the entry wins). */
export function applyDefaults(e: ImportEntry, d: ImportDefaults): ImportEntry {
  return {
    ...e,
    category: e.category ?? d.category,
    licence: e.licence ?? d.licence,
    attribution: e.attribution ?? d.attribution,
    provenance: e.provenance ?? d.provenance,
    provenanceNotes: e.provenanceNotes ?? d.provenanceNotes,
    usageNotes: e.usageNotes || d.usageNotes || "",
    tags: [...new Set([...(d.tags ?? []), ...e.tags])],
    engines: e.engines.length ? e.engines : (d.engines ?? []),
  };
}

/* -------------------------------------------------------------- planning */

const stem = (p: string) => p.split("/").pop()!.replace(/\.[^.]+$/, "");
const dir = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s.replace(/\+/g, " ");
  }
};

/**
 * Human title from a folder or file name, keeping the owner's naming:
 * "BH-01-Bed" → "BH-01 Bed", "BH+-+07+-+Animals" → "BH-07 Animals",
 * "01 - Walnut Cupboard" → "Walnut Cupboard", "rusty_pipe" → "Rusty pipe".
 */
export function titleFromName(name: string): { title: string; setCode: string | null } {
  let n = decode(name).replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  let setCode: string | null = null;
  const set = /^([A-Za-z]{1,5})\s*-\s*(\d{1,3})\s*-\s*(.+)$/.exec(n);
  if (set) {
    setCode = `${set[1]!.toUpperCase()}-${set[2]!.padStart(2, "0")}`;
    n = set[3]!;
  } else {
    n = n.replace(/^\d{1,3}\s*[-.)]\s*/, "");
  }
  n = n.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  n = n.charAt(0).toUpperCase() + n.slice(1);
  return { title: (setCode ? `${setCode} ${n}` : n).slice(0, 120), setCode };
}

export interface PlannedEntry extends ImportEntry {
  /** Why these files were grouped, for the review screen. */
  reason: string;
}

/**
 * Groups a folder listing into assets:
 * - a folder holding one model becomes one asset with everything beneath it
 *   (e.g. Tripo's .fbx plus its .fbm texture folder);
 * - several models in one folder become one asset each, with images that
 *   share the model's name or sit in "<name>.fbm/";
 * - loose images become one texture asset each.
 */
export function planFromPaths(paths: string[], defaults: ImportDefaults = {}, opts: { textureType?: AssetType } = {}): { entries: PlannedEntry[]; ignored: string[] } {
  const ignored: string[] = [];
  const files = paths
    .map((p) => p.replace(/\\/g, "/").replace(/^\.?\//, ""))
    .filter((p) => {
      if (IGNORED.test(p) || p.split("/").some((seg) => seg.startsWith(".") && seg !== "." && !seg.endsWith(".fbm"))) {
        ignored.push(p);
        return false;
      }
      return true;
    })
    .sort();
  const models = files.filter((p) => MODEL_EXT.has(extensionOf(p)));
  const claimed = new Set<string>();
  const entries: PlannedEntry[] = [];
  const base = {
    category: defaults.category,
    licence: defaults.licence,
    attribution: defaults.attribution,
    provenance: defaults.provenance,
    provenanceNotes: defaults.provenanceNotes,
    shortDescription: "",
    description: "",
    usageNotes: defaults.usageNotes ?? "",
    engines: defaults.engines ?? [],
    sourceUrl: undefined,
    slug: undefined,
  };

  const byDir = new Map<string, string[]>();
  for (const m of models) byDir.set(dir(m), [...(byDir.get(dir(m)) ?? []), m]);
  for (const [d, list] of byDir) {
    // A folder with one model (and no other models below it) is one asset.
    const nested = models.filter((m) => m !== list[0] && (m.startsWith(`${d}/`) || d === "") && dir(m) !== d);
    if (list.length === 1 && d !== "" && !nested.length) {
      const model = list[0]!;
      const group = files.filter((f) => f === model || f.startsWith(`${d}/`));
      group.forEach((f) => claimed.add(f));
      const { title, setCode } = titleFromName(d.split("/").pop()!);
      entries.push({
        ...base,
        title,
        slug: slugify(decode(d.split("/").pop()!)),
        type: "model",
        files: group,
        primary: model,
        tags: [...new Set([...(defaults.tags ?? []), ...(setCode ? [setCode.toLowerCase()] : [])])],
        reason: `Folder “${d}” holds one model`,
      });
      continue;
    }
    for (const model of list) {
      const s = stem(model).toLowerCase();
      const group = files.filter((f) => f === model || (dir(f) === d && IMAGE_EXT.has(extensionOf(f)) && stem(f).toLowerCase().startsWith(s)) || f.toLowerCase().startsWith(`${d ? `${d}/` : ""}${s}.fbm/`));
      group.forEach((f) => claimed.add(f));
      const { title, setCode } = titleFromName(stem(model));
      entries.push({ ...base, title, type: "model", files: group, primary: model, tags: [...(defaults.tags ?? []), ...(setCode ? [setCode.toLowerCase()] : [])], reason: `Model file “${model}”` });
    }
  }

  for (const f of files) {
    if (claimed.has(f) || !IMAGE_EXT.has(extensionOf(f))) continue;
    claimed.add(f);
    const { title, setCode } = titleFromName(stem(f));
    entries.push({ ...base, title, type: opts.textureType ?? "texture", files: [f], primary: f, tags: [...(defaults.tags ?? []), ...(setCode ? [setCode.toLowerCase()] : [])], reason: `Image “${f}”` });
  }
  for (const f of files) if (!claimed.has(f)) ignored.push(f);
  // Keep the owner's own order: folder or file path, numbers compared as numbers.
  const key = (e: PlannedEntry) => (e.reason.startsWith("Folder") ? dir(e.primary!) : e.primary!);
  entries.sort((a, b) => key(a).localeCompare(key(b), "en", { numeric: true }));
  return { entries, ignored };
}

/* ------------------------------------------------------------ validation */

export interface ImportFileInfo {
  path: string;
  size: number;
  sha256: string;
}

export type FilePurpose = "delivery" | "source" | "thumbnail" | "preview";

export interface ValidatedEntry {
  index: number;
  title: string;
  slug: string;
  type: AssetType;
  categoryId: string | null;
  licenceId: string | null;
  files: { path: string; purpose: FilePurpose; primary: boolean; size: number; sha256: string | null }[];
  problems: string[];
  warnings: string[];
  /** Set when every file is already in the library; the entry is skipped. */
  duplicateOf: { slug: string; title: string } | null;
}

export interface ImportPlanReport {
  entries: ValidatedEntry[];
  ready: number;
  duplicates: number;
  blocked: number;
}

const THUMB = /(^|[-_ .])(thumb|thumbnail|cover|preview)([-_ .]|$)/i;

export function purposeFor(path: string): FilePurpose {
  const ext = extensionOf(path);
  if (IMAGE_EXT.has(ext) && THUMB.test(stem(path))) return "thumbnail";
  if (["blend", "psd", "kra", "xcf", "aseprite", "spp"].includes(ext)) return "source";
  return "delivery";
}

/** Checks a plan against the library: references, unique slugs, duplicates by checksum. Read-only. */
export async function validatePlan(q: Queryable, entries: ImportEntry[], files: ImportFileInfo[], maxBytes: number): Promise<ImportPlanReport> {
  const info = new Map(files.map((f) => [f.path, f]));
  const [cats, lics, slugRows] = await Promise.all([
    q.query<{ id: string; slug: string }>("select id, slug from categories"),
    q.query<{ id: string; code: string; allows_download: boolean }>("select id, code, allows_download from licences"),
    q.query<{ slug: string }>("select slug from assets"),
  ]);
  const shas = files.map((f) => f.sha256).filter(Boolean);
  const known = shas.length
    ? await q.query<{ sha256: string; slug: string; title: string }>(
        "select f.sha256, a.slug, a.title from asset_files f join assets a on a.id = f.asset_id where f.deleted_at is null and a.deleted_at is null and f.sha256 = any($1::text[])",
        [shas],
      )
    : [];
  const knownBySha = new Map(known.map((k) => [k.sha256, k]));
  const taken = new Set(slugRows.map((r) => r.slug));
  const out: ValidatedEntry[] = [];
  const seenSha = new Map<string, number>();

  entries.forEach((e, index) => {
    const problems: string[] = [];
    const warnings: string[] = [];
    const categoryId = e.category ? (cats.find((c) => c.slug === e.category)?.id ?? null) : null;
    if (e.category && !categoryId) problems.push(`Unknown category “${e.category}”.`);
    const lic = e.licence ? lics.find((l) => l.code === e.licence) : undefined;
    if (e.licence && !lic) problems.push(`Unknown licence code “${e.licence}”.`);
    if (!e.licence) warnings.push("No licence yet: it will import as a draft that can't be published until one is set.");
    else if (lic && !lic.allows_download) warnings.push("This licence keeps downloads blocked.");

    const primary = e.primary ?? e.files.find((p) => MODEL_EXT.has(extensionOf(p))) ?? e.files[0]!;
    const entryFiles = e.files.map((path) => {
      const f = info.get(path);
      if (!f) problems.push(`File not found in the selection: ${path}`);
      else if (f.size > maxBytes) problems.push(`${path} is larger than the upload limit.`);
      else if (f.size === 0) problems.push(`${path} is empty.`);
      return { path, purpose: purposeFor(path), primary: path === primary, size: f?.size ?? 0, sha256: f?.sha256 || null };
    });
    if (!entryFiles.some((f) => f.purpose === "delivery")) problems.push("Nothing downloadable: add a model or texture file.");
    if (e.type === "model" && !entryFiles.some((f) => MODEL_EXT.has(extensionOf(f.path)))) warnings.push("Marked as a model but has no model file.");

    // Every file already in the library → treat the whole entry as already imported.
    const hits = entryFiles.map((f) => (f.sha256 ? knownBySha.get(f.sha256) : undefined));
    const duplicateOf = hits.length && hits.every(Boolean) ? { slug: hits[0]!.slug, title: hits[0]!.title } : null;
    if (!duplicateOf && hits.some(Boolean)) warnings.push(`Some files are already attached to “${hits.find(Boolean)!.title}”; they'll be stored again under this asset.`);
    for (const f of entryFiles) {
      if (!f.sha256) continue;
      const other = seenSha.get(f.sha256);
      if (other !== undefined && other !== index) warnings.push(`${f.path} is identical to a file in entry ${other + 1}.`);
      seenSha.set(f.sha256, index);
    }

    let slug = slugify(e.slug || e.title);
    if (!duplicateOf) {
      const root = slug;
      for (let i = 2; taken.has(slug); i++) slug = `${root}-${i}`;
      if (slug !== root) warnings.push(`Slug “${root}” is taken; using “${slug}”.`);
      taken.add(slug);
    }
    out.push({ index, title: e.title, slug, type: e.type, categoryId, licenceId: lic?.id ?? null, files: entryFiles, problems, warnings, duplicateOf });
  });

  return {
    entries: out,
    ready: out.filter((e) => !e.problems.length && !e.duplicateOf).length,
    duplicates: out.filter((e) => e.duplicateOf).length,
    blocked: out.filter((e) => e.problems.length).length,
  };
}

/* --------------------------------------------------------------- running */

export interface ImportRunResult {
  index: number;
  title: string;
  status: "created" | "skipped" | "failed";
  assetId?: string;
  slug?: string;
  message?: string;
  warnings: string[];
}

/**
 * Server-side import (CLI): creates drafts, stores every file through the
 * normal validation, then generates previews. Each entry is independent, so
 * one bad file doesn't stop the rest.
 */
export async function runImport(
  tx: Tx,
  storage: AssetStorage,
  actorId: string,
  entries: ImportEntry[],
  plan: ImportPlanReport,
  readFile: (path: string) => Promise<Uint8Array>,
  opts: { derive?: boolean; log?: (s: string) => void } = {},
): Promise<ImportRunResult[]> {
  const results: ImportRunResult[] = [];
  for (const v of plan.entries) {
    const e = entries[v.index]!;
    if (v.duplicateOf) {
      results.push({ index: v.index, title: v.title, status: "skipped", slug: v.duplicateOf.slug, message: `Already in the library as “${v.duplicateOf.title}”.`, warnings: [] });
      continue;
    }
    if (v.problems.length) {
      results.push({ index: v.index, title: v.title, status: "failed", message: v.problems.join(" "), warnings: v.warnings });
      continue;
    }
    try {
      const asset = await tx.asUser((q) =>
        createAsset(q, actorId, {
          title: e.title,
          slug: v.slug,
          assetType: e.type,
          shortDescription: e.shortDescription,
          descriptionMd: e.description,
          usageNotesMd: e.usageNotes,
          categoryId: v.categoryId,
          licenceId: v.licenceId,
          attributionText: e.attribution ?? null,
          licenceSourceUrl: e.sourceUrl ?? null,
          provenanceKind: e.provenance ?? null,
          provenanceNotes: e.provenanceNotes ?? null,
          featured: false,
          engines: e.engines,
          tags: e.tags,
        }),
      );
      await tx.asService((q) => audit(q, actorId, "asset.create", "asset", asset.id, { title: asset.title, type: asset.asset_type, via: "import" }));
      const warnings = [...v.warnings];
      for (const f of v.files) {
        try {
          const bytes = await readFile(f.path);
          const r = await tx.asUser((q) => storeAssetFile(q, storage, { assetId: asset.id, purpose: f.purpose, filename: f.path.split("/").pop()!, bytes, primary: f.primary }));
          warnings.push(...r.analysis.warnings.map((w) => `${f.path}: ${w}`));
        } catch (err) {
          warnings.push(`${f.path}: ${err instanceof FileRejectedError ? err.problems.join(" ") : err instanceof Error ? err.message : "could not be stored"}`);
        }
      }
      if (opts.derive !== false) {
        const d = await generateDerivatives(tx, storage, asset.id, { textureVariants: true });
        warnings.push(...d.warnings);
      }
      results.push({ index: v.index, title: v.title, status: "created", assetId: asset.id, slug: asset.slug, warnings });
      opts.log?.(`  + ${asset.slug}${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? "" : "s"})` : ""}`);
    } catch (err) {
      results.push({ index: v.index, title: v.title, status: "failed", message: err instanceof Error ? err.message : String(err), warnings: v.warnings });
      opts.log?.(`  ! ${v.title}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return results;
}
