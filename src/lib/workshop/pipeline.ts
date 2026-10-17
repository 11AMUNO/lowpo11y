/**
 * A Workshop pipeline as plain, versioned JSON: an ordered list of steps
 * (each can be switched off), an optional atlas step that packs every image
 * into one, and output settings. Presets and saved recipes are pipelines.
 * Loading always goes through `parsePipeline`, which migrates older files,
 * fills in defaults for settings a file doesn't have, and refuses unknown
 * steps or files from a newer version.
 */
import { z } from "@/lib/zod";
import { STEPS, STEP_TYPES, type FieldSpec, type StepType } from "./steps";

export const PIPELINE_FORMAT = "lowpo11y-workshop";
export const PIPELINE_VERSION = 1;

/* ---------------------------------------------------------------- atlas */

const int = (min: number, max: number, d: number) => z.number().int().min(min).max(max).catch(d).default(d);
const bool = (d: boolean) => z.boolean().catch(d).default(d);

export const atlasSchema = z.object({
  method: z.enum(["maxrects", "grid"]).catch("maxrects").default("maxrects"),
  columns: int(0, 64, 0),
  allowRotate: bool(false),
  padding: int(0, 64, 2),
  border: int(0, 64, 0),
  extrude: int(0, 16, 1),
  pot: bool(true),
  square: bool(false),
  uvOrigin: z.enum(["top-left", "bottom-left"]).catch("bottom-left").default("bottom-left"),
});
export type AtlasParams = z.infer<typeof atlasSchema>;

export const ATLAS_STEP = {
  type: "atlas" as const,
  label: "Pack into atlas",
  summary: "Packs every image into one texture page with a JSON file of UVs. Always runs last.",
  schema: atlasSchema,
  fields: [
    {
      key: "method",
      label: "Packing",
      kind: "select",
      options: [
        { value: "maxrects", label: "Tight (MaxRects)" },
        { value: "grid", label: "Grid" },
      ],
    },
    { key: "columns", label: "Columns (0 = square)", kind: "number", min: 0, max: 64, when: (p) => p.method === "grid" },
    { key: "allowRotate", label: "Allow 90° rotation", kind: "toggle", when: (p) => p.method === "maxrects" },
    { key: "padding", label: "Padding", kind: "number", min: 0, max: 64, unit: "px" },
    { key: "border", label: "Border", kind: "number", min: 0, max: 64, unit: "px" },
    { key: "extrude", label: "Edge extrusion", kind: "number", min: 0, max: 16, unit: "px", hint: "Repeats each tile's edge pixels outward so filtering doesn't bleed neighbours in." },
    { key: "pot", label: "Power-of-two size", kind: "toggle" },
    { key: "square", label: "Square", kind: "toggle" },
    {
      key: "uvOrigin",
      label: "UV origin",
      kind: "select",
      options: [
        { value: "bottom-left", label: "Bottom-left (Blender, Unity)" },
        { value: "top-left", label: "Top-left (Godot)" },
      ],
    },
  ] satisfies FieldSpec[],
  describe: (p: AtlasParams) => `${p.method === "grid" ? `grid${p.columns ? ` ${p.columns} columns` : ""}` : "tight"}, padding ${p.padding}, extrude ${p.extrude}${p.pot ? ", power of two" : ""}`,
};

/* ------------------------------------------------------------- pipeline */

export interface Step {
  id: string;
  type: StepType;
  enabled: boolean;
  params: Record<string, unknown>;
}

