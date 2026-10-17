/**
 * Export naming and the batch manifest. Names are deterministic: the same
 * inputs and pipeline always give the same file names, collisions get
 * "-2", "-3"…, and folders from a dropped folder are kept. The manifest has
 * no timestamps, so the whole ZIP is reproducible.
 */
import type { AtlasDoc } from "@/lib/formats/atlas-json";
import { serialisePipeline, type Pipeline } from "./pipeline";

const safePart = (s: string) =>
  s
    .normalize("NFC")
    .replace(/[\u0000-\u001f<>:"\\|?*]/g, "_")
    .replace(/^\.+/, "_")
    .trim() || "image";

/** Output paths for a batch, in input order. `names` may contain folders ("walls/brick.png"). */
export function outputNames(names: string[], naming: string, ext: string): string[] {
  const width = String(names.length).length;
  const used = new Set<string>();
  return names.map((full, i) => {
    const parts = full.split("/").filter(Boolean);
    const file = parts.pop() ?? "image";
    const dir = parts.map(safePart).join("/");
    const base = file.replace(/\.[^.]+$/, "");
    const stem =
      safePart(
        (naming || "{name}")
          .replaceAll("{name}", base)
          .replaceAll("{n}", String(i + 1).padStart(width, "0"))
          .replace(/[/\\]/g, "_"),
      ).slice(0, 120) || "image";
    let path = `${dir ? `${dir}/` : ""}${stem}.${ext}`;
    for (let k = 2; used.has(path.toLowerCase()); k++) path = `${dir ? `${dir}/` : ""}${stem}-${k}.${ext}`;
    used.add(path.toLowerCase());
    return path;
  });
}

export interface ManifestItem {
  /** `origin` is set when the image came from the LOWPO11Y library. */
  source: { name: string; width: number; height: number; sha256: string; origin?: { asset: string; url: string; licence: string | null } };
  output: { file: string; width: number; height: number; bytes: number; sha256: string } | null;
  error: string | null;
}

export interface Manifest {
  format: "lowpo11y-workshop-batch";
  version: 1;
  generator: string;
  pipeline: unknown;
  items: ManifestItem[];
  atlas: { image: string; data: string; width: number; height: number; bytes: number; sha256: string; frames: number; overflow: string[] } | null;
  summary: { inputs: number; succeeded: number; failed: number };
}

export function buildManifest(p: Pipeline, items: ManifestItem[], atlas: Manifest["atlas"] = null): Manifest {
  return {
    format: "lowpo11y-workshop-batch",
    version: 1,
    generator: "LOWPO11Y Workshop",
    pipeline: JSON.parse(serialisePipeline(p)),
    items,
    atlas,
    summary: { inputs: items.length, succeeded: items.filter((i) => i.output).length, failed: items.filter((i) => i.error).length },
  };
}

export const manifestJson = (m: Manifest) => JSON.stringify(m, null, 2) + "\n";

export type { AtlasDoc };
