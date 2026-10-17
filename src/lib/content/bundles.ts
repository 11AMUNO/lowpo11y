/**
 * Download bundles for shaders: the code file, a README with the
 * explanation, setup steps, limitations, tested versions and changelog, and
 * LICENSE.txt. Deterministic (sorted entries, timestamps from the publish
 * date), built once when a shader is published.
 */
import { zipSync, type Zippable } from "fflate";
import { licenceText, type LicenceInfo } from "@/lib/assets/bundle";
import { CODE_LANGUAGES, engineLabel } from "./schemas";

export interface ShaderBundleInput {
  slug: string;
  title: string;
  summary: string;
  engine: string;
  engine_version_min: string | null;
  engine_version_max: string | null;
  renderer_compatibility: string | null;
  explanation_md: string;
  setup_md: string;
  limitations_md: string;
  changelog_md: string;
  code: string;
  code_language: string | null;
  source_url: string | null;
  tested_at: Date | string;
  tested_notes: string | null;
  url: string;
  publishedAt: Date;
}

export const codeExtension = (lang: string | null) => CODE_LANGUAGES.find((c) => c.id === lang)?.ext ?? "txt";

export function testedLine(s: Pick<ShaderBundleInput, "engine" | "engine_version_min" | "engine_version_max" | "renderer_compatibility" | "tested_at" | "tested_notes">): string {
  const versions = s.engine_version_min && s.engine_version_max && s.engine_version_min !== s.engine_version_max ? `${s.engine_version_min}–${s.engine_version_max}` : (s.engine_version_min ?? s.engine_version_max ?? "");
  const date = new Date(s.tested_at).toISOString().slice(0, 10);
  return [`Tested with ${engineLabel(s.engine)}${versions ? ` ${versions}` : ""}`, s.renderer_compatibility ? `(${s.renderer_compatibility})` : null, `on ${date}`, s.tested_notes ? `— ${s.tested_notes}` : null].filter(Boolean).join(" ");
}

export function buildShaderBundle(s: ShaderBundleInput, licence: LicenceInfo): Uint8Array {
  const enc = new TextEncoder();
  const mtime = s.publishedAt;
  const section = (title: string, body: string) => (body.trim() ? [`## ${title}`, "", body.trim(), ""] : []);
  const readme = [
    `# ${s.title}`,
    "",
    s.summary,
    "",
    testedLine(s) + ".",
    "",
    ...section("What it does", s.explanation_md),
    ...section("Setup", s.setup_md),
    ...section("Limitations", s.limitations_md),
    ...section("Changelog", s.changelog_md),
    s.source_url ? `Source: ${s.source_url}` : null,
    `From: ${s.url}`,
    `Licence: ${licence.human_label}. See LICENSE.txt.`,
    "",
  ]
    .filter((l) => l !== null)
    .join("\n");
  const entries: Zippable = {
    [`${s.slug}/${s.slug}.${codeExtension(s.code_language)}`]: [enc.encode(s.code.endsWith("\n") ? s.code : s.code + "\n"), { mtime }],
    [`${s.slug}/README.md`]: [enc.encode(readme), { mtime }],
    [`${s.slug}/LICENSE.txt`]: [enc.encode(licenceText({ title: s.title, url: s.url, attributionText: null, licenceSourceUrl: s.source_url, provenance: null }, licence)), { mtime }],
  };
  const ordered: Zippable = {};
  for (const k of Object.keys(entries).sort()) ordered[k] = entries[k]!;
  return zipSync(ordered, { level: 6 });
}
