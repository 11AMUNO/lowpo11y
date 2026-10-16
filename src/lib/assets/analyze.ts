import sharp from "sharp";
import { gltfStats, parseGlb, parseGltfJson, type GltfStats } from "@/lib/formats/gltf";
import { detectFormat, inspectZip, type DetectedFormat } from "@/lib/validation/file-types";

export interface FileAnalysis {
  detected: DetectedFormat;
  width?: number;
  height?: number;
  channels?: number;
  hasAlpha?: boolean;
  model?: GltfStats;
  zipEntries?: string[];
  /** Blocking problems: the file must be rejected. */
  problems: string[];
  /** Non-blocking notes shown to the admin. */
  warnings: string[];
}

const MAX_IMAGE_PIXELS = 8192 * 8192;

/** Inspects uploaded bytes. Never trusts the filename beyond choosing between text formats. */
export async function analyzeFile(bytes: Uint8Array, filename: string): Promise<FileAnalysis | { problems: string[] }> {
  const detected = detectFormat(bytes, filename);
  if (!detected) return { problems: ["The file's contents don't match a supported format, or it looks like an executable."] };
  const out: FileAnalysis = { detected, problems: [], warnings: [] };

  if (detected.kind === "image") {
    try {
      const meta = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
      out.width = meta.width;
      out.height = meta.height;
      out.channels = meta.channels;
      out.hasAlpha = meta.hasAlpha;
      if (meta.width && meta.height && (meta.width & (meta.width - 1) || meta.height & (meta.height - 1))) {
        out.warnings.push(`${meta.width}×${meta.height} is not a power of two; some engines resize or mipmap it differently.`);
      }
    } catch {
      out.problems.push("The image could not be decoded (damaged, or larger than 8192×8192).");
    }
  } else if (detected.format === "glb" || detected.format === "gltf") {
    try {
      const doc = detected.format === "glb" ? parseGlb(bytes) : parseGltfJson(new TextDecoder().decode(bytes));
      out.model = gltfStats(doc);
      if (out.model.unsupportedExtensions.length) {
        out.warnings.push(`Requires extensions the site viewer cannot decode: ${out.model.unsupportedExtensions.join(", ")}.`);
      }
      if (detected.format === "gltf" && out.model.images.some((i) => i.external)) {
        out.warnings.push("This .gltf references external files; upload a .glb for a self-contained preview.");
      }
    } catch (e) {
      out.problems.push(e instanceof Error ? e.message : "The model could not be read.");
    }
  } else if (detected.format === "zip") {
    const report = inspectZip(bytes);
    out.zipEntries = report.entries;
    out.problems.push(...report.problems);
  }
  return out;
}

export function isAnalysis(a: FileAnalysis | { problems: string[] }): a is FileAnalysis {
  return "detected" in a;
}
