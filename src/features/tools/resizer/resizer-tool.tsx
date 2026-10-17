"use client";

import { zipSync, type Zippable } from "fflate";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { NumberField, SegmentedControl, SliderField } from "@/components/ui/controls";
import { Progress } from "@/components/ui/feedback";
import { Toggle } from "@/components/ui/form";
import { Module } from "@/components/ui/panel";
import { TBody, THead, Table, Td, Th } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { isPowerOfTwo } from "@/lib/processing/image";
import { outputFormat, plannedSize, RESIZE_DEFAULTS, type ResizeSettings } from "@/lib/processing/resize-plan";
import { fromInput, isImage, readDrop, useWindowDrop, type DroppedFile } from "../shared/drop";
import { baseName, saveBlob } from "../shared/files";
import type { ResizeRequest, ResizeResponse } from "./worker";

const STORE_KEY = "lp-resizer-settings";
const SIZES = [64, 128, 256, 512, 1024, 2048];
const SCALES = [25, 50, 200, 400];
const MAX_FILES = 1000;
const MAX_BYTES = 64 * 1024 * 1024;
const EXT = { png: ".png", jpg: ".jpg", webp: ".webp" } as const;
const SAMPLES = ["demo-red-brick", "demo-wood-planks", "demo-cobblestones", "demo-rusted-plate", "demo-steel-grate", "demo-uv-checker"];

interface Row {
  id: number;
  file: File;
  /** Folder path inside the drop, "" or "a/b/". */
  dir: string;
  thumb: string;
  width?: number;
  height?: number;
  /** Set when the file can't be decoded. */
  unreadable?: boolean;
}

