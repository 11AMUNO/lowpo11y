/**
 * The admin editor's fields for each content kind, and conversion between
 * database rows, form values and the JSON the API accepts. One editor
 * renders all five kinds from these definitions.
 */
import { CODE_LANGUAGES, DIFFICULTIES, ENGINES, RESOURCE_CATEGORIES, TOPICS } from "@/lib/content/schemas";
import type { ContentKind } from "@/lib/content/repository";

type Base = { name: string; label: string; hint?: string; required?: boolean };
export type FieldDef = Base &
  (
    | { type: "text" | "url" | "date"; max?: number; placeholder?: string }
    | { type: "number"; min?: number; max?: number }
    | { type: "textarea" | "markdown" | "code"; rows?: number; max?: number }
    | { type: "select"; options: readonly { value: string; label: string }[]; empty?: string }
    | { type: "licence" | "creator" }
    | { type: "checkbox"; description?: string }
    | { type: "checklist"; options: readonly string[] }
    | { type: "tags" | "lines" }
    | { type: "youtube" }
  );

export interface PanelDef {
  title: string;
  fields: FieldDef[];
}

const engineOptions = ENGINES.map((e) => ({ value: e.id, label: e.label }));
const slug: FieldDef = { name: "slug", label: "Slug", type: "text", required: true, max: 80, hint: "The page address. Lowercase letters, numbers and hyphens." };
const reviewed: FieldDef = { name: "last_reviewed_at", label: "Last reviewed", type: "date", hint: "When someone last checked the link and description were still right." };
const reviewNotes: FieldDef = { name: "review_notes", label: "Review notes", type: "textarea", rows: 2, max: 500, hint: "Private. What was checked and anything to recheck." };

export const PANELS: Record<ContentKind, PanelDef[]> = {
  shader: [
    {
      title: "Details",
      fields: [
        { name: "title", label: "Title", type: "text", required: true, max: 120 },
        slug,
        { name: "summary", label: "Summary", type: "text", max: 300, hint: "One sentence for cards and search." },
        { name: "engine", label: "Engine", type: "select", options: engineOptions, required: true },
        { name: "tags", label: "Tags", type: "tags", hint: "Comma-separated, e.g. vertex snapping, fog." },
        { name: "featured", label: "Featured", type: "checkbox", description: "Shown first on the Shaders page." },
      ],
    },
    {
      title: "Tested with",
      fields: [
        { name: "engine_version_min", label: "Oldest version tested", type: "text", max: 40, placeholder: "4.2" },
        { name: "engine_version_max", label: "Newest version tested", type: "text", max: 40, placeholder: "4.3" },
        { name: "renderer_compatibility", label: "Renderer", type: "text", max: 200, placeholder: "Forward+, Mobile, Compatibility" },
        { name: "tested_at", label: "Tested on", type: "date", hint: "Required to publish. Leave empty until you have run it yourself." },
        { name: "tested_notes", label: "How it was tested", type: "text", max: 500, placeholder: "Sample scene, GPU, browser…" },
      ],
    },
    {
      title: "Code",
      fields: [
        { name: "code_language", label: "Language", type: "select", options: CODE_LANGUAGES.map((c) => ({ value: c.id, label: c.label })), empty: "Choose a language" },
        { name: "code", label: "Code", type: "code", rows: 18, max: 200_000, hint: "Shown on the page and packed into the download with a README and LICENSE." },
      ],
    },
    {
      title: "Documentation",
      fields: [
        { name: "explanation_md", label: "What it does", type: "markdown", rows: 6, hint: "Markdown. Explain the technique, not just the steps." },
        { name: "setup_md", label: "Setup steps", type: "markdown", rows: 5 },
        { name: "limitations_md", label: "Limitations", type: "markdown", rows: 4, hint: "What it doesn't handle, and where it looks wrong." },
        { name: "changelog_md", label: "Changelog", type: "markdown", rows: 3 },
      ],
    },
    {
      title: "Licence and source",
      fields: [
        { name: "licence_id", label: "Licence", type: "licence" },
        { name: "source_url", label: "Original source", type: "url", hint: "Where the code came from, if it wasn't written for this site." },
        { name: "preview_url", label: "Preview image or video", type: "url" },
      ],
    },
  ],
  starter: [
    {
      title: "Details",
      fields: [
        { name: "title", label: "Title", type: "text", required: true, max: 120 },
        slug,
        { name: "summary", label: "Summary", type: "text", max: 300 },
        { name: "engine", label: "Engine", type: "select", options: engineOptions, required: true },
        { name: "engine_versions", label: "Engine versions", type: "text", max: 80, placeholder: "4.2–4.3" },
        { name: "included_features", label: "What's included", type: "lines", hint: "One feature per line." },
        { name: "featured", label: "Featured", type: "checkbox", description: "Shown first on the Starter projects page." },
      ],
    },
    { title: "Description", fields: [{ name: "description_md", label: "Description", type: "markdown", rows: 8, hint: "Markdown. How to open it, what to try first." }] },
    {
      title: "Tested with",
      fields: [
        { name: "tested_at", label: "Tested on", type: "date", hint: "Required to publish. Open the downloaded ZIP in the engine first." },
        { name: "tested_notes", label: "How it was tested", type: "text", max: 500 },
      ],
    },
    {
      title: "Licence and source",
      fields: [
        { name: "licence_id", label: "Licence", type: "licence" },
        { name: "source_url", label: "Source repository", type: "url" },
        { name: "preview_url", label: "Preview image or video", type: "url" },
      ],
    },
  ],
  creator: [
    {
      title: "Details",
      fields: [
        { name: "name", label: "Name", type: "text", required: true, max: 120 },
        slug,
        { name: "description", label: "Description", type: "textarea", rows: 3, max: 600, hint: "In our own words: what they teach and who it suits." },
        { name: "youtube_channel_url", label: "YouTube channel", type: "url", placeholder: "https://www.youtube.com/@…" },
        { name: "website_url", label: "Website", type: "url" },
        { name: "categories", label: "Topics", type: "checklist", options: TOPICS },
      ],
    },
    { title: "Review", fields: [reviewed, { name: "attribution_notes", label: "Attribution notes", type: "textarea", rows: 2, max: 500, hint: "How they want to be credited, if they've said." }] },
  ],
  tutorial: [
    {
      title: "Details",
      fields: [
        { name: "title", label: "Title", type: "text", required: true, max: 160 },
        slug,
        { name: "creator_id", label: "Creator", type: "creator" },
        { name: "youtube_video_id", label: "YouTube video", type: "youtube" },
        { name: "external_url", label: "Or a link", type: "url", hint: "For videos that aren't on YouTube, or that can't be embedded." },
        { name: "summary", label: "What viewers will learn", type: "textarea", rows: 3, max: 600 },
      ],
    },
    {
      title: "Filters",
      fields: [
        { name: "topic", label: "Topic", type: "select", options: TOPICS.map((t) => ({ value: t, label: t })), empty: "No topic" },
        { name: "difficulty", label: "Difficulty", type: "select", options: DIFFICULTIES.map((d) => ({ value: d, label: d[0]!.toUpperCase() + d.slice(1) })), empty: "Not set" },
        { name: "engine", label: "Engine", type: "select", options: engineOptions, empty: "Not engine-specific" },
        { name: "duration_minutes", label: "Length (minutes)", type: "number", min: 1, max: 1200 },
        { name: "featured", label: "Featured", type: "checkbox", description: "A featured pick on the Learn page." },
      ],
    },
    { title: "Review", fields: [reviewed, reviewNotes] },
  ],
  resource: [
    {
      title: "Details",
      fields: [
        { name: "title", label: "Title", type: "text", required: true, max: 120 },
        slug,
        { name: "url", label: "Link", type: "url", required: true },
        { name: "category", label: "Category", type: "select", options: RESOURCE_CATEGORIES.map((c) => ({ value: c.id, label: c.label })), required: true },
        { name: "description", label: "Description", type: "textarea", rows: 3, max: 600 },
        { name: "licence_note", label: "Licence note", type: "text", max: 300, hint: "What the site says about reuse, in a few words. We link; we don't rehost." },
        { name: "featured", label: "Featured", type: "checkbox" },
      ],
    },
    { title: "Review", fields: [reviewed, reviewNotes] },
  ],
};

