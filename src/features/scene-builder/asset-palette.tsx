"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/form";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { formatBytes, formatCount } from "@/lib/format";
import type { LibraryModel } from "@/lib/scene/library";
import type { PrimitiveShape } from "@/lib/scene/schema";
import type { LibraryTexture } from "@/lib/workshop/library";

/** What a palette item carries when dragged onto the viewport. */
export type PaletteDrag = { type: "model"; item: LibraryModel } | { type: "primitive"; shape: PrimitiveShape };
export const DRAG_TYPE = "application/x-lowpo11y-scene";

const small = "cursor-pointer border border-edge bg-sunken px-2 py-1 font-ocr text-[11px] tracking-[0.05em] text-muted uppercase hover:border-edge-hover hover:text-bright disabled:cursor-not-allowed disabled:opacity-40";

function useLibrary<T>(kind: "model" | "texture", query: string, active: boolean) {
  const [state, setState] = useState<{ q: string; items: T[] | null; error: string | null }>({ q: "\u0000", items: null, error: null });
  useEffect(() => {
    if (!active) return;
    const q = query.trim();
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/scene/library?kind=${kind}&q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!r.ok) throw new Error();
        setState({ q, items: ((await r.json()) as { items: T[] }).items, error: null });
      } catch {
        if (!ctrl.signal.aborted) setState({ q, items: null, error: "Couldn't load the library." });
      }
    }, 160);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [kind, query, active]);
  return { ...state, loading: state.q !== query.trim() && !state.error };
}

const SHAPES: { shape: PrimitiveShape; label: string; note: string }[] = [
  { shape: "box", label: "Box", note: "1×1×1 m" },
  { shape: "plane", label: "Plane", note: "4×4 m floor" },
  { shape: "cylinder", label: "Cylinder", note: "8 sides" },
];

