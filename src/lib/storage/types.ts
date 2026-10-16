/**
 * Object storage abstraction (docs/decisions/0004).
 * - "private": staging uploads, sources, everything unpublished. Never public.
 * - "public": copies of published files, served from the public base URL.
 */
export type Bucket = "private" | "public";

export interface PutOptions {
  contentType: string;
  /** Suggested download filename (Content-Disposition: attachment). */
  downloadName?: string;
  cacheControl?: string;
}

export interface ObjectInfo {
  size: number;
  contentType?: string;
  etag?: string;
}

export interface UploadTarget {
  url: string;
  method: "PUT";
  /** Headers the client must send with the upload (they are part of the signature). */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface AssetStorage {
  readonly provider: "local" | "r2";
  put(bucket: Bucket, key: string, body: Uint8Array, opts: PutOptions): Promise<void>;
  get(bucket: Bucket, key: string): Promise<Uint8Array | null>;
  head(bucket: Bucket, key: string): Promise<ObjectInfo | null>;
  delete(bucket: Bucket, key: string): Promise<void>;
  copy(from: { bucket: Bucket; key: string }, to: { bucket: Bucket; key: string }, opts: PutOptions): Promise<void>;
  /** Short-lived URL the browser can PUT one file to (always the private bucket). */
  createUploadUrl(key: string, opts: { contentType: string; contentLength: number; expiresInSeconds: number }): Promise<UploadTarget>;
  /** Stable URL for a published object in the public bucket. */
  publicUrl(key: string): string;
  /** Short-lived URL to read a private object (admin previews). */
  signedGetUrl(bucket: Bucket, key: string, opts: { expiresInSeconds: number; downloadName?: string }): Promise<string>;
}

export class StorageError extends Error {}
