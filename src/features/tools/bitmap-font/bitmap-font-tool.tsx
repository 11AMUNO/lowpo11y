"use client";

import { zipSync } from "fflate";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ColorField, NumberField, SegmentedControl, SliderField } from "@/components/ui/controls";
import { Dropzone } from "@/components/ui/dropzone";
import { Checkbox, PromptInput, Textarea, Toggle, Input } from "@/components/ui/form";
import { Advanced, Module } from "@/components/ui/panel";
import { toast } from "@/components/ui/toast";
import { formatBytes, formatCount } from "@/lib/format";
import { renderBmfont, toBmfontJson, toBmfontText, type LaidGlyph } from "@/lib/formats/bmfont";
import { encodePng } from "@/lib/formats/png";
import { buildCharset, CHARSET_PRESETS } from "@/lib/fonts/charset";
import { embeddingNote, FontError, readFont, type FontInfo } from "@/lib/fonts/sfnt";
import { saveBlob, toBitmap } from "../shared/files";
import { generate, GEN_DEFAULTS, type GenResult, type GenSettings } from "./generate";

const STORE_KEY = "lp-bitmap-font-settings";
const SAMPLE_TEXT = "The quick brown fox jumps over the lazy dog.\n0123456789 !?#&@ (c) © 25° · \"quotes\"";

interface LoadedFont {
  name: string;
  family: string;
  bytes: number;
  info: FontInfo;
  face: FontFace;
}

interface Stored extends GenSettings {
  presets: string[];
  extra: string;
  ranges: string;
}

const DEFAULTS: Stored = { ...GEN_DEFAULTS, presets: ["ascii"], extra: "©°·", ranges: "" };
const hex = (c: number) => `U+${c.toString(16).toUpperCase().padStart(4, "0")}`;
const safe = (s: string) => s.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/\s+/g, "-").toLowerCase() || "font";

