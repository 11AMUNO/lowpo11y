"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Notice, Progress } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Panel } from "@/components/ui/panel";
import { toast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api-client";
import { ASSET_TYPE_LABEL, PROVENANCE_KINDS, PROVENANCE_LABEL } from "@/lib/assets/schemas";
import type { ImportPlanReport } from "@/lib/assets/import";
import { formatBytes, pluralise } from "@/lib/format";
import { uploadAssetFile } from "../upload";

interface Option {
  id: string;
  code: string;
  label: string;
}

interface PlanResponse {
  jobId: string;
  report: ImportPlanReport;
  create: Record<string, unknown>[];
  ignored: string[];
  manifestProblems: string[];
}

type RunState = { status: "waiting" | "running" | "created" | "skipped" | "failed"; message?: string; slug?: string; assetId?: string; progress?: number };

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Paths relative to the chosen folder (the folder's own name is dropped). */
function relativePaths(files: File[]): Map<string, File> {
  const raw = files.map((f) => [(f.webkitRelativePath || f.name).replace(/\\/g, "/"), f] as const);
  const first = raw[0]?.[0].split("/")[0];
  const shared = raw.length > 0 && raw.every(([p]) => p.includes("/") && p.split("/")[0] === first);
  return new Map(raw.map(([p, f]) => [shared ? p.slice(first!.length + 1) : p, f]));
}

export function ImportWizard({ licences, categories }: { licences: Option[]; categories: Option[] }) {
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<Map<string, File>>(new Map());
  const [manifest, setManifest] = useState<{ name: string; text: string; format: "json" | "csv" } | null>(null);
  const [defaults, setDefaults] = useState({ licence: "", category: "", provenance: "", provenanceNotes: "", tags: "" });
  const [hashing, setHashing] = useState<number | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [run, setRun] = useState<Record<number, RunState>>({});
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  const totalBytes = [...selection.values()].reduce((n, f) => n + f.size, 0);
  const pick = (list: FileList | null) => {
    if (!list?.length) return;
    setSelection(relativePaths([...list]));
    setPlan(null);
    setRun({});
    setFinished(false);
  };

  async function makePlan() {
    setPlan(null);
    setRun({});
    setFinished(false);
    try {
      const files = [];
      let i = 0;
      for (const [path, f] of selection) {
        setHashing(i++ / selection.size);
        files.push({ path, size: f.size, sha256: await sha256(f) });
      }
      setHashing(null);
      const r = await api<PlanResponse>("/api/admin/import/plan", {
        body: {
          files,
          defaults: {
            licence: defaults.licence || undefined,
            category: defaults.category || undefined,
            provenance: defaults.provenance || undefined,
            provenanceNotes: defaults.provenanceNotes || undefined,
            tags: defaults.tags,
          },
          manifest: manifest ? { text: manifest.text, format: manifest.format } : undefined,
        },
      });
      setPlan(r);
    } catch (e) {
      setHashing(null);
      toast.error("Couldn't plan the import", e instanceof ApiError ? e.message : undefined);
    }
  }

  async function runPlan() {
    if (!plan) return;
    setRunning(true);
    const results: { title: string; status: "created" | "skipped" | "failed"; slug?: string; message?: string }[] = [];
    const set = (i: number, s: RunState) => setRun((r) => ({ ...r, [i]: s }));
    for (const v of plan.report.entries) {
      if (v.duplicateOf) {
        set(v.index, { status: "skipped", message: `Already imported as ${v.duplicateOf.slug}`, slug: v.duplicateOf.slug });
        results.push({ title: v.title, status: "skipped", slug: v.duplicateOf.slug });
        continue;
      }
      if (v.problems.length) {
        set(v.index, { status: "failed", message: v.problems.join(" ") });
        results.push({ title: v.title, status: "failed", message: v.problems.join(" ") });
        continue;
      }
      set(v.index, { status: "running", progress: 0 });
      try {
        const created = await api<{ id: string; slug: string }>("/api/admin/assets", { body: plan.create[v.index] });
        const warnings: string[] = [];
        for (const [n, f] of v.files.entries()) {
          const file = selection.get(f.path);
          if (!file) throw new Error(`${f.path} is no longer selected.`);
          try {
            const r = await uploadAssetFile(created.id, f.purpose, file, { primary: f.primary, onProgress: (p) => set(v.index, { status: "running", progress: (n + p) / (v.files.length + 1) }) });
            warnings.push(...r.warnings);
          } catch (e) {
            warnings.push(`${f.path}: ${e instanceof ApiError ? e.message : "upload failed"}`);
          }
        }
        set(v.index, { status: "running", progress: v.files.length / (v.files.length + 1), message: "Generating previews…" });
        const d = await api<{ warnings: string[] }>(`/api/admin/assets/${created.id}/derive`, { body: { textureVariants: true } });
        warnings.push(...d.warnings);
        set(v.index, { status: "created", slug: created.slug, assetId: created.id, message: warnings.join(" ") || undefined });
        results.push({ title: v.title, status: "created", slug: created.slug, message: warnings.join(" ").slice(0, 2000) || undefined });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Failed.";
        set(v.index, { status: "failed", message });
        results.push({ title: v.title, status: "failed", message });
      }
    }
    await api(`/api/admin/import/jobs/${plan.jobId}`, { method: "PATCH", body: { status: "completed", results } }).catch(() => {});
    setRunning(false);
    setFinished(true);
    const n = results.filter((r) => r.status === "created").length;
    toast.ok(`Imported ${pluralise(n, "draft")}`);
  }

  const counts = plan?.report;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Panel title="Choose files">
          <div className="flex flex-col gap-3">
            <p className="text-[13px] leading-relaxed text-muted">
              Choose a folder: each sub-folder holding one model (with its textures, such as an FBX and its .fbm folder) becomes one asset, and loose images become one texture each.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => folderRef.current?.click()} disabled={running}>
                Choose folder
              </Button>
              <Button variant="ghost" onClick={() => filesRef.current?.click()} disabled={running}>
                Choose files
              </Button>
              <input
                ref={folderRef}
                type="file"
                className="sr-only"
                tabIndex={-1}
                aria-label="Folder to import"
                multiple
                {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                onChange={(e) => pick(e.target.files)}
              />
              <input ref={filesRef} type="file" className="sr-only" tabIndex={-1} aria-label="Files to import" multiple onChange={(e) => pick(e.target.files)} />
            </div>
            <p className="font-ocr text-[11px] tracking-[0.06em] text-muted uppercase">
              {selection.size ? `${pluralise(selection.size, "file")} // ${formatBytes(totalBytes)}` : "Nothing selected"}
            </p>
            <Field label="Manifest (optional)" hint="JSON or CSV listing each asset's title, type, files and licence. Overrides folder grouping.">
              <Input
                type="file"
                accept=".json,.csv,application/json,text/csv"
                className="h-auto py-1.5"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  setManifest(f ? { name: f.name, text: await f.text(), format: f.name.toLowerCase().endsWith(".csv") ? "csv" : "json" } : null);
                  setPlan(null);
                }}
              />
            </Field>
          </div>
        </Panel>

        <Panel title="Defaults for every asset">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Licence" hint="Leave unset unless every file is covered. Drafts can't publish without one.">
              <Select value={defaults.licence} onChange={(e) => setDefaults({ ...defaults, licence: e.target.value })}>
                <option value="">Not set</option>
                {licences.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Category">
              <Select value={defaults.category} onChange={(e) => setDefaults({ ...defaults, category: e.target.value })}>
                <option value="">Not set</option>
                {categories.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Provenance">
              <Select value={defaults.provenance} onChange={(e) => setDefaults({ ...defaults, provenance: e.target.value })}>
                <option value="">Not recorded</option>
                {PROVENANCE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {PROVENANCE_LABEL[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tags" hint="Comma-separated, added to every asset.">
              <Input value={defaults.tags} onChange={(e) => setDefaults({ ...defaults, tags: e.target.value })} />
            </Field>
            <Field label="Provenance notes" className="sm:col-span-2" hint="Facts only: who made it, with which tool or plan, under what agreement.">
              <Textarea rows={2} value={defaults.provenanceNotes} onChange={(e) => setDefaults({ ...defaults, provenanceNotes: e.target.value })} />
            </Field>
          </div>
        </Panel>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" disabled={!selection.size || hashing !== null || running} onClick={makePlan}>
          {hashing !== null ? "Checking files…" : "Plan import"}
        </Button>
        {hashing !== null ? <Progress value={hashing} label="Checksums" className="w-72" /> : null}
        <p className="text-xs text-muted">Planning is a dry run: nothing is created until you confirm.</p>
      </div>

      {plan ? (
        <Panel title="Review and import">
          {plan.manifestProblems.length ? (
            <Notice tone="warn" title="Manifest problems" className="mb-3">
              <ul>
                {plan.manifestProblems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          <p className="mb-3 font-ocr text-[12px] tracking-[0.06em] text-muted uppercase">
            &gt; {counts!.ready} ready // {counts!.duplicates} already imported // {counts!.blocked} blocked
            {plan.ignored.length ? ` // ${plan.ignored.length} files ignored` : ""}
          </p>
          <div className="lp-scroll max-h-[60vh] overflow-auto border border-rule-strong">
            <table className="w-full border-collapse text-[13px]">
              <thead className="sticky top-0 bg-panel text-left">
                <tr>
                  <th scope="col" className="type-label h-9 px-3 font-normal">
                    Asset
                  </th>
                  <th scope="col" className="type-label h-9 px-3 font-normal">
                    Files
                  </th>
                  <th scope="col" className="type-label h-9 px-3 font-normal">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {plan.report.entries.map((v) => {
                  const r = run[v.index];
                  return (
                    <tr key={v.index} className="border-t border-rule align-top">
                      <td className="px-3 py-2">
                        <span className="block text-fg">{v.title}</span>
                        <span className="font-ocr text-[11px] text-muted">
                          {ASSET_TYPE_LABEL[v.type]} // {v.slug}
                        </span>
                      </td>
                      <td className="max-w-[22rem] px-3 py-2">
                        <ul className="font-ocr text-[11px] text-muted">
                          {v.files.map((f) => (
                            <li key={f.path} className="truncate">
                              {f.primary ? "* " : "  "}
                              {f.path.split("/").pop()} ({f.purpose})
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="min-w-[14rem] px-3 py-2">
                        {r?.status === "running" ? (
                          <Progress value={r.progress ?? null} label="Importing" />
                        ) : r?.status === "created" ? (
                          <Link href={`/admin/assets/${r.assetId}`} className="text-bright underline underline-offset-2">
                            Created draft
                          </Link>
                        ) : r?.status === "skipped" || v.duplicateOf ? (
                          <Badge tone="outline">Already imported</Badge>
                        ) : r?.status === "failed" || v.problems.length ? (
                          <Badge tone="bright">Blocked</Badge>
                        ) : (
                          <Badge>Ready</Badge>
                        )}
                        {[...v.problems, ...(r?.message ? [r.message] : []), ...(r ? [] : v.warnings)].map((m) => (
                          <p key={m} className={v.problems.includes(m) || r?.status === "failed" ? "mt-1 text-xs text-bright" : "mt-1 text-xs text-muted"}>
                            {m}
                          </p>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {!finished ? (
              <Button variant="primary" size="lg" disabled={running || counts!.ready === 0} onClick={runPlan}>
                {running ? "Importing…" : `Import ${pluralise(counts!.ready, "draft")}`}
              </Button>
            ) : (
              <Link href="/admin/assets?status=draft" className={buttonClasses("primary", "lg")}>
                [ Review drafts ]
              </Link>
            )}
            <p className="text-xs text-muted">Imported assets are drafts: nothing is published and rights are not confirmed until you do it per asset.</p>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
