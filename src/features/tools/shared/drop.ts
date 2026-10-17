"use client";

import { useEffect, useRef, useState } from "react";

/** A file from a drop or folder picker, with the folder path it came from ("" for loose files, else "a/b/"). */
export interface DroppedFile {
  file: File;
  dir: string;
}

const IMG_RE = /\.(png|jpe?g|webp|bmp|gif|avif|tiff?)$/i;
export const isImage = (f: File) => (f.type && f.type.startsWith("image/")) || IMG_RE.test(f.name);

/** Folder path of a relative path such as `webkitRelativePath`: "a/b/c.png" → "a/b/". */
export const dirOf = (path: string) => {
  const p = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return p.length > 1 ? `${p.slice(0, -1).join("/")}/` : "";
};

/** Files from an `<input type=file>`, keeping folder paths when it was a folder picker. */
export const fromInput = (files: FileList | null): DroppedFile[] => [...(files ?? [])].map((file) => ({ file, dir: dirOf(file.webkitRelativePath || "") }));

interface FsHandle {
  kind: "file" | "directory";
  name: string;
  getFile?: () => Promise<File>;
  values?: () => AsyncIterable<FsHandle>;
}
interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  fullPath: string;
  file?: (ok: (f: File) => void, err: () => void) => void;
  createReader?: () => { readEntries: (ok: (list: FsEntry[]) => void, err: () => void) => void };
}

async function walkHandle(h: FsHandle, dir: string, out: DroppedFile[]) {
  if (h.kind === "file") {
    out.push({ file: await h.getFile!(), dir });
    return;
  }
  for await (const child of h.values!()) await walkHandle(child, `${dir}${h.name}/`, out);
}

function readEntry(entry: FsEntry, out: DroppedFile[], status: { failed: boolean }): Promise<void> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file!(
        (file) => {
          out.push({ file, dir: dirOf(entry.fullPath) });
          resolve();
        },
        () => {
          status.failed = true;
          resolve();
        },
      );
    } else if (entry.isDirectory) {
      const reader = entry.createReader!();
      const batch = () =>
        reader.readEntries(
          async (list) => {
            if (!list.length) return resolve();
            for (const child of list) await readEntry(child, out, status);
            batch();
          },
          () => {
            status.failed = true;
            resolve();
          },
        );
      batch();
    } else resolve();
  });
}

/**
 * Reads a drop, including whole folders. Everything on the DataTransfer must
 * be grabbed synchronously, before the first await. The File System Access
 * handle API is tried first, the older entry API is the fallback.
 */
export async function readDrop(dt: DataTransfer): Promise<{ files: DroppedFile[]; failed: boolean }> {
  const items = [...(dt.items || [])].filter((i) => i.kind === "file");
  const handles = items.map((i) => ((i as unknown as { getAsFileSystemHandle?: () => Promise<FsHandle | null> }).getAsFileSystemHandle?.() ?? null));
  const entries = items.map((i) => (i.webkitGetAsEntry ? (i.webkitGetAsEntry() as unknown as FsEntry | null) : null));
  const loose = [...dt.files];
  const out: DroppedFile[] = [];
  const status = { failed: false };
  for (let k = 0; k < Math.max(items.length, loose.length); k++) {
    if (handles[k]) {
      try {
        const h = await handles[k];
        if (h) {
          await walkHandle(h, "", out);
          continue;
        }
      } catch {
        // fall back to the entry API
      }
    }
    if (entries[k]) await readEntry(entries[k]!, out, status);
    else if (loose[k]) out.push({ file: loose[k]!, dir: "" });
  }
  return { files: out, failed: status.failed };
}

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");

/**
 * Accepts files and folders dropped anywhere on the window. Returns whether a
 * file drag is over the window, for highlighting the drop target.
 */
export function useWindowDrop(onDrop: (dt: DataTransfer) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const cb = useRef(onDrop);
  useEffect(() => {
    cb.current = onDrop;
  });
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (hasFiles(e)) {
        depth++;
        setDragging(true);
      }
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      cb.current(e.dataTransfer!);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
  return dragging;
}
