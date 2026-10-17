import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workshopLibrary } from "@/lib/workshop/library";
import { asRole, createTestDb, TEST_DRIVERS, type TestDb } from "../support/db";

describe.each(TEST_DRIVERS)("Workshop library (%s)", (driver) => {
  let t: TestDb;
  const anon = <R>(fn: Parameters<typeof asRole<R>>[2]) => asRole(t.db, { role: "anon" }, fn);

  beforeAll(async () => {
    t = await createTestDb(driver);
    const lic = await t.db.query<{ id: string; code: string }>("select id, code from licences where code in ('cc0-1.0', 'cc-by-4.0')");
    const cc0 = lic.find((l) => l.code === "cc0-1.0")!.id;
    const ccBy = lic.find((l) => l.code === "cc-by-4.0")!.id;
    const asset = async (slug: string, type: string, status: string, licence: string | null) => {
      const [a] = await t.db.query<{ id: string }>(
        `insert into assets (slug, title, asset_type, status, licence_id, ownership_attested_at, published_at)
         values ($1::text, initcap(replace($1::text, '-', ' ')), $2::asset_type, $3::publish_status, $4::uuid, case when $4::uuid is null then null else now() end, case when $3::text = 'published' then now() end) returning id`,
        [slug, type, status, licence],
      );
      return a!.id;
    };
    let n = 0;
    const file = (assetId: string, format: string, o: { purpose?: string; w?: number; primary?: boolean; published?: boolean; publicKey?: boolean } = {}) => {
      n++;
      return t.db.query(
        `insert into asset_files (asset_id, purpose, storage_key, public_key, original_filename, format, mime, size_bytes, sha256, width, height, is_primary, published)
         values ($1, $2, $3, $4, $5, $6, 'image/png', 100, $7, $8, $8, $9, $10)`,
        [assetId, o.purpose ?? "delivery", `k/${n}`, o.publicKey === false ? null : `p/${n}`, `f${n}.${format}`, format, String(n % 10).repeat(64), o.w ?? 128, o.primary ?? false, o.published ?? true],
      );
    };
    const brick = await asset("brick-wall", "texture", "published", cc0);
    await file(brick, "png", { w: 64 });
    await file(brick, "png", { w: 256 });
    await file(brick, "glb", { w: 999 });
    const sign = await asset("exit-sign", "decal", "published", ccBy);
    await file(sign, "webp", { primary: true, w: 32 });
    await file(sign, "png", { w: 512 });
    await file(await asset("crate", "model", "published", cc0), "png");
    await file(await asset("secret-floor", "texture", "draft", cc0), "png");
    await file(await asset("source-only", "texture", "published", cc0), "png", { purpose: "source" });
    await file(await asset("not-copied-yet", "texture", "published", cc0), "png", { publicKey: false });
    await file(await asset("hidden-file", "texture", "published", cc0), "png", { published: false });
  }, 60_000);

  afterAll(async () => {
    await t?.cleanup();
  });

  it("lists published, downloadable texture-like assets with their best image file", async () => {
    const items = await anon((q) => workshopLibrary(q));
    expect(items.map((i) => i.slug).sort()).toEqual(["brick-wall", "exit-sign"]);
    const brick = items.find((i) => i.slug === "brick-wall")!;
    expect(brick).toMatchObject({ type: "texture", licence: "CC0", attribution: false, width: 256 });
    // The primary file wins over a larger one.
    expect(items.find((i) => i.slug === "exit-sign")).toMatchObject({ width: 32, attribution: true });
  });

  it("filters by title or slug", async () => {
    expect((await anon((q) => workshopLibrary(q, "exit"))).map((i) => i.slug)).toEqual(["exit-sign"]);
    expect(await anon((q) => workshopLibrary(q, "100%_"))).toEqual([]);
  });
});
