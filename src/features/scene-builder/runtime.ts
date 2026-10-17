/**
 * three.js side of the Scene Builder. Imported on demand. It mirrors the
 * scene document: one Group per node (in the document's order and
 * hierarchy), model instances cloned from a shared, reference-counted
 * template per asset, blockout primitives with library textures, and
 * placeholders for anything missing. Edits come from the document; the
 * gizmo reports transforms back. GPU resources are freed when nothing uses
 * them and on dispose.
 */
import {
  AmbientLight,
  Box3,
  BoxGeometry,
  BoxHelper,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  Euler,
  Fog,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  Timer,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type Camera,
  type IUniform,
  type Material,
} from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { ViewHelper } from "three/addons/helpers/ViewHelper.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { checkModelFile } from "@/lib/scene/model-check";
import type { AssetRef, MaterialSpec, PrimitiveSpec, SceneDoc, SceneNode, Transform, Vec3 } from "@/lib/scene/schema";

export type AssetState = { status: "loading" } | { status: "ready"; triangles: number; warnings: string[] } | { status: "failed"; message: string };

export interface SceneStats {
  objects: number;
  meshes: number;
  triangles: number;
  drawCalls: number;
  geometries: number;
  textures: number;
  fps: number;
}

export interface RuntimeEvents {
  select: (ids: string[], mode: "replace" | "toggle") => void;
  transformLive: (id: string, t: Transform) => void;
  transformEnd: (id: string, t: Transform) => void;
  stats: (s: SceneStats) => void;
  asset: (id: string, state: AssetState) => void;
}

export type ViewMode = "perspective" | "top" | "front" | "side";
export type GizmoMode = "translate" | "rotate" | "scale";

export interface ExportResult {
  bytes: Uint8Array;
  warnings: string[];
  /** The exported file loaded back with GLTFLoader. */
  check: { ok: boolean; meshes: number; expectedMeshes: number; nodes: number; problems: string[] };
}

export interface SceneRuntime {
  sync(doc: SceneDoc, selection: string[]): void;
  setGizmo(mode: GizmoMode): void;
  setView(view: ViewMode): void;
  setCompare(on: boolean): void;
  focus(ids: string[]): void;
  /** Where a screen point meets the ground (y = 0), for drops. */
  groundPoint(clientX: number, clientY: number): Vec3 | null;
  exportGlb(o: { includeHidden: boolean; includeSun: boolean }): Promise<ExportResult>;
  /** Triangle count of a ready asset. */
  assetTriangles(assetId: string): number | null;
  /** Tries a failed asset again (after the user adds the missing file). */
  reload(assetId: string): void;
  dispose(): void;
}

const DEG = MathUtils.DEG2RAD;
const MAX_TEXTURE_PIXELS = 4096 * 4096;

function applyTransform(o: Object3D, t: Transform) {
  o.position.set(...t.position);
  o.rotation.copy(new Euler(t.rotation[0] * DEG, t.rotation[1] * DEG, t.rotation[2] * DEG, "XYZ"));
  o.scale.set(...t.scale);
}

const round = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
};

export function readTransform(o: Object3D): Transform {
  return {
    position: [round(o.position.x), round(o.position.y), round(o.position.z)],
    rotation: [round(o.rotation.x / DEG), round(o.rotation.y / DEG), round(o.rotation.z / DEG)],
    scale: [round(o.scale.x), round(o.scale.y), round(o.scale.z)],
  };
}

function trianglesOf(o: Object3D): number {
  let n = 0;
  o.traverse((c) => {
    const m = c as Mesh;
    if (!m.isMesh) return;
    const g = m.geometry as BufferGeometry;
    const count = g.index ? g.index.count : (g.getAttribute("position")?.count ?? 0);
    n += Math.floor(count / 3);
  });
  return n;
}

function primitiveGeometry(p: PrimitiveSpec): BufferGeometry {
  if (p.shape === "plane") {
    const g = new PlaneGeometry(p.width, p.depth);
    g.rotateX(-Math.PI / 2);
    return g;
  }
  if (p.shape === "cylinder") return new CylinderGeometry(p.width / 2, p.width / 2, p.height, p.segments, 1);
  return new BoxGeometry(p.width, p.height, p.depth);
}

