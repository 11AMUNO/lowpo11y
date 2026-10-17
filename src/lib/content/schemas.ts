/**
 * Shaders & Code, starter projects, the Learn directory and external
 * resources: input validation and the taxonomies the plan specifies.
 */
import { z } from "zod";

export const ENGINES = [
  { id: "godot", label: "Godot" },
  { id: "threejs", label: "three.js" },
  { id: "unity", label: "Unity" },
  { id: "blender", label: "Blender" },
  { id: "unreal", label: "Unreal" },
  { id: "glsl", label: "Plain GLSL" },
  { id: "any", label: "Any engine" },
] as const;
export type Engine = (typeof ENGINES)[number]["id"];
export const engineLabel = (id: string | null | undefined) => ENGINES.find((e) => e.id === id)?.label ?? id ?? "";

/** The plan's editorial taxonomy for Learn. */
export const TOPICS = [
  "Beginner Setup",
  "Blender UV & Textures",
  "Godot Rendering",
  "Low-Poly Modelling",
  "Character Rigging/Animations",
  "Godot Gameplay",
  "Optimisation",
  "Retro Art History",
  "Level Design",
  "Technical Art",
  "Shader Tutorials",
] as const;

export const DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;

export const RESOURCE_CATEGORIES = [
  { id: "textures", label: "Textures & materials" },
  { id: "models", label: "Models" },
  { id: "audio", label: "Audio" },
  { id: "fonts", label: "Fonts" },
  { id: "tools", label: "Tools & software" },
  { id: "docs", label: "Documentation & specs" },
  { id: "learning", label: "Learning" },
] as const;
export const resourceCategoryLabel = (id: string) => RESOURCE_CATEGORIES.find((c) => c.id === id)?.label ?? id;

export const CODE_LANGUAGES = [
  { id: "gdshader", label: "Godot shader", ext: "gdshader" },
  { id: "glsl", label: "GLSL", ext: "glsl" },
  { id: "hlsl", label: "HLSL", ext: "hlsl" },
  { id: "javascript", label: "JavaScript", ext: "js" },
  { id: "typescript", label: "TypeScript", ext: "ts" },
  { id: "gdscript", label: "GDScript", ext: "gd" },
  { id: "csharp", label: "C#", ext: "cs" },
] as const;

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens.");
const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((u) => u.startsWith("https://"), "Use an https:// link.");
const optionalUrl = z.union([httpsUrl, z.literal("").transform(() => null), z.null()]);
const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .transform((v) => (v ? v : null))
    .default(null);
const markdown = z.string().max(40_000);
const isoDate = z.union([z.iso.datetime({ offset: true }), z.iso.date(), z.null(), z.literal("").transform(() => null)]);
const uuidOrNull = z.union([z.uuid(), z.null(), z.literal("").transform(() => null)]);
const tags = z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20);

/* --------------------------------------------------------------- YouTube */

