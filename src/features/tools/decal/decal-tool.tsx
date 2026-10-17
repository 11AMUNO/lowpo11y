"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ColorField, NumberField, SegmentedControl, SliderField } from "@/components/ui/controls";
import { Dropzone } from "@/components/ui/dropzone";
import { PromptInput, Toggle } from "@/components/ui/form";
import { Module } from "@/components/ui/panel";
import { toast } from "@/components/ui/toast";
import { formatBytes } from "@/lib/format";
import { cornerColour, DECAL_DEFAULTS, OUTPUT_SIZES, subjectBounds, type DecalSettings } from "@/lib/processing/decal";
import { hexToRgb, isPowerOfTwo, rgbToHex, type RGB, type RGBAImage } from "@/lib/processing/image";
import { deltaE } from "@/lib/processing/palette";
import { baseName, saveBlob, toBitmap } from "../shared/files";
import { DecalCanvas, type DecalTool as Tool } from "./decal-canvas";
import type { WallView } from "./wall-view";
import type { DecalRequest, DecalResponse } from "./worker";

const STORE_KEY = "lp-decal-settings";
const SAMPLES = [
  { file: "demo-sign-greenscreen.png", label: "+ Green screen", title: "A warning sign shot on a green screen (CC0)" },
  { file: "demo-tag-on-black.png", label: "+ Tag on black", title: "Light paint on black, for brightness keying (CC0)" },
];
const WALLS = [
  { id: "demo-red-brick", label: "Brick" },
  { id: "demo-poured-concrete", label: "Concrete" },
  { id: "demo-rusted-plate", label: "Rust" },
  { id: "demo-wood-planks", label: "Wood" },
];

type View = "result" | "original" | "mask" | "output" | "wall3d";
type Bg = "checker" | "black" | "white" | (typeof WALLS)[number]["id"];

interface Result {
  key: string;
  sourceWidth: number;
  sourceHeight: number;
  base: RGBAImage;
  work: RGBAImage;
  output: RGBAImage;
  png: Uint8Array;
  maskPng: Uint8Array;
  ms: number;
}

/** Settings worth remembering between images (not crop, strokes or picked colours). */
const remembered = (s: DecalSettings) => ({ ...s, crop: null, strokes: [], keyColours: [] });

function loadSettings(): DecalSettings {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...DECAL_DEFAULTS, ...(JSON.parse(raw) as Partial<DecalSettings>), crop: null, strokes: [], keyColours: [] } : DECAL_DEFAULTS;
  } catch {
    return DECAL_DEFAULTS;
  }
}

