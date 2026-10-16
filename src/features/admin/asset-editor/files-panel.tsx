"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Dropzone } from "@/components/ui/dropzone";
import { Progress } from "@/components/ui/feedback";
import { Select } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { formatBytes, formatCount } from "@/lib/format";
import { guessPurpose, uploadAssetFile, type UploadPurpose } from "../upload";
import type { EditorFile } from "./types";
import { useMutation } from "./use-mutation";

const PURPOSE_LABEL: Record<string, string> = {
  delivery: "Download",
  source: "Source (private)",
  thumbnail: "Thumbnail",
  preview: "Preview",
  dependency: "Dependency",
  bundle: "ZIP bundle",
};

const EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".glb", ".gltf", ".fbx", ".obj", ".mtl", ".blend", ".zip", ".ttf", ".otf", ".woff", ".woff2", ".wav", ".ogg", ".mp3", ".flac", ".txt", ".md", ".json", ".gdshader", ".shader", ".glsl", ".hlsl"];

interface QueueItem {
  key: string;
  name: string;
  size: number;
  progress: number | null;
  state: "waiting" | "uploading" | "verifying" | "done" | "failed";
  message?: string;
}

function detail(f: EditorFile) {
  const parts: string[] = [];
  if (f.width && f.height) parts.push(`${f.width}×${f.height}`);
  if (f.triangles) parts.push(`${formatCount(f.triangles)} tris`);
  if (f.generated) parts.push(f.note ?? `generated (${f.generated})`);
  return parts.join(" // ");
}

