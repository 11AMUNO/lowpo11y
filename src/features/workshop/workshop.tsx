"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { SegmentedControl, SliderField } from "@/components/ui/controls";
import { Progress } from "@/components/ui/feedback";
import { Field, Input, Select, Toggle } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { CancelledError } from "@/lib/workshop/graph";
import { estimateBatch, predictSize } from "@/lib/workshop/estimate";
import { outputNames } from "@/lib/workshop/manifest";
import { ATLAS_STEP, describeStep, emptyPipeline, newStep, normaliseOrder, parsePipeline, PipelineError, serialisePipeline, stepDef, type Pipeline, type Step } from "@/lib/workshop/pipeline";
import { BUILTIN_PRESETS } from "@/lib/workshop/presets";
import { STEP_TYPES, STEPS, type StepType } from "@/lib/workshop/steps";
import { fromInput, isImage, readDrop, useWindowDrop, type DroppedFile } from "../tools/shared/drop";
import { saveBlob, toBitmap } from "../tools/shared/files";
import { Viewport, type ViewState } from "../tools/shared/viewport";
import { createWorker, runBatch, type BatchProgress } from "./batch";
import { LibraryPicker } from "./library-picker";
import { StepForm } from "./step-form";
import { deleteRecipe, forgetInputs, keepInputs, keptInputs, listRecipes, loadSession, saveRecipe, saveSession, storageEstimate, StorageFullError, type Recipe } from "./storage";
import type { WorkerRequest, WorkerResponse } from "./worker";

const MAX_INPUTS = 500;
const MAX_FILE = 128 * 1024 * 1024;
const SAMPLES = ["demo-red-brick", "demo-rusted-plate", "demo-wood-planks", "demo-cobblestones"];
const VIEW: ViewState = { view: "split", grid: 3, tsrc: "result", seams: false, pixelated: true, divider: 0.5, pan: { x: 0, y: 0 }, zoom: 1 };

interface Item {
  id: string;
  name: string;
  file: File;
  thumb: string;
  origin?: { asset: string; url: string; licence: string | null };
  status: "loading" | "ready" | "failed";
  width?: number;
  height?: number;
  message?: string;
}

interface Shown {
  token: number;
  result: ImageBitmap;
  compare: ImageBitmap;
  width: number;
  height: number;
  ms: number;
  colours: number | null;
  frames?: number;
  overflow?: string[];
}

type ExportState =
  | { kind: "idle" }
  | { kind: "running"; progress: BatchProgress; ctrl: AbortController }
  | { kind: "done"; url: string; filename: string; bytes: number; succeeded: number; failures: { name: string; message: string }[] }
  | { kind: "error"; message: string };

const small = "cursor-pointer border border-edge bg-sunken px-2 py-1 font-ocr text-[11px] tracking-[0.05em] text-muted uppercase hover:border-edge-hover hover:text-bright disabled:cursor-not-allowed disabled:opacity-40";
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "pipeline";

