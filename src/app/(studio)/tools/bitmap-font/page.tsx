import type { Metadata } from "next";
import { BitmapFontTool } from "@/features/tools/bitmap-font/bitmap-font-tool";

export const metadata: Metadata = {
  title: "Bitmap font generator",
  description:
    "Turn a licensed TTF or OTF into a bitmap font in your browser: character sets and Unicode ranges, 1-bit or smooth edges, outline, shadow, spacing and kerning, exported as AngelCode BMFont text or JSON with PNG pages.",
  alternates: { canonical: "/tools/bitmap-font" },
};

export default function BitmapFontPage() {
  return <BitmapFontTool />;
}
