import type { Metadata } from "next";
import { PaletteTool } from "@/features/tools/palette/palette-tool";

export const metadata: Metadata = {
  title: "Palette generator",
  description:
    "Extract a palette from a reference image, edit, lock and reorder colours, find harmonies, check colour-blind readability, preview your texture in the palette and export GPL, HEX, JSON or PNG swatches.",
  alternates: { canonical: "/tools/palette" },
};

export default function PalettePage() {
  return <PaletteTool />;
}
