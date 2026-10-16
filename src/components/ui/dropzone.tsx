"use client";

import { Upload } from "lucide-react";
import { useCallback, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";

export interface DropzoneProps {
  onFiles: (files: File[]) => void;
  /** Called with a human-readable reason for each rejected file. */
  onReject?: (reasons: string[]) => void;
  accept?: string;
  /** Extensions (lowercase, with dot) accepted when MIME types are unreliable, e.g. [".glb"]. */
  extensions?: string[];
  multiple?: boolean;
  maxBytes?: number;
  maxFiles?: number;
  label?: ReactNode;
  hint?: ReactNode;
  className?: string;
  compact?: boolean;
  disabled?: boolean;
}

function matches(file: File, accept?: string, extensions?: string[]) {
  const name = file.name.toLowerCase();
  if (extensions?.some((ext) => name.endsWith(ext))) return true;
  if (!accept) return !extensions;
  return accept.split(",").some((rule) => {
    const r = rule.trim().toLowerCase();
    if (r.startsWith(".")) return name.endsWith(r);
    if (r.endsWith("/*")) return file.type.startsWith(r.slice(0, -1));
    return file.type === r;
  });
}

export function Dropzone({
  onFiles,
  onReject,
  accept,
  extensions,
  multiple = false,
  maxBytes,
  maxFiles,
  label = "Drop files here or choose files",
  hint,
  className,
  compact,
  disabled,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const id = useId();

  const handle = useCallback(
    (list: FileList | null) => {
      if (!list || disabled) return;
      const ok: File[] = [];
      const reasons: string[] = [];
      for (const f of Array.from(list)) {
        if (!matches(f, accept, extensions)) reasons.push(`${f.name}: unsupported file type`);
        else if (maxBytes && f.size > maxBytes) reasons.push(`${f.name}: larger than ${formatBytes(maxBytes)}`);
        else ok.push(f);
      }
      let accepted = multiple ? ok : ok.slice(0, 1);
      if (maxFiles && accepted.length > maxFiles) {
        reasons.push(`Only the first ${maxFiles} files were added`);
        accepted = accepted.slice(0, maxFiles);
      }
      if (reasons.length) onReject?.(reasons);
      if (accepted.length) onFiles(accepted);
    },
    [accept, extensions, maxBytes, maxFiles, multiple, onFiles, onReject, disabled],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    handle(e.dataTransfer.files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "relative flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-rule-strong bg-sunken text-center transition-colors",
        compact ? "px-4 py-4" : "px-6 py-10",
        over && "border-accent bg-accent-soft",
        disabled && "opacity-50",
        className,
      )}
    >
      <Upload className="size-5 text-muted" aria-hidden />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="type-label rounded-sm text-fg underline decoration-rule-strong underline-offset-4 hover:decoration-accent"
        aria-describedby={hint ? `${id}-hint` : undefined}
      >
        {label}
      </button>
      {hint ? (
        <p id={`${id}-hint`} className="type-small max-w-sm text-muted">
          {hint}
        </p>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        accept={[accept, ...(extensions ?? [])].filter(Boolean).join(",") || undefined}
        multiple={multiple}
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