/** Vertex snapping for the retro preview, shared by every material (0 = off, so the clean view is unaffected). */
const snapUniform: IUniform<number> = { value: 0 };
const aspectUniform: IUniform<number> = { value: 1 };
const patched = new WeakSet<Material>();
function patchMaterial(m: Material) {
  if (patched.has(m)) return;
  patched.add(m);
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer);
    shader.uniforms.uLpSnap = snapUniform;
    shader.uniforms.uLpAspect = aspectUniform;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "uniform float uLpSnap;\nuniform float uLpAspect;\nvoid main() {")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nif (uLpSnap > 0.0) { vec2 lpGrid = vec2(uLpSnap * uLpAspect, uLpSnap) * 0.5; gl_Position.xy = floor(gl_Position.xy / gl_Position.w * lpGrid + 0.5) / lpGrid * gl_Position.w; }",
      );
  };
  const key = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${key ? key() : ""}|lp-snap`;
  m.needsUpdate = true;
}

const POST_VERTEX = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform float uLevels;
uniform float uDither;
varying vec2 vUv;
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
void main() {
  gl_FragColor = texture2D(tDiffuse, vUv);
  #include <colorspace_fragment>
  float steps = uLevels - 1.0;
  // Dither in the low-resolution grid, so the pattern is as chunky as the pixels.
  float t = (bayer4(floor(vUv * vec2(textureSize(tDiffuse, 0)))) - 0.5) * uDither;
  gl_FragColor.rgb = clamp(floor(gl_FragColor.rgb * steps + 0.5 + t) / steps, 0.0, 1.0);
}`;

interface ModelEntry {
  state: AssetState;
  template: Object3D | null;
  users: number;
  triangles: number;
}

interface TextureEntry {
  state: AssetState;
  texture: Texture | null;
  users: number;
}

interface Slot {
  node: SceneNode;
  wrapper: Group;
  /** The model instance, primitive mesh or placeholder inside the wrapper. */
  body: Object3D | null;
  bodyKey: string;
}

