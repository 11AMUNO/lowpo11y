import type { Metadata } from "next";
import { DecalTool } from "@/features/tools/decal/decal-tool";

export const metadata: Metadata = {
  title: "Decal and cutout maker",
  description:
    "Make transparent decals in your browser: key out a background by colour or brightness, clean edges without dark or green fringes, erase and restore with a brush, add grime and wear, preview on a wall and export a PNG and mask.",
  alternates: { canonical: "/tools/decal" },
};

export default function DecalPage() {
  return <DecalTool />;
}
