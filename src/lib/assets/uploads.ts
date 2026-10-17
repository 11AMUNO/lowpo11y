import { randomUUID } from "node:crypto";
import { z } from "@/lib/zod";
import type { Queryable, Tx } from "@/lib/db";
import { keys, type AssetStorage, type UploadTarget } from "@/lib/storage";
import { ALLOWED_FORMATS, extensionOf } from "@/lib/validation/file-types";
import { storeAssetFile, FileRejectedError, type StoreFileResult } from "./files";

export const UPLOAD_TTL_SECONDS = 15 * 60;

export const createUploadSchema = z.object({
  assetId: z.uuid(),
  purpose: z.enum(["source", "delivery", "thumbnail", "preview", "dependency"]),
  filename: z.string().trim().min(1).max(200),
  size: z.number().int().positive(),
  contentType: z
    .string()
    .max(100)
    .regex(/^[\w.+-]+\/[\w.+-]+$/)
    .default("application/octet-stream"),
});
export type CreateUploadInput = z.infer<typeof createUploadSchema>;

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface UploadSessionRow {
  id: string;
  actor_id: string;
  target_type: string;
  target_id: string;
  purpose: CreateUploadInput["purpose"];
  staging_key: string;
  original_filename: string;
  declared_mime: string;
  declared_size: number;
  status: string;
  expires_at: Date;
}

// Format names as detected from content, keyed by the extensions that produce them.
const EXT_ALIASES: Record<string, string> = { jpeg: "jpg" };

/**
 * Step 1: a staff member asks to upload one file to an asset. The asset
 * lookup runs under the actor's RLS context (proving they can see it);
 * session bookkeeping runs as the service.
 */
export async function createUploadSession(
  tx: Tx,
  storage: AssetStorage,
  actorId: string,
  input: CreateUploadInput,
  maxBytes: number,
): Promise<{ id: string; upload: UploadTarget }> {
  if (input.size > maxBytes) throw new UploadError(`Files must be ${Math.floor(maxBytes / 1024 / 1024)} MB or smaller.`, 413);
  const ext = EXT_ALIASES[extensionOf(input.filename)] ?? extensionOf(input.filename);
  if (!ext || !ALLOWED_FORMATS[input.purpose].includes(ext)) {
    throw new UploadError(`.${ext || "?"} files can't be uploaded as ${input.purpose}. Allowed: ${ALLOWED_FORMATS[input.purpose].join(", ")}.`);
  }
  const [asset] = await tx.asUser((q) =>
    q.query<{ id: string; status: string }>("select id, status from assets where id = $1 and deleted_at is null", [input.assetId]),
  );
  if (!asset) throw new UploadError("Asset not found.", 404);

  const id = randomUUID();
  const stagingKey = keys.staging(id);
  await tx.asService((q) => q.query(
    `insert into upload_sessions (id, actor_id, target_type, target_id, purpose, staging_key, original_filename, declared_mime, declared_size, expires_at)
     values ($1, $2, 'asset', $3, $4, $5, $6, $7, $8, now() + ($9 || ' seconds')::interval)`,
    [id, actorId, input.assetId, input.purpose, stagingKey, input.filename, input.contentType, input.size, String(UPLOAD_TTL_SECONDS)],
  ));
  const upload = await storage.createUploadUrl(stagingKey, {
    contentType: input.contentType,
    contentLength: input.size,
    expiresInSeconds: UPLOAD_TTL_SECONDS,
  });
  return { id, upload };
}

/**
 * Step 3 (after the browser PUT the bytes): verify the staged object and file
 * it under the asset. Failures mark the session failed and delete the staged
 * object; nothing unverified is ever kept.
 */
export async function completeUploadSession(
  tx: Tx,
  storage: AssetStorage,
  actorId: string,
  sessionId: string,
  opts: { primary?: boolean } = {},
): Promise<StoreFileResult> {
  const [s] = await tx.asService((q) => q.query<UploadSessionRow>("select * from upload_sessions where id = $1", [sessionId]));
  if (!s || s.actor_id !== actorId) throw new UploadError("Upload not found.", 404);
  if (s.status !== "pending") throw new UploadError(`This upload is already ${s.status}.`, 409);

  const fail = async (message: string, status = 422): Promise<never> => {
    await tx.asService((q) => q.query("update upload_sessions set status = 'failed', error = $2, completed_at = now() where id = $1", [s.id, message.slice(0, 1000)]));
    await storage.delete("private", s.staging_key).catch(() => {});
    throw new UploadError(message, status);
  };

  if (new Date(s.expires_at).getTime() < Date.now()) return fail("This upload expired. Start it again.", 410);
  const head = await storage.head("private", s.staging_key);
  if (!head) return fail("The file never arrived in storage. Check your connection and try again.");
  if (head.size !== Number(s.declared_size)) return fail(`Expected ${s.declared_size} bytes but received ${head.size}.`);
  const bytes = await storage.get("private", s.staging_key);
  if (!bytes) return fail("The staged file could not be read.");

  let result: StoreFileResult;
  try {
    result = await tx.asUser((q) =>
      storeAssetFile(q, storage, {
        assetId: s.target_id,
        purpose: s.purpose,
        filename: s.original_filename,
        bytes,
        primary: opts.primary,
      }),
    );
  } catch (e) {
    if (e instanceof FileRejectedError) return fail(e.message);
    throw e;
  }
  await storage.delete("private", s.staging_key).catch(() => {});
  await tx.asService((q) =>
    q.query(
      `update upload_sessions set status = 'consumed', sha256 = $2, detected_format = $3, result_file_id = $4, completed_at = now() where id = $1`,
      [s.id, result.file.sha256, result.file.format, result.file.id],
    ),
  );
  return result;
}

/** Housekeeping: expire stale sessions and remove their staged objects. */
export async function expireUploadSessions(serviceQ: Queryable, storage: AssetStorage): Promise<number> {
  const stale = await serviceQ.query<{ id: string; staging_key: string }>(
    "update upload_sessions set status = 'expired' where status = 'pending' and expires_at < now() returning id, staging_key",
  );
  for (const s of stale) await storage.delete("private", s.staging_key).catch(() => {});
  return stale.length;
}