export function FilesPanel({ assetId, files, maxBytes, readOnly }: { assetId: string; files: EditorFile[]; maxBytes: number; readOnly: boolean }) {
  const router = useRouter();
  const { busy, run } = useMutation();
  const [purpose, setPurpose] = useState<"auto" | UploadPurpose>("auto");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [deriveNote, setDeriveNote] = useState<string | null>(null);

  const patch = (key: string, p: Partial<QueueItem>) => setQueue((q) => q.map((i) => (i.key === key ? { ...i, ...p } : i)));

  async function derive(force: boolean) {
    const r = await run(force ? "regen" : "derive", () => api<{ created: { filename: string }[]; warnings: string[] }>(`/api/admin/assets/${assetId}/derive`, { body: { force, textureVariants: true } }));
    if (r) setDeriveNote([r.created.length ? `Generated ${r.created.map((c) => c.filename).join(", ")}.` : "Nothing new to generate.", ...r.warnings].join(" "));
  }

  async function onFiles(list: File[]) {
    const items = list.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, size: f.size, progress: 0, state: "waiting" as const }));
    setQueue((q) => [...items, ...q].slice(0, 40));
    setUploading(true);
    let ok = 0;
    for (const [i, file] of list.entries()) {
      const key = items[i]!.key;
      patch(key, { state: "uploading" });
      try {
        const res = await uploadAssetFile(assetId, purpose === "auto" ? guessPurpose(file.name) : purpose, file, {
          onProgress: (p) => patch(key, { progress: p, state: p >= 1 ? "verifying" : "uploading" }),
        });
        ok++;
        patch(key, {
          state: "done",
          progress: 1,
          message: [res.duplicate ? "Already attached; reused the existing file." : `${PURPOSE_LABEL[res.file.purpose] ?? res.file.purpose} // ${res.file.format.toUpperCase()}`, ...res.warnings].join(" "),
        });
      } catch (e) {
        patch(key, { state: "failed", progress: null, message: e instanceof ApiError ? e.message : "Upload failed." });
      }
    }
    setUploading(false);
    router.refresh();
    // Convert FBX, render thumbnails and size variants for whatever just arrived.
    if (ok) await derive(false);
  }

  return (
    <div className="flex flex-col gap-4">
      {files.length ? (
        <div className="lp-scroll overflow-x-auto border border-rule-strong">
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-panel text-left">
              <tr>
                <th scope="col" className="type-label h-9 px-3 font-normal">
                  File
                </th>
                <th scope="col" className="type-label h-9 px-3 font-normal">
                  Use
                </th>
                <th scope="col" className="type-label h-9 px-3 font-normal">
                  Size
                </th>
                <th scope="col" className="type-label h-9 px-3 font-normal">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id} className="border-t border-rule align-top">
                  <td className="max-w-[22rem] px-3 py-2">
                    <a href={`/api/admin/files/${f.id}`} target="_blank" rel="noreferrer" className="block truncate text-fg hover:text-bright hover:underline">
                      {f.filename}
                    </a>
                    <span className="block font-ocr text-[11px] text-muted uppercase">
                      {f.format}
                      {detail(f) ? ` // ${detail(f)}` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <Badge>{PURPOSE_LABEL[f.purpose] ?? f.purpose}</Badge>
                      {f.isPrimary ? <Badge tone="bright">Primary</Badge> : null}
                      {!f.published ? <Badge tone="outline">Not published</Badge> : null}
                      {f.isPublic ? <Badge tone="outline">Live</Badge> : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-ocr text-xs whitespace-nowrap text-muted">{formatBytes(f.sizeBytes)}</td>
                  <td className="px-3 py-2">
                    {f.purpose !== "bundle" && !readOnly ? (
                      <div className="flex flex-wrap justify-end gap-1">
                        {!f.isPrimary ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy !== null}
                            onClick={() => run(`p${f.id}`, () => api(`/api/admin/assets/${assetId}/files/${f.id}`, { method: "PATCH", body: { isPrimary: true } }), "Primary file updated")}
                          >
                            Make primary
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy !== null}
                          onClick={() =>
                            run(`v${f.id}`, () => api(`/api/admin/assets/${assetId}/files/${f.id}`, { method: "PATCH", body: { published: !f.published } }), f.published ? "File excluded from publishing" : "File included in publishing")
                          }
                        >
                          {f.published ? "Exclude" : "Include"}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busy !== null}
                          onClick={() => {
                            if (window.confirm(`Delete ${f.filename}? Its public copy is removed immediately.`)) {
                              void run(`d${f.id}`, () => api(`/api/admin/assets/${assetId}/files/${f.id}`, { method: "DELETE" }), "File deleted");
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[13px] text-muted">No files yet. Upload the model or texture to download, plus any textures an FBX needs; previews are generated for you.</p>
      )}

      {!readOnly ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="upload-purpose" className="type-label">
              Upload as
            </label>
            <Select id="upload-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value as typeof purpose)} className="w-56">
              <option value="auto">Auto (from the filename)</option>
              <option value="delivery">Download file</option>
              <option value="source">Source, kept private</option>
              <option value="thumbnail">Thumbnail</option>
              <option value="preview">Preview only</option>
              <option value="dependency">Dependency</option>
            </Select>
          </div>
          <Dropzone
            multiple
            maxFiles={40}
            maxBytes={maxBytes}
            extensions={EXTENSIONS}
            disabled={uploading}
            label={uploading ? "Uploading…" : "Drop files or browse"}
            hint={`Up to ${formatBytes(maxBytes)} each. Files are checked by content, not just extension. FBX models are converted to GLB with their textures.`}
            onFiles={onFiles}
            onReject={(reasons) => toast.error("Some files were skipped", reasons.join(". "))}
          />
          {queue.length ? (
            <ul aria-label="Upload queue" className="flex flex-col gap-2">
              {queue.map((i) => (
                <li key={i.key} className="border border-rule-strong bg-sunken px-3 py-2">
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="truncate text-fg">{i.name}</span>
                    <span className="shrink-0 font-ocr text-[11px] tracking-[0.08em] text-muted uppercase">
                      {i.state === "done" ? "Done" : i.state === "failed" ? "Failed" : i.state === "verifying" ? "Checking" : i.state === "uploading" ? formatBytes(i.size) : "Waiting"}
                    </span>
                  </div>
                  {i.state === "uploading" || i.state === "verifying" ? (
                    <Progress className="mt-1.5" value={i.state === "verifying" ? null : i.progress} label={i.state === "verifying" ? "Verifying" : "Uploading"} />
                  ) : null}
                  {i.message ? <p className={i.state === "failed" ? "mt-1 text-xs text-bright" : "mt-1 text-xs text-muted"}>{i.state === "failed" ? `! ${i.message}` : i.message}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy !== null || uploading} onClick={() => derive(false)}>
              {busy === "derive" ? "Generating…" : "Generate missing previews"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null || uploading} onClick={() => derive(true)} title="Delete and rebuild every generated file">
              {busy === "regen" ? "Rebuilding…" : "Rebuild generated files"}
            </Button>
            <a href="/admin/import" className={buttonClasses("link", "sm", "ml-auto text-xs")}>
              Importing many assets? Use bulk import
            </a>
          </div>
          {deriveNote ? (
            <p role="status" className="font-ocr text-[11px] tracking-[0.04em] text-muted">
              &gt; {deriveNote}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