/** The 11-character video id from a YouTube URL (watch, youtu.be, shorts, embed, live) or a bare id. */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = /^\/(?:shorts|embed|live|v)\/([^/?#]+)/.exec(u.pathname);
      id = m?.[1] ?? null;
    }
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

const youtubeId = z
  .union([z.string(), z.null()])
  .transform((v, ctx) => {
    if (!v || !v.trim()) return null;
    const id = parseYouTubeId(v);
    if (!id) ctx.addIssue({ code: "custom", message: "That isn't a YouTube video link or id." });
    return id;
  });

/* --------------------------------------------------------------- schemas */

const status = z.enum(["draft", "review", "published", "archived"]);

export const shaderInputSchema = z.object({
  slug,
  title: z.string().trim().min(2).max(120),
  summary: z.string().trim().max(300).default(""),
  engine: z.enum(ENGINES.map((e) => e.id) as [Engine, ...Engine[]]),
  engine_version_min: optionalText(40),
  engine_version_max: optionalText(40),
  renderer_compatibility: optionalText(200),
  licence_id: uuidOrNull.default(null),
  explanation_md: markdown.default(""),
  setup_md: markdown.default(""),
  limitations_md: markdown.default(""),
  changelog_md: markdown.default(""),
  code: z.union([z.string().max(200_000), z.null()]).default(null),
  code_language: z.union([z.enum(CODE_LANGUAGES.map((c) => c.id) as [string, ...string[]]), z.null()]).default(null),
  preview_url: optionalUrl.default(null),
  source_url: optionalUrl.default(null),
  tested_at: isoDate.default(null),
  tested_notes: optionalText(500),
  tags: tags.default([]),
  featured: z.boolean().default(false),
});
export type ShaderInput = z.infer<typeof shaderInputSchema>;

export const starterInputSchema = z.object({
  slug,
  title: z.string().trim().min(2).max(120),
  summary: z.string().trim().max(300).default(""),
  engine: z.enum(ENGINES.map((e) => e.id) as [Engine, ...Engine[]]),
  engine_versions: optionalText(80),
  description_md: markdown.default(""),
  included_features: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  licence_id: uuidOrNull.default(null),
  preview_url: optionalUrl.default(null),
  source_url: optionalUrl.default(null),
  tested_at: isoDate.default(null),
  tested_notes: optionalText(500),
  featured: z.boolean().default(false),
});
export type StarterInput = z.infer<typeof starterInputSchema>;

export const creatorInputSchema = z.object({
  slug,
  name: z.string().trim().min(1).max(120),
  youtube_channel_url: optionalUrl.default(null),
  website_url: optionalUrl.default(null),
  description: z.string().trim().max(600).default(""),
  categories: z.array(z.enum(TOPICS)).max(TOPICS.length).default([]),
  attribution_notes: optionalText(500),
  last_reviewed_at: isoDate.default(null),
});
export type CreatorInput = z.infer<typeof creatorInputSchema>;

export const tutorialInputSchema = z.object({
  slug,
  creator_id: uuidOrNull.default(null),
  title: z.string().trim().min(2).max(160),
  youtube_video_id: youtubeId.default(null),
  external_url: optionalUrl.default(null),
  summary: z.string().trim().max(600).default(""),
  difficulty: z.union([z.enum(DIFFICULTIES), z.null(), z.literal("").transform(() => null)]).default(null),
  engine: z.union([z.enum(ENGINES.map((e) => e.id) as [Engine, ...Engine[]]), z.null(), z.literal("").transform(() => null)]).default(null),
  topic: z.union([z.enum(TOPICS), z.null(), z.literal("").transform(() => null)]).default(null),
  duration_minutes: z.union([z.number().int().min(1).max(1200), z.null()]).default(null),
  featured: z.boolean().default(false),
  last_reviewed_at: isoDate.default(null),
  review_notes: optionalText(500),
});
export type TutorialInput = z.infer<typeof tutorialInputSchema>;

export const resourceInputSchema = z.object({
  slug,
  title: z.string().trim().min(2).max(120),
  url: httpsUrl,
  category: z.enum(RESOURCE_CATEGORIES.map((c) => c.id) as [string, ...string[]]),
  description: z.string().trim().max(600).default(""),
  licence_note: optionalText(300),
  link_only: z.boolean().default(true),
  featured: z.boolean().default(false),
  last_reviewed_at: isoDate.default(null),
  review_notes: optionalText(500),
});
export type ResourceInput = z.infer<typeof resourceInputSchema>;

export const statusChangeSchema = z.object({ status });
export const creatorApprovalSchema = z.object({ approved: z.boolean() });

/**
 * Parses a partial update. Zod applies defaults even to `.partial()` fields,
 * so only the keys the request actually sent are kept; nothing else is reset.
 */
export function parsePatch<S extends z.ZodObject>(schema: S, body: unknown): Partial<z.infer<S>> {
  const parsed = schema.partial().parse(body) as Record<string, unknown>;
  const sent = body && typeof body === "object" ? new Set(Object.keys(body)) : new Set<string>();
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => sent.has(k))) as Partial<z.infer<S>>;
}

export const CONTENT_SCHEMAS = {
  shader: shaderInputSchema,
  starter: starterInputSchema,
  creator: creatorInputSchema,
  tutorial: tutorialInputSchema,
  resource: resourceInputSchema,
} as const;
