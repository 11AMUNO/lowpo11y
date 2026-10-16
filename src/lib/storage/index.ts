import path from "node:path";
import { env } from "@/lib/env";
import { LocalFilesystemStorage } from "./local";
import { R2Storage } from "./r2";
import type { AssetStorage } from "./types";

export type { AssetStorage, Bucket, ObjectInfo, PutOptions, UploadTarget } from "./types";
export { keys, safeFilename, contentDisposition } from "./keys";

const g = globalThis as unknown as { __lpStorage?: AssetStorage; __lpStorageOverride?: AssetStorage };

export function getStorage(): AssetStorage {
  if (g.__lpStorageOverride) return g.__lpStorageOverride;
  if (g.__lpStorage) return g.__lpStorage;
  const e = env();
  g.__lpStorage =
    e.STORAGE_PROVIDER === "r2"
      ? new R2Storage({
          accountId: e.R2_ACCOUNT_ID,
          endpoint: e.R2_ENDPOINT,
          accessKeyId: e.R2_ACCESS_KEY_ID!,
          secretAccessKey: e.R2_SECRET_ACCESS_KEY!,
          privateBucket: e.R2_PRIVATE_BUCKET!,
          publicBucket: e.R2_PUBLIC_BUCKET,
          publicBaseUrl: e.R2_PUBLIC_BASE_URL,
        })
      : new LocalFilesystemStorage(path.join(e.dataDir, "storage"), e.NEXT_PUBLIC_APP_URL, e.APP_SECRET);
  return g.__lpStorage;
}

export function setStorageForTests(storage: AssetStorage | undefined) {
  g.__lpStorageOverride = storage;
}

/** Long cache for immutable, id-keyed published objects. */
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
