"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dropzone } from "@/components/ui/dropzone";
import { Progress } from "@/components/ui/feedback";
import { Panel } from "@/components/ui/panel";
import { toast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";
import { formatBytes } from "@/lib/format";
import { uploadStarterFile } from "../upload";

export interface StarterFile {
  name: string;
  sizeBytes: number;
  sha256: string;
}

/** The project ZIP: uploaded privately, checked, and copied to the public bucket when published. */
export function StarterFilePanel({ starterId, file, maxBytes, readOnly, published }: { starterId: string; file: StarterFile | null; maxBytes: number; readOnly: boolean; published: boolean }) {
  const router = useRouter();
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function onFiles([f]: File[]) {
    if (!f) return;
    setProblem(null);
    setProgress(0);
    try {
      const r = await uploadStarterFile(starterId, f, { onProgress: setProgress });
      toast.ok(`${r.file.name} checked and attached${published ? ". Republish to update the download" : ""}`);
      router.refresh();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Upload failed.");
    } finally {
      setProgress(null);
    }
  }

  return (
    <Panel title="Project file">
      <div className="flex flex-col gap-3">
        {file ? (
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 font-ocr text-[12px]">
            <dt className="text-muted">File</dt>
            <dd className="break-all text-fg">{file.name}</dd>
            <dt className="text-muted">Size</dt>
            <dd className="text-fg">{formatBytes(file.sizeBytes)}</dd>
            <dt className="text-muted">SHA-256</dt>
            <dd className="break-all text-fg">{file.sha256}</dd>
          </dl>
        ) : (
          <p className="text-[13px] text-muted">No project file yet. Upload the ZIP you tested.</p>
        )}
        {!readOnly ? (
          <Dropzone
            onFiles={(fs) => void onFiles(fs)}
            onReject={(r) => setProblem(r.join(" "))}
            extensions={[".zip"]}
            accept=".zip,application/zip"
            maxBytes={maxBytes}
            compact
            disabled={progress !== null}
            label={file ? "[ REPLACE ZIP ]" : "[ DROP PROJECT ZIP ]"}
            hint="Checked before it's kept: no executables, shell scripts or unsafe paths. Visitors only get it once published."
          />
        ) : null}
        {progress !== null ? <Progress value={progress} label={progress >= 1 ? "Checking the archive" : "Uploading"} /> : null}
        {problem ? (
          <p role="alert" className="text-xs text-bright">
            ! {problem}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
