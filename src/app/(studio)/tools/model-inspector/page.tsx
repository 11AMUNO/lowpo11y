import type { Metadata } from "next";
import { InspectorTool } from "@/features/tools/model-inspector/inspector-tool";

export const metadata: Metadata = {
  title: "Model inspector",
  description:
    "Open a GLB or glTF in your browser to check triangles, draw calls, materials, texture sizes, UVs, skins and animations, with wireframe, normals and flat shading views. Nothing is uploaded.",
  alternates: { canonical: "/tools/model-inspector" },
};

export default function ModelInspectorPage() {
  return <InspectorTool />;
}