export function AssetPalette({
  onAddModel,
  onAddPrimitive,
  onUseTexture,
  onLocalFiles,
  onForgetFiles,
  canTexture,
  className,
}: {
  onAddModel: (m: LibraryModel) => void;
  onAddPrimitive: (shape: PrimitiveShape) => void;
  onUseTexture: (t: LibraryTexture) => void;
  onLocalFiles: (files: File[]) => void;
  /** Removes the local files kept in this browser. */
  onForgetFiles: () => void;
  canTexture: boolean;
  className?: string;
}) {
  const [tab, setTab] = useState("models");
  const [query, setQuery] = useState("");
  const models = useLibrary<LibraryModel>("model", query, tab === "models");
  const textures = useLibrary<LibraryTexture>("texture", query, tab === "textures");
  const fileRef = useRef<HTMLInputElement>(null);

  const dragProps = (d: PaletteDrag) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(d));
      e.dataTransfer.effectAllowed = "copy";
    },
  });

  return (
    <section aria-labelledby="sb-assets" className={cn("flex min-h-0 flex-col border border-rule-strong bg-panel p-3", className)}>
      <h2 id="sb-assets" className="type-panel mb-2">
        // Assets
      </h2>
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-col">
        <TabList label="Asset sources">
          <Tab value="models" className="flex-1 px-1 tracking-[0.06em]">Models</Tab>
          <Tab value="textures" className="flex-1 px-1 tracking-[0.06em]">Textures</Tab>
          <Tab value="blockout" className="flex-1 px-1 tracking-[0.06em]">Blockout</Tab>
          <Tab value="local" className="flex-1 px-1 tracking-[0.06em]">Local</Tab>
        </TabList>
        {tab === "models" || tab === "textures" ? <Input aria-label={`Search ${tab}`} placeholder="search…" value={query} onChange={(e) => setQuery(e.target.value)} className="mt-2" /> : null}
        <TabPanel value="models" className="lp-scroll mt-2 min-h-0 overflow-y-auto" tabIndex={0}>
          {models.error ? (
            <p className="text-xs text-bright">! {models.error}</p>
          ) : !models.items || models.loading ? (
            <p className="font-ocr text-xs text-muted">LOADING…</p>
          ) : models.items.length ? (
            <ul aria-label="Library models" className="grid grid-cols-2 gap-1.5">
              {models.items.map((m) => (
                <li key={m.fileId} {...dragProps({ type: "model", item: m })} className="flex cursor-grab flex-col border border-rule-strong bg-sunken active:cursor-grabbing">
                  <div className="aspect-square bg-sunken">{m.thumbnail ? <img src={m.thumbnail} alt="" className="h-full w-full object-contain" loading="lazy" draggable={false} /> : null}</div>
                  <div className="flex flex-1 flex-col gap-1 p-1.5">
                    <p className="line-clamp-2 text-[12px] leading-snug text-fg">{m.title}</p>
                    <p className="font-ocr text-[10.5px] text-muted">
                      {m.triangles ? `${formatCount(m.triangles)} tris` : formatBytes(m.sizeBytes)}
                      {m.licence ? ` // ${m.licence}` : ""}
                    </p>
                    <button type="button" className={cn(small, "mt-auto")} onClick={() => onAddModel(m)}>
                      Add<span className="sr-only"> {m.title}</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">{query.trim() ? "No models match." : "No published models yet. Add your own GLB under Local."}</p>
          )}
        </TabPanel>
        <TabPanel value="textures" className="lp-scroll mt-2 min-h-0 overflow-y-auto" tabIndex={0}>
          <p className="type-data mb-2 text-muted">{canTexture ? "Applies to the selected blockout shapes." : "Select a box, plane or cylinder to texture it."}</p>
          {textures.error ? (
            <p className="text-xs text-bright">! {textures.error}</p>
          ) : !textures.items || textures.loading ? (
            <p className="font-ocr text-xs text-muted">LOADING…</p>
          ) : textures.items.length ? (
            <ul aria-label="Library textures" className="grid grid-cols-3 gap-1.5">
              {textures.items.map((t) => (
                <li key={t.fileId}>
                  <button type="button" disabled={!canTexture} onClick={() => onUseTexture(t)} className="group flex w-full cursor-pointer flex-col border border-rule-strong bg-sunken text-left hover:border-edge-hover disabled:cursor-not-allowed disabled:opacity-60" title={`${t.title}${t.licence ? ` (${t.licence})` : ""}`}>
                    <span className="block aspect-square bg-checker">{t.thumbnail ? <img src={t.thumbnail} alt="" className="h-full w-full object-cover [image-rendering:pixelated]" loading="lazy" /> : null}</span>
                    <span className="truncate px-1 py-0.5 text-[11px] text-fg">
                      <span className="sr-only">Use </span>
                      {t.title}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">No published textures match.</p>
          )}
        </TabPanel>
        <TabPanel value="blockout" className="mt-2">
          <ul aria-label="Blockout shapes" className="flex flex-col gap-1.5">
            {SHAPES.map((s) => (
              <li key={s.shape} {...dragProps({ type: "primitive", shape: s.shape })} className="flex cursor-grab items-center gap-2 border border-rule-strong bg-sunken px-2 py-1.5 active:cursor-grabbing">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-fg">{s.label}</span>
                  <span className="font-ocr text-[11px] text-muted">{s.note}</span>
                </span>
                <button type="button" className={small} onClick={() => onAddPrimitive(s.shape)}>
                  Add<span className="sr-only"> {s.label.toLowerCase()}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="type-data mt-2 text-muted">Drag onto the floor to place, or Add to drop at the centre of the view. Texture them from the Textures tab.</p>
        </TabPanel>
        <TabPanel value="local" className="mt-2">
          <div className="flex flex-col items-center gap-1.5 border border-dashed border-edge bg-sunken px-3 py-4 text-center">
            <button type="button" onClick={() => fileRef.current?.click()} className="cursor-pointer font-ocr tracking-[0.1em] uppercase glow">
              [ Add GLB or image ]
            </button>
            <span className="font-ocr text-[11px] text-muted">or drop files on the viewport</span>
            <input ref={fileRef} type="file" multiple hidden accept=".glb,.gltf,.png,.jpg,.jpeg,.webp,model/gltf-binary,image/*" aria-label="Local models or textures" onChange={(e) => (onLocalFiles([...(e.target.files ?? [])]), (e.target.value = ""))} />
          </div>
          <p className="type-data mt-2 text-muted">Models: GLB, or glTF with everything embedded. Images become textures for the selected shapes. Files stay on this device; they&apos;re kept in this browser so a recovered scene can find them.</p>
          <button type="button" className={cn(small, "mt-2")} onClick={onForgetFiles}>
            Forget kept files
          </button>
        </TabPanel>
      </Tabs>
    </section>
  );
}
