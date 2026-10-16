import { unzipSync } from "fflate";

/**
 * Content-based file type detection. Extensions and declared MIME types are
 * never trusted on their own: the bytes must match.
 */
export type FileKind = "image" | "model" | "archive" | "font" | "audio" | "text";

export interface DetectedFormat {
  format: string;
  mime: string;
  kind: FileKind;
}

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));
const starts = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

const TEXT_FORMATS: Record<string, string> = {
  obj: "model/obj",
  mtl: "model/mtl",
  gdshader: "text/plain",
  gdshaderinc: "text/plain",
  shader: "text/plain",
  glsl: "text/plain",
  hlsl: "text/plain",
  gd: "text/plain",
  cs: "text/plain",
  md: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  csv: "text/csv",
  tres: "text/plain",
  tscn: "text/plain",
};

export function extensionOf(filename: string): string {
  const m = /\.([a-z0-9]{1,12})$/i.exec(filename.trim());
  return m ? m[1]!.toLowerCase() : "";
}

/** Executable formats are refused everywhere. */
export function looksExecutable(b: Uint8Array): boolean {
  return (
    starts(b, [0x4d, 0x5a]) || // PE / MZ
    starts(b, [0x7f, 0x45, 0x4c, 0x46]) || // ELF
    starts(b, [0xca, 0xfe, 0xba, 0xbe]) || // Mach-O fat / Java class
    starts(b, [0xcf, 0xfa, 0xed, 0xfe]) ||
    starts(b, [0xce, 0xfa, 0xed, 0xfe])
  );
}

function isLikelyUtf8Text(b: Uint8Array): boolean {
  const sample = b.subarray(0, 64 * 1024);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample.length === b.length ? sample : sample.subarray(0, lastCompleteUtf8(sample)));
    return true;
  } catch {
    return false;
  }
}

function lastCompleteUtf8(b: Uint8Array): number {
  let i = b.length;
  // Step back over a possibly truncated multi-byte sequence at the cut.
  for (let k = 0; k < 4 && i > 0; k++) {
    const byte = b[i - 1]!;
    if ((byte & 0xc0) !== 0x80) return (byte & 0x80) === 0 ? i : i - 1;
    i--;
  }
  return i;
}

export function detectFormat(b: Uint8Array, filename: string): DetectedFormat | null {
  if (b.length === 0 || looksExecutable(b)) return null;
  const ext = extensionOf(filename);

  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { format: "png", mime: "image/png", kind: "image" };
  if (starts(b, [0xff, 0xd8, 0xff])) return { format: "jpg", mime: "image/jpeg", kind: "image" };
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return { format: "webp", mime: "image/webp", kind: "image" };
  if (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a") return { format: "gif", mime: "image/gif", kind: "image" };
  if (ascii(b, 0, 4) === "glTF") return { format: "glb", mime: "model/gltf-binary", kind: "model" };
  if (ascii(b, 0, 18) === "Kaydara FBX Binary") return { format: "fbx", mime: "application/octet-stream", kind: "model" };
  if (ascii(b, 0, 7) === "BLENDER") return { format: "blend", mime: "application/x-blender", kind: "model" };
  if (ext === "blend" && (starts(b, [0x28, 0xb5, 0x2f, 0xfd]) || starts(b, [0x1f, 0x8b]))) {
    return { format: "blend", mime: "application/x-blender", kind: "model" }; // zstd/gzip-compressed .blend
  }
  if (starts(b, [0x50, 0x4b, 0x03, 0x04]) || starts(b, [0x50, 0x4b, 0x05, 0x06])) return { format: "zip", mime: "application/zip", kind: "archive" };
  if (starts(b, [0x00, 0x01, 0x00, 0x00]) || ascii(b, 0, 4) === "true") return { format: "ttf", mime: "font/ttf", kind: "font" };
  if (ascii(b, 0, 4) === "OTTO") return { format: "otf", mime: "font/otf", kind: "font" };
  if (ascii(b, 0, 4) === "wOFF") return { format: "woff", mime: "font/woff", kind: "font" };
  if (ascii(b, 0, 4) === "wOF2") return { format: "woff2", mime: "font/woff2", kind: "font" };
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return { format: "wav", mime: "audio/wav", kind: "audio" };
  if (ascii(b, 0, 4) === "OggS") return { format: "ogg", mime: "audio/ogg", kind: "audio" };
  if (ascii(b, 0, 4) === "fLaC") return { format: "flac", mime: "audio/flac", kind: "audio" };
  if (ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0 && ext === "mp3")) return { format: "mp3", mime: "audio/mpeg", kind: "audio" };

  if (!isLikelyUtf8Text(b)) return null;
  const head = new TextDecoder().decode(b.subarray(0, 4096)).trimStart();
  if (head.startsWith("#!")) return null; // shell scripts are executables
  if (ext === "fbx" && head.startsWith(";")) return { format: "fbx", mime: "application/octet-stream", kind: "model" };
  if (ext === "gltf") {
    try {
      const json = JSON.parse(new TextDecoder().decode(b)) as { asset?: { version?: string } };
      if (json.asset?.version) return { format: "gltf", mime: "model/gltf+json", kind: "model" };
    } catch {
      return null;
    }
    return null;
  }
  if (ext === "json") {
    try {
      JSON.parse(new TextDecoder().decode(b));
    } catch {
      return null;
    }
  }
  const mime = TEXT_FORMATS[ext];
  return mime ? { format: ext, mime, kind: ext === "obj" || ext === "mtl" ? "model" : "text" } : null;
}

export type UploadPurpose = "source" | "delivery" | "thumbnail" | "preview" | "dependency";

const IMAGE = ["png", "jpg", "webp", "gif"];
const DOWNLOADABLE = [...IMAGE, "glb", "gltf", "fbx", "obj", "mtl", "blend", "zip", "ttf", "otf", "woff", "woff2", "wav", "ogg", "mp3", "flac", ...Object.keys(TEXT_FORMATS)];

export const ALLOWED_FORMATS: Record<UploadPurpose, string[]> = {
  thumbnail: IMAGE,
  preview: [...IMAGE, "glb", "gltf"],
  delivery: DOWNLOADABLE,
  source: DOWNLOADABLE,
  dependency: DOWNLOADABLE,
};

const BLOCKED_IN_ARCHIVES = /\.(exe|dll|bat|cmd|com|msi|scr|ps1|vbs|jar|apk|app|sh|bash|zsh|command|cpl|lnk|reg|hta|js|mjs|wsf)$/i;

export interface ArchiveReport {
  entries: string[];
  problems: string[];
}

/** Lists ZIP entries without extracting them and flags unsafe paths or executable content. */
export function inspectZip(b: Uint8Array, maxEntries = 5000): ArchiveReport {
  const entries: string[] = [];
  const problems: string[] = [];
  try {
    unzipSync(b, {
      filter: (f) => {
        entries.push(f.name);
        return false;
      },
    });
  } catch {
    return { entries, problems: ["The ZIP file is damaged or uses an unsupported compression method."] };
  }
  if (entries.length > maxEntries) problems.push(`The ZIP has ${entries.length} entries; the limit is ${maxEntries}.`);
  for (const name of entries) {
    if (name.startsWith("/") || name.includes("..") || /^[a-z]:/i.test(name) || name.includes("\\")) problems.push(`Unsafe path in ZIP: ${name}`);
    if (BLOCKED_IN_ARCHIVES.test(name)) problems.push(`Executable or script files are not allowed: ${name}`);
  }
  return { entries, problems };
}
