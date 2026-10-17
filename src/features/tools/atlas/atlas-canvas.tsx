"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export interface CanvasFrame {
  id: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  bitmap: ImageBitmap | null;
  width: number;
  height: number;
  frames: CanvasFrame[];
  extrude: number;
  selected: number | null;
  guides: boolean;
  onSelect: (id: number) => void;
  label: string;
}

/** Atlas preview: checkerboard, pixel-exact zoom and pan, frame outlines, click to select. */
export function AtlasCanvas({ bitmap, width, height, frames, extrude, selected, guides, onSelect, label }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState<CanvasFrame | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const geo = useRef({ k: 1, x0: 0, y0: 0 });
  const zoomLabel = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const box = boxRef.current,
      cv = canvasRef.current;
    if (!box || !cv) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = Math.max(1, Math.round(box.clientWidth * dpr)),
        H = Math.max(1, Math.round(box.clientHeight * dpr));
      if (cv.width !== W || cv.height !== H) {
        cv.width = W;
        cv.height = H;
      }
      const ctx = cv.getContext("2d")!;
      ctx.clearRect(0, 0, W, H);
      if (!bitmap) return;
      const pad = 16 * dpr;
      const fit = Math.min((W - pad * 2) / width, (H - pad * 2) / height);
      // whole-pixel scales when enlarging keep texels square
      const k = fit * zoom >= 1 ? Math.max(1, Math.floor(fit * zoom)) : fit * zoom;
      const x0 = Math.round((W - width * k) / 2 + pan.x * dpr),
        y0 = Math.round((H - height * k) / 2 + pan.y * dpr);
      geo.current = { k: k / dpr, x0: x0 / dpr, y0: y0 / dpr };
      if (zoomLabel.current) zoomLabel.current.textContent = `${Math.round((k / dpr) * 100)}%`;
      // checkerboard behind transparency
      const cell = Math.max(4, Math.round(8 * dpr));
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, width * k, height * k);
      ctx.clip();
      for (let y = 0; y * cell < height * k; y++)
        for (let x = 0; x * cell < width * k; x++) {
          ctx.fillStyle = (x + y) % 2 ? "#0b0b0b" : "#161616";
          ctx.fillRect(x0 + x * cell, y0 + y * cell, cell, cell);
        }
      ctx.restore();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bitmap, x0, y0, width * k, height * k);
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 - 0.5, y0 - 0.5, width * k + 1, height * k + 1);
      if (guides || selected !== null) {
        for (const f of frames) {
          const on = f.id === selected || f.id === hover?.id;
          if (!guides && !on) continue;
          if (extrude && on) {
            ctx.setLineDash([3 * dpr, 3 * dpr]);
            ctx.strokeStyle = "rgba(255,255,255,.45)";
            ctx.strokeRect(x0 + (f.x - extrude) * k + 0.5, y0 + (f.y - extrude) * k + 0.5, (f.w + extrude * 2) * k - 1, (f.h + extrude * 2) * k - 1);
            ctx.setLineDash([]);
          }
          ctx.strokeStyle = on ? "#ffffff" : "rgba(255,255,255,.28)";
          ctx.lineWidth = on ? 2 * dpr : 1;
          ctx.strokeRect(x0 + f.x * k + 0.5, y0 + f.y * k + 0.5, f.w * k - 1, f.h * k - 1);
          ctx.lineWidth = 1;
        }
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    return () => ro.disconnect();
  }, [bitmap, width, height, frames, extrude, selected, hover, guides, zoom, pan]);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current!.getBoundingClientRect();
    const { k, x0, y0 } = geo.current;
    const px = (e.clientX - r.left - x0) / k,
      py = (e.clientY - r.top - y0) / k;
    return { px, py, frame: frames.find((f) => px >= f.x && px < f.x + f.w && py >= f.y && py < f.y + f.h) ?? null };
  };

  const onDown = (e: ReactPointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x,
        dy = e.clientY - d.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      if (d.moved) setPan({ x: d.px + dx, y: d.py + dy });
      return;
    }
    const h = at(e).frame;
    if (h?.id !== hover?.id) setHover(h);
  };
  const onUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      const f = at(e).frame;
      if (f) onSelect(f.id);
    }
  };

  const small = "cursor-pointer border border-edge bg-sunken px-2 py-1 font-ocr text-[11px] tracking-[0.05em] text-muted uppercase hover:text-bright";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        ref={boxRef}
        role="img"
        aria-label={label}
        className="relative min-h-[18rem] flex-1 cursor-crosshair touch-none overflow-hidden border border-rule-strong bg-sunken"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => setHover(null)}
        onWheel={(e) => setZoom((z) => Math.min(32, Math.max(0.25, z * (e.deltaY < 0 ? 1.25 : 0.8))))}
      >
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full" />
        {hover ? (
          <span className="pointer-events-none absolute top-2 left-2 border border-rule-strong bg-black/80 px-1.5 py-px font-ocr text-[11px] tracking-[0.06em] text-bright">
            {hover.name} // {hover.x},{hover.y} {hover.w}×{hover.h}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" className={small} onClick={() => setZoom((z) => Math.max(0.25, z * 0.8))} aria-label="Zoom out">
          −
        </button>
        <button
          type="button"
          className={small}
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          Fit
        </button>
        <button type="button" className={small} onClick={() => setZoom((z) => Math.min(32, z * 1.25))} aria-label="Zoom in">
          +
        </button>
        <span ref={zoomLabel} className="font-ocr text-[11px] text-muted" />
      </div>
    </div>
  );
}
