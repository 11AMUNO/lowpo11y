"use client";

import { api, ApiError } from "@/lib/api-client";

export type UploadPurpose = "source" | "delivery" | "thumbnail" | "preview" | "dependency";

export interface UploadedFile {
  id: string;
  purpose: string;
  filename: string;
  format: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  triangles: number | null;
}

function put(url: string, headers: Record<string, string>, file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) {
      // Browsers set Content-Length themselves and refuse to let scripts do it.
      if (k.toLowerCase() !== "content-length") xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(`Storage refused the upload (${xhr.status}).`, xhr.status)));
    xhr.onerror = () => reject(new ApiError("The upload was interrupted. Check your connection and try again.", 0));
    xhr.onabort = () => reject(new ApiError("Upload cancelled.", 0));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

/**
 * Signed upload: ask the server for a one-file upload URL, PUT the bytes
 * straight to storage, then have the server verify and attach the file.
 */
export async function uploadAssetFile(
  assetId: string,
  purpose: UploadPurpose,
  file: File,
  opts: { primary?: boolean; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<{ file: UploadedFile; duplicate: boolean; warnings: string[] }> {
  const { id, upload } = await api<{ id: string; upload: { url: string; headers: Record<string, string> } }>("/api/admin/uploads", {
    body: { assetId, purpose, filename: file.name, size: file.size, contentType: file.type || "application/octet-stream" },
    signal: opts.signal,
  });
  await put(upload.url, upload.headers, file, opts.onProgress, opts.signal);
  return api(`/api/admin/uploads/${id}/complete`, { body: { primary: opts.primary }, signal: opts.signal });
}

/** Sensible default purpose from the filename. */
export function guessPurpose(name: string): UploadPurpose {
  const n = name.toLowerCase();
  if (/(^|[-_ .])(thumb|thumbnail|cover)([-_ .]|$)/.test(n) && /\.(png|jpe?g|webp|gif)$/.test(n)) return "thumbnail";
  if (/\.(blend|psd|kra|aseprite|xcf|spp)$/.test(n)) return "source";
  return "delivery";
}
