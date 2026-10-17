"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function roundTo(v: number, step: number) {
  const decimals = (step.toString().split(".")[1] ?? "").length;
  return Number((Math.round(v / step) * step).toFixed(decimals));
}

/** Seamless-style ASCII level bar: █████░░░░░░░ */
export function asciiBar(value: number, min: number, max: number, cells = 12) {
  const f = Math.round(((value - min) / (max - min || 1)) * cells);
  const filled = Math.min(cells, Math.max(0, f));
  return { filled: "█".repeat(filled), empty: "░".repeat(cells - filled) };
}

/* ------------------------------------------------------------------ Slider */

export interface SliderFieldProps {
  label: ReactNode;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Format the readout; defaults to the raw value. */
  format?: (value: number) => string;
  hint?: ReactNode;
  /** Tooltip explaining the setting. */
  title?: string;
  disabled?: boolean;
  className?: string;
}

/** Slider with the Seamless header: NAME ███░░░ VALUE. */
export function SliderField({ label, value, onChange, min, max, step = 1, unit = "", format, hint, title, disabled, className }: SliderFieldProps) {
  const id = useId();
  const bar = asciiBar(value, min, max);
  const readout = `${format ? format(value) : value}${unit}`;
  return (
    <div className={cn("flex flex-col", className)} title={title}>
      <div className="flex items-baseline justify-between gap-2 font-ocr text-xs tracking-[0.08em]">
        <label htmlFor={`sl${id}`} className="text-muted uppercase">
          {label}
        </label>
        <span aria-hidden className="flex-1 overflow-hidden text-right tracking-normal whitespace-pre text-faint">
          <b className="font-normal glow">{bar.filled}</b>
          {bar.empty}
        </span>
        <span className="min-w-[3.6em] text-right glow">{readout}</span>
      </div>
      <input
        id={`sl${id}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={readout}
        aria-describedby={hint ? `sl${id}-h` : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        className="lp-range"
      />
      {hint ? (
        <p id={`sl${id}-h`} className="type-data text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- Segmented */

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  hideLabel?: boolean;
  /** Label on the left in a fixed column (Seamless `.field.row2`). */
  inline?: boolean;
  className?: string;
  size?: "sm" | "md";
}

/** Joined button group with aria-pressed, like Seamless `.seg.full`. */
export function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
  hideLabel,
  inline,
  className,
  size = "md",
}: SegmentedControlProps<T>) {
  const id = useId();
  return (
    <div className={cn(inline ? "grid grid-cols-[80px_1fr] items-center gap-2" : "flex flex-col gap-1.5", className)}>
      <span id={`sg${id}`} className={cn("type-label", hideLabel && "sr-only")}>
        {label}
      </span>
      <div role="group" aria-labelledby={`sg${id}`} className="flex w-full">
        {options.map((o, i) => (
          <button
            key={o.value}
            type="button"
            title={o.title}
            disabled={o.disabled}
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 cursor-pointer border border-edge bg-sunken px-1 font-ocr tracking-[0.05em] text-muted uppercase transition-colors hover:border-edge-hover hover:text-bright disabled:cursor-not-allowed disabled:opacity-35",
              "aria-pressed:relative aria-pressed:z-10 aria-pressed:border-bright aria-pressed:text-bright aria-pressed:[text-shadow:var(--crt-glow)] aria-pressed:shadow-[inset_0_0_0_1px_rgba(255,255,255,.15)]",
              i > 0 && "-ml-px",
              size === "sm" ? "h-7 text-[11px]" : "h-8 text-[12.5px]",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- NumberField */

export interface NumberFieldProps {
  label: ReactNode;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
  /** Classes for the input box (default width w-24). */
  boxClassName?: string;
  id?: string;
}

/**
 * Numeric control: type a value, use arrow keys (Shift = ×10), or drag
 * horizontally on the label to scrub.
 */
export function NumberField({ label, value, onChange, min = -Infinity, max = Infinity, step = 1, unit, hint, disabled, className, boxClassName, id }: NumberFieldProps) {
  const autoId = useId();
  const inputId = id ?? `n${autoId}`;
  // While focused the user's text is kept verbatim; otherwise the prop value is shown.
  const [draft, setDraft] = useState<string | null>(null);
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);
  const shown = draft ?? String(value);

  const commit = (raw: string) => {
    const n = Number(raw.replace(",", "."));
    if (Number.isFinite(n) && raw.trim() !== "") onChange(clamp(roundTo(n, step), min, max));
  };
  const nudge = (dir: 1 | -1, big: boolean) => onChange(clamp(roundTo(value + dir * step * (big ? 10 : 1), step), min, max));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      setDraft(null);
      nudge(e.key === "ArrowUp" ? 1 : -1, e.shiftKey);
    } else if (e.key === "Enter") {
      commit(shown);
      setDraft(null);
      (e.target as HTMLInputElement).select();
    } else if (e.key === "Escape") {
      setDraft(null);
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLLabelElement>) => {
    if (disabled || e.button !== 0) return;
    drag.current = { x: e.clientX, start: value, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLLabelElement>) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    if (Math.abs(dx) > 2) drag.current.moved = true;
    if (!drag.current.moved) return;
    const pixelsPerStep = e.shiftKey ? 1 : 4;
    onChange(clamp(roundTo(drag.current.start + Math.round(dx / pixelsPerStep) * step, step), min, max));
  };
  const onPointerUp = (e: PointerEvent<HTMLLabelElement>) => {
    const wasDrag = drag.current?.moved;
    drag.current = null;
    if (!wasDrag) document.getElementById(inputId)?.focus();
    e.preventDefault();
  };

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-center gap-2">
        <label
          htmlFor={inputId}
          className={cn("type-label min-w-0 flex-1 truncate select-none", disabled ? "opacity-40" : "cursor-ew-resize")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          title="Drag to adjust"
        >
          {label}
        </label>
        <div className={cn("flex h-8 w-24 items-center border border-edge-strong bg-sunken focus-within:border-bright focus-within:shadow-[var(--crt-glow)] hover:border-edge-hover", boxClassName)}>
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            role="spinbutton"
            aria-valuenow={value}
            aria-valuemin={Number.isFinite(min) ? min : undefined}
            aria-valuemax={Number.isFinite(max) ? max : undefined}
            aria-describedby={hint ? `${inputId}-hint` : undefined}
            disabled={disabled}
            value={shown}
            onFocus={(e) => e.target.select()}
            onBlur={() => {
              if (draft !== null) commit(draft);
              setDraft(null);
            }}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-full w-full min-w-0 bg-transparent px-2 text-right font-ocr text-xs text-bright caret-white outline-none"
          />
          {unit ? <span className="pr-2 font-ocr text-xs text-muted">{unit}</span> : null}
        </div>
      </div>
      {hint ? (
        <p id={`${inputId}-hint`} className="type-data text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- Colour */

const HEX_RE = /^#?([0-9a-f]{6})$/i;

export function normaliseHex(input: string): string | null {
  const m = HEX_RE.exec(input.trim());
  return m ? `#${m[1]!.toLowerCase()}` : null;
}

export interface ColorFieldProps {
  label: ReactNode;
  value: string;
  onChange: (hex: string) => void;
  className?: string;
  hideLabel?: boolean;
}

export function ColorField({ label, value, onChange, className, hideLabel }: ColorFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <label htmlFor={`cf${id}`} className={cn("type-label min-w-0 flex-1", hideLabel && "sr-only")}>
        {label}
      </label>
      <input
        type="color"
        aria-label={typeof label === "string" ? `${label} picker` : "Colour picker"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-9 cursor-pointer border border-edge-strong bg-sunken p-0.5"
      />
      <input
        id={`cf${id}`}
        type="text"
        spellCheck={false}
        value={draft ?? value}
        onChange={(e) => {
          setDraft(e.target.value);
          const hex = normaliseHex(e.target.value);
          if (hex) onChange(hex);
        }}
        onBlur={() => setDraft(null)}
        className="h-8 w-24 border border-edge-strong bg-sunken px-2 font-ocr text-xs text-bright uppercase outline-none focus-visible:border-bright focus-visible:shadow-[var(--crt-glow)]"
      />
    </div>
  );
}
