"use client";

import { zipSync } from "fflate";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ColorField, NumberField, SegmentedControl } from "@/components/ui/controls";
import { Input, PromptInput, Toggle } from "@/components/ui/form";
import { Module } from "@/components/ui/panel";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { buildAtlasDoc, toAtlasCsv, toAtlasJson, UV_PRESETS, type AtlasDoc } from "@/lib/formats/atlas-json";
import { PACK_DEFAULTS, type PackSettings, type Placement, type Rotation } from "@/lib/processing/atlas";
import { hexToRgb, isPowerOfTwo } from "@/lib/processing/image";
import type { Fit, Sampling } from "@/lib/processing/resample";
import { fromInput, isImage, readDrop, useWindowDrop, type DroppedFile } from "../shared/drop";
import { baseName, saveBlob, toBitmap } from "../shared/files";
import { AtlasCanvas } from "./atlas-canvas";
import type { AtlasRequest, AtlasResponse } from "./worker";

const STORE_KEY = "lp-atlas-settings";
const MAX_TILES = 512;
const SAMPLES = ["demo-red-brick", "demo-wood-planks", "demo-cobblestones", "demo-rusted-plate", "demo-steel-grate", "demo-hazard-stripes", "demo-patchy-grass", "demo-tread-plate"];

interface Tile {
  id: number;
  file: File;
  key: string;
  name: string;
  thumb: string;
  rotate: Rotation;
  trim: boolean;
  fill: string | null;
}

interface Settings {
  tileMode: "original" | "fixed";
  tileW: number;
  tileH: number;
  fit: Fit;
  sampling: Sampling;
  pack: PackSettings;
  uv: string;
  inset: 0 | 0.5;
}

const DEFAULTS: Settings = { tileMode: "original", tileW: 64, tileH: 64, fit: "crop", sampling: "nearest", pack: PACK_DEFAULTS, uv: "blender", inset: 0 };

interface Result {
  key: string;
  width: number;
  height: number;
  bitmap: ImageBitmap;
  /** Arrives just after the layout. */
  png: Uint8Array | null;
  placements: Placement[];
  overflow: number[];
  sizes: { w: number; h: number }[];
  failed: number[];
  ms: number;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULTS;
    const v = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULTS, ...v, pack: { ...PACK_DEFAULTS, ...v.pack } };
  } catch {
    return DEFAULTS;
  }
}

const safeName = (s: string) => s.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_") || "tile";

