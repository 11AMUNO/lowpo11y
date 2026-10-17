import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { LicenceInfo } from "@/lib/assets/bundle";
import { UPLOAD_TTL_SECONDS, UploadError, type UploadSessionRow } from "@/lib/assets/uploads";
import type { Tx } from "@/lib/db";
import { IMMUTABLE_CACHE, keys, safeFilename, type AssetStorage, type UploadTarget } from "@/lib/storage";
import { looksExecutable } from "@/lib/validation/file-types";
import { unzipSync } from "fflate";
import { buildShaderBundle } from "./bundles";
import { setContentStatus, type ContentRow } from "./repository";

/**
 * Files for shaders and starter projects. Shaders publish a bundle built
 * from their code; starter projects upload a ZIP (signed upload to staging,
 * verified, then kept privately) that is copied to the public bucket when
 * published and removed from it when unpublished.
 */

export const starterUploadSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  size: z.number().int().positive(),
  contentType: z
    .string()
    .max(100)
    .regex(/^[\w.+-]+\/[\w.+-]+$/)
    .default("application/zip"),
});

// Project archives may contain source code (.js, .gd, .cs…) but never binaries or OS scripts.
const BLOCKED_IN_PROJECTS = /\.(exe|dll|so|dylib|bat|cmd|com|msi|scr|ps1|vbs|jar|apk|app|sh|bash|zsh|command|cpl|lnk|reg|hta|wsf)$/i;

export function inspectProjectZip(b: Uint8Array): string[] {
  const problems: string[] = [];
  const names: string[] = [];
  try {
    unzipSync(b, {
      filter: (f) => {
        names.push(f.name);
        return false;
      },
    });
  } catch {
    return ["The file isn't a readable ZIP archive."];
  }
  if (!names.length) problems.push("The ZIP is empty.");
  if (names.length > 20_000) problems.push(`The ZIP has ${names.length} entries; the limit is 20,000.`);
  for (const n of names) {
    if (n.startsWith("/") || n.includes("..") || /^[a-z]:/i.test(n) || n.includes("\\")) problems.push(`Unsafe path in ZIP: ${n}`);
    if (BLOCKED_IN_PROJECTS.test(n)) problems.push(`Binaries and shell scripts aren't allowed in projects: ${n}`);
  }
  return problems.slice(0, 20);
}

export async function createStarterUpload(tx: Tx, storage: AssetStorage, actorId: string, starterId: string, input: z.infer<typeof starterUploadSchema>, maxBytes: number): Promise<{ id: string; upload: UploadTarget }> {
  if (input.size > maxBytes) throw new UploadError(`Files must be ${Math.floor(maxBytes / 1024 / 1024)} MB or smaller.`, 413);
  if (!/\.zip$/i.test(input.filename)) throw new UploadError("Starter projects are uploaded as a .zip file.");
  const [row] = await tx.asUser((q) => q.query<{ id: string }>("select id from starter_projects where id = $1 and deleted_at is null", [starterId]));
  if (!row) throw new UploadError("Starter project not found.", 404);
  const id = randomUUID();
  const stagingKey = keys.staging(id);
  await tx.asService((q) =>
    q.query(
      `insert into upload_sessions (id, actor_id, target_type, target_id, staging_key, original_filename, declared_mime, declared_size, expires_at)
       values ($1, $2, 'starter', $3, $4, $5, $6, $7, now() + ($8 || ' seconds')::interval)`,
      [id, actorId, starterId, stagingKey, input.filename, input.contentType, input.size, String(UPLOAD_TTL_SECONDS)],
    ),
  );
  const upload = await storage.createUploadUrl(stagingKey, { contentType: input.contentType, contentLength: input.size, expiresInSeconds: UPLOAD_TTL_SECONDS });
  return { id, upload };
}

/** Verifies the staged ZIP and files it, privately, on the starter project. */
export async function completeStarterUpload(tx: Tx, storage: AssetStorage, actorId: string, sessionId: string): Promise<ContentRow> {
  const [s] = await tx.asService((q) => q.query<UploadSessionRow>("select * from upload_sessions where id = $1", [sessionId]));
  if (!s || s.actor_id !== actorId || s.target_type !== "starter") throw new UploadError("Upload not found.", 404);
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
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || looksExecutable(bytes)) return fail("That file isn't a ZIP archive.");
  const problems = inspectProjectZip(bytes);
  if (problems.length) return fail(problems.join(" "));

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const key = keys.resourceFile("starters", s.target_id, randomUUID(), "zip");
  await storage.put("private", key, bytes, { contentType: "application/zip" });
  const [prev] = await tx.asUser((q) => q.query<{ file_key: string | null }>("select file_key from starter_projects where id = $1", [s.target_id]));
  const [row] = await tx.asUser((q) =>
    q.query<ContentRow>("update starter_projects set file_key = $2, file_name = $3, file_size_bytes = $4, file_sha256 = $5, updated_at = now() where id = $1 returning *", [
      s.target_id,
      key,
      safeFilename(s.original_filename, "project.zip"),
      bytes.byteLength,
      sha256,
    ]),
  );
  if (!row) {
    await storage.delete("private", key).catch(() => {});
    return fail("Your role can't change this starter project.", 403);
  }
  if (prev?.file_key && prev.file_key !== key) await storage.delete("private", prev.file_key).catch(() => {});
  await storage.delete("private", s.staging_key).catch(() => {});
  await tx.asService((q) => q.query("update upload_sessions set status = 'consumed', sha256 = $2, detected_format = 'zip', completed_at = now() where id = $1", [s.id, sha256]));
  return row;
}

