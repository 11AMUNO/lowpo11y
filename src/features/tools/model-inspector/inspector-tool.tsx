"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/controls";
import { Dropzone } from "@/components/ui/dropzone";
import { Toggle } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatBytes, formatCount } from "@/lib/format";
import { gltfStats, GltfError, parseGlb, parseGltfJson, type GltfStats } from "@/lib/formats/gltf";
import { isPowerOfTwo } from "@/lib/processing/image";
import { saveBlob } from "../shared/files";
import { externalUris, pickModel, resolveUri, UNSUPPORTED_EXTENSION_HELP } from "./files";
import { DEFAULT_DISPLAY, type Display, type InspectInfo, type InspectorView, type ModelSource } from "./types";
import { track } from "@/lib/analytics/client";

const MAX_BYTES = 256 * 1024 * 1024;
const SAMPLES = [
  { file: "demo-wooden-crate.glb", label: "+ Crate", title: "Textured static prop (CC0)" },
  { file: "demo-rigged-pole.glb", label: "+ Rigged pole", title: "Skinned mesh with two animation clips (CC0)" },
];

interface Loaded {
  name: string;
  bytes: number;
  stats: GltfStats;
  info: InspectInfo | null;
}

const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : "—");

export function InspectorTool() {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<InspectorView | null>(null);
  const urls = useRef<string[]>([]);
  const [viewError, setViewError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [display, setDisplay] = useState<Display>(DEFAULT_DISPLAY);
  const [clip, setClip] = useState(0);
  const [time, setTime] = useState({ t: 0, duration: 0, playing: false });
  const [memory, setMemory] = useState<{ geometries: number; textures: number } | null>(null);
  const [loads, setLoads] = useState(0);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    let v: InspectorView | null = null;
    import("./view")
      .then(({ createView }) => {
        if (cancelled) return;
        v = createView(el, (t, duration, playing) => setTime({ t, duration, playing }));
        view.current = v;
        setMemory(v.memory());
      })
      .catch((e: unknown) => setViewError(e instanceof Error ? e.message : "The 3D view couldn't start."));
    return () => {
      cancelled = true;
      v?.dispose();
      view.current = null;
      urls.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const revoke = () => {
    urls.current.forEach((u) => URL.revokeObjectURL(u));
    urls.current = [];
  };

  const unload = () => {
    view.current?.unload();
    revoke();
    setLoaded(null);
    setError(null);
    setTime({ t: 0, duration: 0, playing: false });
    if (view.current) setMemory(view.current.memory());
  };

  const open = useCallback(async (files: File[]) => {
    const model = pickModel(files.map((f) => Object.assign(f, { path: f.webkitRelativePath || undefined })));
    setError(null);
    if (!model) return setError("Choose a .glb or .gltf file. For a .gltf, select its .bin and texture files too.");
    if (model.size > MAX_BYTES) return setError(`This file is ${formatBytes(model.size)}; the inspector opens files up to ${formatBytes(MAX_BYTES)}.`);
    setBusy(true);
    view.current?.unload();
    revoke();
    setTime({ t: 0, duration: 0, playing: false });
    setClip(0);
    try {
      const isGlb = /\.glb$/i.test(model.name);
      const bytes = new Uint8Array(await model.arrayBuffer());
      let doc;
      try {
        doc = isGlb ? parseGlb(bytes) : parseGltfJson(new TextDecoder().decode(bytes));
      } catch (e) {
        throw new Error(e instanceof GltfError ? e.message : "This file isn't valid glTF.");
      }
      const stats = gltfStats(doc);
      setLoaded({ name: model.name, bytes: model.size, stats, info: null });
      if (stats.unsupportedExtensions.length) {
        throw new Error(`Can't display this model: ${stats.unsupportedExtensions.map((x) => UNSUPPORTED_EXTENSION_HELP[x] ?? `it requires ${x}.`).join(" ")} The file's statistics are shown below.`);
      }
      let src: ModelSource;
      if (isGlb) src = { kind: "glb", data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
      else {
        const map = new Map<string, string>();
        const missing: string[] = [];
        for (const uri of externalUris(doc.json)) {
          const f = resolveUri(uri, files);
          if (!f) missing.push(uri);
          else {
            const u = URL.createObjectURL(f);
            urls.current.push(u);
            map.set(uri, u);
          }
        }
        if (missing.length) throw new Error(`This .gltf needs ${missing.length === 1 ? "a file" : "files"} you didn't select: ${missing.join(", ")}. Select the .gltf together with them.`);
        src = { kind: "gltf", json: new TextDecoder().decode(bytes), urls: map };
      }
      if (!view.current) throw new Error(viewError ?? "The 3D view isn't ready.");
      const info = await view.current.load(src);
      setLoaded({ name: model.name, bytes: model.size, stats, info });
      setLoads((n) => n + 1);
      if (info.animations.length) view.current.select(0);
      track("preview", "inspector:ok");
    } catch (e) {
      view.current?.unload();
      track("preview", "inspector:error");
      setError(e instanceof Error ? e.message : "This model couldn't be opened.");
    } finally {
      setBusy(false);
      if (view.current) setMemory(view.current.memory());
    }
  }, [viewError]);

  const loadSample = async (file: string) => {
    const r = await fetch(`/demo/models/${file}`);
    await open([new File([await r.blob()], file, { type: "model/gltf-binary" })]);
  };

  const changeDisplay = (patch: Partial<Display>) => {
    const next = { ...display, ...patch };
    setDisplay(next);
    view.current?.setDisplay(next);
  };

  const report = () => {
    if (!loaded) return;
    const json = {
      tool: "LOWPO11Y model inspector",
      file: { name: loaded.name, bytes: loaded.bytes },
      stats: loaded.stats,
      rendered: loaded.info ? { drawCalls: loaded.info.measured.calls, triangles: loaded.info.measured.triangles, size: loaded.info.size } : null,
      meshes: loaded.info?.meshes ?? [],
      materials: loaded.info?.materials ?? [],
      textures: loaded.info?.textures ?? [],
      animations: loaded.info?.animations ?? [],
      warnings: warnings(loaded),
    };
    saveBlob(new Blob([JSON.stringify(json, null, 2) + "\n"], { type: "application/json" }), `${loaded.name.replace(/\.(glb|gltf)$/i, "")}-report.json`);
    toast.ok("Saved report");
  };

  const screenshot = async () => {
    if (!view.current || !loaded?.info) return;
    saveBlob(await view.current.screenshot(), `${loaded.name.replace(/\.(glb|gltf)$/i, "")}.png`);
    toast.ok("Saved screenshot");
  };

  const s = loaded?.stats;
  const info = loaded?.info;
  const anims = info?.animations ?? [];
  const warn = loaded ? warnings(loaded) : [];

  return (
    <div className="lp-scroll flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      <header className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-rule-strong px-4 py-2.5 sm:px-6">
        <h1 className="font-ocr text-lg tracking-[0.18em] uppercase glow">Model inspector</h1>
        <p className="font-ocr text-[12px] tracking-[0.08em] text-muted uppercase">&gt; open a GLB or glTF to check triangles, materials, textures and animations // nothing is uploaded</p>
      </header>

      <div className="grid gap-3 p-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[16rem_minmax(0,1fr)_22rem] xl:grid-cols-[18rem_minmax(0,1fr)_24rem]">
        <div className="lp-scroll flex min-h-0 flex-col gap-3 lg:overflow-y-auto">
          <section aria-label="Model file" className="border border-rule-strong bg-panel p-3">
            <h2 className="type-panel mb-2.5">// Model</h2>
            <Dropzone
              multiple
              extensions={[".glb", ".gltf", ".bin", ".png", ".jpg", ".jpeg", ".webp", ".ktx2"]}
              maxBytes={MAX_BYTES}
              label={loaded ? "Open another" : "Drop a model"}
              hint=".glb, or a .gltf with its .bin and textures. Nothing is uploaded."
              onFiles={(f) => void open(f)}
              onReject={(r) => toast.error("Not opened", r.join(". "))}
              compact
              disabled={busy}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SAMPLES.map((x) => (
                <button key={x.file} type="button" title={x.title} disabled={busy} onClick={() => void loadSample(x.file)} className="cursor-pointer border border-edge bg-sunken px-2 py-1 font-ocr text-[11px] tracking-[0.05em] text-muted uppercase hover:text-bright disabled:opacity-40">
                  {x.label}
                </button>
              ))}
            </div>
            {loaded ? (
              <div className="mt-2.5 flex items-center gap-2 border-t border-dashed border-rule-strong pt-2">
                <p className="min-w-0 flex-1 truncate font-ocr text-[11px] tracking-[0.04em] text-muted">
                  {loaded.name} // {formatBytes(loaded.bytes)}
                </p>
                <Button size="sm" variant="ghost" onClick={unload}>
                  Unload
                </Button>
              </div>
            ) : null}
            {s?.generator ? <p className="mt-1 truncate font-ocr text-[11px] text-muted">Made with {s.generator}</p> : null}
          </section>

          {loaded ? (
            <section aria-label="Checks" className="border border-rule-strong bg-panel p-3">
              <h2 className="type-panel mb-2.5">// Checks</h2>
              {warn.length ? (
                <ul className="flex flex-col gap-1.5">
                  {warn.map((w) => (
                    <li key={w} className="text-[12.5px] leading-snug text-fg">
                      <span className="font-ocr text-bright">! </span>
                      {w}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="font-ocr text-[12px] tracking-[0.04em] text-muted uppercase">&gt; nothing to flag</p>
              )}
            </section>
          ) : null}

          <section aria-label="GPU memory" className="border border-rule-strong bg-panel p-3">
            <h2 className="type-panel mb-2">// GPU memory</h2>
            <p role="status" className="font-ocr text-[12px] tracking-[0.04em] text-muted uppercase [&_b]:font-normal [&_b]:text-bright">
              {memory ? (
                <>
                  &gt; <b>{memory.geometries}</b> geometries // <b>{memory.textures}</b> textures // {loads} load{loads === 1 ? "" : "s"}
                </>
              ) : (
                "> —"
              )}
            </p>
            <p className="mt-1.5 text-[11.5px] leading-snug text-muted">Live counts from the renderer. Unloading or opening another model frees everything the last one used.</p>
          </section>
        </div>

        <section aria-label="Viewer" className="flex min-h-[28rem] flex-col gap-2 border border-rule-strong bg-panel p-3 lg:min-h-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="type-panel mr-auto">// View</h2>
            <SegmentedControl
              label="Display"
              hideLabel
              size="sm"
              className="w-72"
              value={display.mode}
              onChange={(v) => changeDisplay({ mode: v })}
              options={[
                { value: "shaded", label: "Shaded" },
                { value: "unlit", label: "Unlit", title: "Texture and colour only, no lighting" },
                { value: "wire", label: "Wire" },
                { value: "normals", label: "Normals", title: "Surface normals as colours" },
              ]}
            />
          </div>
          <div className="relative min-h-0 flex-1 border border-rule-strong bg-sunken">
            <div ref={host} className="absolute inset-0" />
            {!loaded && !busy && !viewError ? (
              <p className="pointer-events-none absolute inset-0 flex items-center justify-center font-ocr text-[12px] tracking-[0.08em] text-muted uppercase">&gt; no model // drop one or try a sample</p>
            ) : null}
            {busy ? <p className="pointer-events-none absolute top-2 left-2 font-ocr text-[12px] text-bright uppercase glow">&gt; loading…</p> : null}
          </div>
          {error || viewError ? (
            <p role="alert" className="border border-bright px-2 py-1.5 font-ocr text-[12px] leading-snug text-bright">
              ! {error ?? viewError}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Toggle pressed={display.flat} onPressedChange={(v) => changeDisplay({ flat: v })} title="Shade by face. The renderer computes these normals; the file's own normals may differ.">
              Flat shading
            </Toggle>
            <Toggle pressed={display.grid} onPressedChange={(v) => changeDisplay({ grid: v })}>
              Grid
            </Toggle>
            <Toggle pressed={display.axes} onPressedChange={(v) => changeDisplay({ axes: v })} title="X red, Y green, Z blue">
              Axes
            </Toggle>
            <Toggle pressed={display.bounds} onPressedChange={(v) => changeDisplay({ bounds: v })}>
              Bounds
            </Toggle>
            <span className="ml-auto flex gap-1.5">
              <Button size="sm" variant="ghost" disabled={!info} onClick={() => view.current?.reset()}>
                Reset camera
              </Button>
              <Button size="sm" disabled={!info} onClick={() => void screenshot()}>
                Screenshot
              </Button>
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <SegmentedControl label="Background" size="sm" className="w-56" value={display.background} onChange={(v) => changeDisplay({ background: v })} options={[{ value: "dark", label: "Dark" }, { value: "grey", label: "Grey" }, { value: "light", label: "Light" }]} />
            <SegmentedControl label="Lights" size="sm" className="w-56" value={display.lights} onChange={(v) => changeDisplay({ lights: v })} options={[{ value: "studio", label: "Studio" }, { value: "soft", label: "Soft" }, { value: "flat", label: "Flat", title: "Even ambient light" }]} />
          </div>
          {anims.length ? (
            <div aria-label="Animation" role="group" className="flex flex-wrap items-center gap-2 border-t border-dashed border-rule-strong pt-2">
              <label className="type-label" htmlFor="clip-select">
                Clip
              </label>
              <select
                id="clip-select"
                value={clip}
                onChange={(e) => {
                  const i = Number(e.target.value);
                  setClip(i);
                  view.current?.pause();
                  view.current?.select(i);
                }}
                className="h-8 border border-edge-strong bg-sunken px-2 font-ocr text-[12px] text-bright"
              >
                {anims.map((a, i) => (
                  <option key={i} value={i}>
                    {a.name} ({fmt(a.duration)} s)
                  </option>
                ))}
              </select>
              <Button size="sm" onClick={() => (time.playing ? view.current?.pause() : view.current?.play(clip))}>
                {time.playing ? "Pause" : "Play"}
              </Button>
              <input
                type="range"
                aria-label="Animation time"
                min={0}
                max={time.duration || anims[clip]?.duration || 1}
                step={0.01}
                value={time.t}
                onChange={(e) => {
                  view.current?.pause();
                  view.current?.setTime(Number(e.target.value));
                }}
                className="min-w-40 flex-1 accent-white"
              />
              <span className="font-ocr text-[12px] text-muted" aria-live="off">
                {fmt(time.t)} / {fmt(time.duration || anims[clip]?.duration || 0)} s
              </span>
            </div>
          ) : null}
        </section>

        <aside aria-label="Details" className="lp-scroll flex min-h-0 flex-col gap-3 lg:overflow-y-auto lg:pr-1">
          <section aria-label="Statistics" className="border border-rule-strong bg-panel p-3">
            <div className="mb-2.5 flex items-center gap-2">
              <h2 className="type-panel mr-auto">// Statistics</h2>
              <Button size="sm" variant="ghost" disabled={!loaded} onClick={report}>
                Report JSON
              </Button>
            </div>
            {s ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[12.5px]">
                <Stat label="Triangles (in scene)" value={formatCount(s.sceneTriangles)} title="Every instance counted" />
                <Stat label="Triangles (unique meshes)" value={formatCount(s.uniqueTriangles)} title="Each mesh counted once" />
                <Stat label="Vertices (in scene)" value={formatCount(s.sceneVertices)} />
                <Stat label="Draw calls (estimate)" value={formatCount(s.drawCalls)} title="One per primitive instance; engines may batch or split" />
                <Stat label="Draw calls (measured)" value={info ? formatCount(info.measured.calls) : "—"} title="What this renderer issued for the model, helpers hidden" />
                <Stat label="Meshes / primitives" value={`${s.meshes} / ${s.primitives}`} />
                <Stat label="Nodes" value={formatCount(s.nodes)} />
                <Stat label="Materials" value={formatCount(s.materials)} />
                <Stat label="Textures" value={formatCount(s.textures)} />
                <Stat label="Skins" value={formatCount(s.skins)} />
                <Stat label="Morph targets" value={formatCount(s.morphTargets)} />
                <Stat label="Animations" value={formatCount(s.animations.length)} />
                <Stat label="UV channels" value={String(s.uvChannels)} />
                <Stat label="Normals" value={s.hasNormals ? "yes" : "no"} />
                <Stat label="Vertex colours" value={s.hasVertexColors ? "yes" : "no"} />
                <Stat label="Size (x × y × z)" value={s.bounds ? s.bounds.size.map((v) => fmt(v)).join(" × ") : "—"} title="Axis-aligned bounds in file units (glTF uses metres)" />
              </dl>
            ) : (
              <p className="text-[12.5px] text-muted">Open a model to see its statistics. They come from the file itself, so they&rsquo;re shown even when it can&rsquo;t be displayed.</p>
            )}
          </section>

          {info?.meshes.length ? (
            <Listing label="Meshes" count={info.meshes.length}>
              {info.meshes.map((m, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate text-fg">
                    {m.name}
                    {m.skinned ? <span className="font-ocr text-[11px] text-muted"> · SKINNED</span> : null}
                    {m.morphs ? <span className="font-ocr text-[11px] text-muted"> · {m.morphs} MORPHS</span> : null}
                  </span>
                  <span className="shrink-0 font-ocr text-[11px] text-muted">{formatCount(m.triangles)} tris</span>
                </li>
              ))}
            </Listing>
          ) : null}

          {info?.materials.length ? (
            <Listing label="Materials" count={info.materials.length}>
              {info.materials.map((m, i) => (
                <li key={i}>
                  <span className="text-fg">{m.name}</span>
                  <span className="block font-ocr text-[11px] text-muted">
                    {m.type.replace(/^Mesh|Material$/g, "").toUpperCase()}
                    {m.maps.length ? ` · ${m.maps.join(", ")}` : " · no textures"}
                    {m.transparent ? " · blend" : ""}
                    {m.alphaTest ? ` · cutout ${m.alphaTest}` : ""}
                    {m.doubleSided ? " · double-sided" : ""}
                  </span>
                </li>
              ))}
            </Listing>
          ) : null}

          {info?.textures.length ? (
            <Listing label="Textures" count={info.textures.length}>
              {info.textures.map((t, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-fg">{t.name}</span>
                    <span className="block font-ocr text-[11px] text-muted">
                      {t.slots.join(", ")}
                      {t.nearest ? " · nearest" : " · linear"}
                    </span>
                  </span>
                  <span className={cn("shrink-0 font-ocr text-[11px]", isPowerOfTwo(t.width) && isPowerOfTwo(t.height) ? "text-muted" : "text-bright")}>
                    {t.width}×{t.height}
                    {isPowerOfTwo(t.width) && isPowerOfTwo(t.height) ? "" : " NPOT"}
                  </span>
                </li>
              ))}
            </Listing>
          ) : null}

          {anims.length ? (
            <Listing label="Animations" count={anims.length}>
              {anims.map((a, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="text-fg">{a.name}</span>
                  <span className="font-ocr text-[11px] text-muted">
                    {fmt(a.duration)} s · {a.tracks} track{a.tracks === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </Listing>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <>
      <dt className="text-muted" title={title}>
        {label}
      </dt>
      <dd className="text-right font-ocr text-fg">{value}</dd>
    </>
  );
}

function Listing({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="border border-rule-strong bg-panel p-3">
      <h2 className="type-panel mb-2">
        // {label} <span className="text-muted">{count}</span>
      </h2>
      {/* focusable so a long list can be scrolled from the keyboard */}
      <ul tabIndex={0} className="lp-scroll flex max-h-56 flex-col gap-1.5 overflow-y-auto text-[12.5px] outline-none focus-visible:ring-1 focus-visible:ring-bright">
        {children}
      </ul>
    </section>
  );
}

/** Plain-language flags for things that commonly go wrong in game assets. */
function warnings(l: Loaded): string[] {
  const s = l.stats,
    out: string[] = [];
  if (s.unsupportedExtensions.length) out.push(`Requires ${s.unsupportedExtensions.join(", ")}, which this viewer can't decode.`);
  const npot = (l.info?.textures ?? []).filter((t) => t.width && (!isPowerOfTwo(t.width) || !isPowerOfTwo(t.height)));
  if (npot.length) out.push(`${npot.length} texture${npot.length > 1 ? "s aren't" : " isn't"} a power of two; older engines and GPUs may refuse to mipmap or repeat ${npot.length > 1 ? "them" : "it"}.`);
  const big = (l.info?.textures ?? []).filter((t) => Math.max(t.width, t.height) > 2048);
  if (big.length) out.push(`${big.length} texture${big.length > 1 ? "s are" : " is"} larger than 2048 px.`);
  if (!s.hasNormals && s.sceneTriangles) out.push("No vertex normals: engines will compute them, which may not match the author's shading.");
  if (s.textures && !s.uvChannels) out.push("Textures but no UV coordinates: the textures can't be mapped.");
  if (s.sceneTriangles > 20000) out.push(`${formatCount(s.sceneTriangles)} triangles is a lot for a low-poly scene.`);
  if (s.drawCalls > 50) out.push(`${s.drawCalls} draw calls: merging meshes that share a material would reduce this.`);
  if (s.images.some((i) => i.external) && /\.glb$/i.test(l.name)) out.push("This GLB references external images, which won't travel with it.");
  if (s.bounds && Math.max(...s.bounds.size) > 1000) out.push("Over 1 km across: check the export scale (glTF units are metres).");
  if (s.bounds && Math.max(...s.bounds.size) < 0.01 && s.sceneTriangles) out.push("Under 1 cm across: check the export scale (glTF units are metres).");
  return out;
}
