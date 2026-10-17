"use client";

import { ColorField, NumberField, SegmentedControl, SliderField } from "@/components/ui/controls";
import { Field, Select, Textarea, Toggle } from "@/components/ui/form";
import type { FieldSpec } from "@/lib/workshop/steps";

/** Renders a step's settings from its field specs, hiding fields whose `when` doesn't hold. */
export function StepForm({ fields, values, onChange, idPrefix }: { fields: FieldSpec[]; values: Record<string, unknown>; onChange: (key: string, value: unknown) => void; idPrefix: string }) {
  return (
    <div className="flex flex-col gap-3">
      {fields
        .filter((f) => !f.when || f.when(values))
        .map((f) => {
          const key = `${idPrefix}-${f.key}-${f.label}`;
          const v = values[f.key];
          switch (f.kind) {
            case "slider":
              return (
                <SliderField
                  key={key}
                  label={f.label}
                  value={Number(v)}
                  min={f.min}
                  max={f.max}
                  step={f.step ?? 1}
                  unit={f.unit}
                  hint={f.hint}
                  format={(n) => ((f.step ?? 1) < 1 ? n.toFixed(2) : String(n))}
                  onChange={(n) => onChange(f.key, n)}
                />
              );
            case "number":
              return <NumberField key={key} label={f.label} value={Number(v)} min={f.min} max={f.max} step={f.step ?? 1} unit={f.unit} hint={f.hint} onChange={(n) => onChange(f.key, n)} />;
            case "toggle":
              return (
                <div key={key} className="flex flex-col gap-1">
                  <Toggle pressed={v === true} onPressedChange={(on) => onChange(f.key, on)} className="self-start text-left normal-case">
                    {f.label}
                  </Toggle>
                  {f.hint ? <p className="type-data text-muted">{f.hint}</p> : null}
                </div>
              );
            case "colour":
              return <ColorField key={key} label={f.label} value={String(v)} onChange={(hex) => onChange(f.key, hex)} />;
            case "text":
              return (
                <Field key={key} label={f.label} hint={f.hint}>
                  <Textarea value={String(v ?? "")} rows={f.rows ?? 3} spellCheck={false} onChange={(e) => onChange(f.key, e.target.value)} className="font-ocr text-[12px]" />
                </Field>
              );
            case "select":
              return f.options.length <= 3 && f.options.every((o) => o.label.length <= 10) ? (
                <SegmentedControl key={key} label={f.label} size="sm" value={String(v)} onChange={(x) => onChange(f.key, x)} options={f.options.map((o) => ({ value: o.value, label: o.label }))} />
              ) : (
                <Field key={key} label={f.label} hint={f.hint}>
                  <Select value={String(v)} onChange={(e) => onChange(f.key, e.target.value)}>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              );
          }
        })}
    </div>
  );
}
