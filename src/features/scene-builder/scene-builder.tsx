"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Toggle } from "@/components/ui/form";
import { Kbd } from "@/components/ui/kbd";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { formatBytes, formatCount } from "@/lib/format";
import {
  addAsset,
  addNode,
  byId,
  commit,
  copyNodes,
  duplicateNodes,
  groupNodes,
  makeModel,
  makePrimitive,
  pasteNodes,
  redo,
  removeNodes,
  setSettings,
  snapValue,
  startHistory,
  topLevel,
  undo,
  ungroup,
  updateNodes,
  type Clip,
  type History,
} from "@/lib/scene/editor";
import type { LibraryModel } from "@/lib/scene/library";
import { checkModelFile } from "@/lib/scene/model-check";
import { emptyScene, parseScene, SceneFileError, serialiseScene, type AssetRef, type PrimitiveShape, type SceneDoc, type Transform, type Vec3 } from "@/lib/scene/schema";
import { sha256Hex } from "@/lib/workshop/hash";
import type { LibraryTexture } from "@/lib/workshop/library";
import { isImage, readDrop, useWindowDrop } from "../tools/shared/drop";
import { saveBlob } from "../tools/shared/files";
import { AssetPalette, DRAG_TYPE, type PaletteDrag } from "./asset-palette";
import { Hierarchy } from "./hierarchy";
import { ObjectInspector, SceneSettingsPanel } from "./inspector";
import type { AssetState, ExportResult, GizmoMode, RuntimeEvents, SceneRuntime, SceneStats, ViewMode } from "./runtime";
import { clearFiles, loadFile, readAutosave, storeFile, writeAutosave, type Autosave } from "./storage";

const MODEL_RE = /\.(glb|gltf)$/i;
/** Above this the status bar warns that the editor may slow down. */
const HEAVY_TRIANGLES = 1_000_000;
const SCENE_RE = /\.json$/i;
const fileSlug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "scene";

