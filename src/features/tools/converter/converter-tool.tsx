"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberField, SegmentedControl, SliderField } from "@/components/ui/controls";
import { Dropzone } from "@/components/ui/dropzone";
import { PromptInput, Textarea, Toggle } from "@/components/ui/form";
import { Advanced, Module } from "@/components/ui/panel";
import { toast } from "@/components/ui/toast";
import { formatBytes } from "@/lib/format";
import { isPowerOfTwo, rgbToHex, type RGB } from "@/lib/processing/image";
import { parsePalette } from "@/lib/processing/quantize";
import { outputSize, RETRO_DEFAULTS, RETRO_PRESETS, type RetroSettings } from "@/lib/processing/retro";
import { baseName, saveBlob, toBitmap } from "../shared/files";
import { Viewport, type ViewState } from "../shared/viewport";
import type { ConverterRequest, ConverterResponse } from "./worker";

const STORE_KEY = "lp-converter-settings";
const SIZES = [32, 64, 128, 256, 512];
const BIT_PRESETS: { id: string; label: string; title: string; bits: RetroSettings["bits"] }[] = [
  { id: "888", label: "24-BIT", title: "8 bits per channel (unchanged)", bits: { r: 8, g: 8, b: 8 } },
  { id: "555", label: "RGB555", title: "15-bit colour, as the PS1 stores textures", bits: { r: 5, g: 5, b: 5 } },
  { id: "565", label: "RGB565", title: "16-bit colour with an extra green bit", bits: { r: 5, g: 6, b: 5 } },
  { id: "444", label: "RGB444", title: "12-bit colour", bits: { r: 4, g: 4, b: 4 } },
  { id: "332", label: "RGB332", title: "8-bit colour", bits: { r: 3, g: 3, b: 2 } },
];

interface Output {
  key: string;
  inputWidth: number;
  inputHeight: number;
  result: ImageBitmap;
  source: ImageBitmap;
  png: Uint8Array;
  palette: RGB[];
  colours: number;
  transparent: boolean;
  ms: number;
}

function loadSettings(): RetroSettings {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...RETRO_DEFAULTS, ...(JSON.parse(raw) as Partial<RetroSettings>) } : RETRO_DEFAULTS;
  } catch {
    return RETRO_DEFAULTS;
  }
}

