import { Slot } from "radix-ui";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Terminal buttons, after 11AM-Seamless `.tbtn`:
 * - secondary: dim border, muted label → brightens on hover
 * - primary ("hot"): white border with CRT glow, label in [ BRACKETS ]
 * - ghost: borderless
 * - danger: as secondary; the label names the destructive action
 * - link: underlined text
 * `aria-pressed="true"` renders the pressed (selected) state.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap border font-ocr uppercase " +
  "tracking-[0.05em] select-none transition-[color,border-color,background-color,box-shadow] duration-150 " +
  "disabled:cursor-not-allowed disabled:opacity-35 aria-disabled:pointer-events-none aria-disabled:opacity-35 " +
  "aria-pressed:border-bright aria-pressed:text-bright aria-pressed:[text-shadow:var(--crt-glow)] aria-pressed:shadow-[inset_0_0_0_1px_rgba(255,255,255,.15)] " +
  "[&_svg]:size-3.5 [&_svg]:shrink-0";

const variants: Record<ButtonVariant, string> = {
  primary: "border-bright bg-sunken text-bright [text-shadow:var(--crt-glow)] hover:bg-[#151515] hover:shadow-[var(--crt-glow)]",
  secondary: "border-edge bg-sunken text-muted hover:border-edge-hover hover:text-bright",
  ghost: "border-transparent bg-transparent text-muted hover:text-bright",
  danger: "border-edge bg-sunken text-fg hover:border-bright hover:text-bright",
  link: "border-transparent bg-transparent p-0 text-bright underline underline-offset-4 hover:[text-shadow:var(--crt-glow)]",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2 text-[11px]",
  md: "h-8 px-2.5 text-[12.5px]",
  lg: "h-10 px-4 text-[13.5px]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render the child element (e.g. a Next.js Link) with button styling. */
  asChild?: boolean;
  /** Wrap the label in [ brackets ]. Defaults to true for primary buttons. */
  brackets?: boolean;
}

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cn(base, variants[variant], variant === "link" ? "" : sizes[size], className);
}

export function Bracketed({ children }: { children: ReactNode }) {
  return (
    <>
      <span aria-hidden>[</span>
      {children}
      <span aria-hidden>]</span>
    </>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", asChild = false, brackets, className, type, children, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button";
  const wrap = brackets ?? (variant === "primary" && !asChild);
  return (
    <Comp ref={ref} className={buttonClasses(variant, size, className)} {...(asChild ? {} : { type: type ?? "button" })} {...props}>
      {wrap ? <Bracketed>{children}</Bracketed> : children}
    </Comp>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, "children"> {
  /** Accessible name — required because the button has no visible text. */
  label: string;
  icon: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = "md", variant = "ghost", className, ...props },
  ref,
) {
  const square = size === "sm" ? "size-7 px-0" : size === "lg" ? "size-10 px-0" : "size-8 px-0";
  return (
    <Button ref={ref} aria-label={label} title={label} variant={variant} size={size} brackets={false} className={cn(square, className)} {...props}>
      {icon}
    </Button>
  );
});

/** Small square ON/OFF switch used in module headers (Seamless `.sw`). */
export function OnOff({
  on,
  onToggle,
  label,
  disabled,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "min-w-[3.4em] shrink-0 cursor-pointer border px-1.5 py-0.5 font-ocr text-[11px] tracking-[0.08em] disabled:opacity-35",
        on ? "border-bright bg-bright text-bg [text-shadow:none] shadow-[var(--crt-glow)]" : "border-edge bg-transparent text-muted",
      )}
    >
      {on ? "ON" : "OFF"}
    </button>
  );
}