export function DecalTool() {
  const worker = useRef<Worker | null>(null);
  const token = useRef(0);
  const [file, setFile] = useState<{ file: File; key: string; name: string } | null>(null);
  /** File whose background should be guessed from its corners when its first result arrives. */
  const autoKey = useRef<string | null>(null);
  const [settings, setSettings] = useState<DecalSettings>(DECAL_DEFAULTS);
  const [history, setHistory] = useState<DecalSettings[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [bitmaps, setBitmaps] = useState<{ key: string; work: ImageBitmap; base: ImageBitmap; output: ImageBitmap; mask: ImageBitmap } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("result");
  const [bg, setBg] = useState<Bg>("checker");
  const [tool, setTool] = useState<Tool>("pan");
  const [brush, setBrush] = useState({ r: 6, hardness: 0.6 });
  const [walls, setWalls] = useState<Record<string, ImageBitmap>>({});
  const [name, setName] = useState("decal");
  const settingsRef = useRef(settings);
  const lastEdit = useRef<{ key: string; at: number } | null>(null);
  const wallHost = useRef<HTMLDivElement>(null);
  const wallView = useRef<WallView | null>(null);
  const outputRef = useRef<RGBAImage | null>(null);
  /** Sends the latest output to the 3D wall, if it's open. */
  const pushDecal = useCallback(async () => {
    const out = outputRef.current;
    if (!out || !wallView.current) return;
    const bmp = await createImageBitmap(new ImageData(new Uint8ClampedArray(out.data), out.width, out.height), { imageOrientation: "flipY", premultiplyAlpha: "none" });
    if (!wallView.current || outputRef.current !== out) return bmp.close();
    wallView.current.setDecal(bmp, out.width, out.height);
  }, []);
  useLayoutEffect(() => {
    settingsRef.current = settings;
  });

  useEffect(() => {
    worker.current = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const saved = loadSettings();
    settingsRef.current = saved;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore after mount
    setSettings(saved);
    let cancelled = false;
    void Promise.all(
      WALLS.map(async (w) => {
        const r = await fetch(`/demo/textures/${w.id}.png`);
        return [w.id, await createImageBitmap(await r.blob())] as const;
      }),
    ).then((list) => !cancelled && setWalls(Object.fromEntries(list)));
    return () => {
      cancelled = true;
      worker.current?.terminate();
    };
  }, []);

  /** Change settings; edits with the same key within 500 ms are one undo step. */
  const update = useCallback((patch: Partial<DecalSettings>, coalesceKey?: string) => {
    const prev = settingsRef.current;
    const now = Date.now();
    const coalesce = !!coalesceKey && lastEdit.current?.key === coalesceKey && now - lastEdit.current.at < 500;
    lastEdit.current = coalesceKey ? { key: coalesceKey, at: now } : null;
    if (!coalesce) setHistory((h) => [...h.slice(-49), prev]);
    const next = { ...prev, ...patch };
    settingsRef.current = next;
    setSettings(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(remembered(next)));
    } catch {
      // private mode: settings just aren't remembered
    }
  }, []);

  const load = (f: File, preset?: Partial<DecalSettings>, guessBackground = !preset) => {
    const fileKey = `${f.name}:${f.size}:${f.lastModified}`;
    autoKey.current = guessBackground ? fileKey : null;
    setFile({ file: f, key: fileKey, name: f.name });
    setName(baseName(f.name));
    setResult(null);
    setError(null);
    update({ crop: null, strokes: [], keyColours: [], ...preset });
  };
  const loadSample = async (sample: string) => {
    const r = await fetch(`/demo/decals/${sample}`);
    const f = new File([await r.blob()], sample, { type: "image/png" });
    const tag = sample.includes("tag");
    load(f, tag ? { key: "luma", lumaThreshold: 80, lumaSoftness: 120, lumaInvert: false } : { key: "colour", tolerance: 12, softness: 10 }, !tag);
  };

  /* -------------------------------------------------------------- process */
  const key = file ? `${file.key}|${JSON.stringify(settings)}` : null;
  useEffect(() => {
    const w = worker.current;
    if (!w || !file || !key) return;
    const t = ++token.current;
    const timer = setTimeout(() => {
      w.onmessage = (ev: MessageEvent<DecalResponse>) => {
        const m = ev.data;
        if (m.token !== token.current) return;
        if (!m.ok) return setError(m.message);
        setError(null);
        // first result for a new image: guess the background from the corners
        const cur = settingsRef.current;
        if (autoKey.current === file.key && cur.key === "colour" && !cur.keyColours.length) {
          autoKey.current = null;
          const c = cornerColour(m.base);
          if (c) {
            update({ keyColours: [c] });
            toast.ok(`Keying out ${rgbToHex(c)}`, "Picked from the corners. Use “Pick colour” to change it.");
          }
        }
        setResult({ key, sourceWidth: m.sourceWidth, sourceHeight: m.sourceHeight, base: m.base, work: m.work, output: m.output, png: m.png, maskPng: m.maskPng, ms: m.ms });
      };
      w.postMessage({ token: t, fileKey: file.key, file: file.file, settings } satisfies DecalRequest);
    }, 70);
    return () => clearTimeout(timer);
  }, [file, key, settings, update]);

  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    const mask = new ImageData(result.work.width, result.work.height);
    for (let i = 0; i < result.work.data.length; i += 4) {
      const v = result.work.data[i + 3]!;
      mask.data[i] = mask.data[i + 1] = mask.data[i + 2] = v;
      mask.data[i + 3] = 255;
    }
    void Promise.all([toBitmap(result.work), toBitmap(result.base), toBitmap(result.output), createImageBitmap(mask)]).then(([work, base, output, m]) => {
      if (cancelled) return [work, base, output, m].forEach((b) => b.close());
      setBitmaps((old) => {
        if (old) [old.work, old.base, old.output, old.mask].forEach((b) => b.close());
        return { key: result.key, work, base, output, mask: m };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [result]);

  /* ------------------------------------------------------------- 3D wall */
  useEffect(() => {
    const host = wallHost.current;
    if (view !== "wall3d" || !host) return;
    let cancelled = false;
    void import("./wall-view").then(({ createWallView }) => {
      if (cancelled) return;
      try {
        wallView.current = createWallView(host);
        wallView.current.setWall(`/demo/textures/${bg.startsWith("demo-") ? bg : "demo-red-brick"}.png`);
        void pushDecal();
      } catch {
        setError("Your browser couldn't start WebGL, so the 3D wall is unavailable.");
      }
    });
    return () => {
      cancelled = true;
      wallView.current?.dispose();
      wallView.current = null;
    };
  }, [view, bg, pushDecal]);
  useEffect(() => {
    outputRef.current = result?.output ?? null;
    if (view === "wall3d") void pushDecal();
  }, [view, result, pushDecal]);

  /* -------------------------------------------------------------- actions */
  const current = result && result.key === key ? result : null;
  const s = settings;
  const pick = (x: number, y: number) => {
    if (!result) return;
    const i = (y * result.base.width + x) * 4;
    const c: RGB = [result.base.data[i]!, result.base.data[i + 1]!, result.base.data[i + 2]!];
    if (s.keyColours.some((k) => deltaE(k, c) < 2)) return;
    update({ key: "colour", keyColours: [...s.keyColours, c].slice(-6) });
    toast.ok(`Keying out ${rgbToHex(c)}`);
  };
  const trim = () => {
    if (!current) return;
    const b = subjectBounds(current.work);
    if (!b) return toast.error("Nothing visible to trim to");
    const c = s.crop ?? { x: 0, y: 0, w: current.base.width, h: current.base.height };
    const pad = 2;
    const x = Math.max(0, b.x - pad),
      y = Math.max(0, b.y - pad);
    update({ crop: { x: c.x + x, y: c.y + y, w: Math.min(current.base.width - x, b.w + pad * 2), h: Math.min(current.base.height - y, b.h + pad * 2) }, strokes: [] });
  };
  const download = (kind: "png" | "mask") => {
    if (!current) return;
    const fn = `${(name || "decal").replace(/[\\/:*?"<>|]+/g, "_")}${kind === "mask" ? "-mask" : ""}.png`;
    saveBlob(new Blob([(kind === "png" ? current.png : current.maskPng) as BlobPart], { type: "image/png" }), fn);
    toast.ok(`Saved ${fn}`);
  };

  /* -------------------------------------------------------------- render */
  const shown = bitmaps && result ? { bitmaps, result } : null;
  const image = !shown ? null : view === "original" ? shown.bitmaps.base : view === "mask" ? shown.bitmaps.mask : view === "output" ? shown.bitmaps.output : shown.bitmaps.work;
  const dims = !result ? [1, 1] : view === "output" ? [result.output.width, result.output.height] : [result.work.width, result.work.height];
  const background = useMemo(() => (bg.startsWith("demo-") && walls[bg] ? { kind: "pattern" as const, image: walls[bg]! } : { kind: (bg.startsWith("demo-") ? "checker" : bg) as "checker" | "black" | "white" }), [bg, walls]);
  const visible = current ? Math.round((current.output.data.reduce((n, v, i) => (i % 4 === 3 && v > 0 ? n + 1 : n), 0) / (current.output.width * current.output.height)) * 100) : 0;
  const crop = s.crop ?? (result ? { x: 0, y: 0, w: result.base.width, h: result.base.height } : { x: 0, y: 0, w: 0, h: 0 });
  const orientedW = result ? (s.rotate % 180 ? result.sourceHeight : result.sourceWidth) : 0,
    orientedH = result ? (s.rotate % 180 ? result.sourceWidth : result.sourceHeight) : 0;
  const potOk = current ? isPowerOfTwo(current.output.width) && isPowerOfTwo(current.output.height) : false;

  return (
    <div className="lp-scroll flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      <header className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-rule-strong px-4 py-2.5 sm:px-6">
        <h1 className="font-ocr text-lg tracking-[0.18em] uppercase glow">Decal &amp; cutout maker</h1>
        <p className="font-ocr text-[12px] tracking-[0.08em] text-muted uppercase">&gt; key out a background by colour or brightness, clean the edge, save a transparent PNG // no AI // nothing is uploaded</p>
      </header>

      <div className="grid gap-3 p-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[17rem_minmax(0,1fr)_22rem] xl:grid-cols-[19rem_minmax(0,1fr)_24rem]">
        <div className="lp-scroll flex min-h-0 flex-col gap-3 lg:overflow-y-auto">
          <section aria-label="Source image" className="border border-rule-strong bg-panel p-3">
            <h2 className="type-panel mb-2.5">// Source</h2>
            <Dropzone
              accept="image/*"
              extensions={[".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]}
              maxBytes={64 * 1024 * 1024}
              label={file ? "Replace image" : "Drop a photo or texture"}
              hint="Up to 4096×4096. Nothing is uploaded."
              onFiles={(f) => load(f[0]!)}
              onReject={(r) => toast.error("Not loaded", r.join(". "))}
              compact
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SAMPLES.map((x) => (
                <button key={x.file} type="button" title={x.title} onClick={() => void loadSample(x.file)} className="cursor-pointer border border-edge bg-sunken px-2 py-1 font-ocr text-[11px] tracking-[0.05em] text-muted uppercase hover:text-bright">
                  {x.label}
                </button>
              ))}
            </div>
            {file && result ? (
              <p className="mt-2 truncate font-ocr text-[11px] tracking-[0.04em] text-muted">
                {file.name} // {result.sourceWidth}×{result.sourceHeight}
              </p>
            ) : null}
          </section>

          <section aria-label="Crop and rotate" className="border border-rule-strong bg-panel p-3">
            <h2 className="type-panel mb-2.5">// Crop &amp; rotate</h2>
            <div className="flex flex-col gap-2.5">
              <SegmentedControl label="Rotate" inline size="sm" value={String(s.rotate)} onChange={(v) => update({ rotate: Number(v) as DecalSettings["rotate"], crop: null, strokes: [] })} options={[0, 90, 180, 270].map((d) => ({ value: String(d), label: `${d}°` }))} />
              <div className="flex gap-2">
                <Toggle pressed={s.flipH} onPressedChange={(v) => update({ flipH: v, crop: null, strokes: [] })}>
                  Flip ↔
                </Toggle>
                <Toggle pressed={s.flipV} onPressedChange={(v) => update({ flipV: v, crop: null, strokes: [] })}>
                  Flip ↕
                </Toggle>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(["x", "y", "w", "h"] as const).map((k) => (
                  <NumberField
                    key={k}
                    label={k.toUpperCase()}
                    value={crop[k]}
                    min={k === "w" || k === "h" ? 1 : 0}
                    max={k === "x" || k === "w" ? orientedW || 4096 : orientedH || 4096}
                    unit="px"
                    onChange={(v) => update({ crop: { ...crop, [k]: v }, strokes: [] })}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" disabled={!current} onClick={trim} title="Crop to the visible pixels, plus 2 px">
                  Trim to subject
                </Button>
                <Button size="sm" variant="ghost" className="flex-1" disabled={!s.crop} onClick={() => update({ crop: null, strokes: [] })}>
                  Full image
                </Button>
              </div>
              <p className="text-[11.5px] leading-snug text-muted">Crop box in pixels: left, top, width, height. Changing the crop or rotation clears brush strokes, which are drawn in cropped pixels.</p>
            </div>
          </section>
        </div>

        <section aria-label="Preview" className="flex min-h-[28rem] min-w-0 flex-col gap-2 border border-rule-strong bg-panel p-3 lg:min-h-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="type-panel mr-auto">// Preview</h2>
            <SegmentedControl
              label="View"
              hideLabel
              size="sm"
              className="w-[22rem] max-w-full"
              value={view}
              onChange={setView}
              options={[
                { value: "result", label: "Result" },
                { value: "original", label: "Original" },
                { value: "mask", label: "Mask" },
                { value: "output", label: "Output", title: "Final size, as exported" },
                { value: "wall3d", label: "3D wall" },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              label="Tool"
              hideLabel
              size="sm"
              className="w-80 max-w-full"
              value={tool}
              onChange={setTool}
              options={[
                { value: "pan", label: "Move" },
                { value: "pick", label: "Pick", title: "Pick a background colour to key out: click it in the preview" },
                { value: "erase", label: "Erase", title: "Paint transparency" },
                { value: "restore", label: "Restore", title: "Paint the original pixels back" },
              ]}
            />
            <SegmentedControl label="Background" hideLabel size="sm" className="w-[22rem] max-w-full" value={bg} onChange={setBg} options={[{ value: "checker", label: "Checker" }, { value: "black", label: "Black" }, { value: "white", label: "White" }, ...WALLS.map((w) => ({ value: w.id, label: w.label }))]} />
          </div>
          {view === "wall3d" ? (
            <div ref={wallHost} className="relative min-h-[18rem] flex-1 border border-rule-strong bg-sunken" />
          ) : (
            <DecalCanvas
              image={image}
              width={dims[0]!}
              height={dims[1]!}
              background={background}
              tool={tool}
              editable={view === "result" || view === "original" || view === "mask"}
              brushRadius={brush.r}
              onPick={pick}
              onStroke={(points) => tool !== "pick" && tool !== "pan" && update({ strokes: [...s.strokes, { mode: tool, r: brush.r, hardness: brush.hardness, points }] })}
              label={result ? `Decal ${view} view, ${dims[0]} by ${dims[1]} pixels` : "Decal preview, empty"}
            />
          )}
          <p role="status" className="font-ocr text-[12px] tracking-[0.04em] text-muted [&_b]:font-normal [&_b]:text-bright">
            {!file ? (
              <>&gt; IDLE // DROP AN IMAGE OR TRY A SAMPLE</>
            ) : error ? (
              <>! {error}</>
            ) : !result ? (
              <>&gt; PROCESSING…</>
            ) : (
              <>
                &gt; WORK <b>{result.work.width}×{result.work.height}</b> → OUT <b>{result.output.width}×{result.output.height}</b>
                {potOk ? " POT" : ""} // <b>{visible}%</b> VISIBLE // <b>{result.ms} MS</b>
                {current ? <> // PNG <b>{formatBytes(current.png.byteLength)}</b></> : null}
              </>
            )}
          </p>
        </section>

        <aside aria-label="Settings" className="lp-scroll flex min-h-0 flex-col gap-3 lg:overflow-y-auto lg:pr-1">
          <section aria-label="Cutout settings" className="border border-rule-strong bg-panel p-3">
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
                }}
              >
                Undo
              </Button>
              <Button size="sm" variant="ghost" onClick={() => update({ ...DECAL_DEFAULTS, crop: s.crop, keyColours: s.keyColours })}>
                Reset
              </Button>
            </div>

            <Module n="01" name="Key" summary={s.key === "none" ? "OFF" : s.key === "luma" ? `BRIGHTNESS ${s.lumaInvert ? "≤" : "≥"} ${s.lumaThreshold}` : `${s.keyColours.length} COLOUR${s.keyColours.length === 1 ? "" : "S"} · ΔE ${s.tolerance}`}>
              <SegmentedControl label="Key by" inline size="sm" value={s.key} onChange={(v) => update({ key: v })} options={[{ value: "colour", label: "Colour" }, { value: "luma", label: "Brightness" }, { value: "none", label: "Off" }]} />
              {s.key === "colour" ? (
                <>
                  <ul aria-label="Key colours" className="flex flex-wrap gap-1.5">
                    {s.keyColours.map((c, i) => (
                      <li key={rgbToHex(c)} className="flex items-center gap-1 border border-rule-strong py-0.5 pr-0.5 pl-1">
                        <span aria-hidden className="size-4 border border-black/50" style={{ background: rgbToHex(c) }} />
                        <span className="font-ocr text-[11px] text-fg uppercase">{rgbToHex(c)}</span>
                        <button type="button" aria-label={`Stop keying ${rgbToHex(c)}`} onClick={() => update({ keyColours: s.keyColours.filter((_, j) => j !== i) })} className="size-6 cursor-pointer text-muted hover:text-bright">
                          ✕
                        </button>
                      </li>
                    ))}
                    {!s.keyColours.length ? <li className="text-[12px] text-muted">No colour yet: use “Pick colour” and click the background.</li> : null}
                  </ul>
                  <ColorField label="Add colour" value="#00b140" onChange={(hex) => update({ keyColours: [...s.keyColours, hexToRgb(hex)].slice(-6) }, "add-colour")} />
                  <SliderField label="Tolerance" value={s.tolerance} min={0} max={60} onChange={(v) => update({ tolerance: v }, "tolerance")} title="Colours this close to a key colour (OKLab ΔE) become fully transparent" />
                  <SliderField label="Softness" value={s.softness} min={0} max={40} onChange={(v) => update({ softness: v }, "softness")} title="How gradually alpha comes back beyond the tolerance" />
                </>
              ) : null}
              {s.key === "luma" ? (
                <>
                  <SliderField label="Threshold" value={s.lumaThreshold} min={0} max={255} onChange={(v) => update({ lumaThreshold: v }, "luma")} />
                  <SliderField label="Softness" value={s.lumaSoftness} min={1} max={200} onChange={(v) => update({ lumaSoftness: v }, "lumaSoft")} />
                  <Toggle pressed={s.lumaInvert} onPressedChange={(v) => update({ lumaInvert: v })} title="Keep dark marks on a light background">
                    Keep dark parts
                  </Toggle>
                </>
              ) : null}
            </Module>

            <Module n="02" name="Edges" summary={`${s.decontaminate ? "CLEAN" : "RAW"}${s.grow ? ` · ${s.grow > 0 ? "+" : ""}${s.grow}PX` : ""}${s.feather ? ` · FEATHER ${s.feather}` : ""}`}>
              <Toggle pressed={s.decontaminate} onPressedChange={(v) => update({ decontaminate: v })} title="Re-measure edge alpha and remove the background colour mixed into edge pixels">
                Clean edges
              </Toggle>
              <SliderField label="Grow / shrink" value={s.grow} min={-10} max={10} unit=" px" onChange={(v) => update({ grow: v }, "grow")} />
              <SliderField label="Remove specks" value={s.despeckle} min={0} max={500} unit=" px" onChange={(v) => update({ despeckle: v }, "despeckle")} title="Clear visible islands smaller than this" />
              <SliderField label="Feather" value={s.feather} min={0} max={20} unit=" px" onChange={(v) => update({ feather: v }, "feather")} />
            </Module>

            <Module n="03" name="Brush" summary={`R ${brush.r} · ${s.strokes.length} STROKE${s.strokes.length === 1 ? "" : "S"}`}>
              <SliderField label="Radius" value={brush.r} min={1} max={64} unit=" px" onChange={(v) => setBrush((b) => ({ ...b, r: v }))} />
              <SliderField label="Hardness" value={Math.round(brush.hardness * 100)} min={0} max={100} unit="%" onChange={(v) => setBrush((b) => ({ ...b, hardness: v / 100 }))} />
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" disabled={!s.strokes.length} onClick={() => update({ strokes: s.strokes.slice(0, -1) })}>
                  Undo stroke
                </Button>
                <Button size="sm" variant="ghost" className="flex-1" disabled={!s.strokes.length} onClick={() => update({ strokes: [] })}>
                  Clear strokes
                </Button>
              </div>
              <p className="text-[11.5px] leading-snug text-muted">Choose Erase or Restore above the preview, then paint on the Result, Original or Mask view.</p>
            </Module>

            <Module n="04" name="Look" summary={s.tintAmount || s.brightness || s.contrast || s.saturation || s.grime || s.wear ? "CHANGED" : "NONE"} defaultOpen={false}>
              <ColorField label="Tint" value={rgbToHex(s.tint)} onChange={(hex) => update({ tint: hexToRgb(hex) }, "tint")} />
              <SliderField label="Tint amount" value={s.tintAmount} min={0} max={100} unit="%" onChange={(v) => update({ tintAmount: v }, "tintAmount")} />
              <SliderField label="Brightness" value={s.brightness} min={-100} max={100} onChange={(v) => update({ brightness: v }, "brightness")} />
              <SliderField label="Contrast" value={s.contrast} min={-100} max={100} onChange={(v) => update({ contrast: v }, "contrast")} />
              <SliderField label="Saturation" value={s.saturation} min={-100} max={100} onChange={(v) => update({ saturation: v }, "saturation")} />
              <SliderField label="Grime" value={s.grime} min={0} max={100} onChange={(v) => update({ grime: v }, "grime")} title="Seeded dirt, darker in patches" />
              <SliderField label="Wear" value={s.wear} min={0} max={100} onChange={(v) => update({ wear: v }, "wear")} title="Seeded chips taken out of the edges" />
              {s.grime || s.wear ? <NumberField label="Seed" value={s.seed} min={0} max={999999} onChange={(v) => update({ seed: v }, "seed")} /> : null}
            </Module>

            <Module n="05" name="Output" summary={`${s.size ? `LONG SIDE ${s.size}` : "WORK SIZE"}${s.pot ? " · 2ⁿ PAD" : ""}`}>
              <SegmentedControl label="Long side" size="sm" value={String(s.size)} onChange={(v) => update({ size: Number(v) })} options={OUTPUT_SIZES.map((n) => ({ value: String(n), label: n ? String(n) : "Same", title: n ? undefined : "Keep the working size" }))} />
              <SegmentedControl label="Sampling" inline size="sm" value={s.sampling} onChange={(v) => update({ sampling: v })} options={[{ value: "smooth", label: "Smooth" }, { value: "nearest", label: "Nearest" }]} />
              <div className="flex flex-wrap gap-2">
                <Toggle pressed={s.pot} onPressedChange={(v) => update({ pot: v })} title="Pad to power-of-two sides with transparent margins">
                  Pad to 2ⁿ
                </Toggle>
                <Toggle pressed={s.bleed} onPressedChange={(v) => update({ bleed: v })} title="Transparent pixels keep the nearest edge colour so filtered textures don't get dark halos">
                  Edge colour bleed
                </Toggle>
              </div>
            </Module>
          </section>

          <section aria-label="Export" className="border border-rule-strong bg-panel p-3">
            <h2 className="type-panel mb-2.5">// Export</h2>
            <PromptInput aria-label="Decal file name" value={name} onChange={(e) => setName(e.target.value)} suffix=".png" spellCheck={false} />
            <Button variant="primary" className="mt-2 w-full" disabled={!current} onClick={() => download("png")}>
              Download PNG {current ? `· ${formatBytes(current.png.byteLength)}` : ""}
            </Button>
            <Button className="mt-2 w-full" disabled={!current} onClick={() => download("mask")}>
              Download mask PNG
            </Button>
            <p className="mt-2 font-ocr text-[11px] tracking-[0.04em] text-muted">
              The PNG holds exactly the Output view. Transparent pixels carry the nearest edge colour (bleed), so mipmaps and filtering don&rsquo;t draw dark halos.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
