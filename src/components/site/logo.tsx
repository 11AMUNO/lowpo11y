import { cn } from "@/lib/cn";
import { BANNER } from "./banner-text";

/** Header wordmark: OCR caps with CRT glow. */
export function Wordmark({ className }: { className?: string }) {
  return <span className={cn("font-ocr text-[15px] leading-none tracking-[0.14em] glow", className)}>LOWPO11Y</span>;
}

const BANNER_COLS = Math.max(...BANNER.split("\n").map((l) => l.length));

/**
 * The ASCII-art banner, scaled so it always fits its container width
 * (same technique as the Seamless header).
 */
export function Banner({ className }: { className?: string }) {
  return (
    <pre
      role="img"
      aria-label="LOWPO11Y"
      className={cn("m-0 overflow-hidden leading-[1.05] whitespace-pre glow", className)}
      style={{ fontSize: `clamp(4px, calc((100vw - 3rem) / ${BANNER_COLS * 0.62}), 15px)` }}
    >
      {BANNER}
    </pre>
  );
}
