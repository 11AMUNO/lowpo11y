import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { signToken } from "@/lib/auth/tokens";
import { assertSafeKey, contentDisposition } from "./keys";
import type { AssetStorage, Bucket, ObjectInfo, PutOptions, UploadTarget } from "./types";

interface Meta {
  contentType: string;
  downloadName?: string;
  cacheControl?: string;
}

/**
 * Filesystem storage for development and tests. Layout:
 *   <root>/<bucket>/<key>          object bytes
 *   <root>/<bucket>/<key>.meta.json content type + download name
 * Upload and private-download URLs are HMAC-signed tokens verified by
 * /api/storage/upload and /api/storage/object, mirroring R2 presigned URLs.
 */
export class LocalFilesystemStorage implements AssetStorage {
  readonly provider = "local" as const;

  constructor(
    private readonly root: string,
    private readonly appUrl: string,
    private readonly secret: string,
  ) {}

  private file(bucket: Bucket, key: string) {
    assertSafeKey(key);
    return path.join(this.root, bucket, ...key.split("/"));
  }

  async put(bucket: Bucket, key: string, body: Uint8Array, opts: PutOptions) {
    const file = this.file(bucket, key);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, file);
    const meta: Meta = { contentType: opts.contentType, downloadName: opts.downloadName, cacheControl: opts.cacheControl };
    await writeFile(`${file}.meta.json`, JSON.stringify(meta));
  }

  async get(bucket: Bucket, key: string) {
    try {
      return new Uint8Array(await readFile(this.file(bucket, key)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async meta(bucket: Bucket, key: string): Promise<Meta | null> {
    try {
      return JSON.parse(await readFile(`${this.file(bucket, key)}.meta.json`, "utf8")) as Meta;
    } catch {
      return null;
    }
  }

  async head(bucket: Bucket, key: string): Promise<ObjectInfo | null> {
    try {
      const s = await stat(this.file(bucket, key));
      const meta = await this.meta(bucket, key);
      return { size: s.size, contentType: meta?.contentType, etag: `"${s.size.toString(16)}-${s.mtimeMs.toString(16)}"` };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async delete(bucket: Bucket, key: string) {
    const file = this.file(bucket, key);
    await rm(file, { force: true });
    await rm(`${file}.meta.json`, { force: true });
  }

  async copy(from: { bucket: Bucket; key: string }, to: { bucket: Bucket; key: string }, opts: PutOptions) {
    const body = await this.get(from.bucket, from.key);
    if (!body) throw new Error(`Object not found: ${from.bucket}/${from.key}`);
    await this.put(to.bucket, to.key, body, opts);
  }

  async createUploadUrl(key: string, opts: { contentType: string; contentLength: number; expiresInSeconds: number }): Promise<UploadTarget> {
    assertSafeKey(key);
    const exp = Math.floor(Date.now() / 1000) + opts.expiresInSeconds;
    const token = signToken({ key, ct: opts.contentType, len: opts.contentLength, exp }, this.secret, "upload");
    return {
      url: new URL(`/api/storage/upload?token=${encodeURIComponent(token)}`, this.appUrl).toString(),
      method: "PUT",
      headers: { "Content-Type": opts.contentType },
      expiresAt: new Date(exp * 1000),
    };
  }

  publicUrl(key: string) {
    assertSafeKey(key);
    return `/files/${key}`;
  }

  async signedGetUrl(bucket: Bucket, key: string, opts: { expiresInSeconds: number; downloadName?: string }) {
    assertSafeKey(key);
    const exp = Math.floor(Date.now() / 1000) + opts.expiresInSeconds;
    const token = signToken({ b: bucket, key, dn: opts.downloadName, exp }, this.secret, "object");
    return `/api/storage/object?token=${encodeURIComponent(token)}`;
  }

  static etagFor(body: Uint8Array) {
    return `"${createHash("sha1").update(body).digest("hex")}"`;
  }

  static disposition = contentDisposition;
}
