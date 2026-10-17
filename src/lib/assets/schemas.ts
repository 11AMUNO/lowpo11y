import { z } from "@/lib/zod";

export const ASSET_TYPES = ["model", "texture", "decal", "sprite", "ui", "audio", "skybox", "animation", "pack"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  model: "Model",
  texture: "Texture",
  decal: "Decal",
  sprite: "Sprite",
  ui: "UI",
  audio: "Audio",
  skybox: "Skybox",
  animation: "Animation",
  pack: "Pack",
};

export const PROVENANCE_KINDS = ["original", "commissioned", "third_party", "ai_assisted", "demo"] as const;
export const PROVENANCE_LABEL: Record<(typeof PROVENANCE_KINDS)[number], string> = {
  original: "Original work",
  commissioned: "Commissioned",
  third_party: "Third-party (licensed)",
  ai_assisted: "Made with AI assistance",
  demo: "LOWPO11Y demo content",
};

export const ENGINES = ["godot", "blender", "unity", "unreal"] as const;

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens.");

const optionalUrl = z
  .union([z.literal(""), z.url({ protocol: /^https?$/ })])
  .optional()
  .transform((v) => v || null);

export const assetInputSchema = z.object({
  title: z.string().trim().min(2, "Give the asset a title.").max(120),
  slug: slug.optional().or(z.literal("").transform(() => undefined)),
  assetType: z.enum(ASSET_TYPES),
  shortDescription: z.string().trim().max(240).default(""),
  descriptionMd: z.string().max(20_000).default(""),
  usageNotesMd: z.string().max(20_000).default(""),
  categoryId: z.uuid().nullable().default(null),
  licenceId: z.uuid().nullable().default(null),
  attributionText: z.string().trim().max(1000).nullable().default(null),
  licenceSourceUrl: optionalUrl,
  provenanceKind: z.enum(PROVENANCE_KINDS).nullable().default(null),
  provenanceNotes: z.string().trim().max(4000).nullable().default(null),
  featured: z.boolean().default(false),
  engines: z.array(z.enum(ENGINES)).max(4).default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
});
export type AssetInput = z.infer<typeof assetInputSchema>;

export const assetPatchSchema = assetInputSchema.partial().extend({
  /** true sets ownership_attested_at/by to now/actor; false clears it. */
  attest: z.boolean().optional(),
  /** Editors move work between draft and review; publishing has its own endpoint. */
  status: z.enum(["draft", "review"]).optional(),
});
export type AssetPatch = z.infer<typeof assetPatchSchema>;

export function slugify(input: string): string {
  return (
    input
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72)
      .replace(/-+$/, "") || "asset"
  );
}

export function tagSlug(name: string): string {
  return slugify(name).slice(0, 40) || "tag";
}

/** Asset types listed under /textures; everything else lives under /assets. */
export const TEXTURE_SECTION_TYPES: readonly AssetType[] = ["texture", "decal", "skybox"];

/** Canonical public path of an asset's detail page. */
export function assetPath(asset: { slug: string; asset_type: string }): string {
  return `/${(TEXTURE_SECTION_TYPES as readonly string[]).includes(asset.asset_type) ? "textures" : "assets"}/${asset.slug}`;
}
