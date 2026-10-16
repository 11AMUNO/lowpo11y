import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogCounts, getPublicAsset, parseCatalogParams, searchCatalog } from "@/lib/assets/catalog";
import { publishCollection, createCollection, getPublicCollection } from "@/lib/assets/collections";
import { generateDerivatives } from "@/lib/assets/derive";
import { DownloadError, recordDownload, resolveDownload } from "@/lib/assets/downloads";
import { storeAssetFile } from "@/lib/assets/files";
import { PublishError, publishAsset, unpublishAsset } from "@/lib/assets/publish";
import { createAsset, getAssetById, listAssetFiles, updateAsset } from "@/lib/assets/repository";
import { assetInputSchema } from "@/lib/assets/schemas";
import { txOn } from "@/lib/db";
import { seedDemoContent } from "@/lib/demo/seed";
import { LocalFilesystemStorage } from "@/lib/storage/local";
import { asciiFbxCube } from "../support/fbx-fixture";
import { asRole, createTestDb, TEST_DRIVERS, type TestDb } from "../support/db";

describe.each(TEST_DRIVERS)("asset library (%s)", (driver) => {
  let t: TestDb;
  let root: string;
  let storage: LocalFilesystemStorage;
  let adminId: string;
  let editorId: string;
  const admin = () => txOn(t.db, { kind: "user", userId: adminId, role: "admin" });
  const editor = () => txOn(t.db, { kind: "user", userId: editorId, role: "editor" });
  const anon = <R>(fn: Parameters<typeof asRole<R>>[2]) => asRole(t.db, { role: "anon" }, fn);
  const catalog = (sp: Record<string, string> = {}, types?: ("texture" | "model")[]) => anon((q) => searchCatalog(q, parseCatalogParams(sp), { types }));

  beforeAll(async () => {
    t = await createTestDb(driver);
    root = await mkdtemp(path.join(tmpdir(), "lp-assets-"));
    storage = new LocalFilesystemStorage(root, "http://localhost:3000", "a".repeat(40));
    const users = await t.db.query<{ id: string; role: string }>(
      "insert into users (email, password_hash, display_name, role) values ('a@x.test','x','Admin','admin'), ('e@x.test','x','Editor','editor') returning id, role",
    );
    adminId = users.find((u) => u.role === "admin")!.id;
    editorId = users.find((u) => u.role === "editor")!.id;
    await seedDemoContent(admin(), storage, adminId);
  }, 120_000);

  afterAll(async () => {
    await t?.cleanup();
    await rm(root, { recursive: true, force: true });
  });

  describe("seeded demo library", () => {
    it("publishes 11 textures, 10 models and 2 collections visible to anonymous visitors", async () => {
      expect(await anon((q) => catalogCounts(q))).toEqual({ models: 10, textures: 11, collections: 2 });
    });

    it("is idempotent", async () => {
      const r = await seedDemoContent(admin(), storage, adminId);
      expect(r.created).toEqual([]);
      expect(r.skipped).toHaveLength(21);
    });

    it("generates thumbnails, texture variants and a bundle per asset", async () => {
      const brick = (await anon((q) => getPublicAsset(q, "demo-red-brick")))!;
      const variants = brick.files.filter((f) => f.size_variant).map((f) => f.size_variant).sort();
      expect(variants).toEqual([32, 64]);
      expect(brick.files.some((f) => f.purpose === "thumbnail" && f.format === "webp")).toBe(true);
      const bundle = brick.files.find((f) => f.purpose === "bundle")!;
      const zip = unzipSync((await storage.get("public", bundle.public_key!))!);
      expect(Object.keys(zip).sort()).toEqual([
        "demo-red-brick/LICENSE.txt",
        "demo-red-brick/README.txt",
        "demo-red-brick/files/demo-red-brick.png",
        "demo-red-brick/files/demo-red-brick_32.png",
        "demo-red-brick/files/demo-red-brick_64.png",
        "demo-red-brick/manifest.json",
      ]);
      const manifest = JSON.parse(new TextDecoder().decode(zip["demo-red-brick/manifest.json"]!));
      expect(manifest.licence.code).toBe("cc0-1.0");
      expect(manifest.files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it("records real model stats from the files", async () => {
      const crate = (await anon((q) => getPublicAsset(q, "demo-wooden-crate")))!;
      expect(crate.asset.triangle_count).toBe(60);
      expect(crate.asset.formats).toEqual(["glb"]);
      expect(crate.asset.bounds_mm).toEqual([1000, 1000, 1000]);
    });
  });

  describe("catalogue search and filters", () => {
    it("finds by full-text, prefix and typo", async () => {
      expect((await catalog({ q: "crate" })).items.map((i) => i.slug)).toContain("demo-wooden-crate");
      expect((await catalog({ q: "cra" })).items.map((i) => i.slug)).toContain("demo-wooden-crate");
      expect((await catalog({ q: "brik wal" })).items.map((i) => i.slug)).toContain("demo-brick-wall-module");
      expect((await catalog({ q: "rust" })).items.map((i) => i.slug)).toEqual(expect.arrayContaining(["demo-rusted-plate", "demo-oil-drum"]));
    });

    it("filters by type, format, triangles and tag facets", async () => {
      expect((await catalog({ type: "texture" })).total).toBe(11);
      expect((await catalog({ format: "glb" })).total).toBe(10);
      expect((await catalog({ tris: "lt-1k", type: "model" })).total).toBe(10);
      expect((await catalog({ setting: "industrial", type: "model" })).items.map((i) => i.slug)).toContain("demo-oil-drum");
      expect((await catalog({ type: "model" }, ["texture"])).total).toBe(11); // a type filter can't escape the page scope
    });

    it("reports facets from real metadata only, excluding their own filter", async () => {
      const r = await catalog({ type: "texture" });
      expect(r.facets.size.map((f) => f.value)).toEqual(["128"]);
      expect(r.facets.type.find((f) => f.value === "model")?.count).toBe(10); // counted without the type filter itself
      expect(r.facets.tris).toEqual([]);
      expect(r.facets.licence).toEqual([{ value: "cc0-1.0", label: "CC0", count: 11 }]);
    });

    it("sorts and paginates deterministically", async () => {
      const byName = await catalog({ sort: "name" });
      const names = byName.items.map((i) => i.title.toLowerCase());
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
      const page2 = await catalog({ page: "2" });
      expect(page2.items).toEqual([]);
      expect(page2.pageCount).toBe(1);
    });

    it("ignores garbage parameters instead of failing", async () => {
      const r = await catalog({ type: "nope,model", tris: "lots", page: "-4", sort: "random", format: "<script>" });
      expect(r.total).toBe(10);
    });
  });

  describe("downloads", () => {
    it("counts downloads and ignores repeated event ids", async () => {
      const crate = (await anon((q) => getPublicAsset(q, "demo-wooden-crate")))!;
      const glb = crate.files.find((f) => f.format === "glb")!;
      const d = await anon((q) => resolveDownload(q, glb.id));
      expect(await t.db.transaction((q) => recordDownload(q, d, "evt-123456"))).toBe(true);
      expect(await t.db.transaction((q) => recordDownload(q, d, "evt-123456"))).toBe(false);
      expect(await t.db.transaction((q) => recordDownload(q, d))).toBe(true);
      const after = (await anon((q) => getPublicAsset(q, "demo-wooden-crate")))!;
      expect(after.asset.download_count).toBe(2);
    });

    it("blocks downloads when the licence does not allow them", async () => {
      const [lic] = await t.db.query<{ id: string }>(
        "insert into licences (code, human_label, short_label, allows_download) values ('link-only', 'Link only', 'Link only', false) returning id",
      );
      const cone = (await anon((q) => getPublicAsset(q, "demo-traffic-cone")))!;
      await admin().asUser((q) => q.query("update assets set licence_id = $2 where id = $1", [cone.asset.id, lic!.id]));
      const glb = cone.files.find((f) => f.format === "glb")!;
      await expect(anon((q) => resolveDownload(q, glb.id))).rejects.toThrow(DownloadError);
    });

    it("unpublishing removes public copies and hides the asset", async () => {
      const lamp = (await anon((q) => getPublicAsset(q, "demo-street-lamp")))!;
      const glb = lamp.files.find((f) => f.format === "glb")!;
      await unpublishAsset(admin(), storage, lamp.asset.id);
      expect(await storage.head("public", glb.public_key!)).toBeNull();
      expect(await storage.head("private", glb.public_key!)).not.toBeNull(); // original kept
      expect(await anon((q) => getPublicAsset(q, "demo-street-lamp"))).toBeNull();
      await expect(anon((q) => resolveDownload(q, glb.id))).rejects.toThrow(DownloadError);
      await publishAsset(admin(), storage, lamp.asset.id);
      expect(await anon((q) => getPublicAsset(q, "demo-street-lamp"))).not.toBeNull();
    });
  });

  describe("publishing rules", () => {
    it("lists what is missing", async () => {
      const a = await admin().asUser((q) => createAsset(q, adminId, assetInputSchema.parse({ title: "Empty draft", assetType: "model" })));
      const err = await publishAsset(admin(), storage, a.id).catch((e) => e);
      expect(err).toBeInstanceOf(PublishError);
      const missing = (err as PublishError).checklist!.filter((c) => c.blocking && !c.ok).map((c) => c.id);
      expect(missing).toEqual(["licence", "attested", "delivery", "thumbnail"]);
    });

    it("editors cannot publish", async () => {
      const [cc0] = await t.db.query<{ id: string }>("select id from licences where code = 'cc0-1.0'");
      const a = await editor().asUser((q) => createAsset(q, editorId, assetInputSchema.parse({ title: "Editor texture", assetType: "texture", licenceId: cc0!.id })));
      const png = new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: "#777" } }).png().toBuffer());
      await editor().asUser((q) => storeAssetFile(q, storage, { assetId: a.id, purpose: "delivery", filename: "grey.png", bytes: png, primary: true }));
      await generateDerivatives(editor(), storage, a.id);
      await editor().asUser((q) => updateAsset(q, editorId, a.id, { attest: true }));
      await expect(publishAsset(editor(), storage, a.id)).rejects.toThrow();
      expect((await t.db.query<{ status: string }>("select status from assets where id = $1", [a.id]))[0]!.status).toBe("draft");
      await publishAsset(admin(), storage, a.id);
      expect((await getAssetById(t.db, a.id))!.status).toBe("published");
    });
  });

  describe("FBX upload pipeline", () => {
    it("converts FBX + texture to GLB, renders a thumbnail and records stats", async () => {
      const a = await admin().asUser((q) => createAsset(q, adminId, assetInputSchema.parse({ title: "Fixture crate", assetType: "model" })));
      await admin().asUser((q) => storeAssetFile(q, storage, { assetId: a.id, purpose: "source", filename: "crate.fbx", bytes: asciiFbxCube("crate_diffuse.png") }));
      const tex = new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 3, background: "#a06030" } }).png().toBuffer());
      await admin().asUser((q) => storeAssetFile(q, storage, { assetId: a.id, purpose: "dependency", filename: "crate_diffuse.png", bytes: tex }));
      const r = await generateDerivatives(admin(), storage, a.id);
      expect(r.warnings).toEqual([]);
      expect(r.created.map((c) => c.generated).sort()).toEqual(["fbx-to-glb", "model-thumbnail"]);
      const files = await admin().asUser((q) => listAssetFiles(q, a.id));
      const glb = files.find((f) => f.format === "glb")!;
      expect(glb).toMatchObject({ purpose: "delivery", model_triangle_count: 12, is_primary: true });
      expect((glb.metadata.model as { images: unknown[] }).images).toHaveLength(1);
      expect(files.find((f) => f.purpose === "thumbnail")?.format).toBe("webp");
      expect((await getAssetById(t.db, a.id))!.triangle_count).toBe(12);
    });

    it("warns when an FBX texture is missing instead of failing", async () => {
      const a = await admin().asUser((q) => createAsset(q, adminId, assetInputSchema.parse({ title: "Missing texture crate", assetType: "model" })));
      await admin().asUser((q) => storeAssetFile(q, storage, { assetId: a.id, purpose: "source", filename: "crate.fbx", bytes: asciiFbxCube("nowhere.png") }));
      const r = await generateDerivatives(admin(), storage, a.id);
      expect(r.warnings.join(" ")).toMatch(/nowhere\.png/);
      expect(r.created.map((c) => c.generated)).toContain("fbx-to-glb");
    });
  });

  describe("collections", () => {
    it("refuse unpublished members and include a licence notice per asset", async () => {
      const [draft] = await t.db.query<{ id: string }>("select id from assets where status = 'draft' limit 1");
      const [crate] = await t.db.query<{ id: string }>("select id from assets where slug = 'demo-wooden-crate'");
      const col = await admin().asUser((q) => createCollection(q, { title: "Mixed", summary: "", descriptionMd: "", featured: false, assetIds: [crate!.id, draft!.id] }));
      await expect(publishCollection(admin(), storage, col.id)).rejects.toThrow(/Publish these assets first/);
      const pub = await anon((q) => getPublicCollection(q, "demo-industrial-blockout-kit"));
      expect(pub!.items.length).toBeGreaterThan(5);
      const zip = unzipSync((await storage.get("public", pub!.collection.bundle_public_key!))!);
      const licences = Object.keys(zip).filter((k) => k.endsWith("/LICENSE.txt"));
      expect(licences.length).toBe(pub!.items.length);
      expect(Object.keys(zip)).toContain("demo-industrial-blockout-kit/NOTICE.txt");
    });
  });
});
