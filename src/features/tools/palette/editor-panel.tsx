"use client";

import { Button } from "@/components/ui/button";
import { ColorField, NumberField, SegmentedControl } from "@/components/ui/controls";
import { Input, PromptInput, Toggle } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { hexToRgb, rgbToHex, type RGB } from "@/lib/processing/image";
import { confusablePairs, CVD_LABEL, harmony, HARMONIES, simulateCvd, type Cvd } from "@/lib/processing/palette";
import type { Doc, Settings, Swatch } from "./model";

interface Props {
  doc: Doc;
  selected: Swatch | null;
  settings: Settings;
  canUndo: boolean;
  onSelect: (id: number) => void;
  onRename: (name: string) => void;
  onChange: (id: number, patch: Partial<Swatch>, coalesce?: string) => void;
  onAdd: (rgb: RGB[]) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onUndo: () => void;
  onClear: () => void;
  onSettings: (patch: Partial<Settings>) => void;
}

const MAX = 256;

export function EditorPanel({ doc, selected, settings, canUndo, onSelect, onRename, onChange, onAdd, onMove, onRemove, onUndo, onClear, onSettings }: Props) {
  const idx = selected ? doc.colours.findIndex((c) => c.id === selected.id) : -1;
  const locked = doc.colours.filter((c) => c.locked).length;
  const full = doc.colours.length >= MAX;
  const cvd = settings.cvd === "none" ? null : settings.cvd;
  const pairs = cvd ? confusablePairs(doc.colours.map((c) => c.rgb), cvd) : [];

  return (
    <>
      <section aria-label="Palette" className="border border-rule-strong bg-panel p-3">
        <div className="mb-2.5 flex items-center gap-2">
          <h2 className="type-panel mr-auto">// Palette</h2>
          <Button size="sm" variant="ghost" disabled={!canUndo} onClick={onUndo}>
            Undo
          </Button>
          <Button size="sm" variant="ghost" disabled={!doc.colours.length} onClick={onClear}>
            Clear
          </Button>
        </div>
        <PromptInput aria-label="Palette name" placeholder="Name this palette" value={doc.name} onChange={(e) => onRename(e.target.value)} maxLength={80} spellCheck={false} />
        <p className="mt-2 font-ocr text-[11px] tracking-[0.06em] text-muted uppercase">
          &gt; {doc.colours.length} colour{doc.colours.length === 1 ? "" : "s"}
          {locked ? ` // ${locked} locked` : ""}
          {full ? " // full (256)" : ""}
        </p>
        {doc.colours.length ? (
          <ul aria-label="Colours" className="lp-scroll mt-2 max-h-[17rem] overflow-y-auto border border-rule-strong">
            {doc.colours.map((c, i) => (
              <li key={c.id} className={cn("flex items-center gap-2 border-t border-rule px-1.5 py-1 first:border-t-0", c.id === selected?.id && "bg-hover")}>
                <button
                  type="button"
                  aria-pressed={c.id === selected?.id}
                  onClick={() => onSelect(c.id)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                >
                  <span aria-hidden className="size-6 shrink-0 border border-black/50" style={{ background: rgbToHex(c.rgb) }} />
                  <span className="w-5 shrink-0 font-ocr text-[11px] text-muted">{i + 1}</span>
                  <span className="font-ocr text-[12px] text-fg uppercase">{rgbToHex(c.rgb)}</span>
                  <span className="min-w-0 truncate text-[12px] text-muted">{c.name}</span>
                </button>
                <Toggle pressed={!!c.locked} onPressedChange={(v) => onChange(c.id, { locked: v || undefined })} title={`Lock ${rgbToHex(c.rgb)}: keep it when extracting again`} className="h-6 px-1.5 text-[10px]">
                  Lock<span className="sr-only"> {rgbToHex(c.rgb)}</span>
                </Toggle>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[12.5px] leading-snug text-muted">Extract colours from an image, load a starter palette, import a file, or add colours one by one.</p>
        )}
        <Button size="sm" className="mt-2 w-full" disabled={full} onClick={() => onAdd([selected ? selected.rgb : [128, 128, 128]])}>
          + Add colour
        </Button>
      </section>

      {selected ? (
        <section aria-label="Selected colour" className="border border-rule-strong bg-panel p-3">
          <div className="mb-2.5 flex items-center gap-2">
            <h2 className="type-panel mr-auto">// Colour {idx + 1}</h2>
            <Button size="sm" variant="ghost" disabled={idx <= 0} onClick={() => onMove(-1)}>
              Move up
            </Button>
            <Button size="sm" variant="ghost" disabled={idx >= doc.colours.length - 1} onClick={() => onMove(1)}>
              Move down
            </Button>
          </div>
          <div className="flex flex-col gap-2.5">
            <ColorField label="Hex" value={rgbToHex(selected.rgb)} onChange={(hex) => onChange(selected.id, { rgb: hexToRgb(hex) }, `rgb-${selected.id}`)} />
            <div className="grid grid-cols-3 gap-2">
              {(["R", "G", "B"] as const).map((ch, k) => (
                <NumberField
                  key={ch}
                  label={ch}
                  value={selected.rgb[k]!}
                  min={0}
                  max={255}
                  onChange={(v) => {
                    const rgb = [...selected.rgb] as RGB;
                    rgb[k] = v;
                    onChange(selected.id, { rgb }, `rgb-${selected.id}`);
                  }}
                />
              ))}
            </div>
            <Input aria-label="Colour name" placeholder="Name (optional)" value={selected.name ?? ""} maxLength={60} onChange={(e) => onChange(selected.id, { name: e.target.value || undefined }, `name-${selected.id}`)} />
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" disabled={full} onClick={() => onAdd([selected.rgb])}>
                Duplicate
              </Button>
              <Button size="sm" variant="ghost" className="flex-1" onClick={onRemove}>
                Remove
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {selected ? (
        <section aria-label="Harmonies" className="border border-rule-strong bg-panel p-3">
          <h2 className="type-panel mb-2.5">// Harmonies</h2>
          <ul className="flex flex-col gap-1.5">
            {HARMONIES.map((h) => {
              const cols = harmony(selected.rgb, h.id);
              return (
                <li key={h.id} className="flex items-center gap-2" title={h.description}>
                  <span className="w-28 shrink-0 font-ocr text-[11px] tracking-[0.05em] text-muted uppercase">{h.label}</span>
                  <span className="flex flex-1 gap-px">
                    {[selected.rgb, ...cols].map((c, i) => (
                      <span key={i} className="h-5 flex-1 border border-black/40" style={{ background: rgbToHex(c) }} title={rgbToHex(c)} />
                    ))}
                  </span>
                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" disabled={doc.colours.length + cols.length > MAX} onClick={() => onAdd(cols)} aria-label={`Add ${h.label.toLowerCase()} colours`}>
                    Add
                  </Button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-[11.5px] leading-snug text-muted">Hues rotate in OKLCh, keeping the selected colour&rsquo;s lightness and chroma.</p>
        </section>
      ) : null}

      <section aria-label="Colour vision" className="border border-rule-strong bg-panel p-3">
        <h2 className="type-panel mb-2.5">// Colour vision</h2>
        <SegmentedControl
          label="Simulate"
          inline
          size="sm"
          value={settings.cvd}
          onChange={(v) => onSettings({ cvd: v })}
          options={[
            { value: "none", label: "Off" },
            { value: "protanopia", label: "Protan", title: CVD_LABEL.protanopia },
            { value: "deuteranopia", label: "Deutan", title: CVD_LABEL.deuteranopia },
            { value: "tritanopia", label: "Tritan", title: CVD_LABEL.tritanopia },
          ]}
        />
        {cvd && doc.colours.length ? (
          <>
            <div className="mt-2.5 flex gap-px" aria-hidden>
              {doc.colours.map((c) => (
                <span key={c.id} className="h-5 flex-1 border border-black/40" style={{ background: rgbToHex(simulateCvd(c.rgb, cvd as Cvd)) }} />
              ))}
            </div>
            <p role="status" className="mt-2 font-ocr text-[11px] tracking-[0.04em] text-muted uppercase">
              {pairs.length ? `! ${pairs.length} pair${pairs.length > 1 ? "s" : ""} hard to tell apart` : "> every pair stays distinguishable"}
            </p>
            {pairs.length ? (
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {pairs.slice(0, 12).map(([a, b]) => (
                  <li key={`${a}-${b}`} className="flex items-center gap-1 border border-rule-strong px-1.5 py-0.5 font-ocr text-[11px] text-muted">
                    <span aria-hidden className="size-3 border border-black/40" style={{ background: rgbToHex(doc.colours[a]!.rgb) }} />
                    {a + 1} ↔ {b + 1}
                    <span aria-hidden className="size-3 border border-black/40" style={{ background: rgbToHex(doc.colours[b]!.rgb) }} />
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-[11.5px] leading-snug text-muted">A simulation of full dichromacy (Machado et al. 2009). It also applies to the preview. It&rsquo;s a guide, not a test.</p>
          </>
        ) : null}
      </section>
    </>
  );
}
