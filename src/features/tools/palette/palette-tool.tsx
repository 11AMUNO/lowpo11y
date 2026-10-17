"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SegmentedControl, SliderField } from "@/components/ui/controls";
import { Dropzone } from "@/components/ui/dropzone";
import { Textarea } from "@/components/ui/form";
import { Advanced } from "@/components/ui/panel";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { encodePng } from "@/lib/formats/png";
import { fromSwatchImage, parsePaletteText, toGpl, toHex, toJson, toSwatchImage, type PaletteDoc } from "@/lib/formats/palette-files";
import { hexToRgb, rgbToHex, type RGB } from "@/lib/processing/image";
import { BUILTIN_PALETTES } from "@/lib/processing/palette";
import { baseName, decodeToRgba, saveBlob, toBitmap } from "../shared/files";
import { Viewport, type ViewState } from "../shared/viewport";
import { EditorPanel } from "./editor-panel";
import { COUNTS, DEFAULT_SETTINGS, DOC_KEY, EMPTY_DOC, fileBase, fromPaletteDoc, loadJson, saveJson, SETTINGS_KEY, swatch, toPaletteDoc, type Doc, type Settings, type Swatch } from "./model";
import type { PaletteJob, PaletteRequest, PaletteResponse } from "./worker";

interface Preview {
  key: string;
  width: number;
  height: number;
  result: ImageBitmap;
  source: ImageBitmap;
  png: Uint8Array;
  ms: number;
}

const SAMPLE = "/demo/textures/demo-rusted-plate.png";

