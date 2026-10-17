/** Lighting and atmosphere presets for the Scene Builder. They only change scene settings. */
import type { SceneSettings } from "./schema";

export interface LightingPreset {
  id: string;
  name: string;
  description: string;
  apply: (s: SceneSettings) => SceneSettings;
}

export const LIGHTING_PRESETS: LightingPreset[] = [
  {
    id: "neutral-studio",
    name: "Neutral studio",
    description: "Even white light from above, dark grey background, no fog. For checking models.",
    apply: (s) => ({
      ...s,
      background: "#1a1a1a",
      ambient: { color: "#ffffff", intensity: 0.7 },
      sun: { ...s.sun, color: "#ffffff", intensity: 1.6, azimuth: 35, elevation: 55 },
      fog: { ...s.fog, enabled: false },
    }),
  },
  {
    id: "moody-industrial",
    name: "Moody industrial",
    description: "Low, warm sodium light against a cold blue ambient, with close fog. Typical of PS1-era industrial levels.",
    apply: (s) => ({
      ...s,
      background: "#0d1014",
      ambient: { color: "#5b6b86", intensity: 0.45 },
      sun: { ...s.sun, color: "#ffb36b", intensity: 1.4, azimuth: 120, elevation: 18 },
      fog: { enabled: true, color: "#0d1014", near: 6, far: 28 },
    }),
  },
  {
    id: "night-fog",
    name: "Night fog",
    description: "Moonlight and dense grey fog that hides the far end of the level.",
    apply: (s) => ({
      ...s,
      background: "#141619",
      ambient: { color: "#8090a0", intensity: 0.25 },
      sun: { ...s.sun, color: "#c4d0e0", intensity: 0.6, azimuth: -40, elevation: 35 },
      fog: { enabled: true, color: "#141619", near: 3, far: 18 },
    }),
  },
  {
    id: "overcast-day",
    name: "Overcast day",
    description: "Soft, bright and slightly hazy daylight.",
    apply: (s) => ({
      ...s,
      background: "#9aa3a8",
      ambient: { color: "#e8eef2", intensity: 1.1 },
      sun: { ...s.sun, color: "#ffffff", intensity: 0.8, azimuth: 20, elevation: 65 },
      fog: { enabled: true, color: "#9aa3a8", near: 20, far: 90 },
    }),
  },
];
