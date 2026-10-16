import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { assertSafeKey, contentDisposition } from "./keys";
import type { AssetStorage, Bucket, ObjectInfo, PutOptions, UploadTarget } from "./types";

export interface R2Config {
  accountId?: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  privateBucket: string;
  /** Optional second bucket with public access via a custom domain. */
  publicBucket?: string;
  publicBaseUrl?: string;
}

/**
 * Cloudflare R2 through its S3-compatible API. Signed operations use the
 * account endpoint; published files are served from the public bucket's
 * custom domain. With a single bucket, "public" objects live under a
 * `public/` prefix of the private bucket and are served via short-lived
 * signed redirects from /files/... (no CDN caching) — see DEPLOYMENT.md.
 */
export class R2Storage implements AssetStorage {
  readonly provider = "r2" as const;
  private readonly client: S3Client;

  constructor(private readonly cfg: R2Config) {
    this.client = new S3Client({
      region: "auto",
      endpoint: cfg.endpoint ?? `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      forcePathStyle: !!cfg.endpoint,
    });
  }

  get singleBucket() {
    return !this.cfg.publicBucket;
  }

  private loc(bucket: Bucket, key: string) {
    assertSafeKey(key);
    if (bucket === "public" && this.cfg.publicBucket) return { Bucket: this.cfg.publicBucket, Key: key };
    return { Bucket: this.cfg.privateBucket, Key: bucket === "public" ? `public/${key}` : key };
  }

  async put(bucket: Bucket, key: string, body: Uint8Array, opts: PutOptions) {
    await this.client.send(
      new PutObjectCommand({
        ...this.loc(bucket, key),
        Body: body,
        ContentType: opts.contentType,
        ContentDisposition: opts.downloadName ? contentDisposition(opts.downloadName) : undefined,
        CacheControl: opts.cacheControl,
      }),
    );
  }

  async get(bucket: Bucket, key: string) {
    try {
      const res = await this.client.send(new GetObjectCommand(this.loc(bucket, key)));
      return res.Body ? new Uint8Array(await res.Body.transformToByteArray()) : null;
    } catch (e) {
      if (e instanceof S3ServiceException && (e.name === "NoSuchKey" || e.$metadata.httpStatusCode === 404)) return null;
      throw e;
    }
  }

  async head(bucket: Bucket, key: string): Promise<ObjectInfo | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand(this.loc(bucket, key)));
      return { size: Number(res.ContentLength ?? 0), contentType: res.ContentType, etag: res.ETag };
    } catch (e) {
      if (e instanceof S3ServiceException && (e.name === "NotFound" || e.$metadata.httpStatusCode === 404)) return null;
      throw e;
    }
  }

  async delete(bucket: Bucket, key: string) {
    await this.client.send(new DeleteObjectCommand(this.loc(bucket, key)));
  }

  async copy(from: { bucket: Bucket; key: string }, to: { bucket: Bucket; key: string }, opts: PutOptions) {
    const src = this.loc(from.bucket, from.key);
    await this.client.send(
      new CopyObjectCommand({
        ...this.loc(to.bucket, to.key),
        CopySource: `${src.Bucket}/${encodeURIComponent(src.Key).replace(/%2F/g, "/")}`,
        MetadataDirective: "REPLACE",
        ContentType: opts.contentType,
        ContentDisposition: opts.downloadName ? contentDisposition(opts.downloadName) : undefined,
        CacheControl: opts.cacheControl,
      }),
    );
  }

  async createUploadUrl(key: string, opts: { contentType: string; contentLength: number; expiresInSeconds: number }): Promise<UploadTarget> {
    const command = new PutObjectCommand({ ...this.loc("private", key), ContentType: opts.contentType, ContentLength: opts.contentLength });
    // content-type and content-length are signed, so the upload must match exactly.
    const url = await getSignedUrl(this.client, command, {
      expiresIn: opts.expiresInSeconds,
      signableHeaders: new Set(["content-type", "content-length"]),
    });
    return { url, method: "PUT", headers: { "Content-Type": opts.contentType }, expiresAt: new Date(Date.now() + opts.expiresInSeconds * 1000) };
  }

  publicUrl(key: string) {
    assertSafeKey(key);
    if (this.cfg.publicBucket && this.cfg.publicBaseUrl) return `${this.cfg.publicBaseUrl.replace(/\/$/, "")}/${key}`;
    return `/files/${key}`;
  }

  async signedGetUrl(bucket: Bucket, key: string, opts: { expiresInSeconds: number; downloadName?: string }) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        ...this.loc(bucket, key),
        ResponseContentDisposition: opts.downloadName ? contentDisposition(opts.downloadName) : undefined,
      }),
      { expiresIn: opts.expiresInSeconds },
    );
  }
}
