"use client";

import { zipSync, type Zippable } from "fflate";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/controls";
import { Toggle } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { formatBytes } from "@/lib/format";
import { DEFAULTS, type SeamlessMetrics, type SeamlessSettings } from "@/lib/processing/seamless/engine";
import { SeamlessClient } from "./engine-client";
import { EXPORT_SIZES, ExportPanel } from "./export-panel";
import { LibraryPanel } from "./library-panel";
import { applyPattern, collator, colNames, extOf, isCustom, isImage, itemsIn, LOOSE, ordered, readDrop, safeName, zipEntryName, type Entry, type Item } from "./model";
import { PipelinePanel, type ModuleKey } from "./pipeline-panel";
import type { ExportFormat } from "./protocol";
import { Viewport, type ViewState } from "./viewport";

interface Result {
  id: number;
  key: string;
  result: ImageBitmap;
  source: ImageBitmap;
  metrics: SeamlessMetrics;
  ms: number;
  bytes: number;
}

interface Prefs {
  format: ExportFormat;
  quality: number;
  sizes: number[];
  scope: "collection" | "all";
  modules: Record<ModuleKey, boolean>;
}

const PREFS_KEY = "lp-seamless-prefs";
const DEFAULT_PREFS: Prefs = { format: "png", quality: 92, sizes: [...EXPORT_SIZES], scope: "all", modules: { source: true, tile: true, key: true, psx: true } };
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const SAMPLES = ["demo-red-brick", "demo-wood-planks", "demo-cobblestones", "demo-rusted-plate", "demo-patchy-grass", "demo-steel-grate"];

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

