"use client";

import { Checkbox as RCheckbox } from "radix-ui";
import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ Field */

interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Wires label, hint and error ids into whichever control is placed inside. */
export function useFieldControl(explicitId?: string) {
  const ctx = useContext(FieldContext);
  return {
    id: explicitId ?? ctx?.id,
    "aria-describedby": ctx?.describedBy,
    "aria-invalid": ctx?.invalid || undefined,
  };
}

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Shown after the label, e.g. a unit or current value. */
  aside?: ReactNode;
  required?: boolean;
  id?: string;
  className?: string;
  /** Visually hide the label (it stays available to assistive tech). */
  hideLabel?: boolean;
  /** Label column on the left, control on the right (Seamless `.field.row2`). */
  inline?: boolean;
  children: ReactNode;
}

export function Field({ label, hint, error, aside, required, id, className, hideLabel, inline, children }: FieldProps) {
  const autoId = useId();
  const controlId = id ?? `f${autoId}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider value={{ id: controlId, describedBy, invalid: Boolean(error) }}>
      <div className={cn(inline ? "grid grid-cols-[96px_1fr] items-center gap-2" : "flex flex-col gap-1.5", className)}>
        <div className={cn("flex items-baseline justify-between gap-3", hideLabel && "sr-only")}>
          <label htmlFor={controlId} className="type-label">
            {label}
            {required ? <span aria-hidden> *</span> : null}
          </label>
          {aside ? <span className="type-data text-bright">{aside}</span> : null}
        </div>
        <div className={inline ? "min-w-0" : undefined}>{children}</div>
        {hint ? (
          <p id={hintId} className={cn("type-data text-muted", inline && "col-span-2")}>
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className={cn("type-data glow", inline && "col-span-2")} role="alert">
            ! {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

/* ---------------------------------------------------------------- Controls */

const controlBase =
  "w-full border border-edge-strong bg-sunken text-bright caret-white placeholder:text-faint " +
  "transition-[border-color,box-shadow] duration-150 hover:border-edge-hover focus-visible:border-bright " +
  "focus-visible:shadow-[var(--crt-glow)] focus-visible:outline-none disabled:opacity-40 aria-invalid:border-bright";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, id, ...props },
  ref,
) {
  const field = useFieldControl(id);
  return <input ref={ref} {...field} {...props} className={cn(controlBase, "h-9 px-2.5 text-[13.5px]", className)} />;
});

/** Prompt-style input with a leading ">" and optional trailing suffix (Seamless `.namebox`). */
export const PromptInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { suffix?: ReactNode }>(
  function PromptInput({ className, id, suffix, ...props }, ref) {
    const field = useFieldControl(id);
    return (
      <div
        className={cn(
          "flex items-center border border-edge-strong bg-sunken focus-within:border-bright focus-within:shadow-[var(--crt-glow)] hover:border-edge-hover",
          className,
        )}
      >
        <span aria-hidden className="px-2 font-ocr text-muted">
          &gt;
        </span>
        <input
          ref={ref}
          {...field}
          {...props}
          className="h-9 min-w-0 flex-1 bg-transparent pr-2 text-[13.5px] text-bright caret-white outline-none placeholder:text-faint"
        />
        {suffix ? <span className="px-2.5 font-ocr text-muted">{suffix}</span> : null}
      </div>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, id, rows = 4, ...props }, ref) {
    const field = useFieldControl(id);
    return (
      <textarea
        ref={ref}
        rows={rows}
        {...field}
        {...props}
        className={cn(controlBase, "min-h-20 px-2.5 py-2 text-[13.5px] leading-relaxed", className)}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, id, children, ...props },
  ref,
) {
  const field = useFieldControl(id);
  return (
    <select
      ref={ref}
      {...field}
      {...props}
      className={cn(
        controlBase,
        "h-9 cursor-pointer appearance-none bg-no-repeat py-0 pr-7 pl-2.5 font-ocr text-[12.5px] tracking-[0.05em] uppercase",
        "bg-[linear-gradient(45deg,transparent_50%,#8e8e8e_50%),linear-gradient(135deg,#8e8e8e_50%,transparent_50%)]",
        "bg-[position:calc(100%-12px)_55%,calc(100%-7px)_55%] bg-[size:5px_5px,5px_5px]",
        className,
      )}
    >
      {children}
    </select>
  );
});

/* ---------------------------------------------------------- Checkbox/Toggle */

export interface CheckboxProps {
  checked: boolean | "indeterminate";
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
}

/** Square [x] checkbox. */
export function Checkbox({ checked, onCheckedChange, label, description, disabled, id, name, className }: CheckboxProps) {
  const autoId = useId();
  const controlId = id ?? `c${autoId}`;
  return (
    <div className={cn("flex items-start gap-2.5", className)}>
      <RCheckbox.Root
        id={controlId}
        name={name}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        aria-describedby={description ? `${controlId}-d` : undefined}
        className="mt-0.5 grid size-4 shrink-0 cursor-pointer place-items-center border border-edge-strong bg-sunken transition-colors hover:border-edge-hover data-[state=checked]:border-bright data-[state=checked]:shadow-[var(--crt-glow)] disabled:opacity-40"
      >
        <RCheckbox.Indicator className="block size-2 bg-bright" />
      </RCheckbox.Root>
      <div className="flex flex-col">
        <label htmlFor={controlId} className="type-label cursor-pointer text-fg">
          {label}
        </label>
        {description ? (
          <span id={`${controlId}-d`} className="type-data text-muted">
            {description}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export interface ToggleProps {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  children: ReactNode;
  title?: string;
  disabled?: boolean;
  className?: string;
  /** Accessible name when the visible text alone is ambiguous; must start with the visible text. */
  ariaLabel?: string;
}

/** A pressable button toggle (Seamless `[data-bool]` buttons like SQUARE CROP). */
export function Toggle({ pressed, onPressedChange, children, title, disabled, className, ariaLabel }: ToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "cursor-pointer border border-edge bg-sunken px-2.5 py-1.5 font-ocr text-[12.5px] tracking-[0.05em] text-muted uppercase transition-colors hover:border-edge-hover hover:text-bright disabled:cursor-not-allowed disabled:opacity-35",
        "aria-pressed:border-bright aria-pressed:text-bright aria-pressed:[text-shadow:var(--crt-glow)] aria-pressed:shadow-[inset_0_0_0_1px_rgba(255,255,255,.15)]",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Kept for API compatibility: a labelled ON/OFF switch row. */
export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Switch({ checked, onCheckedChange, label, description, disabled, id, className }: SwitchProps) {
  const autoId = useId();
  const controlId = id ?? `s${autoId}`;
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <div className="flex flex-col">
        <label htmlFor={controlId} className="type-label cursor-pointer text-fg">
          {label}
        </label>
        {description ? (
          <span id={`${controlId}-d`} className="type-data text-muted">
            {description}
          </span>
        ) : null}
      </div>
      <button
        id={controlId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        aria-describedby={description ? `${controlId}-d` : undefined}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "min-w-[3.4em] shrink-0 cursor-pointer border px-1.5 py-0.5 font-ocr text-[11px] tracking-[0.08em] disabled:opacity-35",
          checked ? "border-bright bg-bright text-bg [text-shadow:none] shadow-[var(--crt-glow)]" : "border-edge bg-transparent text-muted",
        )}
      >
        {checked ? "ON" : "OFF"}
      </button>
    </div>
  );
}
