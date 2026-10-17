"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SegmentedControl, SliderField } from "@/components/ui/controls";
import { Toggle } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { parseControls, splitStages } from "./parse";
import type { PreviewResolution, ShaderPreviewView } from "./view";

type State = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string; compile: boolean };

/**
 * Compiles the entry's own GLSL in the visitor's browser and draws a small
 * scene with it. Only for three.js entries that follow the two-stage file
 * convention; everything else shows code and download only.
 */
export function ShaderPreview({ code, note = "The scene uses LOWPO11Y's demo textures; the shader is exactly the code below." }: { code: string; note?: string }) {
  const stages = useMemo(() => splitStages(code), [code]);
  const controls = useMemo(() => parseControls(code), [code]);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ShaderPreviewView | null>(null);
  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(controls.map((c) => [c.name, c.value])));
  const [resolution, setResolution] = useState<PreviewResolution>("240");
  const [compare, setCompare] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [state, setState] = useState<State>({ kind: "loading" });
  const initial = useRef(values);

  useEffect(() => {
    if (!stages || !hostRef.current) return;
    let cancelled = false;
    const host = hostRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    import("./view")
      .then(({ createShaderPreview }) => {
        if (cancelled) return;
        const view = createShaderPreview(host, { autoRotate: !reduce });
        viewRef.current = view;
        if (reduce) {
          view.setPlaying(false);
          setPlaying(false);
        }
        const error = view.setShader(stages, initial.current);
        setState(error ? { kind: "error", message: error, compile: true } : { kind: "ready" });
      })
      .catch((e: unknown) => !cancelled && setState({ kind: "error", message: e instanceof Error ? e.message : "The preview couldn't start.", compile: false }));
    return () => {
      cancelled = true;
      viewRef.current?.dispose();
      viewRef.current = null;
    };
  }, [stages]);

  if (!stages) return null;

  const set = (name: string, v: number) => {
    setValues((s) => ({ ...s, [name]: v }));
    viewRef.current?.setValue(name, v);
  };

  return (
    <Panel title="Live preview" aside={<span className="font-ocr text-[11px] tracking-[0.06em] text-muted uppercase">WebGL // your browser</span>}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="relative aspect-[4/3] overflow-hidden border border-rule-strong bg-sunken" ref={hostRef} data-preview-state={state.kind}>
          {state.kind === "loading" ? <p className="absolute inset-0 grid place-items-center font-ocr text-xs text-muted">COMPILING SHADER…</p> : null}
          {state.kind === "error" ? (
            <div role="alert" className="absolute inset-0 overflow-auto bg-sunken p-3">
              <p className="font-ocr text-xs tracking-[0.06em] text-bright uppercase">! {state.compile ? "This shader didn't compile in your browser" : "Preview unavailable"}</p>
              <pre className="mt-2 font-mono text-[11.5px] whitespace-pre-wrap text-fg">{state.message}</pre>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-3" aria-label="Preview controls" role="group">
          {controls.map((c) => (
            <SliderField
              key={c.name}
              label={c.label}
              value={values[c.name] ?? c.value}
              min={c.min}
              max={c.max}
              step={c.step}
              format={(v) => (c.step < 1 ? v.toFixed(2) : String(v))}
              onChange={(v) => set(c.name, v)}
              disabled={state.kind !== "ready" || compare}
            />
          ))}
          <SegmentedControl
            label="Render size"
            value={resolution}
            onChange={(r) => {
              setResolution(r);
              viewRef.current?.setResolution(r);
            }}
            options={[
              { value: "240", label: "240p" },
              { value: "480", label: "480p" },
              { value: "full", label: "Full" },
            ]}
            size="sm"
          />
          <div className="flex flex-wrap gap-2">
            <Toggle
              pressed={compare}
              disabled={state.kind !== "ready"}
              title="Draw the scene with three.js's standard unlit material and fog, for comparison"
              onPressedChange={(on) => {
                setCompare(on);
                viewRef.current?.setCompare(on);
              }}
            >
              Compare: standard
            </Toggle>
            <Toggle
              pressed={!playing}
              disabled={state.kind !== "ready"}
              onPressedChange={(paused) => {
                setPlaying(!paused);
                viewRef.current?.setPlaying(!paused);
              }}
            >
              Pause
            </Toggle>
          </div>
          <p className="text-xs leading-relaxed text-muted">Drag to orbit, scroll to zoom. {note}</p>
        </div>
      </div>
    </Panel>
  );
}
