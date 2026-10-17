import type { Metadata } from "next";
import { SceneBuilder } from "@/features/scene-builder/scene-builder";

export const metadata: Metadata = {
  title: "Scene Builder",
  description:
    "Block out a low-poly level in your browser: place LOWPO11Y models and textured shapes, move, rotate and scale them with snapping, preview a PS1-style look, save a .retro-scene.json file and export one GLB.",
  alternates: { canonical: "/scene-builder" },
};

export default function SceneBuilderPage() {
  return <SceneBuilder />;
}
