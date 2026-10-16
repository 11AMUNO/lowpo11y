"use client";

import { SegmentedControl, SliderField } from "@/components/ui/controls";
import { Toggle } from "@/components/ui/form";
import { Advanced, Module } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { psxActive, type SeamlessSettings } from "@/lib/processing/seamless/engine";
import { MODE_DESC, summaries } from "./model";
import type { ExportFormat } from "./protocol";

type Key = keyof SeamlessSettings;
type SetParam = <K extends Key>(key: K, value: SeamlessSettings[K]) => void;

interface SliderCfg {
  key: Key;
  name: string;
  min: number;
  max: number;
  unit: string;
  modes?: SeamlessSettings["mode"][];
  tip: string;
}

const S = (cfg: SliderCfg) => cfg;
const SL = {
  flatten: S({ key: "flatten", name: "Flatten light", min: 0, max: 100, unit: "%", tip: "Removes big lighting gradients that make repeats obvious" }),
  width: S({ key: "width", name: "Blend width", min: 2, max: 50, unit: "%", modes: ["blend", "edge"], tip: "How far in from each edge the heal reaches" }),
  strength: S({ key: "strength", name: "Blend strength", min: 0, max: 100, unit: "%", modes: ["blend", "edge"], tip: "Opacity of the heal. Below 100% the seam is only softened" }),
  jitter: S({ key: "jitter", name: "Organic seam", min: 0, max: 100, unit: "%", modes: ["blend", "edge"], tip: "Breaks the straight blend band up with noise" }),
  offsetX: S({ key: "offsetX", name: "Seam position X", min: 10, max: 90, unit: "%", modes: ["blend", "offset"], tip: "Where the hidden seam sits horizontally" }),
  offsetY: S({ key: "offsetY", name: "Seam position Y", min: 10, max: 90, unit: "%", modes: ["blend", "offset"], tip: "Where the hidden seam sits vertically" }),
  keyTol: S({ key: "keyTol", name: "Threshold", min: 0, max: 64, unit: "", tip: "Brightest value (0-255) that still counts as background black" }),
  keySoft: S({ key: "keySoft", name: "Soft edge", min: 0, max: 64, unit: "", tip: "Fades pixels just above the threshold for anti-aliased edges. Off while PSX is on (hard 1-bit alpha)" }),
  psxColors: S({ key: "psxColors", name: "Colours", min: 2, max: 256, unit: "", tip: "Palette size. PS1 4-bit CLUT = 16, 8-bit CLUT = 256" }),
  psxDitherAmt: S({ key: "psxDitherAmt", name: "Dither strength", min: 0, max: 100, unit: "%", tip: "How strongly the dither breaks up banding" }),
};

export type ModuleKey = "source" | "tile" | "key" | "psx";