export function ConverterTool() {
  const worker = useRef<Worker | null>(null);
  const token = useRef(0);
  const [file, setFile] = useState<{ file: File; key: string; name: string } | null>(null);
  const [settings, setSettings] = useState<RetroSettings>(RETRO_DEFAULTS);
  const [history, setHistory] = useState<RetroSettings[]>([]);
  const [out, setOut] = useState<Output | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [view, setView] = useState<ViewState>({ view: "split", grid: 3, tsrc: "result", seams: false, pixelated: true, divider: 0.5, pan: { x: 0, y: 0 }, zoom: 1 });
  const [paletteText, setPaletteText] = useState("");
  const lastEdit = useRef<{ key: string; at: number } | null>(null);
  const settingsRef = useRef(settings);
  useLayoutEffect(() => {
    settingsRef.current = settings;
  });

  useEffect(() => {
    worker.current = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    // Saved settings live in localStorage, which only exists after hydration.
    const saved = loadSettings();
    settingsRef.current = saved;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore after mount
    setSettings(saved);
    return () => worker.current?.terminate();
  }, []);

  const persist = (next: RetroSettings) => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      // private mode: settings just aren't remembered
    }
  };
  /** Change settings; a slider drag counts as one undo step. Settings (never images) are remembered. */
  const update = useCallback((patch: Partial<RetroSettings>, coalesceKey?: string) => {
    const prev = settingsRef.current;
    const now = Date.now();
    const coalesce = !!coalesceKey && lastEdit.current?.key === coalesceKey && now - lastEdit.current.at < 500;
    lastEdit.current = coalesceKey ? { key: coalesceKey, at: now } : null;
    if (!coalesce) setHistory((h) => [...h.slice(-49), prev]);
    const next = { ...prev, ...patch };
    settingsRef.current = next;
    setSettings(next);
    persist(next);
  }, []);

  const key = file ? `${file.key}|${JSON.stringify(settings)}` : null;
  useEffect(() => {
    const w = worker.current;
    if (!w || !file || !key) return;
    const t = ++token.current;
    const timer = setTimeout(() => {
      w.onmessage = async (ev: MessageEvent<ConverterResponse>) => {
        const m = ev.data;
        if (m.token !== token.current) return;
        if (!m.ok) {
          setError(m.message);
          return;
        }
        const [result, source] = await Promise.all([toBitmap(m.image), toBitmap(m.base)]);
        if (m.token !== token.current) return;
        setError(null);
        setOut((old) => {
          old?.result.close();
          old?.source.close();
          return { key, inputWidth: m.inputWidth, inputHeight: m.inputHeight, result, source, png: m.png, palette: m.palette, colours: m.colours, transparent: m.transparent, ms: m.ms };
        });
      };
      w.postMessage({ token: t, fileKey: file.key, file: file.file, settings } satisfies ConverterRequest);
    }, 60);
    return () => clearTimeout(timer);
  }, [file, key, settings]);

  const load = (f: File) => {
    setFile({ file: f, key: `${f.name}:${f.size}:${f.lastModified}`, name: f.name });
    setName(baseName(f.name));
    setOut(null);
    setError(null);
  };
  const loadSample = async () => {
    const r = await fetch("/demo/textures/demo-rusted-plate.png");
    load(new File([await r.blob()], "rusted-plate.png", { type: "image/png" }));
  };

  const current = out && out.key === key ? out : null;
  const download = useCallback(() => {
    if (!current) return;
    const fn = `${(name || "texture").replace(/[\\/:*?"<>|]+/g, "_")}.png`;
    saveBlob(new Blob([current.png as BlobPart], { type: "image/png" }), fn);
    toast.ok(`Saved ${fn}`);
  }, [current, name]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "d" || e.key === "D") download();
      else if (e.key === "t" || e.key === "T") setView((v) => ({ ...v, view: v.view === "tile" ? "split" : "tile" }));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [download]);

  const s = settings;
  const [ow, oh] = out ? outputSize(out.inputWidth, out.inputHeight, s) : [s.width, s.height];
  const pot = isPowerOfTwo(ow) && isPowerOfTwo(oh);
  const bitId = BIT_PRESETS.find((b) => b.bits.r === s.bits.r && b.bits.g === s.bits.g && b.bits.b === s.bits.b)?.id ?? "custom";
  const shown = out;

  const readout = !file ? (
    <>&gt; IDLE // DROP A TEXTURE TO BEGIN</>
  ) : error ? (
    <>! {error}</>
  ) : !shown ? (
    <>&gt; CONVERTING…</>
  ) : (
    <>
      &gt; IN <b>{shown.inputWidth}×{shown.inputHeight}</b> → OUT <b>{ow}×{oh}</b>
      {pot ? "" : " (not power of two)"} // COLOURS <b>{shown.colours.toLocaleString("en-US")}</b>
      {shown.transparent ? " // ALPHA" : ""} // <b>{shown.ms} MS</b> // PNG <b>{current ? formatBytes(current.png.byteLength) : "…"}</b>
    </>
  );

  return (
    <div className="lp-scroll flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      <header className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-rule-strong px-4 py-2.5 sm:px-6">
        <h1 className="font-ocr text-lg tracking-[0.18em] uppercase glow">Retro texture converter</h1>
        <p className="font-ocr text-[12px] tracking-[0.08em] text-muted uppercase">&gt; size, colour depth, palette and dither // a visual effect, not a console pipeline // files never leave this machine</p>
      </header>

      <div className="grid gap-3 p-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[16rem_minmax(0,1fr)_22rem] xl:grid-cols-[18rem_minmax(0,1fr)_24rem]">
        <div className="flex min-h-0 flex-col gap-3 lg:overflow-y-auto">
          <section aria-label="Input" className="border border-rule-strong bg-panel p-3">
            <h2 className="type-panel mb-2.5">// Input</h2>
            <Dropzone
              accept="image/*"
              extensions={[".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]}
              maxBytes={64 * 1024 * 1024}
              label={file ? "Replace image" : "Drop an image"}
              hint="PNG, JPG, WEBP, GIF or BMP up to 4096×4096. Nothing is uploaded."
              onFiles={(f) => load(f[0]!)}
              onReject={(r) => toast.error("Not loaded", r.join(". "))}
              compact
            >
              <button type="button" onClick={loadSample} className="cursor-pointer border border-edge bg-sunken px-2 py-1 font-ocr text-[11px] tracking-[0.05em] text-muted uppercase hover:text-bright">
                + Sample
              </button>
            </Dropzone>
            {file ? (
              <p className="mt-2 truncate font-ocr text-[11px] tracking-[0.04em] text-muted">
                {file.name}
                {out ? ` // ${out.inputWidth}×${out.inputHeight}` : ""}
              </p>
            ) : null}
          </section>
          <section aria-label="Presets" className="border border-rule-strong bg-panel p-3">
            <h2 className="type-panel mb-2.5">// Presets</h2>
            <ul className="flex flex-col gap-1.5">
              {RETRO_PRESETS.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => update({ ...RETRO_DEFAULTS, width: s.width, height: s.height, sizeMode: s.sizeMode, fit: s.fit, ...p.settings })}
                    className="w-full cursor-pointer border border-edge bg-sunken px-2.5 py-2 text-left hover:border-edge-hover"
                  >
                    <span className="block font-ocr text-[12px] tracking-[0.06em] text-fg uppercase">{p.label}</span>
                    <span className="block text-[11.5px] leading-snug text-muted">{p.description}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] leading-snug text-muted">Reducing colours here doesn&rsquo;t make a texture meet any console&rsquo;s VRAM or CLUT limits on its own.</p>
          </section>
        </div>

        <section aria-label="Preview" className="flex min-h-[26rem] flex-col gap-2 border border-rule-strong bg-panel p-3 lg:min-h-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="type-panel mr-auto">// Preview</h2>
            <SegmentedControl label="View" hideLabel size="sm" className="w-56" value={view.view} onChange={(v) => setView((x) => ({ ...x, view: v }))} options={[{ value: "split", label: "Before/after" }, { value: "tile", label: "Tile check" }]} />
          </div>
          {view.view === "tile" ? (
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl label="Tile grid" hideLabel size="sm" className="w-52" value={String(view.grid)} onChange={(g) => setView((x) => ({ ...x, grid: Number(g), zoom: 1, pan: { x: 0, y: 0 } }))} options={["2", "3", "4", "6"].map((g) => ({ value: g, label: `${g}×${g}` }))} />
              <Toggle pressed={view.seams} onPressedChange={(v) => setView((x) => ({ ...x, seams: v }))}>
                Seam lines
              </Toggle>
            </div>
          ) : null}
          <Viewport result={shown?.result ?? null} source={shown?.source ?? null} hasItem={!!file} state={view} onChange={(p) => setView((x) => ({ ...x, ...p }))} label={file?.name ?? ""} readout={readout} />
          {shown?.palette.length ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-rule-strong pt-2">
              <span className="font-ocr text-[11px] tracking-[0.08em] text-muted uppercase">Palette {shown.palette.length}</span>
              <ul aria-label="Palette colours" className="flex flex-wrap gap-px">
                {shown.palette.slice(0, 64).map((c) => (
                  <li key={c.join()} title={rgbToHex(c)} className="size-4 border border-black/40" style={{ background: rgbToHex(c) }}>
                    <span className="sr-only">{rgbToHex(c)}</span>
                  </li>
                ))}
              </ul>
              {shown.palette.length > 64 ? <span className="font-ocr text-[11px] text-muted">+{shown.palette.length - 64}</span> : null}
              <span className="ml-auto flex gap-1.5">
                {s.palette !== "locked" ? (
                  <Button size="sm" onClick={() => update({ palette: "locked", locked: shown.palette })} title="Keep exactly these colours while you change other settings">
                    Lock palette
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => update({ palette: "adaptive" })}>
                    Unlock
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const gpl = ["GIMP Palette", `Name: ${name || "LOWPO11Y"}`, "Columns: 8", "#", ...shown.palette.map((c) => `${String(c[0]).padStart(3)} ${String(c[1]).padStart(3)} ${String(c[2]).padStart(3)}\t${rgbToHex(c)}`)].join("\n") + "\n";
                    saveBlob(new Blob([gpl], { type: "text/plain" }), `${name || "palette"}.gpl`);
                  }}
                >
                  Save .gpl
                </Button>
              </span>
            </div>
          ) : null}
        </section>

        <aside aria-label="Settings" className="lp-scroll flex min-h-0 flex-col gap-3 lg:overflow-y-auto lg:pr-1">
          <section aria-label="Conversion settings" className="border border-rule-strong bg-panel p-3">
            <div className="mb-2.5 flex items-center gap-2">
              <h2 className="type-panel mr-auto">// Settings</h2>
              <Button
                size="sm"
                variant="ghost"
                disabled={!history.length}
                onClick={() => {
                  const prev = history[history.length - 1]!;
                  lastEdit.current = null;
                  settingsRef.current = prev;
                  setSettings(prev);
                  setHistory((h) => h.slice(0, -1));
                  persist(prev);
                }}
              >
                Undo
              </Button>
              <Button size="sm" variant="ghost" onClick={() => update(RETRO_DEFAULTS)}>
                Reset
              </Button>
            </div>

            <Module n="01" name="Size" summary={`${s.sizeMode === "long" ? `LONG SIDE ${s.width}` : `${s.width}×${s.height} ${s.fit.toUpperCase()}`} · ${s.sampling.toUpperCase()}`}>
              <SegmentedControl label="Mode" inline size="sm" value={s.sizeMode} onChange={(v) => update({ sizeMode: v })} options={[{ value: "exact", label: "Exact" }, { value: "long", label: "Long side" }]} />
              <SegmentedControl
                label={s.sizeMode === "long" ? "Long side" : "Square"}
                inline
                size="sm"
                value={SIZES.includes(s.width) && (s.sizeMode === "long" || s.height === s.width) ? String(s.width) : "custom"}
                onChange={(v) => v !== "custom" && update({ width: Number(v), height: Number(v) })}
                options={[...SIZES.map((n) => ({ value: String(n), label: String(n) })), { value: "custom", label: "…", title: "Custom size below" }]}
              />
              <div className="grid grid-cols-2 gap-2">
                <NumberField label={s.sizeMode === "long" ? "Long side" : "Width"} value={s.width} min={1} max={4096} unit="px" onChange={(v) => update({ width: v }, "width")} />
                {s.sizeMode === "exact" ? <NumberField label="Height" value={s.height} min={1} max={4096} unit="px" onChange={(v) => update({ height: v }, "height")} /> : null}
              </div>
              {s.sizeMode === "exact" ? (
                <SegmentedControl label="Fit" inline size="sm" value={s.fit} onChange={(v) => update({ fit: v })} options={[{ value: "crop", label: "Crop", title: "Fill and trim the centre" }, { value: "pad", label: "Pad", title: "Fit inside with transparent margins" }, { value: "stretch", label: "Stretch" }]} />
              ) : null}
              <SegmentedControl label="Sampling" inline size="sm" value={s.sampling} onChange={(v) => update({ sampling: v })} options={[{ value: "smooth", label: "Smooth", title: "Area average when shrinking, bilinear when enlarging" }, { value: "nearest", label: "Nearest" }]} />
              {!pot ? <p className="font-ocr text-[11px] text-muted">! {ow}×{oh} isn&rsquo;t a power of two. Some engines and older GPUs need 2ⁿ sizes for mipmaps and wrapping.</p> : null}
            </Module>

            <Module n="02" name="Adjust" summary={s.brightness || s.contrast || s.saturation || s.gamma !== 1 || s.grain ? "CHANGED" : "NONE"} defaultOpen={false}>
              <SliderField label="Brightness" value={s.brightness} min={-100} max={100} onChange={(v) => update({ brightness: v }, "brightness")} />
              <SliderField label="Contrast" value={s.contrast} min={-100} max={100} onChange={(v) => update({ contrast: v }, "contrast")} />
              <SliderField label="Saturation" value={s.saturation} min={-100} max={100} onChange={(v) => update({ saturation: v }, "saturation")} />
              <SliderField label="Gamma" value={s.gamma} min={0.2} max={3} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => update({ gamma: v }, "gamma")} />
              <SliderField label="Grain" value={s.grain} min={0} max={50} onChange={(v) => update({ grain: v }, "grain")} title="Seeded monochrome noise, the same every time for the same seed" />
              {s.grain ? <NumberField label="Seed" value={s.seed} min={0} max={999999} onChange={(v) => update({ seed: v }, "seed")} /> : null}
            </Module>

            <Module n="03" name="Colour" summary={`${BIT_PRESETS.find((b) => b.id === bitId)?.label ?? `${s.bits.r}${s.bits.g}${s.bits.b}`} · ${s.palette === "off" ? "NO PALETTE" : s.palette === "locked" ? `LOCKED ${s.locked.length}` : `${s.colours} COL`}`}>
              <SegmentedControl label="Bit depth" inline size="sm" value={bitId} onChange={(v) => { const b = BIT_PRESETS.find((x) => x.id === v); if (b) update({ bits: b.bits }); }} options={[...BIT_PRESETS.map((b) => ({ value: b.id, label: b.id, title: `${b.label}: ${b.title}` })), { value: "custom", label: "…", title: "Custom bits (set per channel below)", disabled: true }]} />
              <Advanced label="Per-channel bits">
                {(["r", "g", "b"] as const).map((c) => (
                  <SliderField key={c} label={`${c.toUpperCase()} bits`} value={s.bits[c]} min={1} max={8} onChange={(v) => update({ bits: { ...s.bits, [c]: v } }, `bits-${c}`)} />
                ))}
              </Advanced>
              <SegmentedControl label="Palette" inline size="sm" value={s.palette} onChange={(v) => update({ palette: v })} options={[{ value: "off", label: "Off" }, { value: "adaptive", label: "Adaptive" }, { value: "locked", label: "Locked", disabled: !s.locked.length && !paletteText }]} />
              {s.palette === "adaptive" ? <SliderField label="Colours" value={s.colours} min={2} max={256} onChange={(v) => update({ colours: v }, "colours")} title="Median-cut palette size" /> : null}
              <Advanced label="Import a palette">
                <Textarea aria-label="Palette colours" rows={3} placeholder={"#0f380f #306230 #8bac0f #9bbc0f\nor paste a GIMP .gpl"} value={paletteText} onChange={(e) => setPaletteText(e.target.value)} />
                <Button
                  size="sm"
                  onClick={() => {
                    const pal = parsePalette(paletteText);
                    if (pal.length < 2) return toast.error("Need at least two colours", "Use #rrggbb values or a GIMP palette.");
                    update({ palette: "locked", locked: pal });
                    toast.ok(`Locked ${pal.length} colours`);
                  }}
                >
                  Use these colours
                </Button>
              </Advanced>
            </Module>

            <Module n="04" name="Dither" summary={s.dither === "none" ? "NONE" : `${s.dither.toUpperCase()} ${s.ditherStrength}%`}>
              <SegmentedControl
                label="Pattern"
                inline
                size="sm"
                value={s.dither}
                onChange={(v) => update({ dither: v })}
                options={[
                  { value: "none", label: "None" },
                  { value: "bayer2", label: "2×2" },
                  { value: "bayer4", label: "4×4" },
                  { value: "bayer8", label: "8×8" },
                  { value: "blue", label: "Blue", title: "Blue-noise threshold mask (void-and-cluster)" },
                  { value: "fs", label: "F-S", title: "Floyd–Steinberg error diffusion" },
                ]}
              />
              {s.dither !== "none" ? <SliderField label="Strength" value={s.ditherStrength} min={0} max={100} unit="%" onChange={(v) => update({ ditherStrength: v }, "ditherStrength")} /> : null}
              {s.dither === "fs" ? (
                <Toggle pressed={s.wrap} onPressedChange={(v) => update({ wrap: v })} title="Spread errors across the left/right edge so tiling textures stay seamless">
                  Wrap edges
                </Toggle>
              ) : null}
            </Module>

            <Module n="05" name="Alpha" summary={s.alpha === "keep" ? "KEEP" : `CUTOUT ≥ ${s.alphaThreshold}`} defaultOpen={false}>
              <SegmentedControl label="Alpha" inline size="sm" value={s.alpha} onChange={(v) => update({ alpha: v })} options={[{ value: "keep", label: "Keep" }, { value: "cutout", label: "1-bit cutout" }]} />
              {s.alpha === "cutout" ? <SliderField label="Threshold" value={s.alphaThreshold} min={1} max={255} onChange={(v) => update({ alphaThreshold: v }, "alphaThreshold")} /> : null}
            </Module>
          </section>

          <section aria-label="Export" className="border border-rule-strong bg-panel p-3">
            <h2 className="type-panel mb-2.5">// Export</h2>
            <PromptInput aria-label="Filename" value={name} onChange={(e) => setName(e.target.value)} suffix=".png" disabled={!file} spellCheck={false} />
            <Button variant="primary" className="mt-2 w-full" disabled={!current} onClick={download}>
              Download PNG {current ? `· ${formatBytes(current.png.byteLength)}` : ""}
            </Button>
            <p className="mt-2 font-ocr text-[11px] tracking-[0.04em] text-muted">
              {ow}×{oh} RGBA PNG // the file holds exactly the pixels in the preview // keys: <b className="font-normal text-fg">D</b> download, <b className="font-normal text-fg">T</b> tile
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