export function createSceneRuntime(host: HTMLElement, resolve: (a: AssetRef) => Promise<Uint8Array>, events: RuntimeEvents): SceneRuntime {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
  } catch {
    throw new Error("Your browser couldn't start WebGL, so the Scene Builder can't run here.");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.info.autoReset = false;
  const canvas = renderer.domElement;
  canvas.className = "block size-full touch-none outline-none";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", "3D viewport. Click to select, drag to orbit, right-drag to pan, scroll to zoom; arrow keys and Page Up/Down fly the camera.");
  host.appendChild(canvas);

  const scene = new Scene();
  const content = new Group();
  content.name = "LOWPO11Y scene";
  scene.add(content);
  const ambient = new AmbientLight(0xffffff, 0.6);
  const sun = new DirectionalLight(0xffffff, 1.6);
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -30;
  sun.shadow.camera.right = sun.shadow.camera.top = 30;
  scene.add(ambient, sun, sun.target);
  let grid = new GridHelper(40, 80, 0x5a5a5a, 0x2a2a2a);
  scene.add(grid);

  // Editor overlays render after the scene at full resolution, never pixelated.
  const overlay = new Scene();

  const persp = new PerspectiveCamera(50, 1, 0.05, 2000);
  persp.position.set(8, 6, 10);
  const ortho = new OrthographicCamera(-10, 10, 10, -10, -1000, 1000);
  let camera: PerspectiveCamera | OrthographicCamera = persp;
  let view: ViewMode = "perspective";
  const controls = new OrbitControls(persp, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.15;
  controls.target.set(0, 0.5, 0);

  const gizmo = new TransformControls(persp, canvas);
  gizmo.setSize(0.9);
  overlay.add(gizmo.getHelper());
  let dragging = false;
  gizmo.addEventListener("dragging-changed", (e) => {
    dragging = !!(e as unknown as { value: boolean }).value;
    controls.enabled = !dragging;
    const o = gizmo.object;
    if (!dragging && o?.userData.lpId) events.transformEnd(o.userData.lpId as string, readTransform(o));
  });
  gizmo.addEventListener("objectChange", () => {
    const o = gizmo.object;
    if (o?.userData.lpId) events.transformLive(o.userData.lpId as string, readTransform(o));
  });

  const viewHelper = new ViewHelper(persp, canvas);
  const timer = new Timer();
  timer.connect(document);

  // Retro preview: low-resolution target, then quantise and dither to the screen.
  const target = new WebGLRenderTarget(1, 1, { magFilter: NearestFilter, minFilter: NearestFilter });
  const post = new ShaderMaterial({ uniforms: { tDiffuse: { value: target.texture }, uLevels: { value: 32 }, uDither: { value: 1 } }, vertexShader: POST_VERTEX, fragmentShader: POST_FRAGMENT, depthTest: false, depthWrite: false });
  const postScene = new Scene();
  const postCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  postScene.add(new Mesh(new PlaneGeometry(2, 2), post));
  let compare = false;

  const placeholderGeo = new EdgesGeometry(new BoxGeometry(1, 1, 1));
  const placeholderMat = new LineBasicMaterial({ color: 0x9a9a9a });
  const loader = new GLTFLoader();
  const models = new Map<string, ModelEntry>();
  const textures = new Map<string, TextureEntry>();
  const slots = new Map<string, Slot>();
  const boxes = new Map<string, BoxHelper>();
  let doc: SceneDoc | null = null;
  let selection: string[] = [];
  let structure = "";
  let disposed = false;

  /* ------------------------------------------------------------ assets */
  function assetOf(id: string | undefined) {
    return id ? doc?.assets.find((a) => a.id === id) : undefined;
  }

  function loadModel(a: AssetRef): ModelEntry {
    let e = models.get(a.id);
    if (e) return e;
    e = { state: { status: "loading" }, template: null, users: 0, triangles: 0 };
    models.set(a.id, e);
    events.asset(a.id, e.state);
    const entry = e;
    (async () => {
      try {
        const bytes = await resolve(a);
        const check = checkModelFile(a.name.match(/\.(glb|gltf)$/i) ? a.name : `${a.name}.glb`, bytes);
        if (!check.ok) throw new Error(check.message);
        const gltf = await loader.parseAsync(bytes.slice().buffer, "");
        if (disposed) return;
        const t = gltf.scene;
        t.traverse((c) => {
          const m = c as Mesh;
          if (!m.isMesh) return;
          (Array.isArray(m.material) ? m.material : [m.material]).forEach(patchMaterial);
          c.userData.lpShared = true;
        });
        entry.template = t;
        entry.triangles = trianglesOf(t);
        entry.state = { status: "ready", triangles: entry.triangles, warnings: check.warnings };
      } catch (err) {
        entry.state = { status: "failed", message: err instanceof Error ? err.message : "The model couldn't be loaded." };
      }
      events.asset(a.id, entry.state);
      // Rebuild the bodies that were waiting for this asset.
      for (const s of slots.values()) if (s.node.asset === a.id) s.bodyKey = "";
      if (doc) sync(doc, selection);
    })();
    return entry;
  }

  function loadTexture(a: AssetRef): TextureEntry {
    let e = textures.get(a.id);
    if (e) return e;
    e = { state: { status: "loading" }, texture: null, users: 0 };
    textures.set(a.id, e);
    events.asset(a.id, e.state);
    const entry = e;
    (async () => {
      try {
        const bytes = await resolve(a);
        const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
        const img = new Image();
        img.src = url;
        try {
          await img.decode();
        } catch {
          throw new Error("This image can't be read. Use a PNG, JPG or WebP file.");
        } finally {
          URL.revokeObjectURL(url);
        }
        if (img.naturalWidth * img.naturalHeight > MAX_TEXTURE_PIXELS) throw new Error(`This image is ${img.naturalWidth}×${img.naturalHeight}; textures here can be up to 4096×4096. Resize it first (Tools → Resizer).`);
        if (disposed) return;
        const t = new Texture(img);
        t.colorSpace = SRGBColorSpace;
        t.wrapS = t.wrapT = RepeatWrapping;
        t.needsUpdate = true;
        entry.texture = t;
        entry.state = { status: "ready", triangles: 0, warnings: [] };
      } catch (err) {
        entry.state = { status: "failed", message: err instanceof Error && err.message ? err.message : "The texture couldn't be loaded." };
      }
      events.asset(a.id, entry.state);
      for (const s of slots.values()) if (s.node.material?.texture === a.id) s.bodyKey = "";
      if (doc) sync(doc, selection);
    })();
    return entry;
  }

  function release(slot: Slot) {
    const body = slot.body;
    if (!body) return;
    slot.wrapper.remove(body);
    if (body.userData.lpPlaceholder) return; // shared geometry
    if (slot.node.type === "model" && body.userData.lpAsset) {
      const e = models.get(body.userData.lpAsset as string);
      if (e) e.users--;
      return; // instance shares the template's GPU resources
    }
    body.traverse((c) => {
      const m = c as Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mat = m.material as MeshStandardMaterial;
      if (mat.map) {
        const texId = mat.userData.lpTexture as string | undefined;
        mat.map.dispose(); // the per-object clone; the image stays with the shared entry
        if (texId) {
          const t = textures.get(texId);
          if (t) t.users--;
        }
      }
      mat.dispose();
    });
  }

  function placeholder(): Object3D {
    const p = new LineSegments(placeholderGeo, placeholderMat);
    p.position.y = 0.5;
    p.userData.lpPlaceholder = true;
    return p;
  }

  function primitiveMaterial(spec: MaterialSpec): MeshStandardMaterial {
    const mat = new MeshStandardMaterial({ color: new Color(spec.color), roughness: spec.roughness, metalness: 0 });
    if (spec.texture) {
      const a = assetOf(spec.texture);
      const e = a ? loadTexture(a) : null;
      if (e?.texture) {
        const t = e.texture.clone();
        t.repeat.set(...spec.repeat);
        t.offset.set(...spec.offset);
        t.magFilter = spec.pixelated ? NearestFilter : t.magFilter;
        t.needsUpdate = true;
        mat.map = t;
        mat.userData.lpTexture = spec.texture;
        e.users++;
      }
    }
    patchMaterial(mat);
    return mat;
  }

  function bodyKey(n: SceneNode): string {
    if (n.type === "model") {
      const e = n.asset ? models.get(n.asset) : undefined;
      return `m:${n.asset}:${e?.state.status ?? "none"}`;
    }
    if (n.type === "primitive") {
      const tex = n.material?.texture ? textures.get(n.material.texture)?.state.status : "";
      return `p:${JSON.stringify(n.primitive)}:${JSON.stringify(n.material)}:${tex}`;
    }
    return "g";
  }

  function buildBody(slot: Slot) {
    release(slot);
    const n = slot.node;
    let body: Object3D | null = null;
    if (n.type === "model") {
      const a = assetOf(n.asset);
      const e = a ? loadModel(a) : null;
      if (e?.template) {
        body = cloneSkinned(e.template);
        body.userData.lpAsset = a!.id;
        e.users++;
      } else body = placeholder();
    } else if (n.type === "primitive" && n.primitive) {
      const mesh = new Mesh(primitiveGeometry(n.primitive), primitiveMaterial(n.material ?? ({ color: "#bdbdbd", texture: null, repeat: [1, 1], offset: [0, 0], roughness: 0.9, pixelated: true } as MaterialSpec)));
      body = mesh;
    }
    if (body) {
      body.traverse((c) => {
        c.castShadow = c.receiveShadow = true;
      });
      slot.wrapper.add(body);
    }
    slot.body = body;
    slot.bodyKey = bodyKey(n);
  }

  /* -------------------------------------------------------------- sync */
  function sync(next: SceneDoc, sel: string[]) {
    doc = next;
    selection = sel;
    const live = new Set(next.nodes.map((n) => n.id));
    for (const [id, s] of slots)
      if (!live.has(id)) {
        release(s);
        s.wrapper.removeFromParent();
        slots.delete(id);
      }
    for (const n of next.nodes) {
      let s = slots.get(n.id);
      if (!s) {
        const wrapper = new Group();
        wrapper.userData.lpId = n.id;
        s = { node: n, wrapper, body: null, bodyKey: "" };
        slots.set(n.id, s);
      }
      if (s.node !== n || !s.wrapper.parent) {
        s.node = n;
        s.wrapper.name = n.name;
        s.wrapper.visible = n.visible;
        // While the gizmo drags this object, the gizmo owns its transform.
        if (!(dragging && gizmo.object === s.wrapper)) applyTransform(s.wrapper, n.transform);
      }
      if (s.bodyKey !== bodyKey(n)) buildBody(s);
    }
    // Hierarchy and sibling order follow the document; re-attach only when it changed.
    const sig = next.nodes.map((n) => `${n.id}<${n.parent ?? ""}`).join("|");
    if (sig !== structure) {
      structure = sig;
      for (const n of next.nodes) (n.parent ? slots.get(n.parent)!.wrapper : content).add(slots.get(n.id)!.wrapper);
    }
    applySettings(next);
    applySelection();
    // Free models and textures the document no longer lists (a new scene, a deleted import).
    const known = new Set(next.assets.map((a) => a.id));
    for (const [id, e] of models)
      if (!known.has(id) && e.users <= 0 && e.state.status !== "loading") {
        disposeTree(e.template);
        models.delete(id);
      }
    for (const [id, e] of textures)
      if (!known.has(id) && e.users <= 0 && e.state.status !== "loading") {
        e.texture?.dispose();
        textures.delete(id);
      }
  }

  function disposeTree(o: Object3D | null) {
    o?.traverse((c) => {
      const m = c as Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => {
        for (const v of Object.values(mat)) if (v instanceof Texture) v.dispose();
        mat.dispose();
      });
    });
  }

  function applySettings(d: SceneDoc) {
    const s = d.settings;
    scene.background = new Color(s.background);
    ambient.color.set(s.ambient.color);
    ambient.intensity = s.ambient.intensity;
    sun.color.set(s.sun.color);
    sun.intensity = s.sun.intensity;
    const az = s.sun.azimuth * DEG,
      el = s.sun.elevation * DEG;
    sun.position.set(Math.sin(az) * Math.cos(el) * 30, Math.sin(el) * 30, Math.cos(az) * Math.cos(el) * 30);
    renderer.shadowMap.enabled = s.sun.shadows;
    sun.castShadow = s.sun.shadows;
    scene.fog = s.fog.enabled ? new Fog(s.fog.color, s.fog.near, Math.max(s.fog.near + 0.01, s.fog.far)) : null;
    gizmo.setTranslationSnap(s.grid.snap || null);
    gizmo.setRotationSnap(s.grid.angle ? s.grid.angle * DEG : null);
    gizmo.setScaleSnap(s.grid.scale || null);
    post.uniforms.uLevels!.value = s.retro.levels;
    post.uniforms.uDither!.value = s.retro.dither ? 1 : 0;
    const cell = s.grid.snap || 0.5;
    const divisions = Math.min(400, Math.round(40 / cell));
    if ((grid.userData.divisions as number | undefined) !== divisions) {
      scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as Material).dispose();
      grid = new GridHelper(40, divisions, 0x5a5a5a, 0x2a2a2a);
      grid.userData.divisions = divisions;
      scene.add(grid);
    }
  }

  function applySelection() {
    const want = new Set(selection.filter((id) => slots.has(id)));
    for (const [id, b] of boxes)
      if (!want.has(id)) {
        overlay.remove(b);
        b.geometry.dispose();
        (b.material as Material).dispose();
        boxes.delete(id);
      }
    for (const id of want) if (!boxes.has(id)) boxes.set(id, overlay.add(new BoxHelper(slots.get(id)!.wrapper, 0xffffff)).children.at(-1) as BoxHelper);
    const primary = selection.at(-1);
    const slot = primary ? slots.get(primary) : undefined;
    const locked = slot ? isLocked(slot.node.id) : true;
    if (slot && !locked) {
      if (gizmo.object !== slot.wrapper) gizmo.attach(slot.wrapper);
    } else if (gizmo.object) gizmo.detach();
  }

  function isLocked(id: string): boolean {
    let n = doc?.nodes.find((x) => x.id === id);
    while (n) {
      if (n.locked) return true;
      n = n.parent ? doc!.nodes.find((x) => x.id === n!.parent) : undefined;
    }
    return false;
  }

  /* ------------------------------------------------------------- input */
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let downAt: { x: number; y: number } | null = null;
  const toNdc = (clientX: number, clientY: number) => {
    const r = canvas.getBoundingClientRect();
    pointer.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  };
  const onDown = (e: PointerEvent) => {
    downAt = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
  };
  const onUp = (e: PointerEvent) => {
    if (!downAt || dragging || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
    downAt = null;
    if (viewHelper.handleClick(e)) return;
    toNdc(e.clientX, e.clientY);
    const hits = raycaster.intersectObject(content, true);
    for (const h of hits) {
      let o: Object3D | null = h.object;
      while (o && !o.userData.lpId) o = o.parent;
      if (!o) continue;
      // The outermost unlocked, visible ancestor under the click (selecting a group's child selects the child).
      const id = o.userData.lpId as string;
      if (isLocked(id) || !isVisible(o)) continue;
      events.select([id], e.shiftKey || e.ctrlKey || e.metaKey ? "toggle" : "replace");
      return;
    }
    if (!e.shiftKey) events.select([], "replace");
  };
  const isVisible = (o: Object3D) => {
    for (let x: Object3D | null = o; x; x = x.parent) if (!x.visible) return false;
    return true;
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);

  // Fly the camera with the arrow keys (forward, back, sideways) and Page Up / Page Down; Shift is faster.
  const FLY = new Set(["arrowup", "arrowdown", "arrowleft", "arrowright", "pageup", "pagedown"]);
  const keys = new Set<string>();
  const onKey = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === "shift") {
      if (e.type === "keydown") keys.add("shift");
      else keys.delete("shift");
      return;
    }
    if (!FLY.has(k) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.type === "keydown") keys.add(k);
    else keys.delete(k);
    if (view === "perspective") e.preventDefault();
  };
  const onBlur = () => keys.clear();
  canvas.addEventListener("keydown", onKey);
  canvas.addEventListener("keyup", onKey);
  canvas.addEventListener("blur", onBlur);

  /* ------------------------------------------------------------ camera */
  function setView(v: ViewMode) {
    view = v;
    const t = controls.target.clone();
    if (v === "perspective") {
      camera = persp;
      controls.enableRotate = true;
    } else {
      camera = ortho;
      const d = 50;
      ortho.position.copy(t).add(v === "top" ? new Vector3(0, d, 0.0001) : v === "front" ? new Vector3(0, 0, d) : new Vector3(d, 0, 0));
      ortho.up.set(0, v === "top" ? 0 : 1, v === "top" ? -1 : 0);
      ortho.lookAt(t);
      controls.enableRotate = false;
    }
    // OrbitControls and TransformControls work with either camera type.
    (controls as unknown as { object: Camera }).object = camera;
    gizmo.camera = camera;
    resize();
  }

  function focus(ids: string[]) {
    const box = new Box3();
    for (const id of ids.length ? ids : [...slots.keys()]) {
      const s = slots.get(id);
      if (s) box.expandByObject(s.wrapper);
    }
    if (box.isEmpty()) box.set(new Vector3(-2, 0, -2), new Vector3(2, 2, 2));
    const c = box.getCenter(new Vector3());
    const r = Math.max(0.5, box.getSize(new Vector3()).length() / 2);
    const dir = camera.position.clone().sub(controls.target).normalize();
    if (!dir.lengthSq()) dir.set(0.5, 0.5, 0.7).normalize();
    controls.target.copy(c);
    if (camera === persp) persp.position.copy(c).addScaledVector(dir, r / Math.sin((persp.fov * DEG) / 2) * 1.1);
    else {
      ortho.position.copy(c).addScaledVector(dir, 50);
      ortho.zoom = Math.max(0.05, 10 / (r * 1.2));
      ortho.updateProjectionMatrix();
    }
    controls.update();
  }

  function resize() {
    const w = Math.max(1, host.clientWidth),
      h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    persp.aspect = w / h;
    persp.updateProjectionMatrix();
    ortho.left = (-10 * w) / h;
    ortho.right = (10 * w) / h;
    ortho.top = 10;
    ortho.bottom = -10;
    ortho.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  /* ------------------------------------------------------------- frame */
  let frame = 0;
  let frames = 0,
    fps = 0,
    lastStats = 0,
    fpsWindow = performance.now();
  function loop() {
    frame = requestAnimationFrame(loop);
    timer.update();
    const dt = Math.min(0.1, timer.getDelta());
    if ([...keys].some((k) => k !== "shift") && view === "perspective") {
      const speed = (keys.has("shift") ? 12 : 4) * dt;
      const fwd = new Vector3();
      persp.getWorldDirection(fwd);
      const right = new Vector3().crossVectors(fwd, persp.up).normalize();
      const move = new Vector3();
      if (keys.has("arrowup")) move.add(fwd);
      if (keys.has("arrowdown")) move.sub(fwd);
      if (keys.has("arrowright")) move.add(right);
      if (keys.has("arrowleft")) move.sub(right);
      if (keys.has("pageup")) move.y += 1;
      if (keys.has("pagedown")) move.y -= 1;
      move.multiplyScalar(speed * Math.max(1, persp.position.distanceTo(controls.target) / 6));
      persp.position.add(move);
      controls.target.add(move);
    }
    controls.update();
    if (viewHelper.animating) viewHelper.update(dt);
    for (const b of boxes.values()) b.update();
    render();
    frames++;
    const now = performance.now();
    if (now - fpsWindow >= 1000) {
      fps = Math.round((frames * 1000) / (now - fpsWindow));
      frames = 0;
      fpsWindow = now;
    }
    if (now - lastStats > 500) {
      lastStats = now;
      emitStats();
    }
  }

  let sceneCalls = 0;
  function render() {
    const retro = doc?.settings.retro;
    const w = canvas.width,
      h = canvas.height;
    renderer.info.reset();
    renderer.setScissorTest(false);
    if (!retro?.enabled || compare) {
      snapUniform.value = 0;
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
    // The scene's own draw calls (one pass), not the editor overlays.
    sceneCalls = renderer.info.render.calls;
    if (retro?.enabled) {
      const before = renderer.info.render.calls;
      const rh = retro.height,
        rw = Math.max(1, Math.round((rh * w) / h));
      if (target.width !== rw || target.height !== rh) target.setSize(rw, rh);
      snapUniform.value = retro.jitter;
      aspectUniform.value = w / h;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      sceneCalls = renderer.info.render.calls - before;
      renderer.setRenderTarget(null);
      if (compare) {
        renderer.setScissorTest(true);
        renderer.setScissor(w / renderer.getPixelRatio() / 2, 0, w / renderer.getPixelRatio() / 2, h / renderer.getPixelRatio());
      }
      renderer.autoClear = !compare;
      renderer.render(postScene, postCam);
      renderer.autoClear = true;
      renderer.setScissorTest(false);
      snapUniform.value = 0;
    }
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(overlay, camera);
    viewHelper.render(renderer);
    renderer.autoClear = true;
  }

  function emitStats() {
    let meshes = 0,
      triangles = 0;
    for (const s of slots.values()) {
      if (!s.body || s.body.userData.lpPlaceholder || !isVisible(s.wrapper)) continue;
      s.body.traverse((c) => {
        if ((c as Mesh).isMesh) meshes++;
      });
      triangles += s.node.type === "model" ? (models.get(s.node.asset ?? "")?.triangles ?? 0) : trianglesOf(s.body);
    }
    events.stats({ objects: slots.size, meshes, triangles, drawCalls: sceneCalls, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, fps });
  }
  frame = requestAnimationFrame(loop);

  /* ------------------------------------------------------------ export */
  async function exportGlb(o: { includeHidden: boolean; includeSun: boolean }): Promise<ExportResult> {
    const warnings: string[] = [];
    const s = doc!.settings;
    const hiddenPlaceholders: Object3D[] = [];
    let missing = 0;
    for (const slot of slots.values())
      if (slot.body?.userData.lpPlaceholder) {
        hiddenPlaceholders.push(slot.body);
        slot.body.visible = false;
        missing++;
      }
    if (missing) warnings.push(`${missing} object${missing > 1 ? "s" : ""} whose model is missing or failed to load ${missing > 1 ? "were" : "was"} left out.`);
    if (s.retro.enabled) warnings.push("The retro preview (low resolution, dithering, vertex snapping) is a viewport effect and isn't in the file.");
    if (s.fog.enabled) warnings.push("Fog isn't part of glTF; set it up again in your engine.");
    warnings.push("Ambient light isn't part of glTF." + (o.includeSun ? " The sun is exported as a directional light (KHR_lights_punctual)." : " Lights weren't exported."));
    if (s.sun.shadows) warnings.push("Shadow settings aren't exported.");
    warnings.push("Hidden and locked states, snapping and the camera are saved in the .retro-scene.json file, not the GLB.");
    let sunClone: DirectionalLight | null = null;
    if (o.includeSun) {
      // glTF lights shine down their node's -Z axis: aim the node at the origin and keep the target on that axis.
      sunClone = new DirectionalLight(sun.color, sun.intensity);
      sunClone.name = "Sun";
      sunClone.position.copy(sun.position);
      sunClone.lookAt(0, 0, 0);
      sunClone.add(sunClone.target);
      sunClone.target.position.set(0, 0, -1);
      content.add(sunClone);
    }
    // The vertex-snapping uniform must be off: it's a viewport effect only.
    snapUniform.value = 0;
    try {
      const result = (await new GLTFExporter().parseAsync(content, { binary: true, onlyVisible: !o.includeHidden, trs: true })) as ArrayBuffer;
      const bytes = new Uint8Array(result);
      // Load it back the way an engine would, and compare.
      let expectedMeshes = 0;
      content.traverseVisible((c) => {
        if ((c as Mesh).isMesh && c !== sunClone) expectedMeshes++;
      });
      if (o.includeHidden) {
        expectedMeshes = 0;
        content.traverse((c) => {
          if ((c as Mesh).isMesh && !c.userData.lpPlaceholder) expectedMeshes++;
        });
      }
      const problems: string[] = [];
      const back = await loader.parseAsync(bytes.slice().buffer, "");
      let meshes = 0,
        nodes = 0;
      back.scene.traverse((c) => {
        nodes++;
        if ((c as Mesh).isMesh) meshes++;
      });
      if (meshes !== expectedMeshes) problems.push(`Expected ${expectedMeshes} meshes after re-import, found ${meshes}.`);
      back.scene.traverse((c) => {
        const m = c as Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat) => {
            (mat as MeshStandardMaterial).map?.dispose();
            mat.dispose();
          });
        }
      });
      return { bytes, warnings, check: { ok: !problems.length, meshes, expectedMeshes, nodes, problems } };
    } finally {
      for (const p of hiddenPlaceholders) p.visible = true;
      if (sunClone) {
        content.remove(sunClone);
        sunClone.dispose();
      }
    }
  }

  function reload(id: string) {
    if (models.get(id)?.state.status === "failed") models.delete(id);
    if (textures.get(id)?.state.status === "failed") textures.delete(id);
    for (const s of slots.values()) if (s.node.asset === id || s.node.material?.texture === id) s.bodyKey = "";
    if (doc) sync(doc, selection);
  }

  /* ----------------------------------------------------------- dispose */
  function dispose() {
    disposed = true;
    cancelAnimationFrame(frame);
    timer.dispose();
    ro.disconnect();
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("keydown", onKey);
    canvas.removeEventListener("keyup", onKey);
    canvas.removeEventListener("blur", onBlur);
    gizmo.detach();
    gizmo.dispose();
    controls.dispose();
    viewHelper.dispose();
    for (const s of slots.values()) release(s);
    slots.clear();
    for (const e of models.values()) disposeTree(e.template);
    for (const t of textures.values()) t.texture?.dispose();
    for (const b of boxes.values()) {
      b.geometry.dispose();
      (b.material as Material).dispose();
    }
    grid.geometry.dispose();
    (grid.material as Material).dispose();
    placeholderGeo.dispose();
    placeholderMat.dispose();
    target.dispose();
    post.dispose();
    renderer.dispose();
    canvas.remove();
  }

  return {
    sync,
    setGizmo: (m) => gizmo.setMode(m),
    setView,
    setCompare: (on) => {
      compare = on;
    },
    focus,
    groundPoint(clientX, clientY) {
      toNdc(clientX, clientY);
      const p = new Vector3();
      return raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), p) ? [round(p.x), 0, round(p.z)] : null;
    },
    exportGlb,
    assetTriangles: (id) => models.get(id)?.triangles ?? null,
    reload,
    dispose,
  };
}

export type { Camera };