export function Workshop() {
  const worker = useRef<Worker | null>(null);
  const nextId = useRef(1);
  const token = useRef(0);
  const itemsRef = useRef<Item[]>([]);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const [pipeline, setPipeline] = useState<Pipeline>(() => BUILTIN_PRESETS[0]!.build());
  const [items, setItems] = useState<Item[]>([]);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [compare, setCompare] = useState<"original" | "previous">("original");
  const [view, setView] = useState<ViewState>(VIEW);
  const [shown, setShown] = useState<Shown | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ token: number; done: number; total: number } | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [preset, setPreset] = useState(BUILTIN_PRESETS[0]!.id);
  const [addType, setAddType] = useState<StepType>("resize");
  const [keepImages, setKeepImages] = useState(false);
  const [concurrency, setConcurrency] = useState(2);
  const [restored, setRestored] = useState(false);
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  const [exporting, setExporting] = useState<ExportState>({ kind: "idle" });
  const [notes, setNotes] = useState<string[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  /* ------------------------------------------------------------ worker */
  useEffect(() => {
    const w = createWorker();
    worker.current = w;
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const r = ev.data;
      if (r.type === "loaded") {
        setItems((list) => list.map((i) => (i.id !== r.id ? i : r.ok ? { ...i, status: "ready", width: r.width, height: r.height } : { ...i, status: "failed", message: r.message })));
        return;
      }
      if (!("token" in r) || r.token !== token.current) return;
      if (r.type === "progress") setProgress({ token: r.token, done: r.done, total: r.total });
      else if (r.type === "preview" || r.type === "atlas-preview") {
        const t = r.token;
        const isAtlas = r.type === "atlas-preview";
        void Promise.all([toBitmap(r.image), isAtlas ? null : toBitmap(r.compare)]).then(([res, cmp]) => {
          if (t !== token.current) {
            res.close();
            cmp?.close();
            return;
          }
          setShown((old) => {
            if (old) {
              old.result.close();
              if (old.compare !== old.result) old.compare.close();
            }
            return {
              token: t,
              result: res,
              compare: cmp ?? res,
              width: r.image.width,
              height: r.image.height,
              ms: r.ms,
              colours: r.type === "preview" ? r.colours : null,
              frames: r.type === "atlas-preview" ? r.frames : undefined,
              overflow: r.type === "atlas-preview" ? r.overflow : undefined,
            };
          });
          setPreviewError(null);
          setProgress(null);
        });
      } else if (r.type === "failed") {
        if (!r.cancelled) setPreviewError(r.message);
        setProgress(null);
      }
    };
    return () => {
      w.terminate();
      itemsRef.current.forEach((i) => URL.revokeObjectURL(i.thumb));
    };
  }, []);

  /* ----------------------------------------------------------- inputs */
  const add = useCallback((dropped: (DroppedFile & { origin?: Item["origin"] })[]) => {
    const fresh: Item[] = [];
    let skipped = 0;
    for (const d of dropped) {
      if (d.file.name.startsWith(".")) continue;
      if (!isImage(d.file) || d.file.size > MAX_FILE) {
        skipped++;
        continue;
      }
      if (itemsRef.current.length + fresh.length >= MAX_INPUTS) break;
      const id = `i${nextId.current++}`;
      const name = d.dir ? `${d.dir}/${d.file.name}` : d.file.name;
      fresh.push({ id, name, file: d.file, thumb: URL.createObjectURL(d.file), origin: d.origin, status: "loading" });
      worker.current?.postMessage({ type: "load", id, name, file: d.file } satisfies WorkerRequest);
    }
    if (fresh.length) {
      setItems((l) => [...l, ...fresh]);
      setSelectedItem((s) => s ?? fresh[0]!.id);
    }
    if (skipped) toast.error(`${skipped} file${skipped > 1 ? "s" : ""} skipped`, "Only images up to 128 MB can be added.");
  }, []);

  const remove = (ids: string[]) => {
    const gone = new Set(ids);
    for (const i of itemsRef.current) {
      if (!gone.has(i.id)) continue;
      URL.revokeObjectURL(i.thumb);
      worker.current?.postMessage({ type: "unload", id: i.id } satisfies WorkerRequest);
    }
    const rest = itemsRef.current.filter((i) => !gone.has(i.id));
    setItems(rest);
    if (selectedItem && gone.has(selectedItem)) setSelectedItem(rest[0]?.id ?? null);
  };

  const dragging = useWindowDrop(async (dt) => add((await readDrop(dt)).files));

  const loadSample = async () => {
    try {
      add(
        await Promise.all(
          SAMPLES.map(async (s) => {
            const r = await fetch(`/demo/textures/${s}.png`);
            if (!r.ok) throw new Error(s);
            return { file: new File([await r.blob()], `${s.replace(/^demo-/, "")}.png`, { type: "image/png" }), dir: "" };
          }),
        ),
      );
    } catch {
      toast.error("Couldn't load the sample images");
    }
  };

  /* --------------------------------------------- session and storage */
  useEffect(() => {
    const s = loadSession();
    // Restoring from the browser happens once, after mount, so the first render matches the server.
    /* eslint-disable react-hooks/set-state-in-effect */
    if (s.pipeline) setPipeline(s.pipeline);
    setConcurrency(s.concurrency || Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)));
    setKeepImages(s.keepImages);
    setRecipes(listRecipes());
    setRestored(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    if (s.keepImages)
      void keptInputs().then((kept) => {
        if (kept.length) add(kept.map((k) => ({ file: new File([k.blob], k.name.split("/").pop()!, { type: k.blob.type }), dir: k.name.includes("/") ? k.name.slice(0, k.name.lastIndexOf("/")) : "", origin: k.origin })));
      });
  }, [add]);

  useEffect(() => {
    if (!restored) return;
    const t = setTimeout(() => saveSession({ pipeline: serialisePipeline(pipeline), keepImages, concurrency }), 250);
    return () => clearTimeout(t);
  }, [pipeline, keepImages, concurrency, restored]);

  useEffect(() => {
    if (!restored || !keepImages) return;
    const t = setTimeout(() => {
      keepInputs(items.map((i) => ({ id: i.id, name: i.name, blob: i.file, origin: i.origin })))
        .then(() => storageEstimate().then(setQuota))
        .catch(() => toast.error("Couldn't keep the images", "This browser's storage for the site is full. They'll still work until you close the page."));
    }, 400);
    return () => clearTimeout(t);
  }, [items, keepImages, restored]);

  /* ---------------------------------------------------------- pipeline */
  const steps = pipeline.steps;
  const selected = steps.find((s) => s.id === selectedStep) ?? null;
  const atlasStep = steps.find((s) => s.type === "atlas") ?? null;
  const item = items.find((i) => i.id === selectedItem) ?? null;
  const setSteps = (fn: (s: Step[]) => Step[]) => setPipeline((p) => ({ ...p, steps: normaliseOrder(fn(p.steps)) }));
  const patchStep = (id: string, patch: Partial<Step>) => setSteps((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const setParam = (id: string, key: string, value: unknown) =>
    setSteps((s) => s.map((x) => (x.id === id ? { ...x, params: stepDef(x.type).schema.parse({ ...x.params, [key]: value }) as Record<string, unknown> } : x)));
  const move = (id: string, dir: -1 | 1) =>
    setSteps((s) => {
      const i = s.findIndex((x) => x.id === id),
        j = i + dir;
      if (i < 0 || j < 0 || j >= s.length || s[j]!.type === "atlas" || s[i]!.type === "atlas") return s;
      const c = [...s];
      [c[i], c[j]] = [c[j]!, c[i]!];
      return c;
    });
  const addStep = () => {
    const step = newStep(addType);
    setSteps((s) => {
      if (addType === "atlas") return [...s.filter((x) => x.type !== "atlas"), step];
      const at = selectedStep ? s.findIndex((x) => x.id === selectedStep) : -1;
      const end = s.findIndex((x) => x.type === "atlas");
      const pos = at >= 0 && s[at]!.type !== "atlas" ? at + 1 : end >= 0 ? end : s.length;
      return [...s.slice(0, pos), step, ...s.slice(pos)];
    });
    setSelectedStep(step.id);
  };
  const replacePipeline = (p: Pipeline, n: string[] = []) => {
    setPipeline(p);
    setSelectedStep(null);
    setNotes(n);
  };

  /* ----------------------------------------------------------- preview */
  const previousEnabled = (id: string | null): string | null => {
    if (!id) return null;
    const i = steps.findIndex((s) => s.id === id);
    for (let j = i - 1; j >= 0; j--) if (steps[j]!.enabled && steps[j]!.type !== "atlas") return steps[j]!.id;
    return null;
  };
  const previewKey = JSON.stringify([serialisePipeline(pipeline), selectedItem, selectedStep, compare, item?.status, atlasStep?.type === "atlas" && selectedStep === atlasStep.id ? items.map((i) => i.id + i.status) : null]);
  useEffect(() => {
    const w = worker.current;
    if (!w) return;
    const t = setTimeout(() => {
      const isAtlas = !!atlasStep && selectedStep === atlasStep.id;
      if (isAtlas ? !items.some((i) => i.status === "ready") : !item || item.status !== "ready") return;
      if (token.current) w.postMessage({ type: "cancel", token: token.current } satisfies WorkerRequest);
      const t2 = ++token.current;
      if (isAtlas) {
        if (!atlasStep.enabled) return;
        w.postMessage({ type: "atlas-preview", token: t2, pipeline } satisfies WorkerRequest);
      } else {
        const stepId = selected && selected.type !== "atlas" ? selected.id : null;
        w.postMessage({ type: "preview", token: t2, pipeline, inputId: item!.id, stepId, compareStepId: compare === "previous" ? previousEnabled(stepId) : null } satisfies WorkerRequest);
      }
    }, 90);
    return () => clearTimeout(t);
    // previewKey captures every input that changes the preview
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  const cancelPreview = () => {
    worker.current?.postMessage({ type: "cancel", token: token.current } satisfies WorkerRequest);
    setProgress(null);
  };

  /* ------------------------------------------------------------ export */
  const ready = items.filter((i) => i.status === "ready");
  // Unreadable images go into the batch too, so the manifest records them as failures.
  const exportable = items.filter((i) => i.status !== "loading");
  const estimate = useMemo(() => estimateBatch(pipeline, ready.map((i) => [i.width!, i.height!] as [number, number]), concurrency), [pipeline, ready, concurrency]);
  const ext = pipeline.output.format === "webp" ? "webp" : "png";
  const exampleName = ready.length ? outputNames(ready.map((i) => i.name), pipeline.output.naming, ext)[0] : null;
  const atlasOn = !!atlasStep?.enabled;

  async function startExport() {
    if (!ready.length) return;
    if (exporting.kind === "done") URL.revokeObjectURL(exporting.url);
    const ctrl = new AbortController();
    setExporting({ kind: "running", progress: { done: 0, total: exportable.length, failed: 0, running: [] }, ctrl });
    try {
      const r = await runBatch(
        pipeline,
        exportable.map((i) => ({ id: i.id, name: i.name, file: i.file, origin: i.origin })),
        { concurrency, pipelineJson: serialisePipeline(pipeline), signal: ctrl.signal, onProgress: (p) => setExporting((e) => (e.kind === "running" ? { ...e, progress: p } : e)) },
      );
      const blob = new Blob([r.zip as BlobPart], { type: "application/zip" });
      const filename = `${slug(pipeline.name)}.zip`;
      saveBlob(blob, filename);
      setExporting({ kind: "done", url: URL.createObjectURL(blob), filename, bytes: r.zip.byteLength, succeeded: r.manifest.summary.succeeded, failures: r.failures });
      toast.ok(`Exported ${r.manifest.summary.succeeded} of ${r.manifest.summary.inputs}`, r.failures.length ? `${r.failures.length} failed; see the list` : undefined);
    } catch (e) {
      if (e instanceof CancelledError || ctrl.signal.aborted) setExporting({ kind: "idle" });
      else setExporting({ kind: "error", message: e instanceof Error ? e.message : "The export failed." });
    }
  }

  /* --------------------------------------------------------- recipes */
  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { pipeline: p, notes: n } = parsePipeline(await file.text());
      replacePipeline(p, n);
      toast.ok(`Loaded “${p.name}”`, n.length ? `${n.length} note${n.length > 1 ? "s" : ""} below` : undefined);
    } catch (e) {
      toast.error("Couldn't import that pipeline", e instanceof PipelineError ? e.message : "The file couldn't be read.");
    }
  };

  const loadPreset = () => {
    const builtin = BUILTIN_PRESETS.find((p) => p.id === preset);
    if (builtin) return replacePipeline(builtin.build());
    const r = recipes.find((x) => x.id === preset);
    if (!r) return;
    try {
      const { pipeline: p, notes: n } = parsePipeline(r.json);
      replacePipeline(p, n);
    } catch (e) {
      toast.error("Couldn't load that recipe", e instanceof Error ? e.message : undefined);
    }
  };

  /* --------------------------------------------------------------- UI */
  const fieldsFor = (s: Step) => (s.type === "atlas" ? ATLAS_STEP.fields : STEPS[s.type].fields);
  const isAtlasView = !!atlasStep && selectedStep === atlasStep.id;
  const selIndex = selected ? steps.indexOf(selected) : -1;
  const out = item?.width && item.height ? predictSize(pipeline, item.width, item.height) : null;
  // Progress is only recorded for the current preview's token.
  const working = progress;

  const readout = working ? (
    <>
      &gt; PROCESSING STEP <b>{working.done}</b>/<b>{working.total}</b>…
    </>
  ) : !items.length ? (
    <>&gt; IDLE // ADD IMAGES TO BEGIN</>
  ) : previewError ? (
    <>! {previewError}</>
  ) : isAtlasView && !atlasStep.enabled ? (
    <>&gt; ATLAS STEP IS OFF</>
  ) : !shown ? (
    <>&gt; PROCESSING…</>
  ) : (
    <>
      &gt; <b>{shown.width}×{shown.height}</b>
      {shown.colours !== null ? (
        <>
          {" "}
          // <b>{shown.colours > 65536 ? "65K+" : shown.colours}</b> COLOURS
        </>
      ) : null}
      {shown.frames !== undefined ? (
        <>
          {" "}
          // <b>{shown.frames}</b> FRAMES
        </>
      ) : null}{" "}
      // <b>{shown.ms} MS</b>
    </>
  );

  return (
    <div className="lp-scroll flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      <header className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-rule-strong px-4 py-2.5 sm:px-6">
        <h1 className="font-ocr text-lg tracking-[0.18em] uppercase glow">Workshop</h1>
        <p className="font-ocr text-[12px] tracking-[0.08em] text-muted uppercase">&gt; chain tool steps // preview every stage // batch to ZIP + manifest // files never leave this machine</p>
      </header>

      <div className="grid gap-3 p-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[18rem_minmax(0,1fr)_23rem] xl:grid-cols-[20rem_minmax(0,1fr)_25rem]">
        {/* ------------------------------------------------ left column */}
        <div className="lp-scroll flex min-h-0 min-w-0 flex-col gap-3 lg:overflow-y-auto">
          <section aria-labelledby="ws-images" className="border border-rule-strong bg-panel p-3">
            <div className="mb-2.5 flex items-center gap-2">
              <h2 id="ws-images" className="type-panel mr-auto">
                // Images
              </h2>
              {items.length ? (
                <button type="button" className={small} onClick={() => remove(items.map((i) => i.id))}>
                  Clear
                </button>
              ) : null}
            </div>
            <div className={cn("flex flex-col items-center gap-1.5 border border-dashed border-edge bg-sunken px-3 py-3 text-center hover:border-bright", dragging && "border-solid border-bright shadow-[var(--crt-glow)]")}>
              <button type="button" onClick={() => filesRef.current?.click()} className="cursor-pointer font-ocr tracking-[0.1em] uppercase glow">
                [ Drop images ]
              </button>
              <span className="font-ocr text-[11px] tracking-[0.04em] text-muted">files or folders // up to {MAX_INPUTS}</span>
              <span className="mt-1 flex flex-wrap justify-center gap-1.5">
                <button type="button" className={small} onClick={() => filesRef.current?.click()}>
                  + Files
                </button>
                <button type="button" className={small} onClick={() => folderRef.current?.click()}>
                  + Folder
                </button>
                <LibraryPicker className={small} onPick={(p) => add([{ file: p.file, dir: "", origin: p.origin }])} />
                <button type="button" className={small} onClick={() => void loadSample()} title="Four LOWPO11Y demo textures (CC0)">
                  + Sample
                </button>
              </span>
              <input ref={filesRef} type="file" accept="image/*" multiple hidden aria-label="Images" onChange={(e) => (add(fromInput(e.target.files)), (e.target.value = ""))} />
              <input ref={folderRef} type="file" multiple hidden aria-label="Image folder" {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} onChange={(e) => (add(fromInput(e.target.files)), (e.target.value = ""))} />
            </div>
            {items.length ? (
              <ul aria-label="Image list" tabIndex={0} className="lp-scroll mt-2 max-h-[15rem] overflow-y-auto border border-rule-strong">
                {items.map((i) => (
                  <li key={i.id} className={cn("flex items-center border-t border-rule first:border-t-0", i.id === selectedItem && "bg-hover")}>
                    <button type="button" aria-pressed={i.id === selectedItem} onClick={() => setSelectedItem(i.id)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-1.5 py-1 text-left">
                      <img src={i.thumb} alt="" className="size-7 max-w-none shrink-0 border border-rule-strong object-contain [image-rendering:pixelated]" />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{i.name}</span>
                      <span className={cn("shrink-0 font-ocr text-[11px]", i.status === "failed" ? "text-bright" : "text-muted")}>{i.status === "ready" ? `${i.width}×${i.height}` : i.status === "loading" ? "…" : "! unreadable"}</span>
                    </button>
                    <IconButton label={`Remove ${i.name}`} icon={<span aria-hidden>×</span>} size="sm" variant="ghost" onClick={() => remove([i.id])} />
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-2.5 flex flex-col gap-1">
              <Toggle
                pressed={keepImages}
                onPressedChange={(on) => {
                  setKeepImages(on);
                  if (!on) void forgetInputs().then(() => storageEstimate().then(setQuota));
                }}
                title="Store the images in this browser so they're here next time. They never leave this device."
                className="self-start"
              >
                Keep images on this device
              </Toggle>
              <p className="type-data text-muted">
                {keepImages ? `Kept in this browser only${quota ? ` // ${formatBytes(quota.usage)} of ${formatBytes(quota.quota)} used` : ""}.` : "Off: images are forgotten when you close the page. The pipeline is always remembered."}
              </p>
            </div>
          </section>

          <section aria-labelledby="ws-pipeline" className="border border-rule-strong bg-panel p-3">
            <h2 id="ws-pipeline" className="type-panel mb-2.5">
              // Pipeline
            </h2>
            <Field label="Pipeline name">
              <Input value={pipeline.name} maxLength={80} onChange={(e) => setPipeline((p) => ({ ...p, name: e.target.value }))} />
            </Field>
            <ol aria-label="Steps" className="mt-3 flex flex-col border border-rule-strong">
              <li className={cn("flex items-center gap-2 px-2 py-1.5", selectedStep === null && "bg-hover")}>
                <span aria-hidden className="w-5 font-ocr text-[11px] text-muted">
                  IN
                </span>
                <button type="button" aria-pressed={selectedStep === null} onClick={() => setSelectedStep(null)} className="min-w-0 flex-1 cursor-pointer text-left">
                  <span className="block text-[13px] text-fg">Original</span>
                  <span className="block truncate font-ocr text-[11px] text-muted">{item ? `${item.width ?? "?"}×${item.height ?? "?"}` : "no image"}</span>
                </button>
              </li>
              {steps.map((s, i) => {
                const def = stepDef(s.type);
                return (
                  <li key={s.id} className={cn("flex items-center gap-1.5 border-t border-rule px-2 py-1.5", s.id === selectedStep && "bg-hover", !s.enabled && "opacity-60")}>
                    <span aria-hidden className="w-5 font-ocr text-[11px] text-muted">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <button type="button" aria-pressed={s.id === selectedStep} onClick={() => setSelectedStep(s.id)} className="min-w-0 flex-1 cursor-pointer text-left">
                      <span className="block text-[13px] text-fg">
                        {def.label}
                        {s.enabled ? null : <span className="font-ocr text-[11px] text-muted"> // off</span>}
                      </span>
                      <span className="block truncate font-ocr text-[11px] text-muted">{describeStep(s)}</span>
                    </button>
                    <Toggle pressed={s.enabled} onPressedChange={(on) => patchStep(s.id, { enabled: on })} title={s.enabled ? "Turn this step off" : "Turn this step on"} className="px-1.5 py-0.5 text-[11px]" ariaLabel={`${s.enabled ? "On" : "Off"}: ${def.label}`}>
                      {s.enabled ? "On" : "Off"}
                    </Toggle>
                  </li>
                );
              })}
              <li className="border-t border-rule px-2 py-1.5 font-ocr text-[11px] text-muted">
                OUT // {pipeline.output.format.toUpperCase()}
                {atlasOn ? " + ATLAS" : ""}
              </li>
            </ol>
            <div className="mt-2 flex gap-2">
              <label htmlFor="ws-add" className="sr-only">
                Step to add
              </label>
              <Select id="ws-add" value={addType} onChange={(e) => setAddType(e.target.value as StepType)} className="min-w-0 flex-1">
                {STEP_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {STEPS[t].label}
                  </option>
                ))}
                <option value="atlas" disabled={!!atlasStep}>
                  {ATLAS_STEP.label}
                </option>
              </Select>
              <Button onClick={addStep}>Add step</Button>
            </div>

            <div className="mt-4 border-t border-dashed border-rule-strong pt-3">
              <h3 className="type-label mb-2">Presets and recipes</h3>
              <div className="flex gap-2">
                <label htmlFor="ws-preset" className="sr-only">
                  Preset or recipe
                </label>
                <Select id="ws-preset" value={preset} onChange={(e) => setPreset(e.target.value)} className="min-w-0 flex-1">
                  <optgroup label="Built-in">
                    {BUILTIN_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                  {recipes.length ? (
                    <optgroup label="Saved in this browser">
                      {recipes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </Select>
                <Button onClick={loadPreset}>Load</Button>
              </div>
              <p className="type-data mt-1.5 text-muted">{BUILTIN_PRESETS.find((p) => p.id === preset)?.description ?? "Loading replaces the current steps."}</p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className={small}
                  onClick={() => {
                    try {
                      saveRecipe(pipeline);
                      setRecipes(listRecipes());
                      toast.ok(`Saved “${pipeline.name.trim() || "Untitled pipeline"}” in this browser`);
                    } catch (e) {
                      toast.error("Couldn't save the recipe", e instanceof StorageFullError ? e.message : undefined);
                    }
                  }}
                >
                  Save recipe
                </button>
                <button type="button" className={small} onClick={() => saveBlob(new Blob([serialisePipeline(pipeline)], { type: "application/json" }), `${slug(pipeline.name)}.workshop.json`)}>
                  Export JSON
                </button>
                <button type="button" className={small} onClick={() => importRef.current?.click()}>
                  Import JSON
                </button>
                {recipes.some((r) => r.id === preset) ? (
                  <button
                    type="button"
                    className={small}
                    onClick={() => {
                      deleteRecipe(preset);
                      setRecipes(listRecipes());
                      setPreset(BUILTIN_PRESETS[0]!.id);
                    }}
                  >
                    Delete recipe
                  </button>
                ) : null}
                <button type="button" className={small} onClick={() => replacePipeline(emptyPipeline())}>
                  Start blank
                </button>
                <input ref={importRef} type="file" accept=".json,application/json" hidden aria-label="Pipeline JSON file" onChange={(e) => (void importJson(e.target.files?.[0]), (e.target.value = ""))} />
              </div>
              {notes.length ? (
                <ul aria-label="Import notes" className="mt-2 flex flex-col gap-0.5 text-xs text-muted">
                  {notes.map((n) => (
                    <li key={n}>&gt; {n}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>
        </div>

        {/* ---------------------------------------------- centre column */}
        <section aria-labelledby="ws-preview" className="flex min-h-[26rem] min-w-0 flex-col gap-2 border border-rule-strong bg-panel p-3 lg:min-h-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="ws-preview" className="type-panel mr-auto">
              // {isAtlasView ? "Atlas" : selected ? `Step ${selIndex + 1}: ${stepDef(selected.type).label}` : "Original"}
            </h2>
            {!isAtlasView ? (
              <SegmentedControl
                label="Compare with"
                inline
                size="sm"
                value={compare}
                onChange={setCompare}
                options={[
                  { value: "original", label: "Original" },
                  { value: "previous", label: "Previous", title: "The step before this one" },
                ]}
              />
            ) : null}
          </div>
          <Viewport result={shown?.result ?? null} source={shown?.compare ?? null} hasItem={!!item} state={view} onChange={(p) => setView((v) => ({ ...v, ...p }))} label={item?.name ?? ""} readout={readout} />
          {working ? (
            <Button size="sm" variant="ghost" className="self-end" onClick={cancelPreview}>
              Cancel preview
            </Button>
          ) : null}
          {shown?.overflow?.length ? <p className="border border-bright px-2 py-1.5 font-ocr text-[12px] text-bright">! {shown.overflow.length} image{shown.overflow.length > 1 ? "s don't" : " doesn't"} fit the atlas: {shown.overflow.slice(0, 5).join(", ")}</p> : null}
        </section>

        {/* ------------------------------------------------ right column */}
        <aside aria-label="Settings and export" className="lp-scroll flex min-h-0 min-w-0 flex-col gap-3 lg:overflow-y-auto lg:pr-1">
          <section aria-labelledby="ws-step" className="border border-rule-strong bg-panel p-3">
            <div className="mb-2.5 flex items-center gap-1.5">
              <h2 id="ws-step" className="type-panel mr-auto">
                // {selected ? stepDef(selected.type).label : "Original"}
              </h2>
              {selected ? (
                <>
                  <IconButton label="Move step up" icon={<span aria-hidden>▲</span>} size="sm" variant="ghost" disabled={selIndex <= 0 || selected.type === "atlas"} onClick={() => move(selected.id, -1)} />
                  <IconButton
                    label="Move step down"
                    icon={<span aria-hidden>▼</span>}
                    size="sm"
                    variant="ghost"
                    disabled={selIndex >= steps.length - 1 || selected.type === "atlas" || steps[selIndex + 1]?.type === "atlas"}
                    onClick={() => move(selected.id, 1)}
                  />
                  <IconButton
                    label="Remove step"
                    icon={<span aria-hidden>×</span>}
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSteps((s) => s.filter((x) => x.id !== selected.id));
                      setSelectedStep(null);
                    }}
                  />
                </>
              ) : null}
            </div>
            {selected ? (
              <>
                <p className="type-data mb-3 text-muted">{stepDef(selected.type).summary}</p>
                <StepForm fields={fieldsFor(selected)} values={selected.params} onChange={(k, v) => setParam(selected.id, k, v)} idPrefix={selected.id} />
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => patchStep(selected.id, { params: stepDef(selected.type).schema.parse({}) as Record<string, unknown> })}>
                    Reset step
                  </Button>
                </div>
              </>
            ) : item ? (
              <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-[13px]">
                <dt className="text-muted">File</dt>
                <dd className="break-all text-fg">{item.name}</dd>
                <dt className="text-muted">Size</dt>
                <dd className="text-fg">{item.width ? `${item.width}×${item.height} // ${formatBytes(item.file.size)}` : "…"}</dd>
                <dt className="text-muted">After</dt>
                <dd className="text-fg">{out ? `${out[0]}×${out[1]}` : "…"}</dd>
                {item.origin ? (
                  <>
                    <dt className="text-muted">From</dt>
                    <dd className="text-fg">
                      <a href={item.origin.url} className="text-bright underline underline-offset-4" target="_blank" rel="noreferrer">
                        LOWPO11Y library
                      </a>
                      {item.origin.licence ? ` // ${item.origin.licence}` : ""}
                    </dd>
                  </>
                ) : null}
              </dl>
            ) : (
              <p className="text-[13px] text-muted">Add images, then pick a step to change its settings. Every step can be turned off without losing its settings.</p>
            )}
          </section>

          <section aria-labelledby="ws-export" className="border border-rule-strong bg-panel p-3">
            <h2 id="ws-export" className="type-panel mb-2.5">
              // Export
            </h2>
            <div className="flex flex-col gap-3">
              <SegmentedControl
                label="Format"
                inline
                size="sm"
                value={pipeline.output.format}
                onChange={(f) => setPipeline((p) => ({ ...p, output: { ...p.output, format: f } }))}
                options={[
                  { value: "png", label: "PNG", title: "Lossless, exact pixels" },
                  { value: "webp", label: "WebP", title: "Smaller; encoded by your browser" },
                ]}
              />
              {pipeline.output.format === "webp" ? <SliderField label="Quality" value={pipeline.output.quality} min={1} max={100} onChange={(q) => setPipeline((p) => ({ ...p, output: { ...p.output, quality: q } }))} /> : null}
              <Field label="File names" hint={<>{"{name}"} = original name, {"{n}"} = position. {exampleName ? `First file: ${exampleName}` : ""}</>}>
                <Input value={pipeline.output.naming} maxLength={80} spellCheck={false} onChange={(e) => setPipeline((p) => ({ ...p, output: { ...p.output, naming: e.target.value.replace(/[/\\:*?"<>|]/g, "") } }))} />
              </Field>
              <SegmentedControl
                label="Parallel jobs"
                inline
                size="sm"
                value={String(concurrency)}
                onChange={(v) => setConcurrency(Number(v))}
                options={["1", "2", "3", "4"].map((v) => ({ value: v, label: v, title: `${v} image${v === "1" ? "" : "s"} at a time` }))}
              />
              <p className="type-data text-muted">
                {ready.length ? (
                  <>
                    {ready.length} image{ready.length > 1 ? "s" : ""}
                    {atlasOn && estimate.atlas ? ` → atlas about ${estimate.atlas[0]}×${estimate.atlas[1]}` : ""} // about {formatBytes(estimate.memoryBytes)} of memory while processing // up to {formatBytes(estimate.outputBytes)} before compression
                  </>
                ) : (
                  "Add images to export."
                )}
              </p>
              {estimate.memoryBytes > 1.5 * 1024 ** 3 ? <p className="border border-bright px-2 py-1.5 text-xs text-bright">! This needs a lot of memory. Use fewer parallel jobs, smaller images or a resize step first; the browser may stop the page.</p> : null}

              {exporting.kind === "running" ? (
                <div className="flex flex-col gap-2">
                  <Progress value={exporting.progress.total ? exporting.progress.done / exporting.progress.total : 0} label={`Exported ${exporting.progress.done} of ${exporting.progress.total}`} />
                  <p className="truncate font-ocr text-[11px] text-muted">{exporting.progress.running.length ? `> ${exporting.progress.running.join(", ")}` : "> starting…"}</p>
                  <Button variant="danger" onClick={() => exporting.ctrl.abort()}>
                    Cancel export
                  </Button>
                </div>
              ) : (
                <Button variant="primary" size="lg" className="w-full" disabled={!ready.length} onClick={() => void startExport()}>
                  {atlasOn ? "Export atlas (ZIP)" : `Export ${ready.length || ""} image${ready.length === 1 ? "" : "s"} (ZIP)`}
                </Button>
              )}
              {exporting.kind === "done" ? (
                <div className="flex flex-col gap-1.5 border border-rule-strong bg-sunken p-2">
                  <p className="text-[13px] text-fg">
                    {exporting.succeeded} exported{exporting.failures.length ? `, ${exporting.failures.length} failed` : ""} // {formatBytes(exporting.bytes)}
                  </p>
                  {exporting.failures.length ? (
                    <ul aria-label="Failed images" className="flex flex-col gap-0.5 text-xs text-bright">
                      {exporting.failures.map((f) => (
                        <li key={f.name}>
                          ! {f.name}: {f.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <a href={exporting.url} download={exporting.filename} className="font-ocr text-[12px] tracking-[0.06em] text-bright uppercase underline underline-offset-4">
                    Download {exporting.filename} again
                  </a>
                  <p className="type-data text-muted">The ZIP holds the images, manifest.json (sources, sizes, checksums) and pipeline.json.</p>
                </div>
              ) : exporting.kind === "error" ? (
                <p role="alert" className="text-xs text-bright">
                  ! {exporting.message}
                </p>
              ) : null}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
