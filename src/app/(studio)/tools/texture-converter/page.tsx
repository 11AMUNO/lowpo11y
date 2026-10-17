import type { Metadata } from "next";
import { ConverterTool } from "@/features/tools/converter/converter-tool";

export const metadata: Metadata = {
  title: "Retro texture converter",
  description:
    "Convert textures to a PS1-era look in your browser: exact output sizes, RGB555 and other bit depths, adaptive or locked palettes, ordered, blue-noise or Floyd–Steinberg dithering, PNG export.",
  alternates: { canonical: "/tools/texture-converter" },
};

export default function TextureConverterPage() {
  return <ConverterTool />;
}
