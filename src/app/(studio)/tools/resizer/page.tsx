import type { Metadata } from "next";
import { ResizerTool } from "@/features/tools/resizer/resizer-tool";

export const metadata: Metadata = {
  title: "Batch resizer",
  description:
    "Resize a whole folder of textures in your browser: long side, exact or percentage sizes, power-of-two rounding, nearest or smooth sampling, and a ZIP that keeps your folders.",
  alternates: { canonical: "/tools/resizer" },
};

export default function ResizerPage() {
  return <ResizerTool />;
}
