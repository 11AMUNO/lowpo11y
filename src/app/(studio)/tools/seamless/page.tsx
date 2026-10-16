import type { Metadata } from "next";
import { SeamlessTool } from "@/features/tools/seamless/seamless-tool";

export const metadata: Metadata = {
  title: "Seamless texture",
  description:
    "Make textures tile seamlessly in your browser: offset blend, mirror and edge healing, black-to-transparent, PSX palettes and dithering, batch ZIP export. Files never leave your machine.",
  alternates: { canonical: "/tools/seamless" },
};

export default function SeamlessPage() {
  return <SeamlessTool />;
}
