"use client";

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
  /** Extra buttons rendered under the label (e.g. "+ FOLDER"). */
  children?: ReactNode;
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

/** "[ DROP FILES ]" well (Seamless `.drop`). */
export function Dropzone({
  onFiles,
  onReject,
  accept,
  extensions,
  multiple = false,
  maxBytes,
  maxFiles,
  label = "Drop files",
  hint,
  className,
  compact,
  disabled,
  children,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const id = useId();

  const handle = useCallback(
    (list: FileList | File[] | null) => {
      if (!list || disabled) return;
      const ok: File[] = [];
      const reasons: string[] = [];
      for (const f of Array.from(list)) {
        if (f.name.startsWith(".")) continue;
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
        "flex flex-col items-center justify-center gap-1.5 border border-dashed border-edge bg-sunken text-center transition-[border-color,box-shadow] duration-150 hover:border-bright hover:shadow-[var(--crt-glow)]",
        compact ? "px-3 py-3" : "px-3 py-5",
        over && "border-solid border-bright shadow-[var(--crt-glow)]",
        disabled && "pointer-events-none opacity-40",
        className,
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="cursor-pointer font-ocr tracking-[0.1em] uppercase glow"
        aria-describedby={hint ? `${id}-hint` : undefined}
      >
        [ {label} ]
      </button>
      {hint ? (
        <p id={`${id}-hint`} className="max-w-sm font-ocr text-[11px] tracking-[0.04em] text-muted">
          {hint}
        </p>
      ) : null}
      {children ? <div className="mt-1 flex gap-2">{children}</div> : null}
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
