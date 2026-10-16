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
  caption: string;
  className?: string;
}

const TICK = 16;

/**
 * A VRAM-style texture page: textures laid out on a texel grid with rulers.
 * Hovering reads out the texel coordinate and which texture is under the cursor.
 */
export function TexturePage({ tiles, columns, cell, caption, className }: TexturePageProps) {
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
    const tile = tiles[Math.floor(y / cell) * columns + Math.floor(x / cell)];
    setCursor({ x, y, tile });
  };

  const hTicks = Array.from({ length: width / TICK + 1 }, (_, i) => i * TICK);
  const vTicks = Array.from({ length: height / TICK + 1 }, (_, i) => i * TICK);

  return (
    <figure className={cn("select-none", className)}>
      <div className="grid grid-cols-[1.75rem_1fr] grid-rows-[1.25rem_1fr]">
        <div />
        {/* Top ruler */}
        <div className="relative h-5 border-b border-rule-strong" aria-hidden>
          {hTicks.map((t) => (
            <span
              key={t}
              className={cn("absolute bottom-0 w-px bg-rule-strong", t % (cell / 2) === 0 ? "h-2.5" : "h-1")}
              style={{ left: `${(t / width) * 100}%` }}
            >
              {t % cell === 0 && t < width ? (
                <span className="type-data absolute -top-4 left-1 text-[0.5625rem] text-muted">{t}</span>
              ) : null}
            </span>
          ))}
        </div>
        {/* Left ruler */}
        <div className="relative w-7 border-r border-rule-strong" aria-hidden>
          {vTicks.map((t) => (
            <span
              key={t}
              className={cn("absolute right-0 h-px bg-rule-strong", t % (cell / 2) === 0 ? "w-2.5" : "w-1")}
              style={{ top: `${(t / height) * 100}%` }}
            >
              {t % cell === 0 && t < height ? (
                <span className="type-data absolute top-0.5 -left-6 text-[0.5625rem] text-muted">{t}</span>
              ) : null}
            </span>
          ))}
        </div>
        <div
          ref={ref}
          onPointerMove={onMove}
          onPointerLeave={() => setCursor(null)}
          className="relative grid bg-checker"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, aspectRatio: `${width} / ${height}` }}
        >
          {tiles.map((t, i) => {
            if (!t.src)
              return (
                <div key={`empty-${i}`} className="grid place-items-center">
                  <span className="type-data text-[0.625rem] text-muted">{t.title}</span>
                </div>
              );
            const img = (
              <img
                src={t.src}
                alt={`${t.title} texture`}
                width={cell}
                height={cell}
                className="block h-full w-full pixelated"
                loading="eager"
                decoding="async"
              />
            );
            return t.href ? (
              <Link key={t.src} href={t.href} className="relative block outline-offset-[-2px] hover:z-10 hover:outline hover:outline-2 hover:outline-accent">
                {img}
              </Link>
            ) : (
              <div key={t.src}>{img}</div>
            );
          })}
          {/* The only scanline treatment on the site. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.07] mix-blend-multiply"
            style={{ backgroundImage: "repeating-linear-gradient(to bottom, #000 0 1px, transparent 1px 3px)" }}
          />
          {cursor ? (
            <>
              <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-info/60" style={{ left: `${((cursor.x + 0.5) / width) * 100}%` }} />
              <div aria-hidden className="pointer-events-none absolute inset-x-0 h-px bg-info/60" style={{ top: `${((cursor.y + 0.5) / height) * 100}%` }} />
            </>
          ) : null}
        </div>
      </div>
      <figcaption className="mt-3 ml-7 flex min-h-5 flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <span className="type-small text-muted">{caption}</span>
        <span className="type-data text-info tabular" aria-live="off">
          {cursor ? (
            <>
              u {String(cursor.x).padStart(3, "0")} v {String(cursor.y).padStart(3, "0")}
              {cursor.tile ? <span className="ml-3 text-muted">{cursor.tile.title}</span> : null}
            </>
          ) : (
            <span className="text-muted">
              {width} × {height} texels
            </span>
          )}
        </span>
      </figcaption>
    </figure>
  );
}