export function AtlasTool() {
  const worker = useRef<Worker | null>(null);
  const token = useRef(0);
  const nextId = useRef(1);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guides, setGuides] = useState(true);
  const [name, setName] = useState("atlas");
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const tilesRef = useRef(tiles);
  useEffect(() => {
    tilesRef.current = tiles;
  });

  useEffect(() => {
    worker.current = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore after mount
    setSettings(loadSettings());
    return () => {
      worker.current?.terminate();
      tilesRef.current.forEach((t) => URL.revokeObjectURL(t.thumb));
    };
  }, []);

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      // private mode: settings just aren't remembered
    }
  };
  const updatePack = (patch: Partial<PackSettings>) => update({ pack: { ...settings.pack, ...patch } });

  /* ---------------------------------------------------------------- tiles */
  const ingest = useCallback((dropped: DroppedFile[]) => {
    const taken = new Set(tilesRef.current.map((t) => t.name.toLowerCase()));
    const fresh: Tile[] = [];
    let skipped = 0;
    for (const { file } of dropped) {
      if (file.name.startsWith(".")) continue;
      if (!isImage(file) || file.size > 64 * 1024 * 1024) {
        skipped++;
        continue;
      }
      let n = safeName(baseName(file.name)),
        k = 2;
      const base = n;
      while (taken.has(n.toLowerCase())) n = `${base}_${k++}`;
      taken.add(n.toLowerCase());
      fresh.push({ id: nextId.current++, file, key: `${file.name}:${file.size}:${file.lastModified}:${nextId.current}`, name: n, thumb: URL.createObjectURL(file), rotate: 0, trim: false, fill: null });
    }
    const room = MAX_TILES - tilesRef.current.length;
    fresh.splice(room).forEach((t) => URL.revokeObjectURL(t.thumb));
    if (fresh.length) {
      setTiles((ts) => [...ts, ...fresh]);
      setSelectedId((s) => s ?? fresh[0]!.id);
      toast.ok(`Added ${fresh.length} tile${fresh.length > 1 ? "s" : ""}`, skipped ? `${skipped} non-image file${skipped > 1 ? "s" : ""} skipped` : undefined);
    } else if (skipped) toast.error("Nothing added", "Only images can be atlas tiles.");
  }, []);

  const dragging = useWindowDrop(async (dt) => ingest((await readDrop(dt)).files));

  const loadSample = async () => {
    try {
      const files = await Promise.all(
        SAMPLES.map(async (slug) => {
          const r = await fetch(`/demo/textures/${slug}.png`);
          if (!r.ok) throw new Error(slug);
          return { file: new File([await r.blob()], `${slug.replace(/^demo-/, "")}.png`, { type: "image/png" }), dir: "" };
        }),
      );
      ingest(files);
    } catch {
      toast.error("Couldn't load the sample tiles");
    }
  };

  const patchTile = (id: number, patch: Partial<Tile>) => setTiles((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const moveTile = (id: number, dir: -1 | 1) =>
    setTiles((ts) => {
      const i = ts.findIndex((t) => t.id === id),
        j = i + dir;
      if (i < 0 || j < 0 || j >= ts.length) return ts;
      const c = [...ts];
      [c[i], c[j]] = [c[j]!, c[i]!];
      return c;
    });
  const removeTiles = (ids: number[]) => {
    const gone = new Set(ids);
    tilesRef.current.filter((t) => gone.has(t.id)).forEach((t) => URL.revokeObjectURL(t.thumb));
    const rest = tilesRef.current.filter((t) => !gone.has(t.id));
    setTiles(rest);
    if (selectedId !== null && gone.has(selectedId)) setSelectedId(rest[0]?.id ?? null);
  };

  /* ---------------------------------------------------------------- pack */
  const s = settings;
  const tileSize = s.tileMode === "fixed" ? { w: s.tileW, h: s.tileH, fit: s.fit, sampling: s.sampling } : null;
  const jobKey = JSON.stringify([tiles.map((t) => [t.key, t.rotate, t.trim, t.fill]), tileSize, s.pack]);
  useEffect(() => {
    const w = worker.current;
    if (!w || !tiles.length) return;
    const t = ++token.current;
    const timer = setTimeout(() => {
      w.onmessage = async (ev: MessageEvent<AtlasResponse>) => {
        const m = ev.data;
        if (m.token !== token.current) return;
        if (!m.ok) return setError(m.message);
        if (m.kind === "png") return setResult((r) => (r && r.key === jobKey ? { ...r, png: m.png } : r));
        const bitmap = await toBitmap(m.image);
        if (m.token !== token.current) return bitmap.close();
        setError(null);
        setResult((old) => {
          old?.bitmap.close();
          return { key: jobKey, width: m.width, height: m.height, bitmap, png: null, placements: m.placements, overflow: m.overflow, sizes: m.sizes, failed: m.failed, ms: m.ms };
        });
      };
      w.postMessage({
        token: t,
        tiles: tiles.map((x) => ({ key: x.key, file: x.file, rotate: x.rotate, trim: x.trim, fill: x.fill ? hexToRgb(x.fill) : null })),
        tileSize,
        pack: s.pack,
      } satisfies AtlasRequest);
    }, 80);
    return () => clearTimeout(timer);
    // jobKey captures every input that changes the atlas
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobKey]);

  const current = result && result.key === jobKey && tiles.length ? result : null;
  const shown = tiles.length ? result : null;
  const preset = UV_PRESETS.find((p) => p.id === s.uv) ?? UV_PRESETS[0]!;

  const dupes = (() => {
    const seen = new Map<string, number>();
    tiles.forEach((t) => seen.set(t.name.trim().toLowerCase(), (seen.get(t.name.trim().toLowerCase()) ?? 0) + 1));
    return tiles.filter((t) => (seen.get(t.name.trim().toLowerCase()) ?? 0) > 1 || !t.name.trim()).length;
  })();

  const doc = (): AtlasDoc | null => {
    if (!current) return null;
    return buildAtlasDoc({
      image: `${safeName(name)}.png`,
      width: current.width,
      height: current.height,
      uvOrigin: preset.origin,
      uvInset: s.inset,
      padding: s.pack.padding,
      extrude: s.pack.extrude,
      frames: current.placements.map((p) => {
        const t = tiles[p.index]!,
          src = current.sizes[p.index]!;
        return { name: t.name.trim(), x: p.x, y: p.y, w: p.w, h: p.h, rotated: p.rotated, sourceW: src.w, sourceH: src.h };
      }),
    });
  };

  const exportAs = (kind: "png" | "json" | "csv" | "zip") => {
    const d = doc();
    if (!d || !current) return;
    const base = safeName(name);
    if (!current.png) return;
    if (kind === "png") saveBlob(new Blob([current.png as BlobPart], { type: "image/png" }), `${base}.png`);
    else if (kind === "json") saveBlob(new Blob([toAtlasJson(d)], { type: "application/json" }), `${base}.json`);
    else if (kind === "csv") saveBlob(new Blob([toAtlasCsv(d)], { type: "text/csv" }), `${base}.csv`);
    else {
      const enc = new TextEncoder();
      const zip = zipSync({ [`${base}.png`]: [current.png, { level: 0 }], [`${base}.json`]: enc.encode(toAtlasJson(d)), [`${base}.csv`]: enc.encode(toAtlasCsv(d)) });
      saveBlob(new Blob([zip as BlobPart], { type: "application/zip" }), `${base}.zip`);
    }
    toast.ok(`Saved ${kind.toUpperCase()}`);
  };

  /* -------------------------------------------------------------- render */
  const selected = tiles.find((t) => t.id === selectedId) ?? null;
  const selIndex = selected ? tiles.indexOf(selected) : -1;
  const frames = shown ? shown.placements.map((p) => ({ id: tiles[p.index]?.id ?? -1, name: tiles[p.index]?.name ?? "", x: p.x, y: p.y, w: p.w, h: p.h })) : [];
  const fillPct = shown ? Math.round((shown.placements.reduce((n, p) => n + p.w * p.h, 0) / (shown.width * shown.height)) * 100) : 0;
  const pot = shown ? isPowerOfTwo(shown.width) && isPowerOfTwo(shown.height) : false;
  const overflowNames = shown ? shown.overflow.map((i) => tiles[i]?.name).filter(Boolean) : [];
  const failedNames = shown ? shown.failed.map((i) => tiles[i]?.name).filter(Boolean) : [];
  const exportBlocked = !current?.png || !!dupes || !!overflowNames.length;
  const small = "cursor-pointer border border-edge bg-sunken px-2 py-1 font-ocr text-[11px] tracking-[0.05em] text-muted uppercase hover:border-edge-hover hover:text-bright";

  return (
    <div className="lp-scroll flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      <header className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-rule-strong px-4 py-2.5 sm:px-6">
        <h1 className="font-ocr text-lg tracking-[0.18em] uppercase glow">Texture atlas builder</h1>
        <p className="font-ocr text-[12px] tracking-[0.08em] text-muted uppercase">&gt; pack tiles with gutters and edge extrusion // PNG + UV JSON // files never leave this machine</p>
      </header>

      <div className="grid gap-3 p-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[17rem_minmax(0,1fr)_22rem] xl:grid-cols-[19rem_minmax(0,1fr)_24rem]">
        <div className="lp-scroll flex min-h-0 flex-col gap-3 lg:overflow-y-auto">
          <section aria-label="Tiles" className="flex min-h-0 flex-col border border-rule-strong bg-panel p-3">
            <div className="mb-2.5 flex items-center gap-2">
              <h2 className="type-panel mr-auto">// Tiles</h2>
              {tiles.length ? (
                <button type="button" className={small} onClick={() => removeTiles(tiles.map((t) => t.id))}>
                  Clear
                </button>
              ) : null}
            </div>
            <div className={cn("flex flex-col items-center gap-1.5 border border-dashed border-edge bg-sunken px-3 py-3 text-center hover:border-bright hover:shadow-[var(--crt-glow)]", dragging && "border-solid border-bright shadow-[var(--crt-glow)]")}>
              <button type="button" onClick={() => filesRef.current?.click()} className="cursor-pointer font-ocr tracking-[0.1em] uppercase glow">
                [ Drop tiles ]
              </button>
              <span className="font-ocr text-[11px] tracking-[0.04em] text-muted">images or folders // up to {MAX_TILES}</span>
              <span className="mt-1 flex flex-wrap justify-center gap-1.5">
                <button type="button" className={small} onClick={() => filesRef.current?.click()}>
                  + Files
                </button>
                <button type="button" className={small} onClick={() => folderRef.current?.click()}>
                  + Folder
                </button>
                <button type="button" className={small} onClick={loadSample} title="Eight LOWPO11Y demo textures (CC0)">
                  + Sample
                </button>
              </span>
              <input ref={filesRef} type="file" accept="image/*" multiple hidden aria-label="Tile images" onChange={(e) => (ingest(fromInput(e.target.files)), (e.target.value = ""))} />
              <input ref={folderRef} type="file" multiple hidden aria-label="Tile folder" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => (ingest(fromInput(e.target.files)), (e.target.value = ""))} />
            </div>
            {tiles.length ? (
              <ul aria-label="Tile list" className="lp-scroll mt-2 max-h-[18rem] overflow-y-auto border border-rule-strong">
                {tiles.map((t, i) => {
                  const sz = shown?.sizes[i];
                  return (
                    <li key={t.id} className={cn("border-t border-rule first:border-t-0", t.id === selectedId && "bg-hover")}>
                      <button type="button" aria-pressed={t.id === selectedId} onClick={() => setSelectedId(t.id)} className="flex w-full cursor-pointer items-center gap-2 px-1.5 py-1 text-left">
                        <img src={t.thumb} alt="" className="size-7 max-w-none shrink-0 border border-rule-strong object-contain [image-rendering:pixelated]" />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{t.name}</span>
                        <span className="shrink-0 font-ocr text-[11px] text-muted">{sz ? `${sz.w}×${sz.h}` : "…"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>

          {selected ? (
            <section aria-label="Selected tile" className="border border-rule-strong bg-panel p-3">
              <div className="mb-2.5 flex items-center gap-1.5">
                <h2 className="type-panel mr-auto">// Tile {selIndex + 1}</h2>
                <Button size="sm" variant="ghost" disabled={selIndex <= 0} onClick={() => moveTile(selected.id, -1)}>
                  Move up
                </Button>
                <Button size="sm" variant="ghost" disabled={selIndex >= tiles.length - 1} onClick={() => moveTile(selected.id, 1)}>
                  Move down
                </Button>
              </div>
              <div className="flex flex-col gap-2.5">
                <Input aria-label="Tile name" value={selected.name} maxLength={80} onChange={(e) => patchTile(selected.id, { name: e.target.value })} spellCheck={false} />
                <SegmentedControl
                  label="Rotate"
                  inline
                  size="sm"
                  value={String(selected.rotate)}
                  onChange={(v) => patchTile(selected.id, { rotate: Number(v) as Rotation })}
                  options={[0, 90, 180, 270].map((d) => ({ value: String(d), label: `${d}°`, title: d ? `Turn ${d}° clockwise` : "As drawn" }))}
                />
                <Toggle pressed={selected.trim} onPressedChange={(v) => patchTile(selected.id, { trim: v })} title="Cut away fully transparent rows and columns around the tile">
                  Trim transparent edges
                </Toggle>
                <Toggle pressed={!!selected.fill} onPressedChange={(v) => patchTile(selected.id, { fill: v ? "#000000" : null })} title="Fill transparent pixels with a solid colour">
                  Fill transparency
                </Toggle>
                {selected.fill ? <ColorField label="Fill colour" value={selected.fill} onChange={(hex) => patchTile(selected.id, { fill: hex })} /> : null}
                <Button size="sm" variant="ghost" onClick={() => removeTiles([selected.id])}>
                  Remove tile
                </Button>
              </div>
            </section>
          ) : null}
        </div>

        <section aria-label="Atlas" className="flex min-h-[26rem] flex-col gap-2 border border-rule-strong bg-panel p-3 lg:min-h-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="type-panel mr-auto">// Atlas</h2>
            <Toggle pressed={guides} onPressedChange={setGuides} title="Outline every frame">
              Guides
            </Toggle>
          </div>
          <AtlasCanvas
            bitmap={shown?.bitmap ?? null}
            width={shown?.width ?? 1}
            height={shown?.height ?? 1}
            frames={frames}
            extrude={s.pack.extrude}
            selected={selectedId}
            guides={guides}
            onSelect={setSelectedId}
            label={shown ? `Atlas preview, ${shown.width} by ${shown.height} pixels, ${shown.placements.length} tiles` : "Atlas preview, empty"}
          />
          <p role="status" className="font-ocr text-[12px] tracking-[0.04em] text-muted [&_b]:font-normal [&_b]:text-bright">
            {!tiles.length ? (
              <>&gt; IDLE // ADD TILES TO BEGIN</>
            ) : error ? (
              <>! {error}</>
            ) : !shown ? (
              <>&gt; PACKING…</>
            ) : (
              <>
                &gt; <b>{shown.placements.length}</b> TILES // <b>{shown.width}×{shown.height}</b>
                {pot ? " POT" : " (not power of two)"} // FILL <b>{fillPct}%</b> // <b>{shown.ms} MS</b>
                {current?.png ? <> // PNG <b>{formatBytes(current.png.byteLength)}</b></> : null}
              </>
            )}
          </p>
          {overflowNames.length ? (
            <p className="border border-bright px-2 py-1.5 font-ocr text-[12px] text-bright">
              ! {overflowNames.length} tile{overflowNames.length > 1 ? "s don't" : " doesn't"} fit in {shown!.width}×{shown!.height}: {overflowNames.slice(0, 6).join(", ")}
              {overflowNames.length > 6 ? "…" : ""}. Use a larger atlas, auto size, or smaller tiles.
            </p>
          ) : null}
          {failedNames.length ? <p className="font-ocr text-[12px] text-muted">! Couldn&rsquo;t read {failedNames.join(", ")}; left out of the atlas.</p> : null}
        </section>

        <aside aria-label="Settings" className="lp-scroll flex min-h-0 flex-col gap-3 lg:overflow-y-auto lg:pr-1">
          <section aria-label="Atlas settings" className="border border-rule-strong bg-panel p-3">
            <div className="mb-2.5 flex items-center gap-2">
              <h2 className="type-panel mr-auto">// Settings</h2>
              <Button size="sm" variant="ghost" onClick={() => update(DEFAULTS)}>
                Reset
              </Button>
            </div>

            <Module n="01" name="Tile size" summary={s.tileMode === "original" ? "AS IMPORTED" : `${s.tileW}×${s.tileH} ${s.fit.toUpperCase()} · ${s.sampling.toUpperCase()}`}>
              <SegmentedControl label="Size" inline size="sm" value={s.tileMode} onChange={(v) => update({ tileMode: v })} options={[{ value: "original", label: "Original" }, { value: "fixed", label: "Resize all" }]} />
              {s.tileMode === "fixed" ? (
                <>
                  <SegmentedControl label="Square" hideLabel size="sm" value={s.tileW === s.tileH && [16, 32, 64, 128, 256].includes(s.tileW) ? String(s.tileW) : "custom"} onChange={(v) => v !== "custom" && update({ tileW: Number(v), tileH: Number(v) })} options={[...[16, 32, 64, 128, 256].map((n) => ({ value: String(n), label: String(n) })), { value: "custom", label: "…", title: "Custom size below" }]} />
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField label="Width" value={s.tileW} min={1} max={4096} unit="px" onChange={(v) => update({ tileW: v })} />
                    <NumberField label="Height" value={s.tileH} min={1} max={4096} unit="px" onChange={(v) => update({ tileH: v })} />
                  </div>
                  <SegmentedControl label="Fit" inline size="sm" value={s.fit} onChange={(v) => update({ fit: v })} options={[{ value: "crop", label: "Crop" }, { value: "pad", label: "Pad" }, { value: "stretch", label: "Stretch" }]} />
                  <SegmentedControl label="Sampling" inline size="sm" value={s.sampling} onChange={(v) => update({ sampling: v })} options={[{ value: "nearest", label: "Nearest" }, { value: "smooth", label: "Smooth" }]} />
                </>
              ) : null}
            </Module>

            <Module n="02" name="Packing" summary={s.pack.method === "grid" ? `GRID${s.pack.columns ? ` ${s.pack.columns} COL` : ""}` : `MAXRECTS${s.pack.allowRotate ? " · ROTATE" : ""}`}>
              <SegmentedControl
                label="Method"
                inline
                size="sm"
                value={s.pack.method}
                onChange={(v) => updatePack({ method: v })}
                options={[
                  { value: "maxrects", label: "Tight", title: "MaxRects bin packing: mixed sizes, least wasted space" },
                  { value: "grid", label: "Grid", title: "Equal cells in reading order" },
                ]}
              />
              {s.pack.method === "grid" ? (
                <NumberField label="Columns (0 = auto)" value={s.pack.columns} min={0} max={128} onChange={(v) => updatePack({ columns: v })} />
              ) : (
                <Toggle pressed={s.pack.allowRotate} onPressedChange={(v) => updatePack({ allowRotate: v })} title="Tiles may be stored turned 90° clockwise; the JSON marks them rotated">
                  Allow rotation
                </Toggle>
              )}
            </Module>

            <Module n="03" name="Gutters" summary={`PAD ${s.pack.padding} · EXTRUDE ${s.pack.extrude} · BORDER ${s.pack.border}`}>
              <div className="flex flex-col gap-2">
                <NumberField label="Padding" value={s.pack.padding} min={0} max={64} unit="px" onChange={(v) => updatePack({ padding: v })} />
                <NumberField label="Extrude" value={s.pack.extrude} min={0} max={32} unit="px" onChange={(v) => updatePack({ extrude: v })} />
                <NumberField label="Border" value={s.pack.border} min={0} max={64} unit="px" onChange={(v) => updatePack({ border: v })} />
              </div>
              <p className="text-[11.5px] leading-snug text-muted">
                Extrusion repeats each tile&rsquo;s edge pixels outward so filtering and mipmaps don&rsquo;t pull in a neighbour. Each mip level halves the gutter: for <i>n</i> levels keep extrusion near 2<sup>n</sup> px.
              </p>
            </Module>

            <Module n="04" name="Atlas size" summary={s.pack.size === "manual" ? `${s.pack.width}×${s.pack.height}` : `AUTO${s.pack.pot ? " · 2ⁿ" : ""}${s.pack.square ? " · SQUARE" : ""}`}>
              <SegmentedControl label="Size" inline size="sm" value={s.pack.size} onChange={(v) => updatePack({ size: v })} options={[{ value: "auto", label: "Auto" }, { value: "manual", label: "Manual" }]} />
              {s.pack.size === "auto" ? (
                <div className="flex flex-wrap gap-2">
                  <Toggle pressed={s.pack.pot} onPressedChange={(v) => updatePack({ pot: v })} title="Round each side up to a power of two">
                    Power of two
                  </Toggle>
                  <Toggle pressed={s.pack.square} onPressedChange={(v) => updatePack({ square: v })}>
                    Square
                  </Toggle>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label="Width" value={s.pack.width} min={1} max={8192} unit="px" onChange={(v) => updatePack({ width: v })} />
                  <NumberField label="Height" value={s.pack.height} min={1} max={8192} unit="px" onChange={(v) => updatePack({ height: v })} />
                </div>
              )}
            </Module>

            <Module n="05" name="UVs" summary={`${preset.label.toUpperCase()} · ${preset.origin.toUpperCase()}${s.inset ? " · HALF-TEXEL" : ""}`}>
              <SegmentedControl label="Preset" inline size="sm" value={s.uv} onChange={(v) => update({ uv: v })} options={UV_PRESETS.map((p) => ({ value: p.id, label: p.label, title: p.note }))} />
              <p className="text-[11.5px] leading-snug text-muted">{preset.note} Pixel rects in the JSON always count from the top-left.</p>
              <SegmentedControl label="Inset" inline size="sm" value={String(s.inset)} onChange={(v) => update({ inset: Number(v) as 0 | 0.5 })} options={[{ value: "0", label: "Edges", title: "UVs on the frame's outer edges" }, { value: "0.5", label: "Texel centres", title: "Pull UVs in half a texel to avoid sampling the gutter" }]} />
            </Module>
          </section>

          <section aria-label="Export" className="border border-rule-strong bg-panel p-3">
            <h2 className="type-panel mb-2.5">// Export</h2>
            <PromptInput aria-label="Atlas file name" value={name} onChange={(e) => setName(e.target.value)} suffix=".png" spellCheck={false} />
            <Button variant="primary" className="mt-2 w-full" disabled={exportBlocked} onClick={() => exportAs("zip")}>
              Download ZIP · PNG + JSON + CSV
            </Button>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <Button size="sm" disabled={exportBlocked} onClick={() => exportAs("png")}>
                PNG
              </Button>
              <Button size="sm" disabled={exportBlocked} onClick={() => exportAs("json")}>
                JSON
              </Button>
              <Button size="sm" disabled={exportBlocked} onClick={() => exportAs("csv")}>
                CSV
              </Button>
            </div>
            {dupes ? <p className="mt-2 font-ocr text-[11px] text-bright">! Give every tile a unique, non-empty name before exporting.</p> : null}
            <p className="mt-2 font-ocr text-[11px] tracking-[0.04em] text-muted">
              JSON: pixel rects, normalised UVs ({preset.origin}), rotated flag and source sizes for every frame. Use nearest filtering for pixel art.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
