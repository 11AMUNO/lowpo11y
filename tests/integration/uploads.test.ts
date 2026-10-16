import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { completeUploadSession, createUploadSession, expireUploadSessions, UploadError } from "@/lib/assets/uploads";
import { storeAssetFile } from "@/lib/assets/files";
import { box } from "@/lib/formats/geometry";
import { writeGlb } from "@/lib/formats/glb-writer";
import { LocalFilesystemStorage } from "@/lib/storage/local";
import { audit } from "@/lib/audit";
import { asRole, createTestDb, TEST_DRIVERS, txAs, type TestDb } from "../support/db";

describe.each(TEST_DRIVERS)("upload pipeline (%s)", (driver) => {
  let t: TestDb;
  let root: string;
  let storage: LocalFilesystemStorage;
  let editor: string;
  let other: string;
  let assetId: string;
  const MAX = 10 * 1024 * 1024;
  const editorCtx = () => ({ role: "editor" as const, userId: editor });

  beforeAll(async () => {
    t = await createTestDb(driver);
    root = await mkdtemp(path.join(tmpdir(), "lp-up-"));
    storage = new LocalFilesystemStorage(root, "http://localhost:3000", "u".repeat(40));
    const users = await t.db.query<{ id: string; email: string }>(
      "insert into users (email, password_hash, display_name, role) values ('ed@x.test','x','Ed','editor'), ('o@x.test','x','O','editor') returning id, email",
    );
    editor = users.find((u) => u.email === "ed@x.test")!.id;
    other = users.find((u) => u.email === "o@x.test")!.id;
    const [a] = await t.db.query<{ id: string }>("insert into assets (slug, title, asset_type) values ('test-crate', 'Test crate', 'model') returning id");
    assetId = a!.id;
  });

  afterAll(async () => {
    await t?.cleanup();
    await rm(root, { recursive: true, force: true });
  });

  async function upload(filename: string, bytes: Uint8Array, purpose: "delivery" | "thumbnail" = "delivery", declaredSize = bytes.byteLength, actor = editor) {
    const { id } = await createUploadSession(txAs(t.db, { role: "editor", userId: actor }), storage, actor, { assetId, purpose, filename, size: declaredSize, contentType: "application/octet-stream" }, MAX);
    const [s] = await t.db.query<{ staging_key: string }>("select staging_key from upload_sessions where id = $1", [id]);
    await storage.put("private", s!.staging_key, bytes, { contentType: "application/octet-stream" }); // the browser's PUT
    return { id, stagingKey: s!.staging_key };
  }

  it("verifies a GLB, records real mesh stats and removes the staged copy", async () => {
    const glb = writeGlb({ meshes: [{ primitives: [box(1, 2, 3)] }], nodes: [{ mesh: 0 }], roots: [0] });
    const { id, stagingKey } = await upload("Crate Ünïcode.glb", glb);
    const result = await completeUploadSession(txAs(t.db, editorCtx()), storage, editor, id, { primary: true });
    expect(result.file).toMatchObject({ format: "glb", mime: "model/gltf-binary", size_bytes: glb.byteLength, model_triangle_count: 12, is_primary: true });
    expect(result.file.original_filename).toBe("Crate Ünïcode.glb");
    expect(await storage.head("private", stagingKey)).toBeNull();
    expect(await storage.head("private", result.file.storage_key)).toMatchObject({ size: glb.byteLength });
    const [s] = await t.db.query<{ status: string; result_file_id: string }>("select status, result_file_id from upload_sessions where id = $1", [id]);
    expect(s).toEqual({ status: "consumed", result_file_id: result.file.id });
  });

  it("records image dimensions and alpha for thumbnails", async () => {
    const png = await sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const { id } = await upload("thumb.png", new Uint8Array(png), "thumbnail");
    const { file, analysis } = await completeUploadSession(txAs(t.db, editorCtx()), storage, editor, id);
    expect(file).toMatchObject({ width: 64, height: 32, format: "png" });
    expect(file.metadata.hasAlpha).toBe(true);
    expect(analysis.warnings).toEqual([]);
  });

  it("deduplicates identical files by checksum", async () => {
    const glb = writeGlb({ meshes: [{ primitives: [box(1, 2, 3)] }], nodes: [{ mesh: 0 }], roots: [0] });
    const { id } = await upload("same-again.glb", glb);
    const result = await completeUploadSession(txAs(t.db, editorCtx()), storage, editor, id);
    expect(result.duplicate).toBe(true);
    const [n] = await t.db.query<{ n: number }>("select count(*)::int as n from asset_files where asset_id = $1 and purpose = 'delivery'", [assetId]);
    expect(n!.n).toBe(1);
  });

  it("rejects an executable disguised as a PNG and cleans up", async () => {
    const { id, stagingKey } = await upload("totally-a-texture.png", new TextEncoder().encode("MZ\x90\0this is a PE file"), "thumbnail");
    await expect(completeUploadSession(txAs(t.db, editorCtx()), storage, editor, id)).rejects.toThrow(UploadError);
    expect(await storage.head("private", stagingKey)).toBeNull();
    const [s] = await t.db.query<{ status: string; error: string }>("select status, error from upload_sessions where id = $1", [id]);
    expect(s!.status).toBe("failed");
  });

  it("rejects size mismatches", async () => {
    const { id } = await upload("crate.glb", new Uint8Array(10), "delivery", 999);
    await expect(completeUploadSession(txAs(t.db, editorCtx()), storage, editor, id)).rejects.toThrow(/Expected 999 bytes/);
  });

  it("rejects ZIPs containing executables", async () => {
    const zip = zipSync({ "pack/readme.txt": new TextEncoder().encode("hi"), "pack/install.exe": new TextEncoder().encode("MZ") });
    const { id } = await upload("pack.zip", zip);
    await expect(completeUploadSession(txAs(t.db, editorCtx()), storage, editor, id)).rejects.toThrow(/install\.exe/);
  });

  it("refuses disallowed extensions before issuing an upload URL", async () => {
    await expect(
      createUploadSession(txAs(t.db, editorCtx()), storage, editor, { assetId, purpose: "thumbnail", filename: "model.glb", size: 10, contentType: "model/gltf-binary" }, MAX),
    ).rejects.toThrow(/can't be uploaded as thumbnail/);
    await expect(
      createUploadSession(txAs(t.db, editorCtx()), storage, editor, { assetId, purpose: "delivery", filename: "big.glb", size: MAX + 1, contentType: "model/gltf-binary" }, MAX),
    ).rejects.toThrow(/MB or smaller/);
  });

  it("does not let one staff member complete another's upload", async () => {
    const { id } = await upload("theirs.glb", new Uint8Array(4), "delivery", 4, other);
    await expect(completeUploadSession(txAs(t.db, editorCtx()), storage, editor, id)).rejects.toThrow(/not found/);
  });

  it("anonymous requests cannot see the asset, so cannot start uploads", async () => {
    await expect(
      createUploadSession(txAs(t.db, { role: "anon" }), storage, editor, { assetId, purpose: "delivery", filename: "x.glb", size: 4, contentType: "model/gltf-binary" }, MAX),
    ).rejects.toThrow(/Asset not found/);
  });

  it("expires stale sessions and deletes their staged bytes", async () => {
    const { id, stagingKey } = await upload("stale.glb", new Uint8Array(4));
    await t.db.query("update upload_sessions set expires_at = now() - interval '1 minute' where id = $1", [id]);
    expect(await expireUploadSessions(t.db, storage)).toBeGreaterThanOrEqual(1);
    expect(await storage.head("private", stagingKey)).toBeNull();
  });

  it("writes redacted audit entries", async () => {
    await asRole(t.db, editorCtx(), (uq) => audit(uq, editor, "asset.file.add", "asset", assetId, { filename: "x.glb", uploadUrl: "https://secret", nested: { a: 1 } }));
    const [row] = await t.db.query<{ details: Record<string, unknown> }>("select details from audit_log where action = 'asset.file.add'");
    expect(row!.details).toEqual({ filename: "x.glb", uploadUrl: "[redacted]", nested: "[object]" });
  });

  it("server-side ingest (bulk import path) stores files directly", async () => {
    const png = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#808080" } }).png().toBuffer();
    const r = await asRole(t.db, editorCtx(), (uq) => storeAssetFile(uq, storage, { assetId, purpose: "thumbnail", filename: "grey.png", bytes: new Uint8Array(png) }));
    expect(r.file.width).toBe(128);
  });
});
