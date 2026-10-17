/** Types and defaults shared by the inspector UI and its three.js view (no three.js imports here). */

export type DisplayMode = "shaded" | "unlit" | "wire" | "normals";

export interface Display {
  mode: DisplayMode;
  flat: boolean;
  grid: boolean;
  axes: boolean;
  bounds: boolean;
  background: "dark" | "grey" | "light";
  lights: "studio" | "soft" | "flat";
}

export const DEFAULT_DISPLAY: Display = { mode: "shaded", flat: false, grid: true, axes: false, bounds: false, background: "dark", lights: "studio" };

export interface InspectInfo {
  meshes: { name: string; triangles: number; vertices: number; materials: string[]; skinned: boolean; morphs: number }[];
  materials: { name: string; type: string; maps: string[]; transparent: boolean; alphaTest: number; doubleSided: boolean; vertexColors: boolean }[];
  textures: { name: string; width: number; height: number; slots: string[]; nearest: boolean }[];
  animations: { name: string; duration: number; tracks: number }[];
  /** What the renderer actually drew for the model alone (helpers hidden). */
  measured: { calls: number; triangles: number };
  size: [number, number, number];
}

export type ModelSource = { kind: "glb"; data: ArrayBuffer } | { kind: "gltf"; json: string; urls: Map<string, string> };

export interface InspectorView {
  load(src: ModelSource): Promise<InspectInfo>;
  unload(): void;
  setDisplay(d: Display): void;
  reset(): void;
  /** Poses the model at the start of a clip without playing it. */
  select(clip: number): void;
  play(clip: number): void;
  pause(): void;
  setTime(t: number): void;
  screenshot(): Promise<Blob>;
  memory(): { geometries: number; textures: number };
  dispose(): void;
}