function loadStored(): Stored {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Stored>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

let familyCounter = 0;

export function BitmapFontTool() {
  const [font, setFont] = useState<LoadedFont | null>(null);
  const [settings, setSettings] = useState<Stored>(DEFAULTS);
  const [result, setResult] = useState<GenResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState(SAMPLE_TEXT);
  const [zoom, setZoom] = useState(2);
  const [boxes, setBoxes] = useState(false);
  const [bg, setBg] = useState<"dark" | "light" | "checker">("dark");
  const [selected, setSelected] = useState<number | null>(null);
  const [name, setName] = useState("font");
  const [pageIndex, setPageIndex] = useState(0);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const pageRef = useRef<HTMLCanvasElement>(null);
  const fontRef = useRef<LoadedFont | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore after mount
    setSettings(loadStored());
    return () => {
      if (fontRef.current) document.fonts.delete(fontRef.current.face);
    };
  }, []);

  const update = (patch: Partial<Stored>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      // private mode: settings just aren't remembered
    }
  };

  /* ---------------------------------------------------------------- font */
  const openFont = async (file: File) => {
    setError(null);
    try {
      if (file.size > 32 * 1024 * 1024) throw new FontError("Font files over 32 MB aren't supported.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const info = readFont(bytes);
      const family = `lp-bitmap-font-${++familyCounter}`;
      const face = new FontFace(family, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      try {
        await face.load();
      } catch {
        throw new FontError("The browser refused to load this font. It may be damaged.");
      }
      document.fonts.add(face);
      if (fontRef.current) document.fonts.delete(fontRef.current.face);
      const loaded = { name: file.name, family, bytes: file.size, info, face };
      fontRef.current = loaded;
      setFont(loaded);
      setName(safe(info.names.family ?? file.name.replace(/\.(ttf|otf)$/i, "")));
      setSelected(null);
      setPageIndex(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "This font couldn't be opened.");
    }
  };
  const loadSample = async () => {
    const r = await fetch("/demo/fonts/lowpo11y-pixel.ttf");
    await openFont(new File([await r.blob()], "lowpo11y-pixel.ttf", { type: "font/ttf" }));
  };

  /* ------------------------------------------------------------ generate */
  const charset = useMemo(() => {
    try {
      return { list: buildCharset(settings.presets, settings.extra, settings.ranges), error: null };
    } catch (e) {
      return { list: [] as number[], error: e instanceof Error ? e.message : "Invalid characters." };
    }
  }, [settings.presets, settings.extra, settings.ranges]);

  const genKey = font ? JSON.stringify([font.family, charset.list, { ...settings, presets: 0, extra: 0, ranges: 0 }, name]) : null;
  useEffect(() => {
    if (!font || !genKey || charset.error) return;
    const timer = setTimeout(() => {
      try {
        const r = generate(font.family, font.info, charset.list, settings, safe(name));
        setResult(r);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Generation failed.");
      }
    }, 120);
    return () => clearTimeout(timer);
    // genKey captures every input
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genKey]);

  // preview: the sample text drawn by the BMFont renderer from the generated data
  const preview = useMemo(() => (result ? renderBmfont(result.font, result.pages, sample || " ") : null), [result, sample]);

  useEffect(() => {
    const cv = previewRef.current;
    if (!cv || !preview) return;
    let cancelled = false;
    void toBitmap(preview.image).then((bmp) => {
      if (cancelled) return bmp.close();
      const pad = 8;
      cv.width = preview.image.width * zoom + pad * 2;
      cv.height = preview.image.height * zoom + pad * 2;
      const x = cv.getContext("2d")!;
      x.imageSmoothingEnabled = false;
      if (bg === "checker") {
        for (let yy = 0; yy < cv.height; yy += 8)
          for (let xx = 0; xx < cv.width; xx += 8) {
            x.fillStyle = ((xx + yy) / 8) % 2 ? "#1a1a1a" : "#0c0c0c";
            x.fillRect(xx, yy, 8, 8);
          }
      } else {
        x.fillStyle = bg === "light" ? "#d8d8d8" : "#050505";
        x.fillRect(0, 0, cv.width, cv.height);
      }
      x.drawImage(bmp, pad, pad, preview.image.width * zoom, preview.image.height * zoom);
      bmp.close();
      if (boxes || selected !== null) {
        for (const g of preview.glyphs) {
          const on = g.id === selected;
          if (!boxes && !on) continue;
          x.strokeStyle = on ? "#ffffff" : "rgba(255,255,255,.38)";
          x.lineWidth = on ? 2 : 1;
          if (g.w && g.h) x.strokeRect(pad + g.x * zoom + 0.5, pad + g.y * zoom + 0.5, g.w * zoom - 1, g.h * zoom - 1);
          if (on || boxes) {
            x.strokeStyle = on ? "rgba(255,255,255,.85)" : "rgba(255,255,255,.6)";
            x.lineWidth = 1;
            x.setLineDash([2, 2]);
            x.beginPath();
            const by = pad + (g.lineY + result!.font.common.base) * zoom + 0.5;
            x.moveTo(pad + g.penX * zoom, by);
            x.lineTo(pad + (g.penX + g.advance) * zoom, by);
            x.stroke();
            x.setLineDash([]);
          }
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [preview, zoom, boxes, bg, selected, result]);

  const page = result?.pages[Math.min(pageIndex, (result?.pages.length ?? 1) - 1)];
  useEffect(() => {
    const cv = pageRef.current;
    if (!cv || !page) return;
    void toBitmap(page).then((bmp) => {
      cv.width = page.width;
      cv.height = page.height;
      const x = cv.getContext("2d")!;
      x.clearRect(0, 0, cv.width, cv.height);
      x.drawImage(bmp, 0, 0);
      bmp.close();
    });
  }, [page]);

  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!preview) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) * (e.currentTarget.width / r.width) - 8) / zoom,
      py = ((e.clientY - r.top) * (e.currentTarget.height / r.height) - 8) / zoom;
    const hit = preview.glyphs.find((g: LaidGlyph) => px >= g.penX && px < g.penX + g.advance && py >= g.lineY && py < g.lineY + result!.font.common.lineHeight);
    setSelected(hit ? hit.id : null);
  };

  /* -------------------------------------------------------------- export */
  const base = safe(name);
  const files = () => {
    if (!result) return null;
    const enc = new TextEncoder();
    const out: Record<string, Uint8Array> = { [`${base}.fnt`]: enc.encode(toBmfontText(result.font)), [`${base}.json`]: enc.encode(toBmfontJson(result.font)) };
    result.pages.forEach((p, i) => (out[`${base}_${i}.png`] = encodePng(p)));
    return out;
  };
  const exportAs = (kind: "zip" | "fnt" | "json" | "pages" | "preview") => {
    const f = files();
    if (!f || !result) return;
    if (kind === "zip") {
      saveBlob(new Blob([zipSync(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, [v, { level: k.endsWith(".png") ? 0 : 6 }]]))) as BlobPart], { type: "application/zip" }), `${base}.zip`);
    } else if (kind === "fnt") saveBlob(new Blob([f[`${base}.fnt`] as BlobPart], { type: "text/plain" }), `${base}.fnt`);
    else if (kind === "json") saveBlob(new Blob([f[`${base}.json`] as BlobPart], { type: "application/json" }), `${base}.json`);
    else if (kind === "pages") result.pages.forEach((_, i) => saveBlob(new Blob([f[`${base}_${i}.png`] as BlobPart], { type: "image/png" }), `${base}_${i}.png`));
    else if (preview) saveBlob(new Blob([encodePng(preview.image) as BlobPart], { type: "image/png" }), `${base}-preview.png`);
    toast.ok(`Saved ${kind === "zip" ? "ZIP" : kind === "preview" ? "preview" : kind.toUpperCase()}`);
  };

  /* -------------------------------------------------------------- render */
  const s = settings;
  const ch = result && selected !== null ? result.font.chars.find((c) => c.id === selected) : null;
  const embedding = font ? embeddingNote(font.info.fsType) : null;
  const inFont = font ? charset.list.filter((c) => font.info.cmap.has(c)).length : 0;
  const missing = font ? charset.list.filter((c) => !font.info.cmap.has(c)) : [];

  return (
    <div className="lp-scroll flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      <header className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-rule-strong px-4 py-2.5 sm:px-6">
        <h1 className="font-ocr text-lg tracking-[0.18em] uppercase glow">Bitmap font generator</h1>
        <p className="font-ocr text-[12px] tracking-[0.08em] text-muted uppercase">&gt; turn a licensed TTF or OTF into BMFont pages // files never leave this machine</p>
      </header>

      <div className="grid gap-3 p-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[17rem_minmax(0,1fr)_22rem] xl:grid-cols-[19rem_minmax(0,1fr)_24rem]">
        <div className="lp-scroll flex min-h-0 flex-col gap-3 lg:overflow-y-auto">
          <section aria-label="Font file" className="border border-rule-strong bg-panel p-3">
            <h2 className="type-panel mb-2.5">// Font</h2>
            <Dropzone
              extensions={[".ttf", ".otf"]}
              maxBytes={32 * 1024 * 1024}
              label={font ? "Replace font" : "Drop a font"}
              hint="TTF or OTF you're licensed to use. Nothing is uploaded."
              onFiles={(f) => void openFont(f[0]!)}
              onReject={(r) => toast.error("Not opened", r.join(". "))}
              compact
            >
              <button type="button" onClick={() => void loadSample()} title="LOWPO11Y Pixel, a 5×7 font drawn for this site (CC0)" className="cursor-pointer border border-edge bg-sunken px-2 py-1 font-ocr text-[11px] tracking-[0.05em] text-muted uppercase hover:text-bright">
                + Sample font
              </button>
            </Dropzone>
            {font ? (
              <div className="mt-2.5 flex flex-col gap-1 text-[12.5px]">
                <p className="text-fg">
                  {font.info.names.fullName ?? font.info.names.family ?? font.name}
                  <span className="font-ocr text-[11px] text-muted"> // {formatBytes(font.bytes)}</span>
                </p>
                <p className="font-ocr text-[11px] text-muted">
                  {formatCount(font.info.cmap.size)} characters · {font.info.format === "truetype" ? "TrueType" : "OpenType (CFF)"}
                  {font.info.names.version ? ` · ${font.info.names.version}` : ""}
                </p>
                {font.info.names.designer ? <p className="font-ocr text-[11px] text-muted">Designer: {font.info.names.designer}</p> : null}
                {embedding ? <p className="font-ocr text-[11px] leading-snug text-bright">! {embedding}</p> : null}
                {font.info.names.license || font.info.names.copyright ? (
                  <Advanced label="Licence in the font">
                    {font.info.names.copyright ? <p className="text-[12px] text-muted">{font.info.names.copyright}</p> : null}
                    {font.info.names.license ? (
                      <p tabIndex={0} className="max-h-40 overflow-y-auto text-[12px] whitespace-pre-line text-muted outline-none focus-visible:ring-1 focus-visible:ring-bright">
                        {font.info.names.license}
                      </p>
                    ) : null}
                    {font.info.names.licenseUrl ? <p className="font-ocr text-[11px] break-all text-muted">{font.info.names.licenseUrl}</p> : null}
                  </Advanced>
                ) : (
                  <p className="text-[11.5px] leading-snug text-muted">This font has no licence text in it. Check where it came from before shipping a bitmap version.</p>
                )}
              </div>
            ) : null}
          </section>

          <section aria-label="Characters" className="border border-rule-strong bg-panel p-3">
            <h2 className="type-panel mb-2.5">// Characters</h2>
            <div className="flex flex-col gap-1.5">
              {CHARSET_PRESETS.map((p) => (
                <Checkbox key={p.id} label={p.label} checked={s.presets.includes(p.id)} onCheckedChange={(v) => update({ presets: v ? [...s.presets, p.id] : s.presets.filter((x) => x !== p.id) })} />
              ))}
            </div>
            <Textarea className="mt-2.5" aria-label="Extra characters" rows={2} placeholder="Extra characters, typed or pasted" value={s.extra} onChange={(e) => update({ extra: e.target.value })} />
            <Input className="mt-2" aria-label="Unicode ranges" placeholder="Ranges, e.g. U+2190-21FF" value={s.ranges} onChange={(e) => update({ ranges: e.target.value })} spellCheck={false} />
            <p role="status" className="mt-2 font-ocr text-[11px] tracking-[0.04em] text-muted uppercase">
              {charset.error ? `! ${charset.error}` : `> ${charset.list.length} requested${font ? ` // ${inFont} in font` : ""}`}
            </p>
            {missing.length ? (
              <p className="mt-1 text-[12px] leading-snug text-fg">
                <span className="font-ocr text-bright">! </span>
                {missing.length} character{missing.length > 1 ? "s aren't" : " isn't"} in this font and will be left out:{" "}
                <span className="font-ocr text-muted">
                  {missing
                    .slice(0, 24)
                    .map((c) => `${String.fromCodePoint(c)} ${hex(c)}`)
                    .join(", ")}
                  {missing.length > 24 ? "…" : ""}
                </span>
              </p>
            ) : null}
          </section>
        </div>

        <section aria-label="Preview" className="flex min-h-[26rem] min-w-0 flex-col gap-2 border border-rule-strong bg-panel p-3 lg:min-h-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="type-panel mr-auto">// Preview</h2>
            <SegmentedControl label="Zoom" hideLabel size="sm" className="w-40" value={String(zoom)} onChange={(v) => setZoom(Number(v))} options={[1, 2, 4].map((n) => ({ value: String(n), label: `${n}×` }))} />
            <SegmentedControl label="Background" hideLabel size="sm" className="w-48" value={bg} onChange={setBg} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }, { value: "checker", label: "Checker" }]} />
            <Toggle pressed={boxes} onPressedChange={setBoxes} title="Glyph boxes, and each advance along the baseline">
              Boxes
            </Toggle>
          </div>
          <Textarea aria-label="Sample text" rows={2} value={sample} onChange={(e) => setSample(e.target.value)} />
          {/* focusable so keyboard users can scroll long previews */}
          <div tabIndex={0} aria-label="Preview area, scrollable" role="group" className="lp-scroll min-h-40 flex-1 overflow-auto border border-rule-strong bg-sunken outline-none focus-visible:border-bright">
            {preview ? (
              <canvas ref={previewRef} onClick={pick} role="img" aria-label={`Sample text drawn from the generated bitmap font: ${sample}`} className="cursor-crosshair [image-rendering:pixelated]" />
            ) : (
              <p className="p-4 font-ocr text-[12px] tracking-[0.08em] text-muted uppercase">&gt; {font ? "generating…" : "no font // drop one or use the sample"}</p>
            )}
          </div>
          <p role="status" className="font-ocr text-[12px] tracking-[0.04em] text-muted [&_b]:font-normal [&_b]:text-bright">
            {error ? (
              <>! {error}</>
            ) : result ? (
              <>
                &gt; <b>{result.font.chars.length}</b> GLYPHS // <b>{result.pages.length}</b> PAGE{result.pages.length > 1 ? "S" : ""} OF <b>{result.font.common.scaleW}×{result.font.common.scaleH}</b> // LINE <b>{result.font.common.lineHeight}</b> BASE <b>{result.font.common.base}</b> // KERNING PAIRS <b>{result.font.kernings.length}</b> // <b>{result.ms} MS</b>
                {preview?.missing.length ? ` // ${preview.missing.length} SAMPLE CHAR${preview.missing.length > 1 ? "S" : ""} NOT IN THE FONT` : ""}
              </>
            ) : (
              <>&gt; IDLE</>
            )}
          </p>
          {result ? (
            <div className="flex flex-wrap items-start gap-3 border-t border-dashed border-rule-strong pt-2">
              <div className="flex flex-col gap-1.5">
                <span className="type-label">Pages</span>
                {result.pages.length > 1 ? (
                  <SegmentedControl label="Page" hideLabel size="sm" value={String(Math.min(pageIndex, result.pages.length - 1))} onChange={(v) => setPageIndex(Number(v))} options={result.pages.slice(0, 12).map((_, i) => ({ value: String(i), label: String(i) }))} />
                ) : null}
              </div>
              <canvas ref={pageRef} role="img" aria-label={`Atlas page ${pageIndex}`} className="max-h-48 max-w-full border border-rule-strong bg-[repeating-conic-gradient(#111_0%_25%,#070707_0%_50%)] bg-[length:16px_16px] object-contain [image-rendering:pixelated]" />
            </div>
          ) : null}
        </section>

        <aside aria-label="Settings" className="lp-scroll flex min-h-0 flex-col gap-3 lg:overflow-y-auto lg:pr-1">
          <section aria-label="Font settings" className="border border-rule-strong bg-panel p-3">
            <div className="mb-2.5 flex items-center gap-2">
              <h2 className="type-panel mr-auto">// Settings</h2>
              <Button size="sm" variant="ghost" onClick={() => update({ ...GEN_DEFAULTS })}>
                Reset
              </Button>
            </div>
            <Module n="01" name="Size" summary={`${s.size}PX · ${s.render === "pixel" ? `1-BIT ≥ ${s.threshold}` : "SMOOTH"}`}>
              <NumberField label="Font size" value={s.size} min={4} max={256} unit="px" onChange={(v) => update({ size: v })} />
              <SegmentedControl label="Edges" inline size="sm" value={s.render} onChange={(v) => update({ render: v })} options={[{ value: "pixel", label: "1-bit", title: "Hard pixels, no antialiasing: for pixel fonts and retro looks" }, { value: "smooth", label: "Smooth", title: "The browser's antialiased rendering" }]} />
              {s.render === "pixel" ? <SliderField label="Threshold" value={s.threshold} min={1} max={255} onChange={(v) => update({ threshold: v })} title="Coverage needed for a pixel to be solid" /> : null}
            </Module>
            <Module n="02" name="Colour & effects" summary={`${s.color.toUpperCase()}${s.outline ? ` · OUTLINE ${s.outline}` : ""}${s.shadow ? " · SHADOW" : ""}`}>
              <ColorField label="Colour" value={s.color} onChange={(v) => update({ color: v })} />
              <NumberField label="Outline" value={s.outline} min={0} max={8} unit="px" onChange={(v) => update({ outline: v })} />
              {s.outline ? <ColorField label="Outline colour" value={s.outlineColor} onChange={(v) => update({ outlineColor: v })} /> : null}
              <Toggle pressed={s.shadow} onPressedChange={(v) => update({ shadow: v })}>
                Drop shadow
              </Toggle>
              {s.shadow ? (
                <>
                  <div className="flex flex-col gap-2">
                    <NumberField label="Shadow X" value={s.shadowX} min={-8} max={8} unit="px" onChange={(v) => update({ shadowX: v })} />
                    <NumberField label="Shadow Y" value={s.shadowY} min={-8} max={8} unit="px" onChange={(v) => update({ shadowY: v })} />
                  </div>
                  <ColorField label="Shadow colour" value={s.shadowColor} onChange={(v) => update({ shadowColor: v })} />
                </>
              ) : null}
              <p className="text-[11.5px] leading-snug text-muted">Colours are baked into the pages. For text you&rsquo;ll tint in the engine, keep it white.</p>
            </Module>
            <Module n="03" name="Spacing" summary={`LETTER ${s.spacing >= 0 ? "+" : ""}${s.spacing} · LINE ${s.lineHeight}% · PAD ${s.padding}`}>
              <NumberField label="Letter spacing" value={s.spacing} min={-8} max={32} unit="px" onChange={(v) => update({ spacing: v })} />
              <NumberField label="Line height" value={s.lineHeight} min={50} max={300} unit="%" onChange={(v) => update({ lineHeight: v })} />
              <NumberField label="Glyph padding" value={s.padding} min={0} max={16} unit="px" onChange={(v) => update({ padding: v })} />
            </Module>
            <Module n="04" name="Pages" summary={`${s.page ? `${s.page}²` : "AUTO"}${s.kerning ? " · KERNING" : ""}`}>
              <SegmentedControl label="Page size" size="sm" value={String(s.page)} onChange={(v) => update({ page: Number(v) })} options={[{ value: "0", label: "Auto", title: "Smallest power-of-two square that fits" }, ...[128, 256, 512, 1024, 2048].map((n) => ({ value: String(n), label: String(n) }))]} />
              <Toggle pressed={s.kerning} onPressedChange={(v) => update({ kerning: v })} title="Kerning pairs measured from the browser's text shaping (up to 256 characters)">
                Kerning pairs
              </Toggle>
            </Module>
          </section>

          {ch ? (
            <section aria-label="Glyph" className="border border-rule-strong bg-panel p-3">
              <h2 className="type-panel mb-2.5">
                // Glyph “{String.fromCodePoint(ch.id)}” <span className="text-muted">{hex(ch.id)}</span>
              </h2>
              <dl className="grid grid-cols-4 gap-x-3 gap-y-1 font-ocr text-[12px]">
                {(
                  [
                    ["x", ch.x],
                    ["y", ch.y],
                    ["w", ch.width],
                    ["h", ch.height],
                    ["xoff", ch.xoffset],
                    ["yoff", ch.yoffset],
                    ["adv", ch.xadvance],
                    ["page", ch.page],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-1">
                    <dt className="text-muted">{k}</dt>
                    <dd className="text-fg">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          <section aria-label="Export" className="border border-rule-strong bg-panel p-3">
            <h2 className="type-panel mb-2.5">// Export</h2>
            <PromptInput aria-label="Font file name" value={name} onChange={(e) => setName(e.target.value)} suffix=".fnt" spellCheck={false} />
            <Button variant="primary" className="mt-2 w-full" disabled={!result} onClick={() => exportAs("zip")}>
              Download ZIP · FNT + JSON + PNG
            </Button>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <Button size="sm" disabled={!result} onClick={() => exportAs("fnt")}>
                .FNT text
              </Button>
              <Button size="sm" disabled={!result} onClick={() => exportAs("json")}>
                JSON
              </Button>
              <Button size="sm" disabled={!result} onClick={() => exportAs("pages")}>
                Page PNG{result && result.pages.length > 1 ? "s" : ""}
              </Button>
              <Button size="sm" disabled={!preview} onClick={() => exportAs("preview")}>
                Preview PNG
              </Button>
            </div>
            <p className="mt-2 font-ocr text-[11px] tracking-[0.04em] text-muted">
              AngelCode BMFont text and JSON. The preview is drawn from these files by LOWPO11Y&rsquo;s BMFont renderer; check your engine&rsquo;s BMFont importer for the format it expects.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
