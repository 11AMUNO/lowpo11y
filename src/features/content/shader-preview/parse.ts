/**
 * The convention three.js shader entries follow so the site can preview
 * them live: one GLSL file split by `// --- vertex ---` and
 * `// --- fragment ---` lines, with optional slider annotations on float
 * uniforms (`uniform float uSnap; // @control 40..480 = 120 "Vertex snap"`).
 */
export interface ShaderStages {
  vertex: string;
  fragment: string;
}

export interface ShaderControl {
  name: string;
  label: string;
  min: number;
  max: number;
  value: number;
  step: number;
}

const FRAGMENT = /^[ \t]*\/\/\s*-{2,}\s*fragment\s*-{2,}[ \t]*$/im;
const VERTEX = /^[ \t]*\/\/\s*-{2,}\s*vertex\s*-{2,}[ \t]*$/im;

/** The vertex and fragment halves, or null when the file doesn't follow the convention. */
export function splitStages(code: string): ShaderStages | null {
  const f = FRAGMENT.exec(code);
  if (!f) return null;
  const v = VERTEX.exec(code);
  const vertex = code.slice(v && v.index < f.index ? v.index : 0, f.index).trim();
  const fragment = code.slice(f.index).trim();
  if (!/void\s+main\s*\(/.test(vertex) || !/void\s+main\s*\(/.test(fragment)) return null;
  return { vertex, fragment };
}

const CONTROL = /^[ \t]*uniform\s+float\s+(\w+)\s*;\s*\/\/\s*@control\s+(-?[\d.]+)\s*\.\.\s*(-?[\d.]+)\s*=\s*(-?[\d.]+)(?:\s+"([^"]{1,60})")?/gm;

/** Slider-annotated float uniforms, in order, once each. */
export function parseControls(code: string): ShaderControl[] {
  const out: ShaderControl[] = [];
  for (const m of code.matchAll(CONTROL)) {
    const [, name, a, b, v, label] = m;
    const min = Number(a);
    const max = Number(b);
    const value = Number(v);
    if (![min, max, value].every(Number.isFinite) || max <= min || out.some((c) => c.name === name)) continue;
    const span = max - min;
    out.push({ name: name!, label: label ?? name!, min, max, value: Math.min(max, Math.max(min, value)), step: span <= 2 ? 0.01 : span <= 20 ? 0.1 : 1 });
  }
  return out;
}

/** Uniforms the preview scene provides to every shader. */
export const PROVIDED_UNIFORMS = ["map", "uTime", "uResolution", "fogColor", "fogNear", "fogFar"] as const;