/** Under this width the editor shows a notice first (it needs room, a mouse and a keyboard). */
const NARROW = "(max-width: 899px)";
const subscribeNarrow = (cb: () => void) => {
  const m = window.matchMedia(NARROW);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

const VIEWS: { value: ViewMode; label: string; key: string }[] = [
  { value: "perspective", label: "Persp", key: "1" },
  { value: "top", label: "Top", key: "2" },
  { value: "front", label: "Front", key: "3" },
  { value: "side", label: "Side", key: "4" },
];
const GIZMOS: { value: GizmoMode; label: string; key: string }[] = [
  { value: "translate", label: "Move", key: "W" },
  { value: "rotate", label: "Rotate", key: "E" },
  { value: "scale", label: "Scale", key: "R" },
];

const SHORTCUTS: [string, string][] = [
  ["W / E / R", "Move, rotate or scale with the gizmo"],
  ["1 / 2 / 3 / 4", "Perspective, top, front or side view"],
  ["F", "Focus the view on the selection (or everything)"],
  ["Arrow keys, Page Up / Down", "Fly the camera while the viewport has focus; Shift is faster"],
  ["Click, Shift-click", "Select, add to or remove from the selection"],
  ["Ctrl+A / Esc", "Select everything / nothing"],
  ["Delete", "Delete the selection"],
  ["Ctrl+D", "Duplicate"],
  ["Ctrl+C / Ctrl+V", "Copy and paste (within this tab)"],
  ["Ctrl+G / Ctrl+Shift+G", "Group / ungroup"],
  ["H / L", "Hide or lock the selection"],
  ["Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y", "Undo / redo"],
  ["Ctrl+S", "Save the .retro-scene.json file"],
  ["?", "This list"],
];

type ExportState = { kind: "idle" } | { kind: "running" } | { kind: "done"; result: ExportResult; filename: string; url: string } | { kind: "error"; message: string };

export function SceneBuilder() {
  /* ---------------------------------------------------------- document */
  const [history, setHistoryState] = useState<History>(() => startHistory(emptyScene()));
  const histRef = useRef(history);
  const setHistory = useCallback((h: History) => {
    histRef.current = h;
    setHistoryState(h);
  }, []);
  const doc = history.present;
  const [selection, setSelectionState] = useState<string[]>([]);
  const selRef = useRef<string[]>([]);
  const setSelection = useCallback((s: string[]) => {
    selRef.current = s;
    setSelectionState(s);
  }, []);
  const ids = useMemo(() => new Set(doc.nodes.map((n) => n.id)), [doc]);
  const sel = useMemo(() => selection.filter((id) => ids.has(id)), [selection, ids]);
  const [saved, setSaved] = useState<SceneDoc | null>(doc);
  const [notes, setNotes] = useState<string[]>([]);

  const mergeRef = useRef({ key: "", at: 0, n: 0 });
  const edit = useCallback(
    (next: SceneDoc, label: string, merge?: string) => {
      let key: string | undefined;
      if (merge) {
        const m = mergeRef.current;
        const now = performance.now();
        if (m.key !== merge || now - m.at > 1200) m.n++;
        m.key = merge;
        m.at = now;
        key = `${merge}#${m.n}`;
      }
      setHistory(commit(histRef.current, next, label, key));
    },
    [setHistory],
  );

  /* ------------------------------------------------------------ layout */
  const narrow = useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
  const [forceOpen, setForceOpen] = useState(false);
  const open = !narrow || forceOpen;

  /* ----------------------------------------------------------- runtime */
  const hostRef = useRef<HTMLDivElement>(null);
  const rtRef = useRef<SceneRuntime | null>(null);
  const [rtState, setRtState] = useState<"loading" | "ready" | "error">("loading");
  const [rtError, setRtError] = useState("");
  const [assets, setAssets] = useState<Map<string, AssetState>>(new Map());
  const assetsRef = useRef(assets);
  const [stats, setStats] = useState<SceneStats | null>(null);
  const [live, setLive] = useState<{ id: string; t: Transform } | null>(null);
  const [gizmo, setGizmo] = useState<GizmoMode>("translate");
  const [view, setView] = useState<ViewMode>("perspective");
  const [compare, setCompare] = useState(false);
  const localFiles = useRef(new Map<string, Uint8Array>());
  const reported = useRef(new Set<string>());
  const gizmoRef = useRef(gizmo);
  useEffect(() => {
    gizmoRef.current = gizmo;
    assetsRef.current = assets;
  });

  const resolve = useCallback(async (a: AssetRef): Promise<Uint8Array> => {
    if (a.source === "library") {
      if (!a.fileId) throw new Error("This library entry has no file id. Add the model again from the library.");
      const r = await fetch(`/api/download/${a.fileId}`);
      if (!r.ok) throw new Error(r.status === 403 ? "This asset's licence doesn't allow downloads any more." : r.status === 404 ? "This asset is no longer in the library." : "The file couldn't be downloaded. Check your connection.");
      return new Uint8Array(await r.arrayBuffer());
    }
    const key = a.sha256;
    const mem = key ? localFiles.current.get(key) : undefined;
    if (mem) return mem;
    const stored = key ? await loadFile(key) : null;
    if (stored && key) {
      localFiles.current.set(key, stored);
      return stored;
    }
    throw new Error(`"${a.name}" is a file from a computer and isn't in this browser. Add it again under Assets → Local; it's matched by its contents.`);
  }, []);

  const events = useRef<RuntimeEvents>(null);
  useEffect(() => {
    let frame = 0;
    let pending: { id: string; t: Transform } | null = null;
    events.current = {
      select: (picked, mode) => {
        if (mode === "replace") setSelection(picked);
        else {
          const cur = new Set(selRef.current);
          for (const id of picked) {
            if (cur.has(id)) cur.delete(id);
            else cur.add(id);
          }
          // Newly added ids go last, so the last pick gets the gizmo.
          setSelection([...selRef.current.filter((id) => cur.has(id)), ...picked.filter((id) => cur.has(id) && !selRef.current.includes(id))]);
        }
      },
      transformLive: (id, t) => {
        pending = { id, t };
        if (!frame)
          frame = requestAnimationFrame(() => {
            frame = 0;
            setLive(pending);
          });
      },
      transformEnd: (id, t) => {
        cancelAnimationFrame(frame);
        frame = 0;
        setLive(null);
        const d = histRef.current.present;
        const n = byId(d).get(id);
        if (!n || JSON.stringify(n.transform) === JSON.stringify(t)) return;
        const verb = gizmoRef.current === "rotate" ? "Rotate" : gizmoRef.current === "scale" ? "Scale" : "Move";
        edit(updateNodes(d, [id], () => ({ transform: t })), `${verb} ${n.name || "object"}`);
      },
      stats: setStats,
      asset: (id, state) => {
        setAssets((m) => new Map(m).set(id, state));
        if (state.status === "failed" && !reported.current.has(id)) {
          reported.current.add(id);
          const a = histRef.current.present.assets.find((x) => x.id === id);
          toast.error(`Couldn't load ${a?.name ?? "an asset"}`, state.message);
        }
      },
    };
    return () => cancelAnimationFrame(frame);
  }, [edit, setSelection]);

  useEffect(() => {
    if (!open) return;
    let rt: SceneRuntime | null = null;
    let cancelled = false;
    import("./runtime")
      .then(({ createSceneRuntime }) => {
        if (cancelled || !hostRef.current) return;
        try {
          rt = createSceneRuntime(hostRef.current, resolve, {
            select: (...a) => events.current?.select(...a),
            transformLive: (...a) => events.current?.transformLive(...a),
            transformEnd: (...a) => events.current?.transformEnd(...a),
            stats: (...a) => events.current?.stats(...a),
            asset: (...a) => events.current?.asset(...a),
          });
          rtRef.current = rt;
          setRtState("ready");
        } catch (e) {
          setRtError(e instanceof Error ? e.message : "The 3D view couldn't start.");
          setRtState("error");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setRtError("The 3D editor couldn't load. Check your connection and reload the page.");
        setRtState("error");
      });
    return () => {
      cancelled = true;
      rt?.dispose();
      rtRef.current = null;
    };
  }, [open, resolve]);

  useEffect(() => {
    if (rtState === "ready") rtRef.current?.sync(doc, sel);
  }, [doc, sel, rtState]);
  useEffect(() => {
    if (rtState === "ready") rtRef.current?.setGizmo(gizmo);
  }, [gizmo, rtState]);
  useEffect(() => {
    if (rtState === "ready") rtRef.current?.setView(view);
  }, [view, rtState]);
  useEffect(() => {
    if (rtState === "ready") rtRef.current?.setCompare(compare && doc.settings.retro.enabled);
  }, [compare, doc.settings.retro.enabled, rtState]);

  /* ---------------------------------------------------------- recovery */
  const [recovery, setRecovery] = useState<Autosave | null>(null);
  const [autosave, setAutosave] = useState<"idle" | "saved" | "failed">("idle");
  useEffect(() => {
    const a = readAutosave();
    if (!a) return;
    try {
      const { doc: d } = parseScene(a.json);
      if (d.nodes.length) queueMicrotask(() => setRecovery(a));
    } catch {
      // unreadable: ignore it, the next autosave replaces it
    }
  }, []);
  useEffect(() => {
    // Nothing to keep until the first edit (so a pending recovery isn't overwritten by an empty scene).
    if (!history.past.length && !history.future.length) return;
    const t = setTimeout(() => setAutosave(writeAutosave({ savedAt: new Date().toISOString(), json: serialiseScene(doc), clean: doc === saved }) ? "saved" : "failed"), 700);
    return () => clearTimeout(t);
  }, [doc, saved, history.past.length, history.future.length]);
  const dirty = doc !== saved;
  useEffect(() => {
    if (!dirty || autosave !== "failed") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, autosave]);

  const restore = () => {
    if (!recovery) return;
    try {
      const { doc: d, notes: n } = parseScene(recovery.json);
      edit(d, "Restore recovered scene");
      setSelection([]);
      setNotes(n);
      if (recovery.clean) setSaved(d);
      setTimeout(() => rtRef.current?.focus([]), 60);
    } catch (e) {
      toast.error("Couldn't restore the scene", e instanceof Error ? e.message : undefined);
    }
    setRecovery(null);
  };

  /* --------------------------------------------------------- placement */
  const snapPoint = useCallback((p: Vec3 | null): Vec3 => {
    const s = histRef.current.present.settings.grid.snap;
    if (!p || Math.hypot(p[0], p[2]) > 500) return [0, 0, 0];
    return [snapValue(p[0], s), 0, snapValue(p[2], s)];
  }, []);
  const viewCentre = useCallback((): Vec3 => {
    const r = hostRef.current?.getBoundingClientRect();
    return snapPoint(r ? (rtRef.current?.groundPoint(r.left + r.width / 2, r.top + r.height / 2) ?? null) : null);
  }, [snapPoint]);

  const addLibraryModel = (m: LibraryModel, at?: Vec3) => {
    const r = addAsset(histRef.current.present, { kind: "model", source: "library", name: m.filename, slug: m.slug, fileId: m.fileId, licence: m.licence, bytes: m.sizeBytes });
    const node = { ...makeModel(r.doc.assets.find((a) => a.id === r.id)!, at ?? viewCentre()), name: m.title };
    edit(addNode(r.doc, node), `Add ${m.title}`);
    setSelection([node.id]);
  };

  const addPrimitive = (shape: PrimitiveShape, at?: Vec3) => {
    const node = makePrimitive(shape, at ?? viewCentre());
    edit(addNode(histRef.current.present, node), `Add ${node.name.toLowerCase()}`);
    setSelection([node.id]);
  };

  const selectedShapes = (d: SceneDoc) => {
    const m = byId(d);
    return selRef.current.filter((id) => m.get(id)?.type === "primitive");
  };

  const applyTexture = (asset: Omit<AssetRef, "id">) => {
    const shapes = selectedShapes(histRef.current.present);
    if (!shapes.length) {
      toast.error("Select a blockout shape first", "Textures go on the selected boxes, planes and cylinders.");
      return;
    }
    const r = addAsset(histRef.current.present, asset);
    edit(
      updateNodes(r.doc, shapes, (n) => ({ material: { ...n.material!, texture: r.id } })),
      `Texture ${shapes.length > 1 ? `${shapes.length} shapes` : (byId(r.doc).get(shapes[0]!)?.name ?? "shape")}`,
    );
  };

  const pickLibraryTexture = (t: LibraryTexture) => applyTexture({ kind: "texture", source: "library", name: t.filename, slug: t.slug, fileId: t.fileId, licence: t.licence, bytes: t.sizeBytes });

  const keepLocal = async (sha: string, bytes: Uint8Array, name: string) => {
    localFiles.current.set(sha, bytes);
    try {
      await storeFile(sha, bytes);
    } catch {
      toast({ title: `${name} is kept for this visit only`, description: "The browser refused to store it, so after a refresh you'll need to add it again." });
    }
  };

  const openScene = async (file: File) => {
    try {
      const { doc: d, notes: n } = parseScene(await file.text());
      edit(d, `Open ${file.name}`);
      setSelection([]);
      setSaved(d);
      setNotes(n);
      setRecovery(null);
      toast.ok(`Opened ${file.name}`, n.length ? `${n.length} thing${n.length > 1 ? "s were" : " was"} repaired; see the notes under Objects.` : "Undo brings back the previous scene.");
      setTimeout(() => rtRef.current?.focus([]), 60);
    } catch (e) {
      toast.error(`Couldn't open ${file.name}`, e instanceof SceneFileError ? e.message : "The file couldn't be read.");
    }
  };

  const addLocalFiles = async (files: File[], at?: Vec3) => {
    let placed = 0;
    for (const f of files) {
      if (SCENE_RE.test(f.name)) {
        await openScene(f);
        continue;
      }
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (!MODEL_RE.test(f.name) && isImage(f)) {
        if (!selectedShapes(histRef.current.present).length) {
          toast.error(`Couldn't use ${f.name}`, "Select a box, plane or cylinder first; images become their texture.");
          continue;
        }
        const sha = await sha256Hex(bytes);
        await keepLocal(sha, bytes, f.name);
        const known = histRef.current.present.assets.find((a) => a.kind === "texture" && a.sha256 === sha);
        if (known && assetsRef.current.get(known.id)?.status === "failed") rtRef.current?.reload(known.id);
        applyTexture({ kind: "texture", source: "local", name: f.name, sha256: sha, bytes: bytes.byteLength });
        continue;
      }
      const check = checkModelFile(f.name, bytes);
      if (!check.ok) {
        toast.error(`Couldn't add ${f.name}`, check.message);
        continue;
      }
      const sha = await sha256Hex(bytes);
      await keepLocal(sha, bytes, f.name);
      const d = histRef.current.present;
      const known = d.assets.find((a) => a.kind === "model" && a.sha256 === sha);
      if (known && d.nodes.some((n) => n.asset === known.id) && assetsRef.current.get(known.id)?.status === "failed") {
        // The file a recovered or opened scene was missing: relink it instead of adding another copy.
        reported.current.delete(known.id);
        rtRef.current?.reload(known.id);
        toast.ok(`Found ${f.name} again`, `${d.nodes.filter((n) => n.asset === known.id).length} object(s) use it.`);
        continue;
      }
      const r = addAsset(d, { kind: "model", source: "local", name: f.name, sha256: sha, bytes: bytes.byteLength });
      // Several files at once go in a square grid around the drop point.
      const base = at ?? viewCentre();
      const step = Math.max(2.5, d.settings.grid.snap * 4);
      const cols = Math.ceil(Math.sqrt(files.length));
      const node = makeModel(r.doc.assets.find((a) => a.id === r.id)!, [base[0] + (placed % cols) * step, 0, base[2] + Math.floor(placed / cols) * step]);
      edit(addNode(r.doc, node), `Add ${node.name}`);
      setSelection([node.id]);
      placed++;
      if (check.warnings.length) toast({ title: `Added ${f.name}`, description: check.warnings.join(" ") });
    }
  };

  const forgetFiles = async () => {
    await clearFiles();
    toast.ok("Forgot the kept files", "Files already in this scene stay until you reload the page.");
  };

  const windowDrag = useWindowDrop((dt) => void readDrop(dt).then((r) => addLocalFiles(r.files.map((f) => f.file))));
  const [dropping, setDropping] = useState(false);

  /* ----------------------------------------------------------- commands */
  const clip = useRef<Clip | null>(null);
  const names = (d: SceneDoc, list: string[]) => {
    const m = byId(d);
    return list.length === 1 ? (m.get(list[0]!)?.name ?? "object") : `${list.length} objects`;
  };

  const command = (c: "delete" | "duplicate" | "group" | "ungroup" | "focus" | "hide" | "lock" | "copy" | "paste" | "all" | "none") => {
    const d = histRef.current.present;
    const s = topLevel(d, selRef.current);
    switch (c) {
      case "focus":
        rtRef.current?.focus(selRef.current);
        return;
      case "all":
        setSelection(d.nodes.map((n) => n.id));
        return;
      case "none":
        setSelection([]);
        return;
      case "paste": {
        if (!clip.current) return;
        const r = pasteNodes(d, clip.current, [d.settings.grid.snap || 0.5, 0, d.settings.grid.snap || 0.5]);
        edit(r.doc, `Paste ${r.ids.length > 1 ? `${r.ids.length} objects` : "object"}`);
        setSelection(r.ids);
        return;
      }
    }
    if (!s.length) return;
    switch (c) {
      case "delete":
        edit(removeNodes(d, s), `Delete ${names(d, s)}`);
        setSelection([]);
        break;
      case "duplicate": {
        const step = d.settings.grid.snap || 0.5;
        const r = duplicateNodes(d, s, [step, 0, step]);
        edit(r.doc, `Duplicate ${names(d, s)}`);
        setSelection(r.ids);
        break;
      }
      case "group": {
        const r = groupNodes(d, s);
        edit(r.doc, `Group ${names(d, s)}`);
        setSelection([r.id]);
        break;
      }
      case "ungroup": {
        const m = byId(d);
        const groups = s.filter((id) => m.get(id)?.type === "group");
        if (!groups.length) return;
        const kids = d.nodes.filter((n) => n.parent && groups.includes(n.parent)).map((n) => n.id);
        edit(
          groups.reduce((acc, g) => ungroup(acc, g), d),
          `Ungroup ${names(d, groups)}`,
        );
        setSelection(kids);
        break;
      }
      case "hide": {
        const m = byId(d);
        const show = s.every((id) => !m.get(id)!.visible);
        edit(updateNodes(d, s, () => ({ visible: show })), `${show ? "Show" : "Hide"} ${names(d, s)}`);
        break;
      }
      case "lock": {
        const m = byId(d);
        const unlock = s.every((id) => m.get(id)!.locked);
        edit(updateNodes(d, s, () => ({ locked: !unlock })), `${unlock ? "Unlock" : "Lock"} ${names(d, s)}`);
        break;
      }
      case "copy":
        clip.current = copyNodes(d, s);
        toast({ title: `Copied ${names(d, s)}` });
        break;
    }
  };

  const doUndo = () => setHistory(undo(histRef.current));
  const doRedo = () => setHistory(redo(histRef.current));

  const fileRef = useRef<HTMLInputElement>(null);
  const save = () => {
    const d = histRef.current.present;
    const json = serialiseScene(d);
    saveBlob(new Blob([json], { type: "application/json" }), `${fileSlug(d.name)}.retro-scene.json`);
    setSaved(d);
    setAutosave(writeAutosave({ savedAt: new Date().toISOString(), json, clean: true }) ? "saved" : "failed");
    const local = d.assets.filter((a) => a.source === "local" && d.nodes.some((n) => n.asset === a.id || n.material?.texture === a.id));
    if (local.length) toast({ title: "Scene saved", description: `It refers to ${local.length} file${local.length > 1 ? "s" : ""} from this computer by name and checksum; keep ${local.length > 1 ? "them" : "it"} with the scene.` });
  };
  const newScene = () => {
    edit(emptyScene(), "New scene");
    setSelection([]);
    setSaved(null);
    setNotes([]);
    toast({ title: "New scene", description: "Undo brings back the previous one." });
  };

  /* ------------------------------------------------------------ export */
  const [exportOpen, setExportOpen] = useState(false);
  const [exportHidden, setExportHidden] = useState(false);
  const [exportSun, setExportSun] = useState(true);
  const [exporting, setExporting] = useState<ExportState>({ kind: "idle" });
  const runExport = async () => {
    const rt = rtRef.current;
    if (!rt) return;
    setExporting({ kind: "running" });
    try {
      const result = await rt.exportGlb({ includeHidden: exportHidden, includeSun: exportSun });
      const filename = `${fileSlug(histRef.current.present.name)}.glb`;
      const blob = new Blob([result.bytes as BlobPart], { type: "model/gltf-binary" });
      saveBlob(blob, filename);
      setExporting((old) => {
        if (old.kind === "done") URL.revokeObjectURL(old.url);
        return { kind: "done", result, filename, url: URL.createObjectURL(blob) };
      });
    } catch (e) {
      setExporting({ kind: "error", message: e instanceof Error && e.message ? e.message : "The export failed." });
    }
  };

  /* --------------------------------------------------------- shortcuts */
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const keyHandler = useRef<(e: KeyboardEvent) => void>(null);
  useEffect(() => {
    keyHandler.current = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!open || exportOpen || shortcutsOpen) return;
      if (t && (t.closest("input, textarea, select, [contenteditable=true], [role=dialog]") || t.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };
      if (mod && k === "z") return run(e.shiftKey ? doRedo : doUndo);
      if (mod && k === "y") return run(doRedo);
      if (mod && k === "s") return run(save);
      if (mod && k === "d") return run(() => command("duplicate"));
      if (mod && k === "g") return run(() => command(e.shiftKey ? "ungroup" : "group"));
      if (mod && k === "a") return run(() => command("all"));
      if (mod && k === "c" && !window.getSelection()?.toString()) return run(() => command("copy"));
      if (mod && k === "v") return run(() => command("paste"));
      if (mod || e.altKey) return;
      if (k === "delete" || k === "backspace") return run(() => command("delete"));
      if (k === "escape") return command("none");
      if (k === "w") return setGizmo("translate");
      if (k === "e") return setGizmo("rotate");
      if (k === "r") return setGizmo("scale");
      if (k === "f") return command("focus");
      if (k === "h") return command("hide");
      if (k === "l") return command("lock");
      if (k === "?") return setShortcutsOpen(true);
      const v = VIEWS.find((x) => x.key === k);
      if (v) setView(v.value);
    };
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandler.current?.(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  /* ---------------------------------------------------------- hierarchy */
  const order = useMemo(() => {
    const kids = new Map<string | null, string[]>();
    for (const n of doc.nodes) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.id]);
    const out: string[] = [];
    const walk = (p: string | null) => {
      for (const id of kids.get(p) ?? []) {
        out.push(id);
        walk(id);
      }
    };
    walk(null);
    return out;
  }, [doc]);
  const pick = (id: string, mode: "replace" | "toggle" | "range") => {
    const cur = selRef.current.filter((x) => ids.has(x));
    if (mode === "replace") return setSelection([id]);
    if (mode === "toggle") return setSelection(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
    const anchor = cur.at(-1);
    if (!anchor) return setSelection([id]);
    const a = order.indexOf(anchor),
      b = order.indexOf(id);
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    // The clicked object goes last, so it gets the gizmo.
    setSelection([...new Set([...cur, ...range].filter((x) => x !== id)), id]);
  };
  const toggleNode = (id: string, key: "visible" | "locked") => {
    const d = histRef.current.present;
    const n = byId(d).get(id);
    if (!n) return;
    const on = !n[key];
    edit(updateNodes(d, [id], () => ({ [key]: on })), `${key === "visible" ? (on ? "Show" : "Hide") : on ? "Lock" : "Unlock"} ${n.name || "object"}`);
  };

  const missing = useMemo(() => doc.nodes.filter((n) => n.type === "model" && (!n.asset || assets.get(n.asset)?.status === "failed")).length, [doc, assets]);
  const canTexture = sel.some((id) => byId(doc).get(id)?.type === "primitive");
  const retroOn = doc.settings.retro.enabled;

  /* ------------------------------------------------------------- render */
  if (!open)
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-4">
        <section aria-labelledby="sb-narrow" className="flex w-full max-w-md flex-col gap-3 border border-rule-strong bg-panel p-4">
          <h1 id="sb-narrow" className="font-ocr text-lg tracking-[0.18em] uppercase glow">
            Scene Builder
          </h1>
          <p className="text-[14px] text-fg">The Scene Builder needs a wider screen, and works best with a mouse and keyboard: it places, moves and rotates objects in 3D.</p>
          <p className="text-[13px] text-muted">You can still open it here. Drag with one finger to orbit and pinch to zoom; the panels stack below the view.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => setForceOpen(true)}>
              Open anyway
            </Button>
            <Button asChild>
              <Link href="/tools">Browse the tools</Link>
            </Button>
          </div>
        </section>
      </div>
    );

  return (
    <div className="lp-scroll flex min-h-0 flex-1 flex-col overflow-y-auto lg:overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-rule-strong px-4 py-2 sm:px-6">
        <h1 className="font-ocr text-lg tracking-[0.18em] uppercase glow">Scene Builder</h1>
        <p className="mr-auto font-ocr text-[12px] tracking-[0.08em] text-muted uppercase">&gt; block out a level // place library models // export GLB // nothing leaves this machine</p>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={newScene}>
            New
          </Button>
          <Button size="sm" onClick={() => fileRef.current?.click()}>
            Open
          </Button>
          <input ref={fileRef} type="file" hidden accept=".json,application/json" aria-label="Scene file" onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void openScene(f);
            }}
          />
          <Button size="sm" onClick={save} title="Ctrl+S">
            Save
          </Button>
          <Button size="sm" variant="primary" disabled={rtState !== "ready"} onClick={() => setExportOpen(true)}>
            Export GLB
          </Button>
        </div>
      </header>

      {recovery ? (
        <div role="region" aria-label="Recovered scene" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-bright bg-panel px-4 py-2 sm:px-6">
          <p className="mr-auto text-[13px] text-fg">
            &gt; This browser kept a scene from {new Date(recovery.savedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
            {recovery.clean ? " (saved to a file then)" : " that wasn't saved to a file"}.
          </p>
          <Button size="sm" variant="primary" onClick={restore}>
            Restore it
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRecovery(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="grid gap-3 p-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[17rem_minmax(0,1fr)_20rem] xl:grid-cols-[19rem_minmax(0,1fr)_23rem]">
        {/* ------------------------------------------------ left column */}
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <AssetPalette
            className="max-h-[30rem] lg:max-h-none lg:basis-[55%]"
            onAddModel={(m) => addLibraryModel(m)}
            onAddPrimitive={(s) => addPrimitive(s)}
            onUseTexture={pickLibraryTexture}
            onLocalFiles={(f) => void addLocalFiles(f)}
            onForgetFiles={() => void forgetFiles()}
            canTexture={canTexture}
          />
          <section aria-labelledby="sb-objects" className="flex min-h-0 flex-col border border-rule-strong bg-panel p-3 lg:flex-1">
            <div className="mb-2 flex items-center gap-2">
              <h2 id="sb-objects" className="type-panel mr-auto">
                // Objects
              </h2>
              <span className="font-ocr text-[11px] text-muted">
                {formatCount(doc.nodes.length)}
                {sel.length ? ` // ${sel.length} selected` : ""}
              </span>
            </div>
            <Hierarchy doc={doc} selection={sel} assets={assets} onSelect={pick} onToggle={toggleNode} />
            {notes.length ? (
              <ul aria-label="Notes from opening the file" className="mt-2 flex flex-col gap-0.5 text-xs text-muted">
                {notes.map((n) => (
                  <li key={n}>&gt; {n}</li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>

        {/* ---------------------------------------------- centre column */}
        <section aria-labelledby="sb-view" className="flex min-h-[28rem] min-w-0 flex-col gap-2 border border-rule-strong bg-panel p-3 lg:min-h-0">
          <h2 id="sb-view" className="sr-only">
            Viewport
          </h2>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            <div className="flex gap-1">
              <Button size="sm" disabled={!history.past.length} onClick={doUndo} title={history.label ? `Undo: ${history.label} (Ctrl+Z)` : "Nothing to undo"}>
                Undo
              </Button>
              <Button size="sm" disabled={!history.future.length} onClick={doRedo} title={history.future[0] ? `Redo: ${history.future[0].label} (Ctrl+Shift+Z)` : "Nothing to redo"}>
                Redo
              </Button>
            </div>
            <SegmentedControl label="Gizmo" hideLabel size="sm" value={gizmo} onChange={setGizmo} options={GIZMOS.map((g) => ({ value: g.value, label: g.label, title: `${g.label} (${g.key})` }))} className="w-40" />
            <SegmentedControl label="View" hideLabel size="sm" value={view} onChange={setView} options={VIEWS.map((v) => ({ value: v.value, label: v.label, title: `${v.label === "Persp" ? "Perspective" : v.label} view (${v.key})` }))} className="w-48" />
            <Button size="sm" onClick={() => command("focus")} title="F">
              Focus
            </Button>
            <Toggle pressed={retroOn} onPressedChange={(on) => edit(setSettings(doc, (s) => ({ ...s, retro: { ...s.retro, enabled: on } })), on ? "Retro preview on" : "Retro preview off")} className="py-1 text-[11px]" title="Low resolution, fewer colours, dithering and vertex wobble">
              Retro
            </Toggle>
            {retroOn ? (
              <Toggle pressed={compare} onPressedChange={setCompare} className="py-1 text-[11px]" title="Left half clean, right half retro">
                Split
              </Toggle>
            ) : null}
            <IconButton size="sm" variant="secondary" className="ml-auto" label="Keyboard shortcuts" icon={<span aria-hidden>?</span>} onClick={() => setShortcutsOpen(true)} />
          </div>

          <div
            className={cn("relative min-h-[18rem] flex-1 overflow-hidden border border-rule-strong bg-sunken", (dropping || windowDrag) && "border-bright shadow-[var(--crt-glow)]")}
            onDragOver={(e) => {
              const types = [...e.dataTransfer.types];
              if (!types.includes(DRAG_TYPE) && !types.includes("Files")) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setDropping(true);
            }}
            onDragLeave={() => setDropping(false)}
            onDrop={(e) => {
              const raw = e.dataTransfer.getData(DRAG_TYPE);
              const hasFiles = [...e.dataTransfer.types].includes("Files");
              if (!raw && !hasFiles) return;
              e.preventDefault();
              e.stopPropagation();
              setDropping(false);
              const at = snapPoint(rtRef.current?.groundPoint(e.clientX, e.clientY) ?? null);
              if (raw) {
                try {
                  const d = JSON.parse(raw) as PaletteDrag;
                  if (d.type === "model") addLibraryModel(d.item, at);
                  else addPrimitive(d.shape, at);
                } catch {
                  // not ours
                }
              } else void readDrop(e.dataTransfer).then((r) => addLocalFiles(r.files.map((f) => f.file), at));
            }}
          >
            <div ref={hostRef} className="absolute inset-0" />
            {rtState === "loading" ? <p className="pointer-events-none absolute inset-0 grid place-items-center font-ocr text-xs text-muted">LOADING 3D VIEW…</p> : null}
            {rtState === "error" ? (
              <div role="alert" className="absolute inset-0 grid place-items-center p-6 text-center">
                <p className="max-w-sm text-[13px] text-bright">! {rtError}</p>
              </div>
            ) : null}
            {rtState === "ready" && !doc.nodes.length ? (
              <p className="pointer-events-none absolute inset-x-0 bottom-4 text-center font-ocr text-[11px] tracking-[0.06em] text-muted uppercase">Drag a model or shape here // or drop GLB files</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-ocr text-[11px] tracking-[0.04em] text-muted">
            <dl aria-label="Scene statistics" className="flex flex-wrap gap-x-4 gap-y-1">
              {(
                [
                  ["Objects", stats ? formatCount(stats.objects) : "—"],
                  ["Triangles", stats ? formatCount(stats.triangles) : "—"],
                  ["Draw calls", stats ? formatCount(stats.drawCalls) : "—"],
                  ["FPS", stats ? String(stats.fps) : "—"],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex gap-1.5">
                  <dt className="uppercase">{k}</dt>
                  <dd className="text-bright">{v}</dd>
                </div>
              ))}
            </dl>
            {missing ? <span className="text-bright">! {missing} missing</span> : null}
            {stats && stats.triangles > HEAVY_TRIANGLES ? <span className="text-bright">! Over {formatCount(HEAVY_TRIANGLES)} triangles: the view may slow down; hide what you aren&apos;t working on</span> : null}
            <span className="ml-auto">
              {history.label ? `Last: ${history.label}` : ""}
              {history.label ? " // " : ""}
              {autosave === "failed" ? <b className="font-normal text-bright">! Not kept in this browser (storage refused); save to a file</b> : autosave === "saved" ? "Kept in this browser" : null}
              {dirty && saved ? " // unsaved changes" : ""}
            </span>
          </div>
        </section>

        {/* ------------------------------------------------ right column */}
        <aside aria-label="Object and scene settings" className="lp-scroll flex min-h-0 min-w-0 flex-col gap-3 lg:overflow-y-auto lg:pr-1">
          <ObjectInspector doc={doc} selection={sel} live={live} assets={assets} edit={edit} onAction={command} />
          <SceneSettingsPanel doc={doc} edit={edit} />
        </aside>
      </div>

      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent title="Keyboard shortcuts" description="They work when you aren't typing in a field.">
          <dl className="grid grid-cols-[minmax(0,11rem)_1fr] gap-x-4 gap-y-2 px-4 py-3 text-[13px]">
            {SHORTCUTS.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="flex flex-wrap gap-1">
                  {k.split(" / ").map((part) => (
                    <Kbd key={part}>{part}</Kbd>
                  ))}
                </dt>
                <dd className="text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent
          title="Export GLB"
          description="One binary glTF file with every model and blockout shape, their names, hierarchy and textures. It's loaded back to check it before you get it."
          footer={
            <>
              <Button variant="ghost" onClick={() => setExportOpen(false)}>
                Close
              </Button>
              <Button variant="primary" disabled={exporting.kind === "running" || !doc.nodes.length} onClick={() => void runExport()}>
                {exporting.kind === "running" ? "Exporting…" : "Export"}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 px-4 py-3">
            <div className="flex flex-wrap gap-1.5">
              <Toggle pressed={exportHidden} onPressedChange={setExportHidden}>
                Include hidden objects
              </Toggle>
              <Toggle pressed={exportSun} onPressedChange={setExportSun}>
                Include the sun
              </Toggle>
            </div>
            {!doc.nodes.length ? <p className="text-[13px] text-muted">Add something to the scene first.</p> : null}
            {exporting.kind === "done" ? (
              <div className="flex flex-col gap-2 border border-rule-strong bg-sunken p-2.5" role="status">
                <p className="text-[13px] text-fg">
                  {exporting.result.check.ok ? "> Exported and checked" : "! Exported, but the check found problems"} // {exporting.filename} // {formatBytes(exporting.result.bytes.byteLength)}
                </p>
                <p className="font-ocr text-[11px] text-muted">
                  Loaded back: {exporting.result.check.meshes} of {exporting.result.check.expectedMeshes} meshes, {exporting.result.check.nodes} nodes
                </p>
                {exporting.result.check.problems.map((p) => (
                  <p key={p} className="text-xs text-bright">
                    ! {p}
                  </p>
                ))}
                <ul aria-label="Export notes" className="flex flex-col gap-0.5 text-xs text-muted">
                  {exporting.result.warnings.map((w) => (
                    <li key={w}>&gt; {w}</li>
                  ))}
                </ul>
                <a href={exporting.url} download={exporting.filename} className="font-ocr text-[12px] tracking-[0.06em] text-bright uppercase underline underline-offset-4">
                  Download {exporting.filename} again
                </a>
              </div>
            ) : exporting.kind === "error" ? (
              <p role="alert" className="text-xs text-bright">
                ! {exporting.message}
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