export function PipelinePanel({
  settings: s,
  setParam,
  disabled,
  format,
  open,
  setOpen,
}: {
  settings: SeamlessSettings;
  setParam: SetParam;
  disabled: boolean;
  format: ExportFormat;
  open: Record<ModuleKey, boolean>;
  setOpen: (m: ModuleKey, v: boolean) => void;
}) {
  const sum = summaries(s);
  const slider = (cfg: SliderCfg) => {
    if (cfg.modes && !cfg.modes.includes(s.mode)) return null;
    if (cfg.key === "offsetX" && s.direction === "y") return null;
    if (cfg.key === "offsetY" && s.direction === "x") return null;
    return (
      <SliderField
        key={cfg.key}
        label={cfg.name}
        title={cfg.tip}
        value={s[cfg.key] as number}
        min={cfg.min}
        max={cfg.max}
        unit={cfg.unit}
        disabled={disabled}
        onChange={(v) => setParam(cfg.key, v as never)}
      />
    );
  };
  const bool = (key: Key, label: string, title: string) => (
    <Toggle pressed={!!s[key]} onPressedChange={(v) => setParam(key, v as never)} title={title} disabled={disabled}>
      {label}
    </Toggle>
  );
  const healing = s.mode === "blend" || s.mode === "edge";
  const switchOn = (key: "tile" | "keyBlack" | "psx", m: ModuleKey) => (v: boolean) => {
    setParam(key, v);
    if (v && !open[m]) setOpen(m, true);
  };

  return (
    <div className={cn(disabled && "pointer-events-none opacity-50")} aria-disabled={disabled || undefined}>
      <Module n="01" name="Source" summary={sum.source} open={open.source} onOpenChange={(v) => setOpen("source", v)}>
        <p className="text-xs text-muted">Resize and prep the image before anything else.</p>
        <SegmentedControl
          label="Long side"
          inline
          size="sm"
          value={String(s.size)}
          onChange={(v) => setParam("size", Number(v))}
          options={[
            { value: "0", label: "Orig" },
            { value: "128", label: "128" },
            { value: "256", label: "256" },
            { value: "512", label: "512" },
            { value: "1024", label: "1K" },
            { value: "2048", label: "2K" },
          ]}
        />
        <SegmentedControl
          label="Resample"
          inline
          size="sm"
          value={s.resample}
          onChange={(v) => setParam("resample", v)}
          options={[
            { value: "smooth", label: "Smooth" },
            { value: "nearest", label: "Nearest" },
          ]}
        />
        <div className="flex flex-wrap gap-1.5">{bool("square", "Square crop", "Center-crop to a square first")}</div>
        {slider(SL.flatten)}
      </Module>

      <Module n="02" name="Seamless" summary={sum.tile} enabled={s.tile} onEnabledChange={switchOn("tile", "tile")} open={open.tile} onOpenChange={(v) => setOpen("tile", v)}>
        <SegmentedControl
          label="Seam mode"
          hideLabel
          size="sm"
          value={s.mode}
          onChange={(v) => setParam("mode", v)}
          options={[
            { value: "blend", label: "Blend" },
            { value: "mirror", label: "Mirror" },
            { value: "edge", label: "Edge" },
            { value: "offset", label: "Offset" },
          ]}
        />
        <p className="text-xs text-muted">{MODE_DESC[s.mode]}</p>
        <SegmentedControl
          label="Repeat"
          inline
          size="sm"
          value={s.direction}
          onChange={(v) => setParam("direction", v)}
          options={[
            { value: "both", label: "X + Y" },
            { value: "x", label: "X" },
            { value: "y", label: "Y" },
          ]}
        />
        {slider(SL.width)}
        {slider(SL.strength)}
        {slider(SL.jitter)}
        <Advanced>
          {slider(SL.offsetX)}
          {slider(SL.offsetY)}
          {healing ? (
            <SegmentedControl
              label="Falloff"
              inline
              size="sm"
              value={s.falloff}
              onChange={(v) => setParam("falloff", v)}
              options={[
                { value: "linear", label: "Linear" },
                { value: "smooth", label: "Smooth" },
                { value: "sharp", label: "Sharp" },
              ]}
            />
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {healing ? bool("pixelSafe", "Pixel-safe blend", "Dithered blend that never invents new colours") : null}
            {s.mode === "mirror" ? bool("mirrorFit", "Mirror fit 1×", "Scale the 2× mirror result back to source size") : null}
            {healing && s.jitter ? (
              <button
                type="button"
                title="New random pattern for the organic seam"
                onClick={() => setParam("seed", (Math.random() * 1e6) | 0)}
                className="cursor-pointer border border-edge bg-sunken px-2.5 py-1.5 font-ocr text-[12.5px] tracking-[0.05em] text-muted uppercase hover:border-edge-hover hover:text-bright"
              >
                Reseed
              </button>
            ) : null}
          </div>
        </Advanced>
      </Module>

      <Module n="03" name="Background" summary={sum.key} enabled={s.keyBlack} onEnabledChange={switchOn("keyBlack", "key")} open={open.key} onOpenChange={(v) => setOpen("key", v)}>
        <p className="text-xs text-muted">Pure black → transparent. Export as PNG or WEBP.</p>
        <div className="flex flex-wrap gap-1.5">
          {bool("keyConnected", "Connected to edge only", "Only remove black that touches the border, so dark detail inside the object stays")}
        </div>
        {slider(SL.keyTol)}
        {psxActive(s) ? null : slider(SL.keySoft)}
        {format === "jpg" ? <p className="border border-bright px-2 py-1.5 font-ocr text-[11px] text-bright">! JPG can&rsquo;t hold transparency // switch FORMAT to PNG or WEBP.</p> : null}
      </Module>

      <Module n="04" name="PSX effects" summary={sum.psx} enabled={s.psx} onEnabledChange={switchOn("psx", "psx")} open={open.psx} onOpenChange={(v) => setOpen("psx", v)}>
        <p className="text-xs text-muted">Colour limit + dither, PlayStation style.</p>
        <div className="flex flex-wrap gap-1.5">
          {bool("psxLimit", "Limit colours", "Reduce to an adaptive palette")}
          {bool("psx15", "15-bit RGB555", "Snap to the PS1's 15-bit RGB555 colour range")}
        </div>
        {s.psxLimit ? slider(SL.psxColors) : null}
        <SegmentedControl
          label="Dither"
          inline
          size="sm"
          value={s.psxDither}
          onChange={(v) => setParam("psxDither", v)}
          options={[
            { value: "none", label: "None", title: "No dither" },
            { value: "bayer4", label: "4×4", title: "4×4 ordered, what the PS1 used" },
            { value: "bayer8", label: "8×8", title: "8×8 ordered" },
            { value: "fs", label: "F-S", title: "Floyd-Steinberg error diffusion" },
          ]}
        />
        {s.psxDither !== "none" ? slider(SL.psxDitherAmt) : null}
      </Module>
    </div>
  );
}
