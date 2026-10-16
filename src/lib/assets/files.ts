import { randomUUID } from "node:crypto";
import type { Queryable } from "@/lib/db";
import { sha256Hex } from "@/lib/auth/tokens";
import { keys, safeFilename, type AssetStorage } from "@/lib/storage";
import { ALLOWED_FORMATS, type UploadPurpose } from "@/lib/validation/file-types";
import { analyzeFile, isAnalysis, type FileAnalysis } from "./analyze";

export interface AssetFileRow {
  id: string;
  asset_id: string;
  purpose: string;
  storage_key: string;
  public_key: string | null;
  original_filename: string;
  format: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  model_triangle_count: number | null;
  model_vertex_count: number | null;
  size_variant: number | null;
  derived_from_file_id: string | null;
  metadata: Record<string, unknown>;
  is_primary: boolean;
  published: boolean;
  created_at: Date;
}

export class FileRejectedError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(" "));
  }
}

export interface StoreFileInput {
  assetId: string;
  purpose: UploadPurpose;
  filename: string;
  bytes: Uint8Array;
  /** Mark as the asset's primary file for its purpose. */
  primary?: boolean;
  published?: boolean;
  derivedFromFileId?: string;
  sizeVariant?: number;
  extraMetadata?: Record<string, unknown>;
}

export interface StoreFileResult {
  file: AssetFileRow;
  analysis: FileAnalysis;
  /** True when an identical file (same checksum and purpose) already existed and was reused. */
  duplicate: boolean;
}

/**
 * Validates bytes and files them under the asset in the private bucket.
 * `q` must run as a staff user (RLS) or the service context. Duplicate files
 * (same sha256 + purpose on the same asset) are not stored twice.
 */
export async function storeAssetFile(q: Queryable, storage: AssetStorage, input: StoreFileInput): Promise<StoreFileResult> {
  const analysis = await analyzeFile(input.bytes, input.filename);
  if (!isAnalysis(analysis) || analysis.problems.length) throw new FileRejectedError(analysis.problems);
  const allowed = ALLOWED_FORMATS[input.purpose];
  if (!allowed.includes(analysis.detected.format)) {
    throw new FileRejectedError([`${analysis.detected.format.toUpperCase()} files can't be used as a ${input.purpose} file. Allowed: ${allowed.join(", ")}.`]);
  }
  const sha256 = sha256Hex(input.bytes);
  const [existing] = await q.query<AssetFileRow>(
    "select * from asset_files where asset_id = $1 and purpose = $2 and sha256 = $3 and deleted_at is null",
    [input.assetId, input.purpose, sha256],
  );
  if (existing) return { file: existing, analysis, duplicate: true };

  const fileId = randomUUID();
  const key = keys.assetFile(input.assetId, input.purpose, fileId, analysis.detected.format);
  const filename = safeFilename(input.filename);
  await storage.put("private", key, input.bytes, { contentType: analysis.detected.mime, downloadName: filename });

  const m = analysis.model;
  const metadata: Record<string, unknown> = { ...input.extraMetadata, warnings: analysis.warnings };
  if (m) {
    metadata.model = {
      meshes: m.meshes,
      materials: m.materials,
      textures: m.textures,
      images: m.images,
      drawCalls: m.drawCalls,
      uniqueTriangles: m.uniqueTriangles,
      uvChannels: m.uvChannels,
      hasVertexColors: m.hasVertexColors,
      skins: m.skins,
      morphTargets: m.morphTargets,
      animations: m.animations,
      bounds: m.bounds,
      generator: m.generator,
      extensionsRequired: m.extensionsRequired,
    };
  }
  if (analysis.zipEntries) metadata.zipEntries = analysis.zipEntries.slice(0, 500);
  if (analysis.hasAlpha !== undefined) metadata.hasAlpha = analysis.hasAlpha;

  try {
    if (input.primary) {
      await q.query("update asset_files set is_primary = false where asset_id = $1 and purpose = $2", [input.assetId, input.purpose]);
    }
    const [file] = await q.query<AssetFileRow>(
      `insert into asset_files (id, asset_id, purpose, storage_key, original_filename, format, mime, size_bytes, sha256,
         width, height, channels, model_triangle_count, model_vertex_count, texture_count, animation_count,
         size_variant, derived_from_file_id, metadata, is_primary, published)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::text::jsonb,$20,$21)
       returning *`,
      [
        fileId,
        input.assetId,
        input.purpose,
        key,
        filename,
        analysis.detected.format,
        analysis.detected.mime,
        input.bytes.byteLength,
        sha256,
        analysis.width ?? null,
        analysis.height ?? null,
        analysis.channels ?? null,
        m?.sceneTriangles ?? null,
        m?.sceneVertices ?? null,
        m ? m.images.length : null,
        m ? m.animations.length : null,
        input.sizeVariant ?? null,
        input.derivedFromFileId ?? null,
        JSON.stringify(metadata),
        input.primary ?? false,
        input.published ?? input.purpose !== "source",
      ],
    );
    return { file: file!, analysis, duplicate: false };
  } catch (e) {
    await storage.delete("private", key).catch(() => {});
    throw e;
  }
}
