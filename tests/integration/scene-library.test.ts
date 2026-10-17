import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sceneModels } from "@/lib/scene/library";
import { asRole, createTestDb, TEST_DRIVERS, type TestDb } from "../support/db";

describe.each(TEST_DRIVERS)("Scene Builder library (%s)", (driver) => {
  let t: TestDb;
  const anon = <R>(fn: Parameters<typeof asRole<R>>[2]) => asRole(t.db, { role: "anon" }, fn);

  beforeAll(async () => {
    t = await createTestDb(driver);
    const [lic] = await t.db.query<{ id: string }>("select id from licences where code = 'cc0-1.0'");
    const asset = async (slug: string, type: string, status: string) => {
      const [a] = await t.db.query<{ id: string }>(
        `insert into assets (slug, title, asset_type, status, licence_id, ownership_attested_at, published_at)
         values ($1::text, initcap(replace($1::text, '-', ' ')), $2::asset_type, $3::publish_status, $4::uuid, now(), case when $3::text = 'published' then now() end) returning id`,
        [slug, type, status, lic!.id],
      );
      return a!.id;
    };
    let n = 0;
    const file = (assetId: string, format: string, o: { purpose?: string; bytes?: number; primary?: boolean; published?: boolean; publicKey?: boolean; tris?: number } = {}) => {
      n++;
      return t.db.query(
        `insert into asset_files (asset_id, purpose, storage_key, public_key, original_filename, format, mime, size_bytes, sha256, is_primary, published, model_triangle_count)
         values ($1, $2, $3, $4, $5, $6, 'model/gltf-binary', $7, $8, $9, $10, $11)`,
        [assetId, o.purpose ?? "delivery", `k/${n}`, o.publicKey === false ? null : `p/${n}`, `f${n}.${format}`, format, o.bytes ?? 1000, String(n % 10).repeat(64), o.primary ?? false, o.published ?? true, o.tris ?? null],
      );
    };
    const crate = await asset("wooden-crate", "model", "published");
    await file(crate, "glb", { bytes: 5000, tris: 60 });
    await file(crate, "glb", { bytes: 900, tris: 12 });
    await file(crate, "fbx", { bytes: 10 });
    const drum = await asset("oil-drum", "model", "published");
    await file(drum, "glb", { bytes: 100 });
    await file(drum, "glb", { bytes: 9000, primary: true, tris: 80 });
    await file(await asset("fbx-only", "model", "published"), "fbx");
    await file(await asset("draft-model", "model", "draft"), "glb");
    await file(await asset("brick-wall", "texture", "published"), "glb");
    await file(await asset("source-only", "model", "published"), "glb", { purpose: "source" });
    await file(await asset("not-copied-yet", "model", "published"), "glb", { publicKey: false });
    await file(await asset("hidden-file", "model", "published"), "glb", { published: false });
  }, 60_000);

  afterAll(async () => {
    await t?.cleanup();
  });

  it("lists published models that have a published GLB, with the primary file, else the smallest", async () => {
    const items = await anon((q) => sceneModels(q));
    expect(items.map((i) => i.slug).sort()).toEqual(["oil-drum", "wooden-crate"]);
    expect(items.find((i) => i.slug === "wooden-crate")).toMatchObject({ licence: "CC0", attribution: false, sizeBytes: 900, triangles: 12 });
    expect(items.find((i) => i.slug === "oil-drum")).toMatchObject({ sizeBytes: 9000, triangles: 80 });
  });

  it("filters by title or slug, treating wildcards literally", async () => {
    expect((await anon((q) => sceneModels(q, "drum"))).map((i) => i.slug)).toEqual(["oil-drum"]);
    expect((await anon((q) => sceneModels(q, "Wooden"))).map((i) => i.slug)).toEqual(["wooden-crate"]);
    expect(await anon((q) => sceneModels(q, "%"))).toEqual([]);
  });
});
