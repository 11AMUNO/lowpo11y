import { Slot } from "radix-ui";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm font-[560] select-none " +
  "transition-[background-color,border-color,color] duration-150 " +
  "disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 " +
  "[&_svg]:size-4 [&_svg]:shrink-0";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-strong active:bg-accent",
  secondary: "border border-rule-strong bg-panel text-fg hover:border-fg/40 hover:bg-panel-2",
  ghost: "text-fg hover:bg-panel-2",
  danger: "border border-danger/50 bg-danger-soft text-danger hover:border-danger hover:bg-danger/20",
  link: "h-auto px-0 text-accent underline-offset-4 hover:underline",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[0.8125rem]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render the child element (e.g. a Next.js Link) with button styling. */
  asChild?: boolean;
}

export function buttonClasses(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cn(base, variants[variant], variant === "link" ? "" : sizes[size], className);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", asChild = false, className, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      ref={ref}
      className={buttonClasses(variant, size, className)}
      {...(asChild ? {} : { type: type ?? "button" })}
      {...props}
    />
  );
});

export interface IconButtonProps extends Omit<ButtonProps, "children"> {
  /** Accessible name — required because the button has no visible text. */
  label: string;
  icon: React.ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = "md", variant = "ghost", className, ...props },
  ref,
) {
  const square = size === "sm" ? "size-8 px-0" : size === "lg" ? "size-12 px-0" : "size-10 px-0";
  return (
    <Button
      ref={ref}
      aria-label={label}
      title={label}
      variant={variant}
      size={size}
      className={cn(square, className)}
      {...props}
    >
      {icon}
    </Button>
  );
});
