import type { Metadata } from "next";
import { Workshop } from "@/features/workshop/workshop";

export const metadata: Metadata = {
  title: "Workshop",
  description:
    "Chain LOWPO11Y's texture tools into one pipeline in your browser: crop, resize, make seamless, adjust, palette, dither, pad and pack an atlas, preview every step, then batch-export a ZIP with a manifest.",
  alternates: { canonical: "/workshop" },
};

export default function WorkshopPage() {
  return <Workshop />;
}
