import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyToken } from "@/lib/auth/tokens";
import { assertSafeKey, contentDisposition, keys, safeFilename } from "./keys";
import { LocalFilesystemStorage } from "./local";

const A = "11111111-1111-4111-8111-111111111111";
const F = "22222222-2222-4222-8222-222222222222";

describe("storage keys", () => {
  it("builds keys only from ids", () => {
    expect(keys.assetFile(A, "delivery", F, "GLB")).toBe(`assets/${A}/delivery/${F}.glb`);
    expect(keys.staging(F)).toBe(`staging/${F}/incoming`);
    expect(() => keys.assetFile("../../etc", "delivery", F, "glb")).toThrow();
    expect(() => keys.assetFile(A, "../x", F, "glb")).toThrow();
    expect(() => keys.assetFile(A, "delivery", F, "g/b")).toThrow();
  });

  it("rejects unsafe raw keys", () => {
    for (const k of ["../x", "/abs", "a//b", "a/../b", "UPPER", "a\\b", ""]) expect(() => assertSafeKey(k), k).toThrow();
    expect(() => assertSafeKey(`assets/${A}/delivery/${F}.glb`)).not.toThrow();
  });

  it("sanitises download filenames including Unicode", () => {
    expect(safeFilename('../../evil"name.png')).toBe("evil_name.png");
    expect(safeFilename("...")).toBe("file");
    expect(safeFilename("Ünïcödé crate.glb")).toBe("Ünïcödé crate.glb");
    expect(contentDisposition("Ünïcödé crate.glb")).toContain("filename*=UTF-8''%C3%9Cn%C3%AFc%C3%B6d%C3%A9%20crate.glb");
  });
});

describe("LocalFilesystemStorage", () => {
  let root: string;
  let storage: LocalFilesystemStorage;
  const secret = "k".repeat(40);

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "lp-storage-"));
    storage = new LocalFilesystemStorage(root, "http://localhost:3000", secret);
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  it("puts, heads, gets, copies across buckets and deletes", async () => {
    const key = `assets/${A}/delivery/${F}.glb`;
    await storage.put("private", key, new Uint8Array([1, 2, 3]), { contentType: "model/gltf-binary", downloadName: "crate.glb" });
    expect(await storage.head("private", key)).toMatchObject({ size: 3, contentType: "model/gltf-binary" });
    expect(await storage.get("public", key)).toBeNull();
    await storage.copy({ bucket: "private", key }, { bucket: "public", key }, { contentType: "model/gltf-binary" });
    expect(Array.from((await storage.get("public", key))!)).toEqual([1, 2, 3]);
    await storage.delete("public", key);
    expect(await storage.head("public", key)).toBeNull();
    expect(await storage.head("private", key)).not.toBeNull();
  });

  it("issues signed upload URLs bound to key, type and size", async () => {
    const target = await storage.createUploadUrl(keys.staging(F), { contentType: "image/png", contentLength: 99, expiresInSeconds: 60 });
    const token = new URL(target.url).searchParams.get("token")!;
    expect(verifyToken<{ key: string; ct: string; len: number; exp: number }>(token, secret, "upload")).toMatchObject({
      key: `staging/${F}/incoming`,
      ct: "image/png",
      len: 99,
    });
    expect(target.headers["Content-Type"]).toBe("image/png");
  });

  it("serves published objects from /files and private ones only via signed URLs", async () => {
    expect(storage.publicUrl(`assets/${A}/thumbnail/${F}.webp`)).toBe(`/files/assets/${A}/thumbnail/${F}.webp`);
    const url = await storage.signedGetUrl("private", `assets/${A}/source/${F}.blend`, { expiresInSeconds: 60 });
    expect(url.startsWith("/api/storage/object?token=")).toBe(true);
  });
});
