"use client";

import { Checkbox as RCheckbox, Switch as RSwitch } from "radix-ui";
import { Check, ChevronDown, Minus } from "lucide-react";
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
  children: ReactNode;
}

export function Field({ label, hint, error, aside, required, id, className, hideLabel, children }: FieldProps) {
  const autoId = useId();
  const controlId = id ?? `f${autoId}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider value={{ id: controlId, describedBy, invalid: Boolean(error) }}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <div className={cn("flex items-baseline justify-between gap-3", hideLabel && "sr-only")}>
          <label htmlFor={controlId} className="type-label text-fg">
            {label}
            {required ? (
              <span className="ml-0.5 text-muted" aria-hidden>
                *
              </span>
            ) : null}
          </label>
          {aside ? <span className="type-data text-muted">{aside}</span> : null}
        </div>
        {children}
        {hint ? (
          <p id={hintId} className="type-small text-muted">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className="type-small text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

/* ---------------------------------------------------------------- Controls */

const controlBase =
  "w-full rounded-sm border border-rule-strong bg-sunken text-fg placeholder:text-faint " +
  "transition-colors duration-150 hover:border-fg/35 focus-visible:border-accent focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent/35 disabled:opacity-50 aria-invalid:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, id, ...props },
  ref,
) {
  const field = useFieldControl(id);
  return <input ref={ref} {...field} {...props} className={cn(controlBase, "h-10 px-3 text-sm", className)} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, id, rows = 4, ...props }, ref) {
    const field = useFieldControl(id);
    return (
      <textarea
        ref={ref}
        rows={rows}
        {...field}
        {...props}
        className={cn(controlBase, "min-h-20 px-3 py-2 text-sm leading-relaxed", className)}
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
    <div className={cn("relative", className)}>
      <select
        ref={ref}
        {...field}
        {...props}
        className={cn(controlBase, "h-10 appearance-none py-0 pr-9 pl-3 text-sm")}
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted" />
    </div>
  );
});

/* ---------------------------------------------------------- Checkbox/Switch */

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
        className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-xs border border-rule-strong bg-sunken text-accent-ink transition-colors hover:border-fg/40 data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent disabled:opacity-50"
      >
        <RCheckbox.Indicator>
          {checked === "indeterminate" ? <Minus className="size-3.5" strokeWidth={3} /> : <Check className="size-3.5" strokeWidth={3} />}
        </RCheckbox.Indicator>
      </RCheckbox.Root>
      <div className="flex flex-col">
        <label htmlFor={controlId} className="type-label cursor-pointer text-fg">
          {label}
        </label>
        {description ? (
          <span id={`${controlId}-d`} className="type-small text-muted">
            {description}
          </span>
        ) : null}
      </div>
    </div>
  );
}

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
          <span id={`${controlId}-d`} className="type-small text-muted">
            {description}
          </span>
        ) : null}
      </div>
      <RSwitch.Root
        id={controlId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-describedby={description ? `${controlId}-d` : undefined}
        className="relative h-[22px] w-[38px] shrink-0 rounded-full border border-rule-strong bg-sunken transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:opacity-50"
      >
        <RSwitch.Thumb className="block size-4 translate-x-[2px] rounded-full bg-muted transition-transform duration-150 data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-accent-ink" />
      </RSwitch.Root>
    </div>
  );
}
