import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { planFromPaths, runImport, validatePlan, type ImportFileInfo } from "@/lib/assets/import";
import { listAssetFiles } from "@/lib/assets/repository";
import { txOn } from "@/lib/db";
import { LocalFilesystemStorage } from "@/lib/storage/local";
import { asciiFbxCube } from "../support/fbx-fixture";
import { asRole, createTestDb, TEST_DRIVERS, type TestDb } from "../support/db";

describe.each(TEST_DRIVERS)("bulk import (%s)", (driver) => {
  let t: TestDb;
  let root: string;
  let storage: LocalFilesystemStorage;
  let adminId: string;
  const files = new Map<string, Uint8Array>();
  const info = (): ImportFileInfo[] => [...files].map(([p, b]) => ({ path: p, size: b.byteLength, sha256: createHash("sha256").update(b).digest("hex") }));
  const admin = <R>(fn: Parameters<typeof asRole<R>>[2]) => asRole(t.db, { role: "admin", userId: adminId }, fn);

  beforeAll(async () => {
    t = await createTestDb(driver);
    root = await mkdtemp(path.join(tmpdir(), "lp-import-"));
    storage = new LocalFilesystemStorage(root, "http://localhost:3000", "b".repeat(40));
    [{ id: adminId }] = (await t.db.query<{ id: string }>("insert into users (email, password_hash, display_name, role) values ('a@x.test','x','Admin','admin') returning id")) as [{ id: string }];
    const png = async (shade: number) => new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: shade, g: shade, b: shade, alpha: 1 } } }).png().toBuffer());
    files.set("kit/BH-03-Crate/tripo_convert_x.fbx", asciiFbxCube("tripo_image_x_0_0.png"));
    files.set("kit/BH-03-Crate/tripo_convert_x.fbm/tripo_image_x_0_0.png", await png(120));
    files.set("wood/01 - Pale Birch.png", await png(200));
    files.set("wood/.DS_Store", new Uint8Array([0, 1, 2]));
  }, 60_000);

  afterAll(async () => {
    await t?.cleanup();
    await rm(root, { recursive: true, force: true });
  });

  it("imports drafts through the normal pipeline, then recognises them as duplicates", async () => {
    const { entries, ignored } = planFromPaths([...files.keys()], { provenance: "ai_assisted", category: "props" });
    expect(ignored).toEqual(["wood/.DS_Store"]);
    expect(entries.map((e) => e.title)).toEqual(["BH-03 Crate", "Pale Birch"]);

    const plan = await admin((q) => validatePlan(q, entries, info(), 10 * 1024 * 1024));
    expect(plan).toMatchObject({ ready: 2, duplicates: 0, blocked: 0 });
    const results = await runImport(txOn(t.db, { kind: "user", userId: adminId, role: "admin" }), storage, adminId, entries, plan, async (p) => files.get(p)!);
    expect(results.map((r) => [r.title, r.status])).toEqual([
      ["BH-03 Crate", "created"],
      ["Pale Birch", "created"],
    ]);

    const crate = results[0]!;
    const stored = await admin((q) => listAssetFiles(q, crate.assetId!));
    expect(stored.map((f) => f.metadata?.generated ?? f.format).sort()).toEqual(["fbx", "fbx-to-glb", "model-thumbnail", "png"]);
    const [asset] = await t.db.query<{ status: string; licence_id: string | null; ownership_attested_at: Date | null; provenance_kind: string; tags: string[] }>(
      "select status, licence_id, ownership_attested_at, provenance_kind, (select array_agg(t.slug) from asset_tags at join tags t on t.id = at.tag_id where at.asset_id = a.id) as tags from assets a where id = $1",
      [crate.assetId],
    );
    // Imports never publish, pick a licence or confirm rights.
    expect(asset).toMatchObject({ status: "draft", licence_id: null, ownership_attested_at: null, provenance_kind: "ai_assisted", tags: ["bh-03"] });
    const [created] = await t.db.query<{ n: number }>("select count(*)::int as n from audit_log where action = 'asset.create' and target_id = $1", [crate.assetId]);
    expect(created!.n).toBe(1);

    const again = await admin((q) => validatePlan(q, entries, info(), 10 * 1024 * 1024));
    expect(again).toMatchObject({ ready: 0, duplicates: 2 });
    const rerun = await runImport(txOn(t.db, { kind: "user", userId: adminId, role: "admin" }), storage, adminId, entries, again, async (p) => files.get(p)!);
    expect(rerun.every((r) => r.status === "skipped")).toBe(true);
  });

  it("reports unknown references, missing files and oversized files without writing anything", async () => {
    const entries = [
      { ...planFromPaths(["wood/01 - Pale Birch.png"]).entries[0]!, licence: "made-up-licence", category: "nope", files: ["wood/01 - Pale Birch.png", "wood/missing.png"] },
    ];
    const plan = await admin((q) => validatePlan(q, entries, info(), 100));
    expect(plan.blocked).toBe(1);
    expect(plan.entries[0]!.problems.join(" ")).toMatch(/Unknown category “nope”.*Unknown licence code “made-up-licence”.*larger than the upload limit.*not found in the selection: wood\/missing\.png/);
  });
});
