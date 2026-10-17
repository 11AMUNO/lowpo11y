import type { Metadata } from "next";
import { AtlasTool } from "@/features/tools/atlas/atlas-tool";

export const metadata: Metadata = {
  title: "Texture atlas builder",
  description:
    "Pack textures into one atlas in your browser with padding, edge extrusion, tight or grid packing and power-of-two sizes, then export the PNG with UV JSON and CSV for Blender, Godot or Unity.",
  alternates: { canonical: "/tools/texture-atlas" },
};

export default function TextureAtlasPage() {
  return <AtlasTool />;
}
