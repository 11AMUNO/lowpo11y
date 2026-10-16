/**
 * Deterministic download bundles. Same inputs → byte-identical ZIP: entries are
 * sorted, timestamps fixed to the publish date, and text is generated from
 * stored metadata only.
 */
import { zipSync, type Zippable } from "fflate";
import { safeFilename } from "@/lib/storage/keys";
import { sha256Hex } from "@/lib/auth/tokens";

export interface LicenceInfo {
  code: string;
  human_label: string;
  short_label: string;
  canonical_url: string | null;
  commercial_use: boolean | null;
  modifications: boolean | null;
  attribution_required: boolean | null;
  redistribution_allowed: boolean | null;
  share_alike: boolean;
  full_text: string | null;
  notes: string | null;
}

export interface BundleAsset {
  slug: string;
  title: string;
  shortDescription: string;
  type: string;
  version: number;
  url: string;
  publishedAt: Date;
  attributionText: string | null;
  licenceSourceUrl: string | null;
  provenance: string | null;
  usageNotes: string;
  stats: string[];
}

export interface BundleFile {
  filename: string;
  bytes: Uint8Array;
  format: string;
  width?: number | null;
  height?: number | null;
  triangles?: number | null;
  note?: string;
}

const yesNo = (v: boolean | null) => (v === null ? "Not stated by the licence" : v ? "Yes" : "No");

export function licenceText(asset: Pick<BundleAsset, "title" | "url" | "attributionText" | "licenceSourceUrl" | "provenance">, lic: LicenceInfo): string {
  const lines = [
    `${asset.title}`,
    `Licence: ${lic.human_label} (${lic.short_label})`,
    lic.canonical_url ? `Licence text: ${lic.canonical_url}` : null,
    "",
    `Commercial use:        ${yesNo(lic.commercial_use)}`,
    `Modification:          ${yesNo(lic.modifications)}`,
    `Attribution required:  ${yesNo(lic.attribution_required)}`,
    `Redistribution:        ${yesNo(lic.redistribution_allowed)}`,
    lic.share_alike ? "Share-alike:           Yes — adaptations must use the same licence" : null,
    "",
    asset.attributionText ? `Attribution text to use:\n  ${asset.attributionText}` : lic.attribution_required ? `Attribution: credit "${asset.title}" and link to ${asset.url}` : null,
    asset.licenceSourceUrl ? `Original source: ${asset.licenceSourceUrl}` : null,
    asset.provenance ? `Provenance: ${asset.provenance}` : null,
    `Downloaded from: ${asset.url}`,
    lic.notes ? `\nNotes: ${lic.notes}` : null,
    lic.full_text ? `\n---\n${lic.full_text}` : null,
  ];
  return lines.filter((l) => l !== null).join("\n") + "\n";
}

/** Unique, safe entry names: duplicates get " (2)", " (3)"… before the extension. */
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((n) => {
    const safe = safeFilename(n);
    let candidate = safe;
    const dot = safe.lastIndexOf(".");
    for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = dot > 0 ? `${safe.slice(0, dot)} (${i})${safe.slice(dot)}` : `${safe} (${i})`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export function buildAssetBundle(asset: BundleAsset, licence: LicenceInfo, files: BundleFile[]): Uint8Array {
  const root = asset.slug;
  const sorted = [...files].sort((a, b) => a.filename.localeCompare(b.filename));
  const names = uniqueNames(sorted.map((f) => f.filename));
  const mtime = asset.publishedAt;
  const entries: Zippable = {};
  const manifestFiles = sorted.map((f, i) => {
    entries[`${root}/files/${names[i]}`] = [f.bytes, { mtime }];
    return {
      path: `files/${names[i]}`,
      bytes: f.bytes.byteLength,
      sha256: sha256Hex(f.bytes),
      format: f.format,
      ...(f.width && f.height ? { width: f.width, height: f.height } : {}),
      ...(f.triangles ? { triangles: f.triangles } : {}),
      ...(f.note ? { note: f.note } : {}),
    };
  });
  const manifest = {
    schema: "lowpo11y.asset-bundle/1",
    asset: { slug: asset.slug, title: asset.title, type: asset.type, version: asset.version, url: asset.url, published: asset.publishedAt.toISOString() },
    licence: { code: licence.code, name: licence.human_label, url: licence.canonical_url },
    files: manifestFiles,
  };
  const readme = [
    `${asset.title}`,
    "=".repeat(Math.min(72, asset.title.length)),
    "",
    asset.shortDescription,
    "",
    ...asset.stats.map((s) => `- ${s}`),
    "",
    "Files",
    ...manifestFiles.map((f) => `- ${f.path} (${f.bytes.toLocaleString("en-GB")} bytes)${f.note ? ` — ${f.note}` : ""}`),
    "",
    asset.usageNotes ? `Usage notes\n${asset.usageNotes}\n` : null,
    `Licence: ${licence.human_label}. See LICENSE.txt before use.`,
    `Source: ${asset.url}`,
    "",
  ]
    .filter((l) => l !== null)
    .join("\n");
  const enc = new TextEncoder();
  entries[`${root}/LICENSE.txt`] = [enc.encode(licenceText(asset, licence)), { mtime }];
  entries[`${root}/README.txt`] = [enc.encode(readme), { mtime }];
  entries[`${root}/manifest.json`] = [enc.encode(JSON.stringify(manifest, null, 2) + "\n"), { mtime }];
  const ordered: Zippable = {};
  for (const k of Object.keys(entries).sort()) ordered[k] = entries[k]!;
  return zipSync(ordered, { level: 6 });
}
