"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/ui/controls";
import { cn } from "@/lib/cn";

type Zoom = "fit" | "1" | "2" | "4" | "8";
type Tiling = "1" | "2" | "3";

/**
 * Texel-accurate texture preview: integer zoom with nearest filtering, a
 * tiling check (seams show up at 3×3), and a cursor readout in texel space.
 */
export function TextureViewer({ src, width, height, title, className }: { src: string; width: number; height: number; title: string; className?: string }) {
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [tiles, setTiles] = useState<Tiling>("1");
  const [smooth, setSmooth] = useState(false);
  const [bg, setBg] = useState<"checker" | "black" | "white">("checker");
  const [texel, setTexel] = useState<[number, number] | null>(null);

  const n = Number(tiles);
  const fixed = zoom !== "fit";
  const scale = fixed ? Number(zoom) : 1;
  const surfaceW = width * n * scale;
  const surfaceH = height * n * scale;

  return (
    <div className={cn("flex flex-col", className)}>
      <div
        className={cn(
          "lp-scroll relative grid aspect-[4/3] w-full overflow-auto border border-rule-strong sm:aspect-[16/10]",
          bg === "checker" ? "bg-checker" : bg === "black" ? "bg-black" : "bg-white",
        )}
        // "safe" keeps zoomed-in content scrollable from its top-left corner.
        style={{ placeItems: "safe center", containerType: "size" }}
      >
        <div
          role="img"
          aria-label={`${title}, ${width}×${height} pixels, shown ${n > 1 ? `tiled ${n}×${n}` : "once"}${fixed ? ` at ${scale}× zoom` : ""}`}
          className={cn("shrink-0", !smooth && "pixelated", fixed && "m-4")}
          style={{
            backgroundImage: `url("${src}")`,
            backgroundRepeat: "repeat",
            backgroundSize: fixed ? `${width * scale}px ${height * scale}px` : `${100 / n}% ${100 / n}%`,
            aspectRatio: `${width} / ${height}`,
            ...(fixed ? { width: surfaceW, height: surfaceH } : { width: `min(calc(100cqw - 2rem), calc((100cqh - 2rem) * ${width / height}))` }),
          }}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const u = (((e.clientX - r.left) / r.width) * n) % 1;
            const v = (((e.clientY - r.top) / r.height) * n) % 1;
            setTexel([Math.min(width - 1, Math.floor(u * width)), Math.min(height - 1, Math.floor(v * height))]);
          }}
          onPointerLeave={() => setTexel(null)}
        />
        <p aria-hidden className="pointer-events-none absolute top-2 left-2.5 border border-rule-strong bg-black/80 px-1.5 font-ocr text-[11px] tracking-[0.08em] text-muted uppercase">
          {width}×{height}px {texel ? `// x ${String(texel[0]).padStart(3, "0")} y ${String(texel[1]).padStart(3, "0")}` : ""}
        </p>
      </div>
      <div className="grid gap-x-5 gap-y-2 border border-t-0 border-rule-strong bg-panel px-3 py-2 sm:grid-cols-2">
        <SegmentedControl
          label="Zoom"
          inline
          size="sm"
          className="grid-cols-[64px_1fr]"
          value={zoom}
          onChange={setZoom}
          options={[
            { value: "fit", label: "Fit" },
            { value: "1", label: "1×" },
            { value: "2", label: "2×" },
            { value: "4", label: "4×" },
            { value: "8", label: "8×", disabled: width > 512 },
          ]}
        />
        <SegmentedControl
          label="Tile"
          inline
          size="sm"
          className="grid-cols-[64px_1fr]"
          value={tiles}
          onChange={setTiles}
          options={[
            { value: "1", label: "1×1" },
            { value: "2", label: "2×2" },
            { value: "3", label: "3×3", title: "Check that edges wrap without seams" },
          ]}
        />
        <SegmentedControl
          label="Filter"
          inline
          size="sm"
          className="grid-cols-[64px_1fr]"
          value={smooth ? "smooth" : "nearest"}
          onChange={(v) => setSmooth(v === "smooth")}
          options={[
            { value: "nearest", label: "Nearest", title: "Point sampling, as a PS1-era engine draws it" },
            { value: "smooth", label: "Bilinear" },
          ]}
        />
        <SegmentedControl
          label="Backdrop"
          inline
          size="sm"
          className="grid-cols-[64px_1fr]"
          value={bg}
          onChange={setBg}
          options={[
            { value: "checker", label: "Checker" },
            { value: "black", label: "Black" },
            { value: "white", label: "White" },
          ]}
        />
      </div>
    </div>
  );
}
