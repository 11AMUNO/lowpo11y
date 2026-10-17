"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

export type DecalTool = "pan" | "pick" | "erase" | "restore";

interface Props {
  image: ImageBitmap | null;
  width: number;
  height: number;
  /** Background behind transparent pixels. */
  background: { kind: "checker" | "black" | "white" } | { kind: "pattern"; image: ImageBitmap };
  tool: DecalTool;
  /** Tools other than pan work in these image coordinates (null = pan only). */
  editable: boolean;
  brushRadius: number;
  onPick: (x: number, y: number) => void;
  onStroke: (points: [number, number][]) => void;
  label: string;
}

/** Pixel-exact preview with zoom/pan, colour picking and brush strokes in image coordinates. */
export function DecalCanvas({ image, width, height, background, tool, editable, brushRadius, onPick, onStroke, label }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [stroke, setStroke] = useState<[number, number][] | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const geo = useRef({ k: 1, x0: 0, y0: 0 });
  const zoomLabel = useRef<HTMLSpanElement>(null);
  const active = editable && tool !== "pan";

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
      // a closed (detached) bitmap reports 0×0: a resize can fire after it was replaced
      if (!image || !image.width) return;
      const pad = 16 * dpr;
      const fit = Math.min((W - pad * 2) / width, (H - pad * 2) / height);
      const k = fit * zoom >= 1 ? Math.max(1, Math.floor(fit * zoom)) : fit * zoom;
      const x0 = Math.round((W - width * k) / 2 + pan.x * dpr),
        y0 = Math.round((H - height * k) / 2 + pan.y * dpr);
      geo.current = { k: k / dpr, x0: x0 / dpr, y0: y0 / dpr };
      if (zoomLabel.current) zoomLabel.current.textContent = `${Math.round((k / dpr) * 100)}%`;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, width * k, height * k);
      ctx.clip();
      if (background.kind === "pattern") {
        const p = ctx.createPattern(background.image, "repeat")!;
        p.setTransform(new DOMMatrix().translate(x0, y0).scale(Math.max(1, k * 2)));
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = p;
        ctx.fillRect(x0, y0, width * k, height * k);
      } else if (background.kind === "checker") {
        const cell = Math.max(4, Math.round(8 * dpr));
        for (let y = 0; y * cell < height * k; y++)
          for (let x = 0; x * cell < width * k; x++) {
            ctx.fillStyle = (x + y) % 2 ? "#2a2a2a" : "#161616";
            ctx.fillRect(x0 + x * cell, y0 + y * cell, cell, cell);
          }
      } else {
        ctx.fillStyle = background.kind === "white" ? "#ffffff" : "#000000";
        ctx.fillRect(x0, y0, width * k, height * k);
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, x0, y0, width * k, height * k);
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.strokeRect(x0 - 0.5, y0 - 0.5, width * k + 1, height * k + 1);
      // the stroke being painted
      if (stroke && stroke.length) {
        ctx.save();
        ctx.lineCap = ctx.lineJoin = "round";
        ctx.lineWidth = brushRadius * 2 * k;
        ctx.strokeStyle = tool === "erase" ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.45)";
        ctx.beginPath();
        stroke.forEach(([x, y], i) => (i ? ctx.lineTo(x0 + x * k, y0 + y * k) : ctx.moveTo(x0 + x * k, y0 + y * k)));
        if (stroke.length === 1) ctx.lineTo(x0 + stroke[0]![0] * k + 0.01, y0 + stroke[0]![1] * k);
        ctx.stroke();
        ctx.restore();
      }
      // brush outline
      if (cursor && active && (tool === "erase" || tool === "restore")) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = dpr;
        ctx.setLineDash([3 * dpr, 3 * dpr]);
        ctx.beginPath();
        ctx.arc(x0 + cursor.x * k, y0 + cursor.y * k, Math.max(2, brushRadius * k), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    return () => ro.disconnect();
  }, [image, width, height, background, zoom, pan, stroke, cursor, brushRadius, tool, active]);

  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = boxRef.current!.getBoundingClientRect();
    const { k, x0, y0 } = geo.current;
    return [(e.clientX - r.left - x0) / k, (e.clientY - r.top - y0) / k];
  };
  const inside = ([x, y]: [number, number]) => x >= 0 && y >= 0 && x < width && y < height;

  const onDown = (e: ReactPointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const p = at(e);
    if (active && tool === "pick") {
      if (inside(p)) onPick(Math.floor(p[0]), Math.floor(p[1]));
      return;
    }
    if (active) {
      setStroke([p]);
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onMove = (e: ReactPointerEvent) => {
    const p = at(e);
    setCursor({ x: p[0], y: p[1] });
    if (stroke) {
      const last = stroke[stroke.length - 1]!;
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= Math.max(0.5, brushRadius / 4)) setStroke([...stroke, p]);
      return;
    }
    const d = drag.current;
    if (d) setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y });
  };
  const onUp = () => {
    drag.current = null;
    if (stroke) {
      onStroke(stroke.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]));
      setStroke(null);
    }
  };

  const small = "cursor-pointer border border-edge bg-sunken px-2 py-1 font-ocr text-[11px] tracking-[0.05em] text-muted uppercase hover:text-bright";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        ref={boxRef}
        role="img"
        aria-label={label}
        className={`relative min-h-[18rem] flex-1 touch-none overflow-hidden border border-rule-strong bg-sunken ${active ? "cursor-crosshair" : "cursor-grab"}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => setCursor(null)}
        onWheel={(e) => setZoom((z) => Math.min(32, Math.max(0.25, z * (e.deltaY < 0 ? 1.25 : 0.8))))}
      >
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full" />
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
