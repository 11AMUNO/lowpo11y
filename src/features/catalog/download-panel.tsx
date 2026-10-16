"use client";

import { useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { formatBytes } from "@/lib/format";

export interface DownloadFile {
  id: string;
  filename: string;
  format: string;
  sizeBytes: number;
  /** e.g. "128×128", "60 tris", "converted from FBX" */
  detail?: string;
}

/** Download URL with a one-off event id so a double click counts once. */
function downloadHref(id: string) {
  const e = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : String(Date.now());
  return `/api/download/${id}?e=${e}`;
}

function DownloadLink({ file, className, children }: { file: DownloadFile; className?: string; children: React.ReactNode }) {
  return (
    <a
      href={`/api/download/${file.id}`}
      download
      rel="nofollow"
      className={className}
      onClick={(e) => {
        e.currentTarget.href = downloadHref(file.id);
      }}
    >
      {children}
    </a>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  return (
    <button
      type="button"
      className={buttonClasses("secondary", "sm")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast.ok("Copied to clipboard");
        } catch {
          toast.error("Couldn't copy", "Select the text and copy it manually.");
        }
      }}
    >
      {label}
    </button>
  );
}

/**
 * Primary download (the ZIP bundle with LICENSE and README) plus every
 * individual file. When the licence requires credit, the credit line is
 * shown before the download starts.
 */
export function DownloadPanel({
  bundle,
  files,
  credit,
  blocked,
}: {
  bundle: DownloadFile | null;
  files: DownloadFile[];
  /** Attribution text to show before downloading, when the licence requires it. */
  credit: string | null;
  /** Reason downloads are unavailable, if any. */
  blocked: string | null;
}) {
  const [showAll, setShowAll] = useState(files.length <= 4);
  if (blocked) {
    return <p className="border border-dashed border-edge bg-sunken px-3 py-2.5 text-[13px] text-muted">{blocked}</p>;
  }
  const visible = showAll ? files : files.slice(0, 4);
  const primary = bundle ?? files[0] ?? null;
  const primaryLabel = (
    <>
      [ Download {bundle ? "ZIP" : primary?.format.toUpperCase()} <span className="text-muted">{primary ? formatBytes(primary.sizeBytes) : ""}</span> ]
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      {primary ? (
        credit ? (
          <Dialog>
            <DialogTrigger className={buttonClasses("primary", "lg", "w-full")}>{primaryLabel}</DialogTrigger>
            <DialogContent
              title="Credit required"
              description="This licence asks you to credit the author wherever you use the asset."
              footer={
                <>
                  <DialogClose className={buttonClasses("ghost", "md")}>Cancel</DialogClose>
                  <DownloadLink file={primary} className={buttonClasses("primary", "md")}>
                    [ Download {formatBytes(primary.sizeBytes)} ]
                  </DownloadLink>
                </>
              }
            >
              <div className="flex flex-col gap-3 px-4 py-4">
                <p className="text-[13px] text-muted">Paste this into your game&rsquo;s credits, README or video description:</p>
                <pre className="border border-rule-strong bg-sunken px-3 py-2.5 text-[13px] whitespace-pre-wrap text-bright">{credit}</pre>
                <div>
                  <CopyButton text={credit} label="Copy credit" />
                </div>
                <p className="text-xs text-muted">The same text is in LICENSE.txt inside the ZIP.</p>
              </div>
            </DialogContent>
          </Dialog>
        ) : (
          <DownloadLink file={primary} className={buttonClasses("primary", "lg", "w-full")}>
            {primaryLabel}
          </DownloadLink>
        )
      ) : null}
      {bundle ? <p className="text-xs leading-relaxed text-muted">The ZIP holds every file below, plus LICENSE.txt, README.txt and a manifest with checksums.</p> : null}

      {files.length ? (
        <div>
          <h3 className="type-label mb-1.5">Individual files</h3>
          <ul className="border-t border-dashed border-rule-strong">
            {visible.map((f) => (
              <li key={f.id}>
                <DownloadLink
                  file={f}
                  className="group grid grid-cols-[auto_1fr_auto] items-baseline gap-2 border-b border-dashed border-rule-strong py-1.5 text-[13px] hover:bg-hover"
                >
                  <span className="w-9 font-ocr text-[11px] tracking-[0.06em] text-muted uppercase">{f.format}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-fg group-hover:text-bright">{f.filename}</span>
                    {f.detail ? <span className="block truncate text-xs text-muted">{f.detail}</span> : null}
                  </span>
                  <span className="font-ocr text-[11px] text-muted tabular">{formatBytes(f.sizeBytes)}</span>
                </DownloadLink>
              </li>
            ))}
          </ul>
          {!showAll ? (
            <button type="button" onClick={() => setShowAll(true)} className="mt-1.5 cursor-pointer font-ocr text-[11px] tracking-[0.08em] text-muted uppercase hover:text-bright">
              [ Show all {files.length} files ]
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