export type FormValue = string | boolean | string[];
export type FormValues = Record<string, FormValue>;

const fieldsOf = (kind: ContentKind) => PANELS[kind].flatMap((p) => p.fields);

/** A database row as form values: dates as YYYY-MM-DD, nulls as "". */
export function toFormValues(kind: ContentKind, row: Record<string, unknown>): FormValues {
  const out: FormValues = {};
  for (const f of fieldsOf(kind)) {
    const v = row[f.name];
    if (f.type === "checkbox") out[f.name] = !!v;
    else if (f.type === "checklist") out[f.name] = Array.isArray(v) ? v.map(String) : [];
    else if (f.type === "tags") out[f.name] = Array.isArray(v) ? v.join(", ") : "";
    else if (f.type === "lines") out[f.name] = Array.isArray(v) ? v.join("\n") : "";
    else if (f.type === "date") out[f.name] = v ? new Date(v as string).toISOString().slice(0, 10) : "";
    else out[f.name] = v === null || v === undefined ? "" : String(v);
  }
  return out;
}

/** Form values as the API's JSON body. */
export function toPayload(kind: ContentKind, values: FormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fieldsOf(kind)) {
    const v = values[f.name];
    if (f.type === "checkbox") out[f.name] = !!v;
    else if (f.type === "checklist") out[f.name] = Array.isArray(v) ? v : [];
    else if (f.type === "tags")
      out[f.name] = String(v ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    else if (f.type === "lines")
      out[f.name] = String(v ?? "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    else if (f.type === "number") out[f.name] = String(v ?? "").trim() ? Number(v) : null;
    else if (f.type === "select" || f.type === "licence" || f.type === "creator" || f.type === "youtube" || f.type === "date" || f.type === "url") out[f.name] = String(v ?? "").trim() || null;
    else out[f.name] = String(v ?? "");
  }
  // Selects that are required stay strings; a required empty select is a validation error worth seeing.
  for (const f of fieldsOf(kind)) if (f.required && out[f.name] === null) out[f.name] = "";
  return out;
}

/** A URL-safe slug from a title. */
export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}
