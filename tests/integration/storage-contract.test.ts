import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keys } from "@/lib/storage/keys";
import { LocalFilesystemStorage } from "@/lib/storage/local";
import { R2Storage } from "@/lib/storage/r2";
import type { AssetStorage } from "@/lib/storage/types";

/**
 * Behaviour every AssetStorage adapter must share. The R2 adapter runs
 * against any S3-compatible server when TEST_S3_ENDPOINT is set (CI and local
 * runs use moto; see docs/IMPLEMENTATION_STATUS.md).
 */
const S3 = process.env.TEST_S3_ENDPOINT;
const A = "33333333-3333-4333-8333-333333333333";
const F = "44444444-4444-4444-8444-444444444444";

type Factory = { name: string; make: () => Promise<{ storage: AssetStorage; cleanup: () => Promise<void> }> };

const factories: Factory[] = [
  {
    name: "local",
    make: async () => {
      const root = await mkdtemp(path.join(tmpdir(), "lp-contract-"));
      return { storage: new LocalFilesystemStorage(root, "http://localhost:3000", "c".repeat(40)), cleanup: () => rm(root, { recursive: true, force: true }) };
    },
  },
];

if (S3) {
  for (const mode of ["two-buckets", "single-bucket"] as const) {
    factories.push({
      name: `r2 (${mode})`,
      make: async () => {
        const suffix = Math.random().toString(36).slice(2, 8);
        const client = new S3Client({ region: "auto", endpoint: S3, forcePathStyle: true, credentials: { accessKeyId: "test", secretAccessKey: "test" } });
        const priv = `lp-private-${suffix}`;
        const pub = `lp-public-${suffix}`;
        await client.send(new CreateBucketCommand({ Bucket: priv }));
        if (mode === "two-buckets") await client.send(new CreateBucketCommand({ Bucket: pub }));
        const storage = new R2Storage({
          endpoint: S3,
          accessKeyId: "test",
          secretAccessKey: "test",
          privateBucket: priv,
          publicBucket: mode === "two-buckets" ? pub : undefined,
          publicBaseUrl: mode === "two-buckets" ? "https://files.example.test" : undefined,
        });
        return { storage, cleanup: async () => {} };
      },
    });
  }
}

describe.each(factories)("AssetStorage contract: $name", ({ make }) => {
  let storage: AssetStorage;
  let cleanup: () => Promise<void>;
  const key = keys.assetFile(A, "delivery", F, "glb");

  beforeAll(async () => {
    ({ storage, cleanup } = await make());
  });
  afterAll(() => cleanup());

  it("round-trips bytes and metadata", async () => {
    await storage.put("private", key, new Uint8Array([9, 8, 7, 6]), { contentType: "model/gltf-binary", downloadName: "Crate Ü.glb" });
    expect(await storage.head("private", key)).toMatchObject({ size: 4, contentType: "model/gltf-binary" });
    expect(Array.from((await storage.get("private", key))!)).toEqual([9, 8, 7, 6]);
  });

  it("keeps the buckets separate", async () => {
    expect(await storage.get("public", key)).toBeNull();
    expect(await storage.head("public", key)).toBeNull();
  });

  it("copies between buckets and deletes", async () => {
    await storage.copy({ bucket: "private", key }, { bucket: "public", key }, { contentType: "model/gltf-binary" });
    expect(await storage.head("public", key)).toMatchObject({ size: 4 });
    await storage.delete("public", key);
    expect(await storage.head("public", key)).toBeNull();
    expect(await storage.head("private", key)).toMatchObject({ size: 4 });
  });

  it("returns null for missing objects instead of throwing", async () => {
    expect(await storage.get("private", keys.staging(F))).toBeNull();
    expect(await storage.head("private", keys.staging(F))).toBeNull();
    await storage.delete("private", keys.staging(F)); // idempotent
  });

  it("refuses unsafe keys", async () => {
    await expect(storage.put("private", "../escape", new Uint8Array(1), { contentType: "text/plain" })).rejects.toThrow();
  });

  it("issues a usable upload URL for the staging key", async () => {
    const stagingKey = keys.staging(F);
    const bytes = new TextEncoder().encode("hello upload");
    const target = await storage.createUploadUrl(stagingKey, { contentType: "text/plain", contentLength: bytes.byteLength, expiresInSeconds: 60 });
    expect(target.method).toBe("PUT");
    expect(target.headers["Content-Type"]).toBe("text/plain");
    if (storage.provider === "r2") {
      const url = new URL(target.url);
      expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
      const res = await fetch(target.url, { method: "PUT", headers: target.headers, body: bytes });
      expect(res.ok).toBe(true);
      expect(await storage.head("private", stagingKey)).toMatchObject({ size: bytes.byteLength });
    } else {
      expect(target.url).toContain("/api/storage/upload?token=");
    }
  });

  it("issues signed reads for private objects and stable public URLs", async () => {
    const signed = await storage.signedGetUrl("private", key, { expiresInSeconds: 60, downloadName: "crate.glb" });
    if (storage.provider === "r2") {
      const res = await fetch(signed);
      expect(res.ok).toBe(true);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7, 6]));
    } else {
      expect(signed.startsWith("/api/storage/object?token=")).toBe(true);
    }
    const pub = storage.publicUrl(key);
    expect(pub.endsWith(key)).toBe(true);
  });
});
