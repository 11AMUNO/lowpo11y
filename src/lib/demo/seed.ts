/**
 * Seeds the procedural demo library through the same domain functions the
 * admin uses (create → store files → derive → attest → publish), so seeding
 * doubles as an end-to-end exercise of the pipeline. Idempotent by slug.
 */
import sharp from "sharp";
import type { Tx } from "@/lib/db";
import type { AssetStorage } from "@/lib/storage";
import { createCollection, publishCollection } from "@/lib/assets/collections";
import { generateDerivatives } from "@/lib/assets/derive";
import { storeAssetFile } from "@/lib/assets/files";
import { publishAsset } from "@/lib/assets/publish";
import { createAsset, updateAsset } from "@/lib/assets/repository";
import { DEMO_MODELS } from "./models";
import { DEMO_TEXTURES, renderDemoTexture } from "./textures";

const DEMO_NOTE = "Generated procedurally by LOWPO11Y for demonstration and testing. Owned by the project and released under CC0.";

const TEXTURE_CATEGORY: Record<string, string> = {
  brick: "brick",
  concrete: "stone-concrete",
  metal: "metal",
  wood: "wood",
  floor: "floor-tiles",
  ground: "ground",
  utility: "utility",
};

export interface SeedResult {
  created: string[];
  skipped: string[];
}

export async function seedDemoContent(tx: Tx, storage: AssetStorage, actorId: string, log: (s: string) => void = () => {}): Promise<SeedResult> {
  const result: SeedResult = { created: [], skipped: [] };
  const [cc0] = await tx.asUser((q) => q.query<{ id: string }>("select id from licences where code = 'cc0-1.0'"));
  if (!cc0) throw new Error("CC0 licence missing; run migrations first.");
  const categories = new Map(
    (await tx.asUser((q) => q.query<{ id: string; slug: string }>("select id, slug from categories"))).map((c) => [c.slug, c.id]),
  );
  const existing = new Set((await tx.asUser((q) => q.query<{ slug: string }>("select slug from assets"))).map((r) => r.slug));
  const ids = new Map<string, string>();

  const finish = async (assetId: string, slug: string) => {
    await tx.asUser((q) => updateAsset(q, actorId, assetId, { attest: true }));
    await publishAsset(tx, storage, assetId);
    result.created.push(slug);
    log(`  published ${slug}`);
  };

  for (const t of DEMO_TEXTURES) {
    if (existing.has(t.slug)) {
      result.skipped.push(t.slug);
      continue;
    }
    const asset = await tx.asUser((q) =>
      createAsset(
        q,
        actorId,
        {
          title: t.title,
          slug: t.slug,
          assetType: "texture",
          shortDescription: t.description,
          descriptionMd: `${t.description}\n\nSeamless at 128 px. Download includes 64 px and 32 px nearest-neighbour variants.`,
          usageNotesMd: "Import with nearest (point) filtering and mipmaps off for a crisp retro look.",
          categoryId: categories.get(TEXTURE_CATEGORY[t.category]!) ?? null,
          licenceId: cc0.id,
          attributionText: null,
          licenceSourceUrl: null,
          provenanceKind: "demo",
          provenanceNotes: DEMO_NOTE,
          featured: false,
          engines: [],
          tags: [...t.tags, "psx-inspired"],
        },
        { isDemo: true },
      ),
    );
    ids.set(t.slug, asset.id);
    const img = renderDemoTexture(t.slug, 128);
    const png = new Uint8Array(await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: 128, height: 128, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer());
    await tx.asUser((q) => storeAssetFile(q, storage, { assetId: asset.id, purpose: "delivery", filename: `${t.slug}.png`, bytes: png, primary: true }));
    await generateDerivatives(tx, storage, asset.id, { textureVariants: true });
    await finish(asset.id, t.slug);
  }

  for (const m of DEMO_MODELS) {
    if (existing.has(m.slug)) {
      result.skipped.push(m.slug);
      continue;
    }
    const asset = await tx.asUser((q) =>
      createAsset(
        q,
        actorId,
        {
          title: m.title,
          slug: m.slug,
          assetType: "model",
          shortDescription: m.description,
          descriptionMd: `${m.description}\n\nBuilt from primitives in code and textured with the LOWPO11Y demo textures (embedded, nearest filtering).`,
          usageNotesMd: "Units are metres; the pivot is at the base centre. Import the GLB directly into Godot 4 or Blender.",
          categoryId: categories.get(m.category) ?? null,
          licenceId: cc0.id,
          attributionText: null,
          licenceSourceUrl: null,
          provenanceKind: "demo",
          provenanceNotes: DEMO_NOTE,
          featured: m.slug === "demo-wooden-crate" || m.slug === "demo-crt-monitor",
          engines: ["godot", "blender"],
          tags: [...m.tags, "general-low-poly"],
        },
        { isDemo: true },
      ),
    );
    ids.set(m.slug, asset.id);
    await tx.asUser(async (q) => storeAssetFile(q, storage, { assetId: asset.id, purpose: "delivery", filename: `${m.slug}.glb`, bytes: await m.build(), primary: true }));
    await generateDerivatives(tx, storage, asset.id);
    await finish(asset.id, m.slug);
  }

  const colExisting = new Set((await tx.asUser((q) => q.query<{ slug: string }>("select slug from collections"))).map((r) => r.slug));
  const collections = [
    {
      slug: "demo-industrial-blockout-kit",
      title: "Demo: industrial blockout kit",
      summary: "Crates, drums, barriers and 2 m wall and floor modules with matching textures — enough to block out a yard.",
      members: ["demo-brick-wall-module", "demo-tread-floor-module", "demo-wooden-crate", "demo-oil-drum", "demo-wooden-pallet", "demo-jersey-barrier", "demo-hazard-locker", "demo-traffic-cone", "demo-street-lamp", "demo-poured-concrete", "demo-rusted-plate", "demo-tread-plate", "demo-hazard-stripes"],
    },
    {
      slug: "demo-texture-page-0",
      title: "Demo: texture page 0",
      summary: "Every procedural demo texture: brick, concrete, metal, wood, tiles, ground, hazard paint and a UV test grid.",
      members: DEMO_TEXTURES.map((t) => t.slug),
    },
  ];
  for (const c of collections) {
    if (colExisting.has(c.slug)) continue;
    const memberIds = (await tx.asUser((q) => q.query<{ id: string; slug: string }>("select id, slug from assets where slug = any($1::text[])", [c.members])))
      .sort((a, b) => c.members.indexOf(a.slug) - c.members.indexOf(b.slug))
      .map((r) => r.id);
    const col = await tx.asUser((q) =>
      createCollection(q, { title: c.title, slug: c.slug, summary: c.summary, descriptionMd: `${c.summary}\n\n${DEMO_NOTE}`, featured: true, assetIds: memberIds }),
    );
    await publishCollection(tx, storage, col.id);
    log(`  published collection ${c.slug}`);
  }
  return result;
}
