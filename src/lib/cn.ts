import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge about our custom type-* utilities so later classes win.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        "type-display-xl",
        "type-display",
        "type-title",
        "type-heading",
        "type-subheading",
        "type-label",
        "type-small",
        "type-data",
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