export function PaletteTool() {
  const worker = useRef<Worker | null>(null);
  const token = useRef(0);
  const [doc, setDoc] = useState<Doc>(EMPTY_DOC);
  const [history, setHistory] = useState<Doc[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [file, setFile] = useState<{ file: File; key: string; name: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [view, setView] = useState<ViewState>({ view: "split", grid: 3, tsrc: "result", seams: false, pixelated: true, divider: 0.5, pan: { x: 0, y: 0 }, zoom: 1 });
  const docRef = useRef(doc);
  const lastEdit = useRef<{ key: string; at: number } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    docRef.current = doc;
  });

  useEffect(() => {
    worker.current = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    // The palette and settings are the visitor's own work, kept in this browser; images never are.
    const saved = fromPaletteDoc(loadJson<PaletteDoc>(DOC_KEY, toPaletteDoc(EMPTY_DOC)));
    docRef.current = saved;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore after mount */
    setDoc(saved);
    setSettings(loadJson(SETTINGS_KEY, DEFAULT_SETTINGS));
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => worker.current?.terminate();
  }, []);

  /* ------------------------------------------------------------ doc edits */
  /** Replace the palette; edits with the same coalesce key within 500 ms are one undo step. */
  const commit = useCallback((next: Doc, coalesceKey?: string) => {
    const now = Date.now();
    const coalesce = !!coalesceKey && lastEdit.current?.key === coalesceKey && now - lastEdit.current.at < 500;
    lastEdit.current = coalesceKey ? { key: coalesceKey, at: now } : null;
    const prev = docRef.current;
    if (!coalesce) setHistory((h) => [...h.slice(-49), prev]);
    docRef.current = next;
    setDoc(next);
    saveJson(DOC_KEY, toPaletteDoc(next));
  }, []);

  const replace = (next: Doc, message?: string) => {
    commit(next);
    setSelectedId(next.colours[0]?.id ?? null);
    if (message) toast.ok(message);
  };

  const updateSettings = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveJson(SETTINGS_KEY, next);
  };

  const selected = doc.colours.find((c) => c.id === selectedId) ?? null;

  const add = (cols: RGB[]) => {
    const room = 256 - doc.colours.length;
    const fresh = cols.slice(0, room).map((c) => swatch(c));
    if (!fresh.length) return;
    const at = selected ? doc.colours.indexOf(selected) + 1 : doc.colours.length;
    const colours = [...doc.colours.slice(0, at), ...fresh, ...doc.colours.slice(at)];
    commit({ ...doc, colours });
    setSelectedId(fresh[0]!.id);
  };
  const change = (id: number, patch: Partial<Swatch>, coalesce?: string) => commit({ ...doc, colours: doc.colours.map((c) => (c.id === id ? { ...c, ...patch } : c)) }, coalesce);
  const move = (dir: -1 | 1) => {
    if (!selected) return;
    const i = doc.colours.indexOf(selected),
      j = i + dir;
    if (j < 0 || j >= doc.colours.length) return;
    const colours = [...doc.colours];
    [colours[i], colours[j]] = [colours[j]!, colours[i]!];
    commit({ ...doc, colours });
  };
  const remove = () => {
    if (!selected) return;
    const i = doc.colours.indexOf(selected);
    const colours = doc.colours.filter((c) => c.id !== selected.id);
    commit({ ...doc, colours });
    setSelectedId(colours[Math.min(i, colours.length - 1)]?.id ?? null);
  };
  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    lastEdit.current = null;
    docRef.current = prev;
    setDoc(prev);
    setHistory((h) => h.slice(0, -1));
    saveJson(DOC_KEY, toPaletteDoc(prev));
    if (!prev.colours.some((c) => c.id === selectedId)) setSelectedId(prev.colours[0]?.id ?? null);
  };

  /* ------------------------------------------------------------- source */
  const load = (f: File) => {
    setFile({ file: f, key: `${f.name}:${f.size}:${f.lastModified}`, name: f.name });
    setPreview(null);
    setError(null);
  };
  const loadSample = async () => {
    const r = await fetch(SAMPLE);
    load(new File([await r.blob()], "rusted-plate.png", { type: "image/png" }));
  };

  const run = useCallback((req: PaletteJob, onDone: (m: Extract<PaletteResponse, { ok: true }>) => void) => {
    const w = worker.current;
    if (!w) return;
    const t = ++token.current;
    w.onmessage = (ev: MessageEvent<PaletteResponse>) => {
      const m = ev.data;
      if (m.token !== t) return;
      if (!m.ok) {
        setError(m.message);
        setExtracting(false);
        return;
      }
      setError(null);
      onDone(m);
    };
    w.postMessage({ ...req, token: t } satisfies PaletteRequest);
  }, []);

  const extract = () => {
    if (!file) return;
    setExtracting(true);
    const lockedSwatches = doc.colours.filter((c) => c.locked);
    run({ kind: "extract", fileKey: file.key, file: file.file, count: settings.count, locked: lockedSwatches.map((c) => c.rgb) }, (m) => {
      setExtracting(false);
      if (m.kind !== "extract") return;
      const colours = [...lockedSwatches, ...m.colours.slice(lockedSwatches.length).map((c) => swatch(c))];
      const name = docRef.current.name || baseName(file.name).replace(/[-_]+/g, " ");
      replace({ name, colours }, `Extracted ${colours.length} colours${lockedSwatches.length ? ` (${lockedSwatches.length} locked kept)` : ""} in ${m.ms} ms`);
    });
  };

  // live preview: the image remapped to the palette
  const paletteKey = doc.colours.map((c) => rgbToHex(c.rgb)).join("");
  const key = file ? `${file.key}|${paletteKey}|${settings.dither}|${settings.strength}|${settings.cvd}` : null;
  useEffect(() => {
    if (!file || !key || extracting) return;
    const timer = setTimeout(() => {
      run(
        { kind: "apply", fileKey: file.key, file: file.file, palette: docRef.current.colours.map((c) => c.rgb), dither: settings.dither, strength: settings.strength / 100, cvd: settings.cvd === "none" ? null : settings.cvd },
        async (m) => {
          if (m.kind !== "apply") return;
          const [result, source] = await Promise.all([toBitmap(m.image), toBitmap(m.source)]);
          setPreview((old) => {
            old?.result.close();
            old?.source.close();
            return { key, width: m.width, height: m.height, result, source, png: m.png, ms: m.ms };
          });
        },
      );
    }, 80);
    return () => clearTimeout(timer);
  }, [file, key, settings.dither, settings.strength, settings.cvd, extracting, run]);

  const current = preview && preview.key === key ? preview : null;

  /* -------------------------------------------------------- import/export */
  const exportName = fileBase(doc.name);
  const exportFile = (kind: "gpl" | "hex" | "json" | "png") => {
    if (!doc.colours.length) return;
    const pd = toPaletteDoc(doc);
    if (kind === "png") {
      const cell = settings.cell;
      const img = toSwatchImage(pd.colours.map((c) => c.rgb), cell, cell === 1 ? pd.colours.length : 16);
      saveBlob(new Blob([encodePng(img) as BlobPart], { type: "image/png" }), `${exportName}-${cell}x.png`);
    } else {
      const text = kind === "gpl" ? toGpl(pd) : kind === "hex" ? toHex(pd) : toJson(pd);
      saveBlob(new Blob([text], { type: kind === "json" ? "application/json" : "text/plain" }), `${exportName}.${kind}`);
    }
    toast.ok(`Saved ${kind.toUpperCase()}`);
  };

  const importDoc = (pd: PaletteDoc, fallbackName: string) => {
    if (!pd.colours.length) return toast.error("No colours found");
    replace(fromPaletteDoc({ ...pd, name: pd.name || fallbackName }), `Imported ${pd.colours.length} colours`);
  };
  const importFile = async (f: File) => {
    try {
      if (/\.png$/i.test(f.name) || f.type === "image/png") {
        const img = await decodeToRgba(f, 1024 * 1024);
        importDoc({ name: "", colours: fromSwatchImage(img).map((rgb) => ({ rgb })) }, baseName(f.name));
      } else {
        if (f.size > 1024 * 1024) throw new Error("Palette files are small; this one is over 1 MB.");
        importDoc(parsePaletteText(await f.text()), baseName(f.name));
      }
    } catch (e) {
      toast.error("Couldn't import", e instanceof Error ? e.message : undefined);
    }
  };

  /* -------------------------------------------------------------- render */
  const readout = !file ? (
    <>&gt; NO IMAGE // THE PALETTE STILL WORKS WITHOUT ONE</>
  ) : error ? (
    <>! {error}</>
  ) : !preview ? (
    <>&gt; READING…</>
  ) : (
    <>
      &gt; <b>{preview.width}×{preview.height}</b> // {doc.colours.length ? <>MAPPED TO <b>{doc.colours.length}</b> COLOURS</> : "ORIGINAL"}
      {settings.cvd !== "none" ? <> // SIMULATING {settings.cvd.toUpperCase()}</> : null} // <b>{preview.ms} MS</b>
    </>
  );

  return (
    <div className="lp-scroll flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      <header className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-rule-strong px-4 py-2.5 sm:px-6">
        <h1 className="font-ocr text-lg tracking-[0.18em] uppercase glow">Palette generator</h1>
        <p className="font-ocr text-[12px] tracking-[0.08em] text-muted uppercase">&gt; extract, edit, lock and test palettes // GPL, HEX, JSON and PNG // files never leave this machine</p>
      </header>

      <div className="grid gap-3 p-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[16rem_minmax(0,1fr)_22rem] xl:grid-cols-[18rem_minmax(0,1fr)_24rem]">
        <div className="lp-scroll flex min-h-0 flex-col gap-3 lg:overflow-y-auto">
          <section aria-label="Source image" className="border border-rule-strong bg-panel p-3">
            <h2 className="type-panel mb-2.5">// Source image</h2>
            <Dropzone
              accept="image/*"
              extensions={[".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]}
              maxBytes={64 * 1024 * 1024}
              label={file ? "Replace image" : "Drop an image"}
              hint="Extract its colours, then preview it in your palette. Nothing is uploaded."
              onFiles={(f) => load(f[0]!)}
              onReject={(r) => toast.error("Not loaded", r.join(". "))}
              compact
            >
              <button type="button" onClick={loadSample} className="cursor-pointer border border-edge bg-sunken px-2 py-1 font-ocr text-[11px] tracking-[0.05em] text-muted uppercase hover:text-bright">
                + Sample
              </button>
            </Dropzone>
            {file ? <p className="mt-2 truncate font-ocr text-[11px] tracking-[0.04em] text-muted">{file.name}</p> : null}
          </section>

          <section aria-label="Extract" className="border border-rule-strong bg-panel p-3">
            <h2 className="type-panel mb-2.5">// Extract</h2>
            <SegmentedControl label="Colours" size="sm" value={String(settings.count)} onChange={(v) => updateSettings({ count: Number(v) })} options={COUNTS.map((n) => ({ value: String(n), label: String(n) }))} />
            <Button variant="primary" className="mt-2.5 w-full" disabled={!file || extracting} onClick={extract}>
              {extracting ? "Extracting…" : `Extract ${settings.count} colours`}
            </Button>
            <p className="mt-2 text-[11.5px] leading-snug text-muted">
              Median cut refined with k-means in OKLab, a perceptual colour space. Locked colours are kept exactly and count towards the total.
            </p>
          </section>

          <section aria-label="Starter palettes" className="border border-rule-strong bg-panel p-3">
            <h2 className="type-panel mb-2.5">// Starter palettes</h2>
            <ul className="flex flex-col gap-1.5">
              {BUILTIN_PALETTES.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => replace({ name: p.name, colours: p.colours.map((h) => swatch(hexToRgb(h))) }, `Loaded ${p.name}`)}
                    className="w-full cursor-pointer border border-edge bg-sunken px-2.5 py-2 text-left hover:border-edge-hover"
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-ocr text-[12px] tracking-[0.06em] text-fg uppercase">{p.name}</span>
                      <span className="font-ocr text-[11px] text-muted">{p.colours.length}</span>
                    </span>
                    <span aria-hidden className="mt-1.5 flex gap-px">
                      {p.colours.map((h) => (
                        <span key={h} className="h-3 flex-1" style={{ background: h }} />
                      ))}
                    </span>
                    <span className="mt-1 block text-[11.5px] leading-snug text-muted">{p.note}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] leading-snug text-muted">Original LOWPO11Y palettes. None of them is an official console or hardware palette.</p>
          </section>
        </div>

        <section aria-label="Preview" className="flex min-h-[26rem] flex-col gap-2 border border-rule-strong bg-panel p-3 lg:min-h-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="type-panel mr-auto">// Preview</h2>
            {file ? <SegmentedControl label="View" hideLabel size="sm" className="w-56" value={view.view} onChange={(v) => setView((x) => ({ ...x, view: v }))} options={[{ value: "split", label: "Before/after" }, { value: "tile", label: "Tile check" }]} /> : null}
          </div>
          {file ? (
            <Viewport result={current?.result ?? preview?.result ?? null} source={current?.source ?? preview?.source ?? null} hasItem state={view} onChange={(p) => setView((x) => ({ ...x, ...p }))} label={file.name} readout={readout} />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              {doc.colours.length ? (
                <ul aria-label="Palette board" className="lp-scroll grid min-h-0 flex-1 auto-rows-[minmax(3.5rem,1fr)] grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] content-start gap-1 overflow-y-auto">
                  {doc.colours.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        aria-pressed={c.id === selectedId}
                        aria-label={`Select ${rgbToHex(c.rgb)}${c.name ? ` ${c.name}` : ""}`}
                        onClick={() => setSelectedId(c.id)}
                        className={cn("flex size-full min-h-14 cursor-pointer items-end border p-1 text-left", c.id === selectedId ? "border-bright shadow-[var(--crt-glow)]" : "border-black/50")}
                        style={{ background: rgbToHex(c.rgb) }}
                      >
                        <span className="bg-black/70 px-1 font-ocr text-[10px] text-white uppercase">
                          {rgbToHex(c.rgb)}
                          {c.locked ? " ·L" : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex flex-1 items-center justify-center border border-dashed border-rule-strong">
                  <p className="font-ocr text-[12px] tracking-[0.08em] text-muted uppercase">&gt; Empty palette // start from an image or a starter palette</p>
                </div>
              )}
              <p role="status" className="font-ocr text-[12px] tracking-[0.04em] text-muted">
                {readout}
              </p>
            </div>
          )}
          {file ? (
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-t border-dashed border-rule-strong pt-2">
              <SegmentedControl
                label="Dither"
                size="sm"
                className="w-72"
                value={settings.dither}
                onChange={(v) => updateSettings({ dither: v })}
                options={[
                  { value: "none", label: "None" },
                  { value: "bayer4", label: "4×4" },
                  { value: "bayer8", label: "8×8" },
                  { value: "blue", label: "Blue", title: "Blue-noise threshold mask" },
                  { value: "fs", label: "F-S", title: "Floyd–Steinberg error diffusion" },
                ]}
              />
              {settings.dither !== "none" ? <SliderField label="Strength" className="w-44" value={settings.strength} min={0} max={100} unit="%" onChange={(v) => updateSettings({ strength: v })} /> : null}
              <Button
                className="ml-auto"
                disabled={!current || !doc.colours.length}
                onClick={() => {
                  if (!current) return;
                  saveBlob(new Blob([current.png as BlobPart], { type: "image/png" }), `${baseName(file.name)}-${exportName}.png`);
                  toast.ok("Saved remapped PNG");
                }}
              >
                Download image{current && doc.colours.length ? ` · ${formatBytes(current.png.byteLength)}` : ""}
              </Button>
            </div>
          ) : null}
        </section>

        <aside aria-label="Palette editor" className="lp-scroll flex min-h-0 flex-col gap-3 lg:overflow-y-auto lg:pr-1">
          <EditorPanel
            doc={doc}
            selected={selected}
            settings={settings}
            canUndo={!!history.length}
            onSelect={setSelectedId}
            onRename={(name) => commit({ ...doc, name }, "doc-name")}
            onChange={change}
            onAdd={add}
            onMove={move}
            onRemove={remove}
            onUndo={undo}
            onClear={() => replace(EMPTY_DOC, "Palette cleared // Undo brings it back")}
            onSettings={updateSettings}
          />

          <section aria-label="Import and export" className="border border-rule-strong bg-panel p-3">
            <h2 className="type-panel mb-2.5">// Import / export</h2>
            <div className="grid grid-cols-3 gap-1.5">
              {(["gpl", "hex", "json"] as const).map((k) => (
                <Button key={k} size="sm" disabled={!doc.colours.length} onClick={() => exportFile(k)} title={k === "gpl" ? "GIMP, Krita, Inkscape, Aseprite" : k === "hex" ? "One rrggbb per line (Lospec)" : "LOWPO11Y JSON with names and locks"}>
                  .{k.toUpperCase()}
                </Button>
              ))}
            </div>
            <div className="mt-2 flex items-end gap-2">
              <SegmentedControl label="Swatch cell" size="sm" className="flex-1" value={String(settings.cell)} onChange={(v) => updateSettings({ cell: Number(v) as Settings["cell"] })} options={[1, 8, 32].map((n) => ({ value: String(n), label: `${n}px` }))} />
              <Button size="sm" disabled={!doc.colours.length} onClick={() => exportFile("png")}>
                Swatch PNG
              </Button>
            </div>
            <div className="mt-3 border-t border-dashed border-rule-strong pt-2.5">
              <Button size="sm" className="w-full" onClick={() => importRef.current?.click()}>
                Import a palette file
              </Button>
              <input
                ref={importRef}
                type="file"
                hidden
                aria-label="Palette file"
                accept=".gpl,.hex,.txt,.json,.png,image/png,application/json,text/plain"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importFile(f);
                  e.target.value = "";
                }}
              />
              <p className="mt-1.5 font-ocr text-[11px] tracking-[0.04em] text-muted">.GPL // .HEX // .JSON // PNG swatch (one colour per cell)</p>
              <Advanced label="Paste colours">
                <Textarea aria-label="Pasted palette" rows={3} placeholder={"#0f380f #306230 #8bac0f\nor a whole .gpl file"} value={pasted} onChange={(e) => setPasted(e.target.value)} />
                <Button
                  size="sm"
                  disabled={!pasted.trim()}
                  onClick={() => {
                    try {
                      importDoc(parsePaletteText(pasted), "Pasted palette");
                      setPasted("");
                    } catch (e) {
                      toast.error("Couldn't import", e instanceof Error ? e.message : undefined);
                    }
                  }}
                >
                  Use pasted colours
                </Button>
              </Advanced>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