export const outputSchema = z.object({
  format: z.enum(["png", "webp"]).catch("png").default("png"),
  quality: int(1, 100, 90),
  /** Tokens: {name} source name without extension, {n} position in the batch (1-based, zero-padded). */
  naming: z
    .string()
    .trim()
    .max(80)
    .regex(/^[^/\\:*?"<>|]*$/)
    .catch("{name}")
    .default("{name}"),
});
export type OutputSettings = z.infer<typeof outputSchema>;

export interface Pipeline {
  format: typeof PIPELINE_FORMAT;
  version: typeof PIPELINE_VERSION;
  name: string;
  steps: Step[];
  output: OutputSettings;
}

export class PipelineError extends Error {}

export function stepDef(type: StepType) {
  return type === "atlas" ? ATLAS_STEP : STEPS[type];
}

let counter = 0;
/** Short, unique-enough ids for steps (stable once created: they're part of the saved JSON). */
export function newStepId(): string {
  counter = (counter + 1) % 1e6;
  return `s${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function newStep(type: StepType, params: Record<string, unknown> = {}): Step {
  return { id: newStepId(), type, enabled: true, params: stepDef(type).schema.parse(params) as Record<string, unknown> };
}

export function emptyPipeline(name = "Untitled pipeline"): Pipeline {
  return { format: PIPELINE_FORMAT, version: PIPELINE_VERSION, name, steps: [], output: outputSchema.parse({}) };
}

/** Atlas, when present, is the last step and appears once. */
export function normaliseOrder(steps: Step[]): Step[] {
  const atlas = steps.filter((s) => s.type === "atlas");
  return [...steps.filter((s) => s.type !== "atlas"), ...atlas.slice(0, 1)];
}

/** Older file versions are upgraded one step at a time. Version 1 is the first published format. */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {};

const docSchema = z.object({
  format: z.literal(PIPELINE_FORMAT),
  version: z.number().int().min(1),
  name: z.string().trim().max(80).catch("Imported pipeline").default("Imported pipeline"),
  steps: z
    .array(
      z.object({
        id: z
          .string()
          .regex(/^[\w-]{1,40}$/)
          .optional(),
        type: z.string(),
        enabled: z.boolean().catch(true).default(true),
        params: z.record(z.string(), z.unknown()).catch({}).default({}),
      }),
    )
    .max(40),
  output: z.unknown().optional(),
});

/** Reads a pipeline from JSON (text or parsed). Returns it with notes on anything that was adjusted. */
export function parsePipeline(input: unknown): { pipeline: Pipeline; notes: string[] } {
  let raw: unknown = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new PipelineError("That file isn't valid JSON.");
    }
  }
  if (!raw || typeof raw !== "object") throw new PipelineError("That file isn't a Workshop pipeline.");
  let doc = raw as Record<string, unknown>;
  if (doc.format !== PIPELINE_FORMAT) throw new PipelineError("That file isn't a Workshop pipeline (it has no \"lowpo11y-workshop\" format marker).");
  const version = typeof doc.version === "number" ? doc.version : NaN;
  if (!Number.isInteger(version) || version < 1) throw new PipelineError("The pipeline's version is missing or invalid.");
  if (version > PIPELINE_VERSION) throw new PipelineError(`This pipeline was made with a newer version of the Workshop (format ${version}; this one reads up to ${PIPELINE_VERSION}).`);
  const notes: string[] = [];
  for (let v = version; v < PIPELINE_VERSION; v++) {
    doc = MIGRATIONS[v]!(doc);
    notes.push(`Upgraded from format ${v} to ${v + 1}.`);
  }
  const parsed = docSchema.safeParse(doc);
  if (!parsed.success) throw new PipelineError(`The pipeline's structure isn't valid: ${parsed.error.issues[0]?.message ?? "unknown problem"}.`);
  const unknown = parsed.data.steps.filter((s) => s.type !== "atlas" && !(STEP_TYPES as string[]).includes(s.type)).map((s) => s.type);
  if (unknown.length) throw new PipelineError(`Unknown steps: ${[...new Set(unknown)].join(", ")}.`);
  const seen = new Set<string>();
  const steps: Step[] = parsed.data.steps.map((s) => {
    const def = stepDef(s.type as StepType);
    const params = def.schema.parse(s.params) as Record<string, unknown>;
    for (const k of Object.keys(s.params)) if (!(k in params)) notes.push(`Ignored an unknown setting "${k}" in ${def.label}.`);
    for (const k of Object.keys(params)) if (JSON.stringify(params[k]) !== JSON.stringify(s.params[k])) notes.push(`${def.label}: "${k}" was missing or out of range, so it uses ${JSON.stringify(params[k])}.`);
    let id = s.id && !seen.has(s.id) ? s.id : newStepId();
    while (seen.has(id)) id = newStepId();
    seen.add(id);
    return { id, type: s.type as StepType, enabled: s.enabled, params };
  });
  const ordered = normaliseOrder(steps);
  if (ordered.length !== steps.length || ordered.some((s, i) => s !== steps[i])) notes.push("The atlas step was moved to the end (it always runs last).");
  return {
    pipeline: { format: PIPELINE_FORMAT, version: PIPELINE_VERSION, name: parsed.data.name, steps: ordered, output: outputSchema.parse(parsed.data.output ?? {}) },
    notes,
  };
}

export function serialisePipeline(p: Pipeline): string {
  return (
    JSON.stringify(
      { format: PIPELINE_FORMAT, version: PIPELINE_VERSION, name: p.name, steps: p.steps.map((s) => ({ id: s.id, type: s.type, enabled: s.enabled, params: s.params })), output: p.output },
      null,
      2,
    ) + "\n"
  );
}

/** One-line description of a step's settings. */
export function describeStep(s: Step): string {
  const def = stepDef(s.type);
  return (def.describe as (p: unknown) => string)(def.schema.parse(s.params));
}
