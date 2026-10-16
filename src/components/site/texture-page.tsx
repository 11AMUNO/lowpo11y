"use client";

import Link from "next/link";
import { useRef, useState, type PointerEvent } from "react";
import { cn } from "@/lib/cn";

export interface TexturePageTile {
  /** Null renders an empty slot (transparent checker). */
  src: string | null;
  title: string;
  href?: string;
  /** Native texel size of the image, e.g. 128. */
  size: number;
  alpha?: boolean;
}

interface TexturePageProps {
  tiles: TexturePageTile[];
  columns: number;
  /** Texel size each tile occupies on the page. */
  cell: number;
  /** Corner tag, e.g. "TPAGE 0". */
  label: string;
  className?: string;
}

const TICK = 16;

/**
 * A VRAM-style texture page in a Seamless "screen": textures on a texel grid
 * with rulers. Hovering reads out the texel coordinate and the texture under the cursor.
 */
export function TexturePage({ tiles, columns, cell, label, className }: TexturePageProps) {
  const rows = Math.ceil(tiles.length / columns);
  const width = columns * cell;
  const height = rows * cell;
  const ref = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number; tile?: TexturePageTile } | null>(null);

  const onMove = (e: PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * height);
    if (x < 0 || y < 0 || x >= width || y >= height) return setCursor(null);
    setCursor({ x, y, tile: tiles[Math.floor(y / cell) * columns + Math.floor(x / cell)] });
  };

  const hTicks = Array.from({ length: width / TICK + 1 }, (_, i) => i * TICK);
  const vTicks = Array.from({ length: height / TICK + 1 }, (_, i) => i * TICK);

  return (
    <figure className={cn("select-none", className)}>
      <div className="grid grid-cols-[1.75rem_1fr] grid-rows-[1.25rem_1fr]">
        <div />
        <div className="relative h-5 border-b border-edge" aria-hidden>
          {hTicks.map((t) => (
            <span key={t} className={cn("absolute bottom-0 w-px bg-edge", t % (cell / 2) === 0 ? "h-2.5" : "h-1")} style={{ left: `${(t / width) * 100}%` }}>
              {t % cell === 0 && t < width ? <span className="absolute -top-4 left-1 font-ocr text-[10px] text-muted">{t}</span> : null}
            </span>
          ))}
        </div>
        <div className="relative w-7 border-r border-edge" aria-hidden>
          {vTicks.map((t) => (
            <span key={t} className={cn("absolute right-0 h-px bg-edge", t % (cell / 2) === 0 ? "w-2.5" : "w-1")} style={{ top: `${(t / height) * 100}%` }}>
              {t % cell === 0 && t < height ? <span className="absolute top-0.5 -left-6 font-ocr text-[10px] text-muted">{t}</span> : null}
            </span>
          ))}
        </div>
        <div
          ref={ref}
          onPointerMove={onMove}
          onPointerLeave={() => setCursor(null)}
          className="relative grid border border-rule-strong bg-checker"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, aspectRatio: `${width} / ${height}` }}
        >
          {tiles.map((t, i) => {
            if (!t.src)
              return (
                <div key={`empty-${i}`} className="grid place-items-center">
                  <span className="font-ocr text-[10px] tracking-[0.1em] text-muted uppercase">{t.title}</span>
                </div>
              );
            const img = <img src={t.src} alt={`${t.title} texture`} width={cell} height={cell} className="block h-full w-full pixelated" decoding="async" />;
            return t.href ? (
              <Link key={t.src} href={t.href} className="relative block outline-offset-[-1px] hover:z-10 hover:outline hover:outline-1 hover:outline-white">
                {img}
              </Link>
            ) : (
              <div key={t.src}>{img}</div>
            );
          })}
          <span className="pointer-events-none absolute top-2 left-2 border border-rule-strong bg-black/75 px-1.5 py-px font-ocr text-[11px] tracking-[0.12em] text-bright">
            {label}
          </span>
          {cursor ? (
            <>
              <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-white/45" style={{ left: `${((cursor.x + 0.5) / width) * 100}%` }} />
              <div aria-hidden className="pointer-events-none absolute inset-x-0 h-px bg-white/45" style={{ top: `${((cursor.y + 0.5) / height) * 100}%` }} />
            </>
          ) : null}
        </div>
      </div>
      <figcaption className="mt-2 ml-7 min-h-5 font-ocr text-xs tracking-[0.06em] text-muted uppercase">
        {cursor ? (
          <>
            &gt; U <b className="font-normal glow">{String(cursor.x).padStart(3, "0")}</b> V <b className="font-normal glow">{String(cursor.y).padStart(3, "0")}</b>
            {cursor.tile ? <> // {cursor.tile.title}</> : null}
          </>
        ) : (
          <>
            &gt; {width}×{height} texels // {tiles.filter((t) => t.src).length} textures // hover to read texels
          </>
        )}
      </figcaption>
    </figure>
  );
}