async function licenceOf(tx: Tx, id: string | null): Promise<LicenceInfo | null> {
  if (!id) return null;
  const [l] = await tx.asService((q) => q.query<LicenceInfo>("select * from licences where id = $1", [id]));
  return l ?? null;
}

/**
 * Publishes a shader or starter project: writes its public download
 * (a bundle built from the shader's code, or the starter's ZIP), then flips
 * the status. If the database refuses (rules not met), the new public file
 * is removed again. The previous public file is removed on success.
 */
export async function publishWithFile(tx: Tx, storage: AssetStorage, kind: "shader" | "starter", id: string, siteUrl: string): Promise<ContentRow> {
  const table = kind === "shader" ? "shader_resources" : "starter_projects";
  const [row] = await tx.asUser((q) => q.query<ContentRow>(`select * from ${table} where id = $1 and deleted_at is null`, [id]));
  if (!row) throw new UploadError("Not found.", 404);
  let bytes: Uint8Array | null = null;
  let copyFrom: string | null = null;
  let filename = "";
  if (kind === "shader" && row.code && String(row.code).trim()) {
    const licence = await licenceOf(tx, row.licence_id);
    if (licence && row.tested_at) {
      bytes = buildShaderBundle(
        {
          slug: row.slug,
          title: row.title,
          summary: row.summary,
          engine: row.engine,
          engine_version_min: row.engine_version_min,
          engine_version_max: row.engine_version_max,
          renderer_compatibility: row.renderer_compatibility,
          explanation_md: row.explanation_md,
          setup_md: row.setup_md,
          limitations_md: row.limitations_md,
          changelog_md: row.changelog_md,
          code: row.code,
          code_language: row.code_language,
          source_url: row.source_url,
          tested_at: row.tested_at,
          tested_notes: row.tested_notes,
          url: `${siteUrl}/shaders/${row.slug}`,
          publishedAt: row.published_at ? new Date(row.published_at) : new Date(),
        },
        licence,
      );
      filename = `${row.slug}.zip`;
    }
  } else if (row.file_key) {
    copyFrom = row.file_key;
    filename = row.file_name ?? `${row.slug}.zip`;
  }
  let publicKey: string | null = null;
  if (bytes || copyFrom) {
    publicKey = keys.resourceFile(kind === "shader" ? "shaders" : "starters", id, randomUUID(), "zip");
    const opts = { contentType: "application/zip", cacheControl: IMMUTABLE_CACHE, downloadName: filename };
    if (bytes) await storage.put("public", publicKey, bytes, opts);
    else await storage.copy({ bucket: "private", key: copyFrom! }, { bucket: "public", key: publicKey }, opts);
  }
  try {
    const sha = bytes ? createHash("sha256").update(bytes).digest("hex") : null;
    if (publicKey)
      await tx.asUser((q) =>
        q.query(`update ${table} set file_public_key = $2${kind === "shader" ? ", file_name = $3, file_size_bytes = $4, file_sha256 = $5" : ""} where id = $1`, kind === "shader" ? [id, publicKey, filename, bytes!.byteLength, sha] : [id, publicKey]),
      );
    const published = await tx.asUser((q) => setContentStatus(q, kind, id, "published"));
    if (row.file_public_key && row.file_public_key !== publicKey) await storage.delete("public", row.file_public_key).catch(() => {});
    return published;
  } catch (e) {
    if (publicKey) {
      await storage.delete("public", publicKey).catch(() => {});
      await tx.asUser((q) => q.query(`update ${table} set file_public_key = $2 where id = $1`, [id, row.file_public_key ?? null])).catch(() => {});
    }
    throw e;
  }
}

/** Takes a shader or starter project down (to draft, review or archived) and removes its public download. */
export async function unpublishWithFile(tx: Tx, storage: AssetStorage, kind: "shader" | "starter", id: string, status: "draft" | "review" | "archived" = "draft"): Promise<ContentRow> {
  const table = kind === "shader" ? "shader_resources" : "starter_projects";
  const [row] = await tx.asUser((q) => q.query<ContentRow>(`select * from ${table} where id = $1`, [id]));
  if (!row) throw new UploadError("Not found.", 404);
  const updated = await tx.asUser((q) => setContentStatus(q, kind, id, status));
  if (row.file_public_key) {
    await storage.delete("public", row.file_public_key).catch(() => {});
    await tx.asUser((q) => q.query(`update ${table} set file_public_key = null where id = $1`, [id]));
  }
  return { ...updated, file_public_key: null };
}
