import { cn } from "@/lib/cn";

/** Flat-shaded cube mark: three faces, three shades — the smallest possible low-poly model. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-5", className)}>
      <path d="M12 2.5 21 7.25 12 12 3 7.25Z" fill="var(--c-accent-strong)" />
      <path d="M3 7.25 12 12v9.5L3 16.75Z" fill="var(--c-accent)" />
      <path d="M21 7.25 12 12v9.5l9-4.75Z" fill="color-mix(in oklab, var(--c-accent) 55%, var(--c-bg))" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-[1.0625rem] leading-none font-[820] tracking-[0.02em] [font-stretch:125%]">LOWPO11Y</span>
    </span>
  );
}