function save(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const settingsKey = (s: SeamlessSettings, f: ExportFormat, q: number) => `${JSON.stringify(s)}|${f}|${q}`;

export function SeamlessTool() {
  const client = useRef<SeamlessClient | null>(null);
  const nextId = useRef(1);
  const [items, setItems] = useState<Item[]>([]);
  const [cols, setCols] = useState<Record<string, { collapsed: boolean }>>({});
  const [active, setActive] = useState<number | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>({ view: "split", grid: 3, tsrc: "result", seams: false, pixelated: false, divider: 0.5, pan: { x: 0, y: 0 }, zoom: 1 });
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const lastEdit = useRef<{ key: string; at: number; id: number } | null>(null);

  const it = items.find((i) => i.id === active) ?? null;
  const list = useMemo(() => ordered(items, cols), [items, cols]);

  useEffect(() => {
    client.current = new SeamlessClient();
    // Saved settings only (never images): format, sizes, scope, which modules are open.
    setPrefs(loadPrefs());
    return () => client.current?.dispose();
  }, []);
  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // private mode: settings just won't be remembered
      }
      return next;
    });
  }, []);

  // Event handlers read the latest items and collections through refs, so a
  // handler never works from a stale list and updaters stay side-effect free.
  const itemsRef = useRef(items);
  const colsRef = useRef(cols);
  useLayoutEffect(() => {
    itemsRef.current = items;
    colsRef.current = cols;
  });
  const commitItems = useCallback((next: Item[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);
  // Release thumbnails when the tool closes.
  useEffect(() => () => itemsRef.current.forEach((i) => URL.revokeObjectURL(i.thumb)), []);

  /* ------------------------------------------------------------ processing */
  const key = it ? settingsKey(it.settings, prefs.format, prefs.quality) : null;
  const current = res && it && res.id === it.id && res.key === key ? res : null;
  // Keep showing the previous render of the same file while a new one is computed.
  const shown = res && it && res.id === it.id ? res : null;

  useEffect(() => {
    const item = itemsRef.current.find((x) => x.id === active);
    if (!item || !client.current || !key) return;
    let cancelled = false;
    const id = item.id;
    const t = setTimeout(async () => {
      try {
        const r = await client.current!.process(id, item.file, item.settings, { format: prefs.format, quality: prefs.quality });
        if (cancelled) {
          r.result.close();
          r.source.close();
          return;
        }
        setFailed(null);
        setRes((old) => {
          if (old) {
            old.result.close();
            old.source.close();
          }
          return { id, key, result: r.result, source: r.source, metrics: r.metrics, ms: r.ms, bytes: r.bytes };
        });
        if (!item.w) commitItems(itemsRef.current.map((x) => (x.id === id ? { ...x, w: r.inputWidth, h: r.inputHeight } : x)));
      } catch (e) {
        if (!cancelled) setFailed(e instanceof Error ? e.message : "Processing failed.");
      }
    }, 80);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // `key` covers the active file's settings, format and quality.
  }, [active, key, prefs.format, prefs.quality, commitItems]);

  /* ---------------------------------------------------------------- edits */
  const patchItem = useCallback((id: number, fn: (i: Item) => Item) => setItems((all) => all.map((x) => (x.id === id ? fn(x) : x))), []);

  const setParam = useCallback(
    <K extends keyof SeamlessSettings>(k: K, v: SeamlessSettings[K]) => {
      if (active === null) return;
      const now = Date.now();
      // A slider drag is one undo step: coalesce edits to the same key within half a second.
      const coalesce = lastEdit.current && lastEdit.current.key === k && lastEdit.current.id === active && now - lastEdit.current.at < 500;
      lastEdit.current = { key: k, at: now, id: active };
      patchItem(active, (x) => ({ ...x, settings: { ...x.settings, [k]: v }, history: coalesce ? x.history : [...x.history.slice(-49), x.settings] }));
    },
    [active, patchItem],
  );

  const undo = () => {
    if (!it?.history.length) return;
    lastEdit.current = null;
    patchItem(it.id, (x) => ({ ...x, settings: x.history[x.history.length - 1]!, history: x.history.slice(0, -1) }));
  };
  const reset = () => {
    if (!it) return;
    lastEdit.current = null;
    patchItem(it.id, (x) => ({ ...x, settings: { ...DEFAULTS }, history: [...x.history.slice(-49), x.settings] }));
    toast.ok("Settings reset");
  };
  const applyTo = (targets: Item[], label: string) => {
    if (!it) return;
    const others = targets.filter((o) => o.id !== it.id);
    if (!others.length) return toast({ title: "Nothing else to apply to" });
    const custom = others.filter(isCustom).length;
    if (custom && !window.confirm(`Overwrite the settings of ${custom} customised file(s) in ${label}?`)) return;
    const ids = new Set(others.map((o) => o.id));
    setItems((all) => all.map((x) => (ids.has(x.id) ? { ...x, settings: { ...it.settings }, history: [...x.history.slice(-49), x.settings] } : x)));
    toast.ok(`Settings → ${others.length} file(s) in ${label}`);
  };

  /* -------------------------------------------------------------- library */
  const ingest = useCallback(
    (entries: Entry[], readFailed = false) => {
      entries = entries.filter((e) => !e.file.name.startsWith("."));
      const tooBig = entries.filter((e) => e.file.size > MAX_FILE_BYTES);
      const files = entries.filter((e) => isImage(e.file) && e.file.size <= MAX_FILE_BYTES);
      if (tooBig.length) toast.error(`${tooBig.length} file(s) skipped`, `Files over ${formatBytes(MAX_FILE_BYTES)} aren't loaded.`);
      if (!files.length) {
        if (readFailed) return toast.error("This browser blocked reading the dropped folder", "Use + Folder instead.");
        const exts = [...new Set(entries.map((e) => (e.file.name.match(/\.[^.]+$/) ?? ["(no extension)"])[0].toLowerCase()))].slice(0, 5);
        return toast({ title: entries.length ? `No supported images in ${entries.length} file(s)` : "No files found in that folder", description: entries.length ? `Found ${exts.join(" ")}` : undefined });
      }
      if (readFailed) toast({ title: "Some folders could not be read", description: "Try + Folder for those." });
      const added: Item[] = files.map(({ file, col }) => {
        const base = file.name.replace(/\.[^.]+$/, "");
        return { id: nextId.current++, file, base, name: base, col: col || LOOSE, thumb: URL.createObjectURL(file), settings: { ...DEFAULTS }, history: [], w: 0, h: 0 };
      });
      const touched = new Set(added.map((a) => a.col));
      const nextCols = { ...colsRef.current };
      for (const t of touched) nextCols[t] ??= { collapsed: false };
      colsRef.current = nextCols;
      setCols(nextCols);
      const merged = [...itemsRef.current, ...added];
      commitItems(merged);
      setActive((cur) => {
        if (cur !== null && merged.some((m) => m.id === cur)) return cur;
        const firstCol = [...touched].sort((a, b) => collator.compare(a, b))[0]!;
        return itemsIn(merged, firstCol)[0]?.id ?? null;
      });
      toast({ title: `${files.length} file(s) // ${touched.size} collection(s)` });
    },
    [commitItems],
  );

  const loadSample = async () => {
    try {
      const files = await Promise.all(
        SAMPLES.map(async (slug) => {
          const r = await fetch(`/demo/textures/${slug}.png`);
          if (!r.ok) throw new Error(slug);
          return new File([await r.blob()], `${slug.replace(/^demo-/, "")}.png`, { type: "image/png" });
        }),
      );
      ingest(files.map((file) => ({ file, col: "LOWPO11Y DEMO" })));
    } catch {
      toast.error("Couldn't load the sample textures");
    }
  };

  const removeItems = useCallback(
    (ids: number[]) => {
      if (!ids.length) return;
      const gone = new Set(ids);
      const all = itemsRef.current;
      for (const x of all) {
        if (!gone.has(x.id)) continue;
        URL.revokeObjectURL(x.thumb);
        client.current?.forget(x.id);
      }
      const rest = all.filter((x) => !gone.has(x.id));
      const ord = ordered(all, colsRef.current);
      commitItems(rest);
      setActive((cur) => {
        if (cur === null || !gone.has(cur)) return cur;
        const pos = ord.findIndex((x) => x.id === cur);
        const after = ord.filter((x) => !gone.has(x.id));
        return after[Math.min(pos, after.length - 1)]?.id ?? null;
      });
      const nextCols = Object.fromEntries(Object.entries(colsRef.current).filter(([name]) => rest.some((r) => r.col === name)));
      colsRef.current = nextCols;
      setCols(nextCols);
    },
    [commitItems],
  );

  const select = useCallback(
    (id: number) => {
      setActive(id);
      setView((v) => ({ ...v, pan: { x: 0, y: 0 } }));
      const item = items.find((x) => x.id === id);
      if (item && cols[item.col]?.collapsed) setCols((c) => ({ ...c, [item.col]: { collapsed: false } }));
    },
    [items, cols],
  );

  /* --------------------------------------------------------------- export */
  const scopeItems = prefs.scope === "collection" && it ? itemsIn(items, it.col) : list;

  const download = useCallback(async () => {
    if (!it || !client.current) return;
    try {
      const r = await client.current.export(it.id, it.file, it.settings, { format: prefs.format, quality: prefs.quality });
      const fn = safeName(it.name) + extOf(prefs.format);
      save(r.blob, fn);
      toast.ok(`Saved ${fn}`);
    } catch (e) {
      toast.error("Download failed", e instanceof Error ? e.message : undefined);
    }
  }, [it, prefs.format, prefs.quality]);

  const sample3x3 = async () => {
    if (!it || !client.current) return;
    try {
      const r = await client.current.export(it.id, it.file, it.settings, { format: prefs.format, quality: prefs.quality }, true);
      const fn = `${safeName(it.name)}_3x3${extOf(prefs.format)}`;
      save(r.blob, fn);
      toast.ok(`Saved ${fn}`);
    } catch (e) {
      toast.error("Sample failed", e instanceof Error ? e.message : undefined);
    }
  };

  const exportZip = async () => {
    if (!scopeItems.length || !client.current) return;
    const sizes = [...prefs.sizes].sort((a, b) => b - a);
    const passes: (number | null)[] = sizes.length ? sizes : [null];
    const total = scopeItems.length * passes.length;
    const used = new Set<string>();
    const files: { name: string; data: Uint8Array }[] = [];
    let k = 0;
    try {
      for (const item of scopeItems) {
        for (const size of passes) {
          k++;
          setBusy(`zip RENDERING ${k}/${total} // ${item.col.toUpperCase()} // ${item.base.toUpperCase()}${size ? ` @ ${size}` : ""}`);
          const settings = size ? { ...item.settings, size } : item.settings;
          const r = await client.current.export(item.id, item.file, settings, { format: prefs.format, quality: prefs.quality });
          const dir = `${size ? `${size}/` : ""}${safeName(item.col)}/`;
          files.push({ name: zipEntryName(used, dir, item.name, prefs.format), data: new Uint8Array(await r.blob.arrayBuffer()) });
        }
      }
      // folder by folder: size (largest first), then collection, then name
      const rank = (n: string) => (sizes.length ? -parseInt(n, 10) : 0);
      files.sort((a, b) => rank(a.name) - rank(b.name) || collator.compare(a.name, b.name));
      const entries: Zippable = {};
      for (const f of files) entries[f.name] = [f.data, { level: 0 }];
      const scopeTag = prefs.scope === "collection" && it ? `_${safeName(it.col).replace(/\s+/g, "_")}` : "";
      save(new Blob([zipSync(entries) as BlobPart], { type: "application/zip" }), `lowpo11y-seamless${scopeTag}_${new Date().toISOString().slice(0, 10)}.zip`);
      toast.ok(`ZIP saved // ${files.length} file(s)`);
    } catch (e) {
      toast.error("Export failed", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const rename = (pattern: string) => {
    const names = applyPattern(scopeItems, pattern);
    setItems((all) => all.map((x) => (names.has(x.id) ? { ...x, name: names.get(x.id)! } : x)));
    toast.ok(`Renamed ${names.size} file(s)`);
  };

  /* ------------------------------------------------------- keys and drops */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input[type=text], input[type=search], input:not([type]), textarea, select, [contenteditable=true], [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = list.findIndex((i) => i.id === active);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!list.length || t.matches("input[type=range]") || t.closest("[role=group], [role=img]")) return;
        e.preventDefault();
        select(list[(idx + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]!.id);
      } else if (e.key === "d" || e.key === "D") void download();
      else if (e.key === "t" || e.key === "T") setView((v) => ({ ...v, view: v.view === "tile" ? "split" : "tile" }));
      else if ((e.key === "Delete" || e.key === "Backspace") && active !== null && !t.matches("input")) {
        e.preventDefault();
        removeItems([active]);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [list, active, select, download, removeItems]);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");
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
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      toast({ title: "Reading folders…" });
      const { entries, failed } = await readDrop(e.dataTransfer!);
      ingest(entries, failed);
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
  }, [ingest]);

  /* --------------------------------------------------------------- render */
  const s = it?.settings ?? DEFAULTS;
  const m = shown?.metrics;
  const readout = busy?.startsWith("zip") ? (
    <>&gt; {busy.slice(4)}</>
  ) : !it ? (
    <>&gt; IDLE // DROP A TEXTURE FOLDER TO BEGIN</>
  ) : failed ? (
    <>! {failed}</>
  ) : !m ? (
    <>&gt; PROCESSING…</>
  ) : (
    <>
      &gt; SIZE <b>{m.width}×{m.height}</b>{" "}
      {s.tile ? (
        <>
          // SEAM <b>{m.before.toFixed(2)}×</b> → <b>{m.after.toFixed(2)}×</b> <span title="Seam contrast vs. the texture's own pixel-to-pixel detail. Around 1.00× = invisible">(~1.00 = INVISIBLE)</span>
        </>
      ) : (
        <>
          // <b>TILING OFF</b>
        </>
      )}{" "}
      // COLOURS <b>{m.colors.toLocaleString("en-US")}</b> // <b>{shown!.ms} MS</b>
      {current ? (
        <>
          {" "}
          // <b>≈ {formatBytes(current.bytes)}</b> {prefs.format.toUpperCase()}
        </>
      ) : (
        " // UPDATING…"
      )}
      {view.view === "tile" && view.tsrc === "source" ? " // VIEWING SOURCE" : ""}
    </>
  );
  const customCount = items.filter(isCustom).length;

  return (
    <div className="lp-scroll flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      <header className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-rule-strong px-4 py-2.5 sm:px-6">
        <h1 className="font-ocr text-lg tracking-[0.18em] uppercase glow">Seamless texture</h1>
        <p className="font-ocr text-[12px] tracking-[0.08em] text-muted uppercase">&gt; Texture tiling terminal // 11AM-Seamless v2 engine // files never leave this machine</p>
        <ul className="ml-auto flex flex-wrap gap-x-4 font-ocr text-[12px] tracking-[0.06em] text-muted uppercase" aria-label="Library stats">
          <li>
            Collections: <strong className="font-normal glow">{colNames(cols).length}</strong>
          </li>
          <li>
            Files: <strong className="font-normal glow">{items.length}</strong>
          </li>
          <li>
            Customised: <strong className="font-normal glow">{customCount}</strong>
          </li>
        </ul>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[17rem_minmax(0,1fr)_22rem] xl:grid-cols-[19rem_minmax(0,1fr)_24rem]">
        <LibraryPanel
          items={items}
          cols={cols}
          active={active}
          format={prefs.format}
          dragging={dragging}
          onIngest={(e) => ingest(e)}
          onSample={loadSample}
          onSelect={select}
          onRemove={(id) => removeItems([id])}
          onToggleCol={(c) => setCols((x) => ({ ...x, [c]: { collapsed: !x[c]?.collapsed } }))}
          onRenameCol={(c) => {
            const nn = window.prompt("Collection name (also the export folder name):", c)?.trim();
            if (!nn || nn === c) return;
            setCols((x) => {
              const { [c]: meta, ...rest } = x;
              return { ...rest, [nn]: rest[nn] ?? meta ?? { collapsed: false } };
            });
            setItems((all) => all.map((i) => (i.col === c ? { ...i, col: nn } : i)));
          }}
          onRemoveCol={(c) => {
            const n = itemsIn(items, c).length;
            if (window.confirm(`Remove collection "${c}" (${n} file(s)) from the library?`)) removeItems(itemsIn(items, c).map((i) => i.id));
          }}
          onAllCols={(collapsed) => setCols((x) => Object.fromEntries(Object.keys(x).map((k) => [k, { collapsed }])))}
          onClear={() => {
            if (items.length && window.confirm(`Clear all ${items.length} file(s) from the library?`)) removeItems(items.map((i) => i.id));
          }}
        />

        <section aria-label="Viewport" className="flex min-h-[26rem] flex-col gap-2 border border-rule-strong bg-panel p-3 lg:min-h-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="type-panel mr-auto">
              // Viewport {it ? <span className="text-muted normal-case">// {it.base}</span> : null}
            </h2>
            <SegmentedControl
              label="View"
              hideLabel
              size="sm"
              className="w-56"
              value={view.view}
              onChange={(v) => setView((x) => ({ ...x, view: v }))}
              options={[
                { value: "split", label: "Split" },
                { value: "tile", label: "Tile check" },
              ]}
            />
          </div>
          {view.view === "tile" ? (
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl
                label="Tile grid"
                hideLabel
                size="sm"
                className="w-52"
                value={String(view.grid)}
                onChange={(g) => setView((x) => ({ ...x, grid: Number(g), zoom: 1, pan: { x: 0, y: 0 } }))}
                options={["2", "3", "4", "6"].map((g) => ({ value: g, label: `${g}×${g}` }))}
              />
              <SegmentedControl
                label="Tile source"
                hideLabel
                size="sm"
                className="w-44"
                value={view.tsrc}
                onChange={(t) => setView((x) => ({ ...x, tsrc: t }))}
                options={[
                  { value: "result", label: "Result" },
                  { value: "source", label: "Source" },
                ]}
              />
              <Toggle pressed={view.seams} onPressedChange={(v) => setView((x) => ({ ...x, seams: v }))}>
                Seam lines
              </Toggle>
              <Button size="sm" onClick={() => setView((x) => ({ ...x, zoom: 1, pan: { x: 0, y: 0 } }))}>
                Recenter
              </Button>
            </div>
          ) : null}
          <Viewport
            result={shown?.result ?? null}
            source={shown?.source ?? null}
            hasItem={!!it}
            state={view}
            onChange={(p) => setView((x) => ({ ...x, ...p }))}
            label={it ? `${it.base}` : ""}
            readout={readout}
          />
        </section>

        <aside aria-label="Settings" className="lp-scroll flex min-h-0 flex-col gap-3 lg:overflow-y-auto lg:pr-1">
          <section aria-label="Editing" className="border border-rule-strong bg-panel p-3">
            <h2 className="type-panel mb-2.5">// Editing</h2>
            {it ? (
              <div className="grid grid-cols-[44px_1fr] items-center gap-2.5">
                <img src={it.thumb} alt="" className="size-11 border border-rule-strong bg-checker object-cover" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-bright">{it.base}</span>
                  <span className="block truncate font-ocr text-[11px] tracking-[0.04em] text-muted uppercase">
                    {it.w ? `${it.w}×${it.h}` : "…"} // {it.col}
                    {isCustom(it) ? " // customised" : ""}
                  </span>
                </span>
              </div>
            ) : (
              <p className="font-ocr text-xs text-muted">&gt; select a file in the library</p>
            )}
            <p className="type-label mt-3 mb-1.5">Copy these settings to</p>
            <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-1.5">
              <Button size="sm" disabled={!it} onClick={() => it && applyTo(itemsIn(items, it.col), it.col)} title="Copy this file's settings to every file in its collection">
                Collection{it ? ` (${itemsIn(items, it.col).length})` : ""}
              </Button>
              <Button size="sm" disabled={!it} onClick={() => applyTo(items, "the whole library")} title="Copy this file's settings to every file in the library">
                Everything{items.length ? ` (${items.length})` : ""}
              </Button>
              <Button size="sm" variant="ghost" disabled={!it?.history.length} onClick={undo} title="Undo the last settings change for this file">
                Undo
              </Button>
              <Button size="sm" variant="ghost" disabled={!it} onClick={reset} title="Back to default settings for this file">
                Reset
              </Button>
            </div>
          </section>

          <section aria-label="Processing pipeline" className="border border-rule-strong bg-panel p-3">
            <h2 className="type-panel mb-2.5">
              // Pipeline <span className="tracking-[0.06em] text-muted normal-case">runs top → bottom</span>
            </h2>
            <PipelinePanel
              settings={s}
              setParam={setParam}
              disabled={!it}
              format={prefs.format}
              open={prefs.modules}
              setOpen={(mod, v) => updatePrefs({ modules: { ...prefs.modules, [mod]: v } })}
            />
          </section>

          <ExportPanel
            active={it}
            scopeItems={scopeItems}
            format={prefs.format}
            quality={prefs.quality}
            scope={prefs.scope}
            sizes={prefs.sizes}
            busy={busy}
            onFormat={(f) => {
              updatePrefs({ format: f });
              if (f === "jpg" && items.some((i) => i.settings.keyBlack)) toast({ title: "JPG has no transparency", description: "Use PNG or WEBP." });
            }}
            onQuality={(q) => updatePrefs({ quality: q })}
            onName={(name) => it && patchItem(it.id, (x) => ({ ...x, name }))}
            onDownload={download}
            onSample={sample3x3}
            onScope={(sc) => updatePrefs({ scope: sc })}
            onSizes={(sz) => updatePrefs({ sizes: sz })}
            onZip={exportZip}
            onRename={rename}
          />
        </aside>
      </div>
    </div>
  );
}
