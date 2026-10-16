"use client";

import { Slider as RSlider, ToggleGroup } from "radix-ui";
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function roundTo(v: number, step: number) {
  const decimals = (step.toString().split(".")[1] ?? "").length;
  return Number((Math.round(v / step) * step).toFixed(decimals));
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
  id?: string;
}

/**
 * Workstation-style numeric control: type a value, use arrow keys (Shift = ×10),
 * or drag horizontally on the label to scrub.
 */
export function NumberField({
  label,
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  unit,
  hint,
  disabled,
  className,
  id,
}: NumberFieldProps) {
  const autoId = useId();
  const inputId = id ?? `n${autoId}`;
  // While the input is focused the user's text is kept verbatim; otherwise the prop value is shown.
  const [draft, setDraft] = useState<string | null>(null);
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);
  const shown = draft ?? String(value);

  const commit = (raw: string) => {
    const n = Number(raw.replace(",", "."));
    if (Number.isFinite(n) && raw.trim() !== "") onChange(clamp(roundTo(n, step), min, max));
  };

  const nudge = (dir: 1 | -1, big: boolean) => {
    onChange(clamp(roundTo(value + dir * step * (big ? 10 : 1), step), min, max));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
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
    const next = drag.current.start + Math.round(dx / pixelsPerStep) * step;
    onChange(clamp(roundTo(next, step), min, max));
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
          className={cn(
            "type-label min-w-0 flex-1 truncate text-fg select-none",
            disabled ? "opacity-50" : "cursor-ew-resize",
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          title="Drag to adjust"
        >
          {label}
        </label>
        <div className="flex h-8 w-24 items-center rounded-sm border border-rule-strong bg-sunken focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/35 hover:border-fg/35">
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
            className="type-data h-full w-full min-w-0 bg-transparent px-2 text-right text-fg outline-none"
          />
          {unit ? <span className="type-data pr-2 text-muted">{unit}</span> : null}
        </div>
      </div>
      {hint ? (
        <p id={`${inputId}-hint`} className="type-small text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
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
  disabled?: boolean;
  className?: string;
}

export function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  format,
  hint,
  disabled,
  className,
}: SliderFieldProps) {
  const id = useId();
  const labelId = `sl${id}`;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId} className="type-label text-fg">
          {label}
        </span>
        <span className="type-data text-muted" aria-hidden>
          {format ? format(value) : value}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <RSlider.Root
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(v) => onChange(v[0] ?? value)}
        className="relative flex h-5 w-full touch-none items-center select-none data-[disabled]:opacity-50"
      >
        <RSlider.Track className="relative h-1 grow rounded-full bg-rule-strong">
          <RSlider.Range className="absolute h-full rounded-full bg-accent" />
        </RSlider.Track>
        <RSlider.Thumb
          aria-labelledby={labelId}
          aria-valuetext={`${format ? format(value) : value}${unit ? ` ${unit}` : ""}`}
          className="block size-4 rounded-xs border-2 border-accent bg-bg transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-strong"
        />
      </RSlider.Root>
      {hint ? <p className="type-small text-muted">{hint}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------ Segmented */

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

export interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  hideLabel?: boolean;
  className?: string;
  size?: "sm" | "md";
}

export function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
  hideLabel,
  className,
  size = "md",
}: SegmentedControlProps<T>) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span id={`sg${id}`} className={cn("type-label text-fg", hideLabel && "sr-only")}>
        {label}
      </span>
      <ToggleGroup.Root
        type="single"
        value={value}
        onValueChange={(v) => v && onChange(v as T)}
        aria-labelledby={`sg${id}`}
        className="inline-flex w-full rounded-sm border border-rule-strong bg-sunken p-0.5"
      >
        {options.map((o) => (
          <ToggleGroup.Item
            key={o.value}
            value={o.value}
            title={o.title}
            className={cn(
              "flex-1 rounded-xs px-2.5 text-muted transition-colors hover:text-fg data-[state=on]:bg-panel-2 data-[state=on]:text-fg data-[state=on]:shadow-[inset_0_-2px_0_var(--c-accent)]",
              size === "sm" ? "h-7 text-xs" : "h-8 text-[0.8125rem]",
            )}
          >
            {o.label}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
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
      <label htmlFor={`cf${id}`} className={cn("type-label min-w-0 flex-1 text-fg", hideLabel && "sr-only")}>
        {label}
      </label>
      <input
        type="color"
        aria-label={typeof label === "string" ? `${label} picker` : "Colour picker"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-9 cursor-pointer rounded-sm border border-rule-strong bg-sunken p-0.5"
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
        className="type-data h-8 w-24 rounded-sm border border-rule-strong bg-sunken px-2 text-fg outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/35"
      />
    </div>
  );
}
