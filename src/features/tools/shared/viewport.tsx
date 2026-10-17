"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface ViewState {
  view: "split" | "tile";
  grid: number;
  tsrc: "result" | "source";
  seams: boolean;
  pixelated: boolean;
  divider: number;
  pan: { x: number; y: number };
  zoom: number;
}

interface Props {
  result: ImageBitmap | null;
  source: ImageBitmap | null;
  hasItem: boolean;
  state: ViewState;
  onChange: (patch: Partial<ViewState>) => void;
  label: string;
  readout: ReactNode;
}

/**
 * The Seamless screen: split before/after with a draggable divider, or a
 * tiled repeat check with pan, wheel zoom and seam lines. Drawing follows the
 * original app's draw() so what you see matches what exports.
 */
export function Viewport({ result, source, hasItem, state, onChange, label, readout }: Props) {
  const screenRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ kind: "divider" } | { kind: "pan"; x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    const screen = screenRef.current,
      cv = canvasRef.current;
    if (!screen || !cv) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = Math.max(1, Math.round(screen.clientWidth * dpr));
      const H = Math.max(1, Math.round(screen.clientHeight * dpr));
      if (cv.width !== W || cv.height !== H) {
        cv.width = W;
        cv.height = H;
      }
      const ctx = cv.getContext("2d")!;
      ctx.clearRect(0, 0, W, H);
      if (!result || !source) return;
      ctx.imageSmoothingEnabled = !state.pixelated;
      ctx.imageSmoothingQuality = "high";
      if (state.view === "split") {
        const padPx = 16 * dpr;
        const k = Math.min((W - padPx * 2) / result.width, (H - padPx * 2) / result.height);
        const dw = result.width * k,
          dh = result.height * k;
        const x0 = (W - dw) / 2,
          y0 = (H - dh) / 2;
        const dx = x0 + dw * state.divider;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, dx, H);
        ctx.clip();
        ctx.drawImage(source, x0, y0, dw, dh);
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.rect(dx, 0, W - dx, H);
        ctx.clip();
        ctx.drawImage(result, x0, y0, dw, dh);
        ctx.restore();
        ctx.strokeStyle = "rgba(255,255,255,.35)";
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(dw) - 1, Math.round(dh) - 1);
        screen.style.setProperty("--divider-x", `${dx / dpr}px`);
      } else {
        const img = state.tsrc === "source" ? source : result;
        const n = state.grid;
        const k = Math.min(W / (n * img.width), H / (n * img.height)) * state.zoom;
        const tw = img.width * k,
          th = img.height * k;
        const ox = (W - tw * n) / 2 + state.pan.x * dpr;
        const oy = (H - th * n) / 2 + state.pan.y * dpr;
        const sx = ox - Math.ceil(ox / tw) * tw,
          sy = oy - Math.ceil(oy / th) * th;
        for (let y = sy; y < H; y += th)
          for (let x = sx; x < W; x += tw) {
            const x1 = Math.round(x),
              y1 = Math.round(y);
            ctx.drawImage(img, x1, y1, Math.round(x + tw) - x1, Math.round(y + th) - y1);
          }
        if (state.seams) {
          ctx.save();
          ctx.strokeStyle = "rgba(255,255,255,.7)";
          ctx.lineWidth = 1;
          ctx.setLineDash([4 * dpr, 4 * dpr]);
          ctx.beginPath();
          for (let x = sx; x < W; x += tw) {
            const p = Math.round(x) + 0.5;
            ctx.moveTo(p, 0);
            ctx.lineTo(p, H);
          }
          for (let y = sy; y < H; y += th) {
            const p = Math.round(y) + 0.5;
            ctx.moveTo(0, p);
            ctx.lineTo(W, p);
          }
          ctx.stroke();
          ctx.restore();
        }
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(screen);
    return () => ro.disconnect();
  }, [result, source, state]);

  // Wheel zoom needs a non-passive listener.
  useEffect(() => {
    const screen = screenRef.current;
    if (!screen) return;
    const onWheel = (e: WheelEvent) => {
      if (state.view !== "tile" || !result) return;
      e.preventDefault();
      onChange({ zoom: Math.min(16, Math.max(0.15, state.zoom * Math.exp(-e.deltaY * 0.0015))) });
    };
    screen.addEventListener("wheel", onWheel, { passive: false });
    return () => screen.removeEventListener("wheel", onWheel);
  }, [state.view, state.zoom, result, onChange]);

  const moveDivider = (clientX: number) => {
    const screen = screenRef.current;
    if (!screen || !result) return;
    const r = screen.getBoundingClientRect();
    const padPx = 16;
    const k = Math.min((r.width - padPx * 2) / result.width, (r.height - padPx * 2) / result.height);
    const dw = result.width * k,
      x0 = (r.width - dw) / 2;
    onChange({ divider: Math.min(1, Math.max(0, (clientX - r.left - x0) / dw)) });
  };

  const split = state.view === "split" && !!result;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div
        ref={screenRef}
        role="img"
        aria-label={result ? `${label}: ${state.view === "split" ? "source on the left, result on the right" : `tiled ${state.grid}×${state.grid}`}` : "No image loaded"}
        tabIndex={result ? 0 : -1}
        onKeyDown={(e) => {
          if (state.view === "split" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
            e.preventDefault();
            e.stopPropagation();
            onChange({ divider: Math.min(1, Math.max(0, state.divider + (e.key === "ArrowLeft" ? -0.05 : 0.05))) });
          }
        }}
        onPointerDown={(e) => {
          if (!result) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          if (state.view === "split") {
            drag.current = { kind: "divider" };
            moveDivider(e.clientX);
          } else drag.current = { kind: "pan", x: e.clientX, y: e.clientY, px: state.pan.x, py: state.pan.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (d.kind === "divider") moveDivider(e.clientX);
          else onChange({ pan: { x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y } });
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        className={cn(
          "relative min-h-[18rem] flex-1 touch-none overflow-hidden border border-edge bg-sunken focus-visible:border-bright focus-visible:outline-none",
          state.view === "tile" && result && "cursor-grab active:cursor-grabbing",
          split && "cursor-ew-resize",
        )}
      >
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
        {!hasItem ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <pre aria-hidden className="font-mono text-[13px] leading-tight text-muted">
              {"┌────────────────────────────────────┐\n│  NO SIGNAL                         │\n│  > drop a texture folder_          │\n└────────────────────────────────────┘"}
            </pre>
          </div>
        ) : null}
        {split ? (
          <>
            <span aria-hidden className="absolute top-2 left-2.5 font-ocr text-[11px] tracking-[0.1em] text-muted">
              SOURCE
            </span>
            <span aria-hidden className="absolute top-2 right-2.5 font-ocr text-[11px] tracking-[0.1em] text-muted">
              RESULT
            </span>
            <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-white/70" style={{ left: "var(--divider-x, 50%)" }}>
              <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border border-bright bg-bg px-1 font-ocr text-[10px] text-bright">◀▶</span>
            </div>
          </>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-ocr text-[12px] tracking-[0.04em] text-muted [&_b]:font-normal [&_b]:text-bright" role="status">
          {readout}
        </p>
        <button
          type="button"
          aria-pressed={state.pixelated}
          onClick={() => onChange({ pixelated: !state.pixelated })}
          className="cursor-pointer border border-edge bg-sunken px-2 py-1 font-ocr text-[11px] tracking-[0.05em] text-muted uppercase hover:text-bright aria-pressed:border-bright aria-pressed:text-bright"
        >
          Pixelated
        </button>
      </div>
    </div>
  );
}