interface Result {
  key: string;
  ok: boolean;
  blob?: Blob;
  width?: number;
  height?: number;
  format?: "png" | "jpg" | "webp";
  message?: string;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const safe = (s: string) => s.replace(/[\\:*?"<>|\u0000-\u001f]+/g, "_").replace(/(^|\/)\.+/g, "$1") || "texture";

function loadSettings(): ResizeSettings {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...RESIZE_DEFAULTS, ...(JSON.parse(raw) as Partial<ResizeSettings>) } : RESIZE_DEFAULTS;
  } catch {
    return RESIZE_DEFAULTS;
  }
}

/** Runs one request on one worker. */
function call(w: Worker, req: ResizeRequest): Promise<ResizeResponse> {
  return new Promise((resolve) => {
    w.onmessage = (ev: MessageEvent<ResizeResponse>) => {
      if (ev.data.token === req.token) resolve(ev.data);
    };
    w.onerror = () => resolve({ token: req.token, ok: false, message: "The resize worker stopped." });
    w.postMessage(req);
  });
}

export function ResizerTool() {
  const [rows, setRows] = useState<Row[]>([]);
  const [results, setResults] = useState<Record<number, Result>>({});
  const [settings, setSettings] = useState<ResizeSettings>(RESIZE_DEFAULTS);
  const [run, setRun] = useState<{ done: number; total: number } | null>(null);
  const [working, setWorking] = useState<Set<number>>(new Set());
  const nextId = useRef(1);
  const pool = useRef<Worker[]>([]);
  const token = useRef(0);
  const stop = useRef(false);
  const folderRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  });

  useEffect(() => {
    // Saved settings live in localStorage, which only exists after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore after mount
    setSettings(loadSettings());
    const workers = pool.current;
    return () => {
      workers.forEach((w) => w.terminate());
      rowsRef.current.forEach((r) => URL.revokeObjectURL(r.thumb));
    };
  }, []);

  /** Settings (never images) are remembered in this browser. */
  const update = (patch: Partial<ResizeSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      // private mode: settings just aren't remembered
    }
  };

  /* ----------------------------------------------------------------- input */
  const ingest = useCallback((dropped: DroppedFile[], failed = false) => {
    const known = new Set(rowsRef.current.map((r) => `${r.dir}${r.file.name}:${r.file.size}`));
    let skipped = 0,
      big = 0,
      dupes = 0;
    const fresh: Row[] = [];
    for (const { file, dir } of dropped) {
      if (file.name.startsWith(".")) continue;
      if (!isImage(file)) {
        skipped++;
        continue;
      }
      if (file.size > MAX_BYTES) {
        big++;
        continue;
      }
      const k = `${dir}${file.name}:${file.size}`;
      if (known.has(k)) {
        dupes++;
        continue;
      }
      known.add(k);
      fresh.push({ id: nextId.current++, file, dir, thumb: URL.createObjectURL(file) });
    }
    const room = MAX_FILES - rowsRef.current.length;
    const over = Math.max(0, fresh.length - room);
    fresh.splice(room).forEach((r) => URL.revokeObjectURL(r.thumb));
    const notes = [
      skipped && `${skipped} non-image file${skipped > 1 ? "s" : ""} skipped`,
      big && `${big} over ${formatBytes(MAX_BYTES)}`,
      dupes && `${dupes} already listed`,
      over && `only the first ${MAX_FILES} files are kept`,
      failed && "some folders couldn't be read",
    ].filter(Boolean);
    if (fresh.length) toast.ok(`Added ${fresh.length} file${fresh.length > 1 ? "s" : ""}`, notes.join(" // ") || undefined);
    else if (notes.length) toast.error("Nothing added", notes.join(" // "));
    if (!fresh.length) return;
    setRows((rs) => [...rs, ...fresh].sort((a, b) => collator.compare(a.dir + a.file.name, b.dir + b.file.name)));
    // Read dimensions in the background so planned sizes show before resizing.
    void (async () => {
      for (const r of fresh) {
        let patch: Partial<Row>;
        try {
          const bmp = await createImageBitmap(r.file);
          patch = { width: bmp.width, height: bmp.height };
          bmp.close();
        } catch {
          patch = { unreadable: true };
        }
        setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, ...patch } : x)));
      }
    })();
  }, []);

  const dragging = useWindowDrop(async (dt) => {
    const { files, failed } = await readDrop(dt);
    ingest(files, failed);
  });

  const loadSample = async () => {
    try {
      const files = await Promise.all(
        SAMPLES.map(async (slug) => {
          const r = await fetch(`/demo/textures/${slug}.png`);
          if (!r.ok) throw new Error(slug);
          return { file: new File([await r.blob()], `${slug.replace(/^demo-/, "")}.png`, { type: "image/png" }), dir: "lowpo11y-demo/" };
        }),
      );
      ingest(files);
    } catch {
      toast.error("Couldn't load the sample textures");
    }
  };

  const remove = (ids: number[]) => {
    const gone = new Set(ids);
    rowsRef.current.filter((r) => gone.has(r.id)).forEach((r) => URL.revokeObjectURL(r.thumb));
    setRows((rs) => rs.filter((r) => !gone.has(r.id)));
    setResults((res) => Object.fromEntries(Object.entries(res).filter(([id]) => !gone.has(Number(id)))));
  };

  /* ---------------------------------------------------------------- resize */
  const key = JSON.stringify(settings);
  const current = (r: Row) => (results[r.id]?.key === key ? results[r.id] : undefined);
  const pending = rows.filter((r) => !r.unreadable && !current(r));
  const done = rows.filter((r) => current(r)?.ok);
  const failedRows = rows.filter((r) => r.unreadable || current(r)?.ok === false);
  const zipBytes = done.reduce((n, r) => n + (current(r)!.blob?.size ?? 0), 0);

  const resizeAll = async () => {
    const todo = pending;
    if (!todo.length || run) return;
    const s = settings;
    const k = key;
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1, todo.length));
    while (pool.current.length < n) pool.current.push(new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }));
    stop.current = false;
    let next = 0,
      finished = 0;
    setRun({ done: 0, total: todo.length });
    const started = performance.now();
    await Promise.all(
      pool.current.slice(0, n).map(async (w) => {
        while (!stop.current && next < todo.length) {
          const row = todo[next++]!;
          setWorking((ws) => new Set(ws).add(row.id));
          const m = await call(w, { token: ++token.current, file: row.file, type: row.file.type, settings: s });
          setWorking((ws) => {
            const c = new Set(ws);
            c.delete(row.id);
            return c;
          });
          setResults((res) => ({ ...res, [row.id]: m.ok ? { key: k, ok: true, blob: m.blob, width: m.width, height: m.height, format: m.format } : { key: k, ok: false, message: m.message } }));
          setRun({ done: ++finished, total: todo.length });
        }
      }),
    );
    setRun(null);
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    if (stop.current) toast({ title: `Stopped after ${finished} of ${todo.length}` });
    else toast.ok(`Resized ${finished} file${finished > 1 ? "s" : ""} in ${secs} s`);
  };

  const outName = (r: Row, format: "png" | "jpg" | "webp") => `${safe(r.dir)}${safe(baseName(r.file.name))}${EXT[format]}`;

  const downloadZip = async () => {
    if (!done.length || pending.length || run) return;
    const used = new Set<string>();
    const entries: Zippable = {};
    for (const r of done) {
      const res = current(r)!;
      const base = outName(r, res.format!);
      let name = base;
      for (let i = 2; used.has(name.toLowerCase()); i++) name = base.replace(/(\.[a-z]+)$/, `_${i}$1`);
      used.add(name.toLowerCase());
      // images are already compressed: store them as they are
      entries[name] = [new Uint8Array(await res.blob!.arrayBuffer()), { level: 0 }];
    }
    const fn = `lowpo11y-resized_${new Date().toISOString().slice(0, 10)}.zip`;
    saveBlob(new Blob([zipSync(entries) as BlobPart], { type: "application/zip" }), fn);
    toast.ok(`ZIP saved // ${done.length} file${done.length > 1 ? "s" : ""}`, fn);
  };

  /* ---------------------------------------------------------------- render */
  const s = settings;
  const folders = new Set(rows.map((r) => r.dir)).size;
  const npot = rows.filter((r) => {
    if (!r.width || !r.height) return false;
    const [w, h] = plannedSize(r.width, r.height, s);
    return !isPowerOfTwo(w) || !isPowerOfTwo(h);
  }).length;
  const sizeSummary =
    s.mode === "long" ? `LONG SIDE ${s.width}` : s.mode === "scale" ? `${s.scale}%` : `${s.width}×${s.height} ${s.fit.toUpperCase()}`;
  const presetValue = SIZES.includes(s.width) && (s.mode === "long" || s.height === s.width) ? String(s.width) : "custom";
  const small = "cursor-pointer border border-edge bg-sunken px-2 py-1 font-ocr text-[11px] tracking-[0.05em] text-muted uppercase hover:border-edge-hover hover:text-bright";

  return (
    <div className="lp-scroll flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      <header className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-rule-strong px-4 py-2.5 sm:px-6">
        <h1 className="font-ocr text-lg tracking-[0.18em] uppercase glow">Batch resizer</h1>
        <p className="font-ocr text-[12px] tracking-[0.08em] text-muted uppercase">&gt; resize a folder of textures at once // folders are kept in the ZIP // files never leave this machine</p>
      </header>

      <div className="grid gap-3 p-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section aria-label="Files" className="flex min-h-[24rem] min-w-0 flex-col gap-2.5 border border-rule-strong bg-panel p-3 lg:min-h-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="type-panel mr-auto">// Files</h2>
            {rows.length ? (
              <button type="button" className={small} onClick={() => remove(rows.map((r) => r.id))} disabled={!!run}>
                Clear all
              </button>
            ) : null}
          </div>
          <div
            className={cn(
              "flex flex-col items-center gap-1.5 border border-dashed border-edge bg-sunken px-3 text-center transition-[border-color,box-shadow] hover:border-bright hover:shadow-[var(--crt-glow)]",
              rows.length ? "py-3" : "py-10",
              dragging && "border-solid border-bright shadow-[var(--crt-glow)]",
            )}
          >
            <button type="button" onClick={() => folderRef.current?.click()} className="cursor-pointer font-ocr tracking-[0.1em] uppercase glow">
              [ Drop folders or images ]
            </button>
            <span className="font-ocr text-[11px] tracking-[0.04em] text-muted">PNG, JPG, WEBP, GIF or BMP // up to {MAX_FILES} files, {formatBytes(MAX_BYTES)} each</span>
            <span className="mt-1 flex flex-wrap justify-center gap-1.5">
              <button type="button" className={small} onClick={() => folderRef.current?.click()}>
                + Folder
              </button>
              <button type="button" className={small} onClick={() => filesRef.current?.click()}>
                + Files
              </button>
              <button type="button" className={small} onClick={loadSample} title="Load six LOWPO11Y demo textures (CC0)">
                + Sample
              </button>
            </span>
            <input
              ref={filesRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              aria-label="Image files"
              onChange={(e) => {
                ingest(fromInput(e.target.files));
                e.target.value = "";
              }}
            />
            <input
              ref={folderRef}
              type="file"
              multiple
              hidden
              aria-label="Image folder"
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(e) => {
                ingest(fromInput(e.target.files));
                e.target.value = "";
              }}
            />
          </div>

          <p role="status" className="font-ocr text-[12px] tracking-[0.06em] text-muted uppercase">
            {!rows.length ? (
              <>&gt; IDLE // ADD IMAGES TO BEGIN</>
            ) : (
              <>
                &gt; <b className="font-normal text-fg">{rows.length}</b> FILE{rows.length > 1 ? "S" : ""}
                {folders > 1 || rows[0]?.dir ? (
                  <>
                    {" "}
                    IN <b className="font-normal text-fg">{folders}</b> FOLDER{folders > 1 ? "S" : ""}
                  </>
                ) : null}{" "}
                // <b className="font-normal text-fg">{done.length}</b> DONE
                {pending.length ? <> // {pending.length} TO RESIZE</> : null}
                {failedRows.length ? <> // ! {failedRows.length} FAILED</> : null}
                {npot ? <> // {npot} NOT POWER OF TWO</> : null}
              </>
            )}
          </p>

          {rows.length ? (
            <div className="lp-scroll lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              <Table aria-label="Files to resize">
                <THead>
                  <tr>
                    <Th className="w-10">
                      <span className="sr-only">Preview</span>
                    </Th>
                    <Th>File</Th>
                    <Th>In</Th>
                    <Th>Out</Th>
                    <Th>Status</Th>
                    <Th className="text-right">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </THead>
                <TBody>
                  {rows.map((r) => {
                    const res = current(r);
                    const [pw, ph] = r.width && r.height ? plannedSize(r.width, r.height, s) : [0, 0];
                    const ow = res?.width ?? pw,
                      oh = res?.height ?? ph;
                    const fmt = res?.format ?? outputFormat(s, r.file.type);
                    return (
                      <tr key={r.id}>
                        <Td className="py-1.5">
                          <img src={r.thumb} alt="" className="size-8 max-w-none border border-rule-strong bg-sunken object-contain [image-rendering:pixelated]" />
                        </Td>
                        <Td className="max-w-[18rem]">
                          <span className="block truncate text-fg" title={r.dir + r.file.name}>
                            {r.file.name}
                          </span>
                          {r.dir ? <span className="block truncate font-ocr text-[11px] text-muted">{r.dir}</span> : null}
                        </Td>
                        <Td className="font-ocr whitespace-nowrap text-muted">{r.width ? `${r.width}×${r.height}` : r.unreadable ? "—" : "…"}</Td>
                        <Td className="font-ocr whitespace-nowrap">
                          {ow ? (
                            <>
                              {ow}×{oh}
                              <span className="text-muted"> {fmt.toUpperCase()}</span>
                              {!isPowerOfTwo(ow) || !isPowerOfTwo(oh) ? (
                                <span className="text-muted" title="Not a power of two">
                                  {" "}
                                  NPOT
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </Td>
                        <Td className="font-ocr text-[12px] whitespace-nowrap uppercase">
                          {r.unreadable ? (
                            <span title="The browser couldn't decode this file">! Unreadable</span>
                          ) : working.has(r.id) ? (
                            <span className="glow">Working…</span>
                          ) : res?.ok ? (
                            <span className="text-bright">Done · {formatBytes(res.blob!.size)}</span>
                          ) : res ? (
                            <span title={res.message}>! Failed</span>
                          ) : (
                            <span className="text-muted">Queued</span>
                          )}
                        </Td>
                        <Td className="text-right whitespace-nowrap">
                          <span className="inline-flex gap-1">
                            {res?.ok ? (
                              <Button size="sm" variant="ghost" onClick={() => saveBlob(res.blob!, outName(r, res.format!).split("/").pop()!)} aria-label={`Save ${r.file.name}`}>
                                Save
                              </Button>
                            ) : null}
                            <Button size="sm" variant="ghost" onClick={() => remove([r.id])} disabled={!!run} aria-label={`Remove ${r.file.name}`}>
                              ✕
                            </Button>
                          </span>
                        </Td>
                      </tr>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          ) : null}
        </section>

        <aside aria-label="Settings" className="lp-scroll flex min-h-0 flex-col gap-3 lg:overflow-y-auto lg:pr-1">
          <section aria-label="Resize settings" className="border border-rule-strong bg-panel p-3">
            <div className="mb-2.5 flex items-center gap-2">
              <h2 className="type-panel mr-auto">// Settings</h2>
              <Button size="sm" variant="ghost" onClick={() => update(RESIZE_DEFAULTS)}>
                Reset
              </Button>
            </div>

            <Module n="01" name="Size" summary={`${sizeSummary}${s.pot ? " · 2ⁿ" : ""} · ${s.sampling.toUpperCase()}`}>
              <SegmentedControl
                label="Mode"
                inline
                size="sm"
                value={s.mode}
                onChange={(v) => update({ mode: v })}
                options={[
                  { value: "long", label: "Long side", title: "Keep the aspect ratio; the longer side gets this size" },
                  { value: "exact", label: "Exact", title: "Exactly width × height" },
                  { value: "scale", label: "Scale", title: "A percentage of each image's size" },
                ]}
              />
              {s.mode === "scale" ? (
                <>
                  <SegmentedControl label="Scale presets" hideLabel size="sm" value={SCALES.includes(s.scale) ? String(s.scale) : "custom"} onChange={(v) => v !== "custom" && update({ scale: Number(v) })} options={[...SCALES.map((n) => ({ value: String(n), label: `${n}%` })), { value: "custom", label: "…", title: "Custom scale below" }]} />
                  <SliderField label="Scale" value={s.scale} min={1} max={400} unit="%" onChange={(v) => update({ scale: v })} />
                </>
              ) : (
                <>
                  <SegmentedControl
                    label={s.mode === "long" ? "Long side" : "Square"}
                    hideLabel
                    size="sm"
                    value={presetValue}
                    onChange={(v) => v !== "custom" && update({ width: Number(v), height: Number(v) })}
                    options={[...SIZES.map((n) => ({ value: String(n), label: String(n) })), { value: "custom", label: "…", title: "Custom size below" }]}
                  />
                  <div className={cn("grid gap-2", s.mode === "exact" && "grid-cols-2")}>
                    <NumberField label={s.mode === "long" ? "Long side" : "Width"} value={s.width} min={1} max={8192} unit="px" onChange={(v) => update({ width: v })} />
                    {s.mode === "exact" ? <NumberField label="Height" value={s.height} min={1} max={8192} unit="px" onChange={(v) => update({ height: v })} /> : null}
                  </div>
                </>
              )}
              {s.mode === "exact" ? (
                <SegmentedControl label="Fit" inline size="sm" value={s.fit} onChange={(v) => update({ fit: v })} options={[{ value: "crop", label: "Crop", title: "Fill and trim the centre" }, { value: "pad", label: "Pad", title: "Fit inside with transparent margins" }, { value: "stretch", label: "Stretch" }]} />
              ) : null}
              <Toggle pressed={s.pot} onPressedChange={(v) => update({ pot: v })} title="Round each side to the nearest power of two (2ⁿ), as many engines expect for mipmaps and wrapping">
                Round to power of two
              </Toggle>
              <SegmentedControl label="Sampling" inline size="sm" value={s.sampling} onChange={(v) => update({ sampling: v })} options={[{ value: "nearest", label: "Nearest", title: "Hard pixels: best for pixel art and retro textures" }, { value: "smooth", label: "Smooth", title: "Area average when shrinking, bilinear when enlarging" }]} />
            </Module>

            <Module n="02" name="Format" summary={s.format === "keep" ? "SAME AS INPUT" : s.format.toUpperCase() + (s.format === "png" ? "" : ` ${s.quality}%`)}>
              <SegmentedControl
                label="Format"
                inline
                size="sm"
                value={s.format}
                onChange={(v) => update({ format: v })}
                options={[
                  { value: "keep", label: "Keep", title: "Same format as each input (BMP and GIF become PNG)" },
                  { value: "png", label: "PNG" },
                  { value: "jpg", label: "JPG" },
                  { value: "webp", label: "WEBP" },
                ]}
              />
              {s.format !== "png" ? <SliderField label="Quality" value={s.quality} min={1} max={100} unit="%" onChange={(v) => update({ quality: v })} title="For JPG and WEBP output" /> : null}
              {s.format === "jpg" ? <p className="font-ocr text-[11px] text-muted">! JPG has no transparency: transparent areas become black.</p> : null}
            </Module>
          </section>

          <section aria-label="Export" className="border border-rule-strong bg-panel p-3">
            <h2 className="type-panel mb-2.5">// Export</h2>
            {run ? (
              <div className="mb-2 flex items-center gap-2">
                <Progress value={run.total ? run.done / run.total : null} label={`Resizing ${run.done}/${run.total}`} className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => (stop.current = true)}>
                  Stop
                </Button>
              </div>
            ) : null}
            <Button variant="primary" className="w-full" disabled={!pending.length || !!run} onClick={resizeAll}>
              {pending.length ? `Resize ${pending.length} file${pending.length > 1 ? "s" : ""}` : done.length ? "All resized" : "Resize"}
            </Button>
            <Button className="mt-2 w-full" disabled={!done.length || !!pending.length || !!run} onClick={downloadZip}>
              Download ZIP{done.length && !pending.length ? ` · ${formatBytes(zipBytes)}` : ""}
            </Button>
            <p className="mt-2 font-ocr text-[11px] tracking-[0.04em] text-muted">
              PNG output holds the exact resized pixels, alpha included // JPG and WEBP use the browser&rsquo;s encoder // changing a setting marks files to resize again
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
