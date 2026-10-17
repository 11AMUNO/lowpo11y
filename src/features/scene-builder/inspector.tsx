"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ColorField, NumberField, SegmentedControl, SliderField } from "@/components/ui/controls";
import { Field, Input, Select, Toggle } from "@/components/ui/form";
import { formatBytes, formatCount } from "@/lib/format";
import { byId, effective, reparent, snapTransform, subtree, updateNodes, setSettings } from "@/lib/scene/editor";
import { LIGHTING_PRESETS } from "@/lib/scene/presets";
import { IDENTITY, type MaterialSpec, type PrimitiveSpec, type SceneDoc, type SceneNode, type SceneSettings, type Transform, type Vec2, type Vec3 } from "@/lib/scene/schema";
import type { AssetState } from "./runtime";

/** Records an edit; edits sharing a merge key in quick succession are one undo step. */
export type Edit = (next: SceneDoc, label: string, merge?: string) => void;

const AXES = ["X", "Y", "Z"] as const;

function Section({ id, title, aside, children }: { id: string; title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border border-rule-strong bg-panel p-3">
      <div className="mb-2.5 flex items-center gap-2">
        <h2 id={id} className="type-panel mr-auto min-w-0 truncate">
          // {title}
        </h2>
        {aside}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function VecField<T extends Vec2 | Vec3>({ label, value, onChange, step, min, max, axes, disabled }: { label: string; value: T; onChange: (v: T) => void; step: number; min?: number; max?: number; axes?: readonly string[]; disabled?: boolean }) {
  const names = axes ?? AXES;
  return (
    <fieldset className="flex min-w-0 flex-col gap-1" disabled={disabled}>
      <legend className="type-label mb-1">{label}</legend>
      <div className={value.length === 3 ? "grid grid-cols-3 gap-2" : "grid grid-cols-2 gap-2"}>
        {value.map((v, i) => (
          <NumberField
            key={names[i]}
            label={
              <>
                <span className="sr-only">{label} </span>
                {names[i]}
              </>
            }
            value={v}
            step={step}
            min={min}
            max={max}
            disabled={disabled}
            className="min-w-0"
            boxClassName="w-0 min-w-0 flex-[4]"
            onChange={(n) => {
              const next = [...value] as T;
              next[i] = n;
              onChange(next);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}

/* ---------------------------------------------------------------- object */

export function ObjectInspector({
  doc,
  selection,
  live,
  assets,
  edit,
  onAction,
}: {
  doc: SceneDoc;
  selection: string[];
  /** The transform while the gizmo drags it. */
  live: { id: string; t: Transform } | null;
  assets: Map<string, AssetState>;
  edit: Edit;
  onAction: (a: "duplicate" | "delete" | "group" | "ungroup" | "focus") => void;
}) {
  const nodes = byId(doc);
  const picked = selection.map((id) => nodes.get(id)).filter((n): n is SceneNode => !!n);

  if (!picked.length)
    return (
      <Section id="sb-object" title="Object">
        <p className="text-[13px] text-muted">Select an object in the viewport or the list. Shift-click adds to the selection; Ctrl+A selects everything.</p>
      </Section>
    );

  const actions = (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" onClick={() => onAction("focus")} title="F">
        Focus
      </Button>
      <Button size="sm" onClick={() => onAction("duplicate")} title="Ctrl+D">
        Duplicate
      </Button>
      <Button size="sm" onClick={() => onAction("group")} title="Ctrl+G">
        Group
      </Button>
      {picked.some((n) => n.type === "group") ? (
        <Button size="sm" onClick={() => onAction("ungroup")} title="Ctrl+Shift+G">
          Ungroup
        </Button>
      ) : null}
      <Button size="sm" variant="danger" onClick={() => onAction("delete")} title="Delete">
        Delete
      </Button>
    </div>
  );

  if (picked.length > 1) {
    const ids = picked.map((n) => n.id);
    const allHidden = picked.every((n) => !n.visible);
    const allLocked = picked.every((n) => n.locked);
    return (
      <Section id="sb-object" title={`${picked.length} objects`}>
        <p className="text-[13px] text-muted">The gizmo moves the last one you picked. Group them to move them together.</p>
        <div className="flex flex-wrap gap-1.5">
          <Toggle pressed={allHidden} onPressedChange={(on) => edit(updateNodes(doc, ids, () => ({ visible: !on })), on ? "Hide objects" : "Show objects")}>
            Hidden
          </Toggle>
          <Toggle pressed={allLocked} onPressedChange={(on) => edit(updateNodes(doc, ids, () => ({ locked: on })), on ? "Lock objects" : "Unlock objects")}>
            Locked
          </Toggle>
        </div>
        {actions}
      </Section>
    );
  }

  const n = picked[0]!;
  const t = live?.id === n.id ? live.t : n.transform;
  const { locked: lockedByParent } = effective(doc, n.id);
  const locked = n.locked || lockedByParent;
  const asset = n.asset ? doc.assets.find((a) => a.id === n.asset) : undefined;
  const state = n.asset ? assets.get(n.asset) : undefined;
  const label = n.name || "object";
  const setT = (patch: Partial<Transform>, what: string, key: string) => edit(updateNodes(doc, [n.id], () => ({ transform: { ...t, ...patch } })), `${what} ${label}`, `${key}:${n.id}`);

  // Groups (and the current parent) the object can go into: never itself or anything inside it.
  const inside = subtree(doc, [n.id]);
  const parents = doc.nodes.filter((x) => !inside.has(x.id) && (x.type === "group" || x.id === n.parent));

  return (
    <Section id="sb-object" title={n.type === "group" ? "Group" : n.type === "model" ? "Model" : "Blockout"} aside={<span className="font-ocr text-[11px] text-muted">{n.type === "primitive" ? n.primitive?.shape : null}</span>}>
      <Field label="Name">
        <Input value={n.name} maxLength={120} onChange={(e) => edit(updateNodes(doc, [n.id], () => ({ name: e.target.value })), `Rename ${label}`, `name:${n.id}`)} />
      </Field>

      {n.type === "model" ? (
        <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1 text-[13px]">
          <dt className="text-muted">File</dt>
          <dd className="break-all text-fg">{asset?.name ?? "missing from the scene file"}</dd>
          <dt className="text-muted">From</dt>
          <dd className="text-fg">
            {asset?.source === "library" && asset.slug ? (
              <Link href={`/assets/${asset.slug}`} className="text-bright underline underline-offset-4" target="_blank">
                LOWPO11Y library
              </Link>
            ) : (
              "This device"
            )}
            {asset?.licence ? ` // ${asset.licence}` : ""}
          </dd>
          <dt className="text-muted">Triangles</dt>
          <dd className="text-fg">{state?.status === "ready" ? formatCount(state.triangles) : state?.status === "loading" ? "loading…" : "—"}</dd>
          {asset?.bytes ? (
            <>
              <dt className="text-muted">Size</dt>
              <dd className="text-fg">{formatBytes(asset.bytes)}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {n.type === "model" && (!state || state.status === "failed") ? (
        <p role="alert" className="border border-bright px-2 py-1.5 text-xs text-bright">
          ! {state?.status === "failed" ? state.message : "This object's model isn't in the scene file."} It shows as a wire box and is left out of exports.
        </p>
      ) : null}
      {state?.status === "ready" && state.warnings.length ? (
        <ul aria-label="Model warnings" className="flex flex-col gap-0.5 text-xs text-muted">
          {state.warnings.map((w) => (
            <li key={w}>&gt; {w}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        <Toggle pressed={!n.visible} onPressedChange={(on) => edit(updateNodes(doc, [n.id], () => ({ visible: !on })), `${on ? "Hide" : "Show"} ${label}`)} title="H">
          Hidden
        </Toggle>
        <Toggle pressed={n.locked} onPressedChange={(on) => edit(updateNodes(doc, [n.id], () => ({ locked: on })), `${on ? "Lock" : "Unlock"} ${label}`)} title="L">
          Locked
        </Toggle>
      </div>
      {locked ? <p className="type-data text-muted">{n.locked ? "Locked: unlock it to move or edit it." : "Inside a locked group: unlock the group to edit it."}</p> : null}

      <Field label="Parent">
        <Select value={n.parent ?? ""} disabled={locked} onChange={(e) => edit(reparent(doc, [n.id], e.target.value || null), `Move ${label} into ${e.target.value ? (nodes.get(e.target.value)?.name ?? "group") : "the top level"}`)}>
          <option value="">Top level</option>
          {parents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || "Untitled"}
            </option>
          ))}
        </Select>
      </Field>

      <VecField label="Position" value={t.position} step={0.01} disabled={locked} onChange={(v) => setT({ position: v }, "Move", "pos")} />
      <VecField label="Rotation" value={t.rotation} step={0.5} disabled={locked} onChange={(v) => setT({ rotation: v }, "Rotate", "rot")} />
      <VecField label="Scale" value={t.scale} step={0.01} min={-1000} max={1000} disabled={locked} onChange={(v) => setT({ scale: v }, "Scale", "scl")} />
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" disabled={locked} onClick={() => edit(updateNodes(doc, [n.id], () => ({ transform: snapTransform(t, doc.settings.grid) })), `Snap ${label} to the grid`)}>
          Snap to grid
        </Button>
        <Button size="sm" variant="ghost" disabled={locked} onClick={() => edit(updateNodes(doc, [n.id], () => ({ transform: { ...IDENTITY, position: t.position } })), `Reset rotation and scale of ${label}`)}>
          Reset rotation + scale
        </Button>
      </div>

      {n.type === "primitive" && n.primitive ? <PrimitiveFields node={n} spec={n.primitive} doc={doc} edit={edit} disabled={locked} /> : null}
      {n.type === "primitive" ? <MaterialFields node={n} spec={n.material!} doc={doc} edit={edit} assets={assets} disabled={locked} /> : null}
      {actions}
    </Section>
  );
}

function PrimitiveFields({ node: n, spec, doc, edit, disabled }: { node: SceneNode; spec: PrimitiveSpec; doc: SceneDoc; edit: Edit; disabled: boolean }) {
  const set = (patch: Partial<PrimitiveSpec>, key: string) => edit(updateNodes(doc, [n.id], () => ({ primitive: { ...spec, ...patch } })), `Resize ${n.name || "shape"}`, `${key}:${n.id}`);
  const size = (k: "width" | "height" | "depth", label: string) => <NumberField key={k} label={label} value={spec[k]} min={0.01} max={10000} step={0.05} unit="m" disabled={disabled} onChange={(v) => set({ [k]: v }, k)} />;
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="type-label mb-1">Size</legend>
      {spec.shape === "plane" ? [size("width", "Width"), size("depth", "Depth")] : spec.shape === "cylinder" ? [size("width", "Diameter"), size("height", "Height")] : [size("width", "Width"), size("height", "Height"), size("depth", "Depth")]}
      {spec.shape === "cylinder" ? <SliderField label="Sides" value={spec.segments} min={3} max={32} onChange={(v) => set({ segments: v }, "seg")} disabled={disabled} /> : null}
    </fieldset>
  );
}

function MaterialFields({ node: n, spec, doc, edit, assets, disabled }: { node: SceneNode; spec: MaterialSpec; doc: SceneDoc; edit: Edit; assets: Map<string, AssetState>; disabled: boolean }) {
  const set = (patch: Partial<MaterialSpec>, what: string, key: string) => edit(updateNodes(doc, [n.id], () => ({ material: { ...spec, ...patch } })), `${what} ${n.name || "shape"}`, `${key}:${n.id}`);
  const tex = spec.texture ? doc.assets.find((a) => a.id === spec.texture) : undefined;
  const texState = spec.texture ? assets.get(spec.texture) : undefined;
  return (
    <fieldset className="flex flex-col gap-2.5" disabled={disabled}>
      <legend className="type-label mb-1">Surface</legend>
      <ColorField label="Colour" value={spec.color} onChange={(c) => set({ color: c }, "Colour", "col")} />
      <div className="flex items-center gap-2 text-[13px]">
        <span className="type-label">Texture</span>
        <span className="min-w-0 flex-1 truncate text-right text-fg" title={tex?.name}>
          {tex ? tex.name : "none (Assets → Textures)"}
        </span>
        {tex ? (
          <Button size="sm" variant="ghost" onClick={() => set({ texture: null }, "Remove texture from", "tex")}>
            Remove
          </Button>
        ) : null}
      </div>
      {texState?.status === "failed" ? <p className="text-xs text-bright">! {texState.message}</p> : null}
      {tex ? (
        <>
          <VecField label="Repeat" value={spec.repeat} axes={["U", "V"]} step={0.25} min={0.01} max={1000} disabled={disabled} onChange={(v) => set({ repeat: v }, "Texture repeat on", "rep")} />
          <VecField label="Offset" value={spec.offset} axes={["U", "V"]} step={0.05} min={-1000} max={1000} disabled={disabled} onChange={(v) => set({ offset: v }, "Texture offset on", "off")} />
          <Toggle pressed={spec.pixelated} onPressedChange={(on) => set({ pixelated: on }, on ? "Crisp texels on" : "Smooth texels on", "pix")} className="self-start" title="Nearest filtering keeps each texel a sharp square">
            Crisp texels
          </Toggle>
        </>
      ) : null}
      <SliderField label="Roughness" value={spec.roughness} min={0} max={1} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => set({ roughness: v }, "Roughness of", "rough")} disabled={disabled} />
    </fieldset>
  );
}

/* ----------------------------------------------------------------- scene */

const SNAPS = ["0", "0.1", "0.25", "0.5", "1"];
const ANGLES = ["0", "5", "15", "45", "90"];
const SCALES = ["0", "0.05", "0.1", "0.25"];

export function SceneSettingsPanel({ doc, edit }: { doc: SceneDoc; edit: Edit }) {
  const s = doc.settings;
  const set = (fn: (s: SceneSettings) => SceneSettings, label: string, key?: string) => edit(setSettings(doc, fn), label, key ? `set:${key}` : undefined);
  return (
    <>
      <Section id="sb-scene" title="Scene">
        <Field label="Scene name" hint="Used for the file names when you save or export.">
          <Input value={doc.name} maxLength={120} onChange={(e) => edit({ ...doc, name: e.target.value }, "Rename scene", "scene-name")} />
        </Field>
        <Field label="Lighting preset" hint="Sets the background, lights and fog. Undo puts them back.">
          <Select
            value=""
            onChange={(e) => {
              const p = LIGHTING_PRESETS.find((x) => x.id === e.target.value);
              if (p) set(p.apply, `Lighting: ${p.name}`);
            }}
          >
            <option value="">Choose a preset…</option>
            {LIGHTING_PRESETS.map((p) => (
              <option key={p.id} value={p.id} title={p.description}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <ColorField label="Background" value={s.background} onChange={(c) => set((x) => ({ ...x, background: c }), "Background colour", "bg")} />
        <fieldset className="flex flex-col gap-2">
          <legend className="type-label mb-1">Ambient light</legend>
          <ColorField label="Ambient colour" value={s.ambient.color} onChange={(c) => set((x) => ({ ...x, ambient: { ...x.ambient, color: c } }), "Ambient colour", "amb-c")} />
          <SliderField label="Strength" value={s.ambient.intensity} min={0} max={3} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => set((x) => ({ ...x, ambient: { ...x.ambient, intensity: v } }), "Ambient strength", "amb-i")} />
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="type-label mb-1">Sun</legend>
          <ColorField label="Sun colour" value={s.sun.color} onChange={(c) => set((x) => ({ ...x, sun: { ...x.sun, color: c } }), "Sun colour", "sun-c")} />
          <SliderField label="Strength" value={s.sun.intensity} min={0} max={5} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => set((x) => ({ ...x, sun: { ...x.sun, intensity: v } }), "Sun strength", "sun-i")} />
          <SliderField label="Direction" value={s.sun.azimuth} min={-180} max={180} unit="°" onChange={(v) => set((x) => ({ ...x, sun: { ...x.sun, azimuth: v } }), "Sun direction", "sun-a")} />
          <SliderField label="Height" value={s.sun.elevation} min={0} max={90} unit="°" onChange={(v) => set((x) => ({ ...x, sun: { ...x.sun, elevation: v } }), "Sun height", "sun-e")} />
          <Toggle pressed={s.sun.shadows} onPressedChange={(on) => set((x) => ({ ...x, sun: { ...x.sun, shadows: on } }), on ? "Shadows on" : "Shadows off")} className="self-start">
            Shadows
          </Toggle>
          {s.sun.shadows ? <p className="type-data text-muted">Shadows cost a lot on big scenes; turn them off if the view gets slow. They&apos;re a viewport preview and aren&apos;t exported.</p> : null}
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="type-label mb-1">Fog</legend>
          <Toggle pressed={s.fog.enabled} onPressedChange={(on) => set((x) => ({ ...x, fog: { ...x.fog, enabled: on } }), on ? "Fog on" : "Fog off")} className="self-start">
            Fog
          </Toggle>
          {s.fog.enabled ? (
            <>
              <ColorField label="Fog colour" value={s.fog.color} onChange={(c) => set((x) => ({ ...x, fog: { ...x.fog, color: c } }), "Fog colour", "fog-c")} />
              <SliderField label="Starts at" value={s.fog.near} min={0} max={200} step={0.5} unit=" m" onChange={(v) => set((x) => ({ ...x, fog: { ...x.fog, near: v, far: Math.max(v + 0.5, x.fog.far) } }), "Fog start", "fog-n")} />
              <SliderField label="Solid at" value={s.fog.far} min={0.5} max={400} step={0.5} unit=" m" onChange={(v) => set((x) => ({ ...x, fog: { ...x.fog, far: v, near: Math.min(x.fog.near, v - 0.5) } }), "Fog end", "fog-f")} />
            </>
          ) : null}
        </fieldset>
      </Section>

      <Section id="sb-grid" title="Grid + snapping">
        <SegmentedControl label="Move snap (m)" size="sm" value={String(s.grid.snap)} onChange={(v) => set((x) => ({ ...x, grid: { ...x.grid, snap: Number(v) } }), "Move snap")} options={SNAPS.map((v) => ({ value: v, label: v === "0" ? "Off" : v }))} />
        <SegmentedControl label="Rotate snap (°)" size="sm" value={String(s.grid.angle)} onChange={(v) => set((x) => ({ ...x, grid: { ...x.grid, angle: Number(v) } }), "Rotate snap")} options={ANGLES.map((v) => ({ value: v, label: v === "0" ? "Off" : v }))} />
        <SegmentedControl label="Scale snap" size="sm" value={String(s.grid.scale)} onChange={(v) => set((x) => ({ ...x, grid: { ...x.grid, scale: Number(v) } }), "Scale snap")} options={SCALES.map((v) => ({ value: v, label: v === "0" ? "Off" : v }))} />
        <p className="type-data text-muted">The gizmo and dropped assets snap to these steps. Typed values are kept as typed.</p>
      </Section>

      <Section id="sb-retro" title="Retro preview">
        <Toggle pressed={s.retro.enabled} onPressedChange={(on) => set((x) => ({ ...x, retro: { ...x.retro, enabled: on } }), on ? "Retro preview on" : "Retro preview off")} className="self-start">
          Retro preview
        </Toggle>
        <SegmentedControl
          label="Resolution"
          size="sm"
          value={String(s.retro.height)}
          onChange={(v) => set((x) => ({ ...x, retro: { ...x.retro, height: Number(v) } }), "Retro resolution")}
          options={[
            { value: "224", label: "224p", title: "Close to many PlayStation games" },
            { value: "240", label: "240p" },
            { value: "360", label: "360p" },
            { value: "480", label: "480p", title: "PlayStation's high-resolution mode" },
          ]}
        />
        <SliderField label="Colour levels" value={s.retro.levels} min={2} max={64} hint="Per channel. 32 is the PlayStation's 15-bit colour." onChange={(v) => set((x) => ({ ...x, retro: { ...x.retro, levels: v } }), "Colour levels", "levels")} />
        <Toggle pressed={s.retro.dither} onPressedChange={(on) => set((x) => ({ ...x, retro: { ...x.retro, dither: on } }), on ? "Dither on" : "Dither off")} className="self-start">
          Dither
        </Toggle>
        <SliderField label="Vertex snap" value={s.retro.jitter} min={0} max={480} step={8} format={(v) => (v ? String(v) : "OFF")} hint="Rounds vertices to a coarse screen grid, the PS1 wobble. Lower is stronger." onChange={(v) => set((x) => ({ ...x, retro: { ...x.retro, jitter: v } }), "Vertex snap", "jitter")} />
        <p className="type-data text-muted">The preview only changes the viewport; exports are clean geometry.</p>
      </Section>
    </>
  );
}
