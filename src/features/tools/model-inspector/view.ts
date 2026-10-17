/**
 * three.js side of the model inspector. Imported dynamically, so three.js
 * only downloads when the tool opens. Everything a model allocates on the
 * GPU (geometry, materials, textures, skeleton textures) is disposed on
 * unload, and `memory()` reports the renderer's live counts so leaks show.
 */
import {
  AmbientLight,
  AnimationMixer,
  AxesHelper,
  Box3,
  Box3Helper,
  Clock,
  Color,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  HemisphereLight,
  LoadingManager,
  MathUtils,
  MeshBasicMaterial,
  MeshNormalMaterial,
  NearestFilter,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
  type AnimationClip,
  type Material,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
  type Texture,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DEFAULT_DISPLAY, type InspectInfo, type InspectorView, type ModelSource } from "./types";

export type { InspectorView, ModelSource };

const BACKGROUNDS = { dark: 0x050505, grey: 0x3a3a3a, light: 0xd8d8d8 };
const MAP_SLOTS = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "alphaMap", "bumpMap", "specularMap", "lightMap"] as const;

type Mats = Material | Material[];
const each = (m: Mats, fn: (x: Material) => void) => (Array.isArray(m) ? m.forEach(fn) : fn(m));

export function createView(host: HTMLElement, onTime: (t: number, duration: number, playing: boolean) => void): InspectorView {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
  } catch {
    throw new Error("Your browser couldn't start WebGL, so the 3D view is unavailable. The statistics below still come from the file itself.");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.className = "block size-full touch-none outline-none";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "3D view of the model. Drag to orbit, right-drag to pan, scroll to zoom, arrow keys to pan.");
  host.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.01, 1000);
  const hemi = new HemisphereLight(0xffffff, 0x303030, 1.6);
  const sun = new DirectionalLight(0xffffff, 1.9);
  sun.position.set(3, 5, 4);
  const ambient = new AmbientLight(0xffffff, 0);
  scene.add(hemi, sun, ambient);
  const axes = new AxesHelper(1);
  axes.visible = false;
  scene.add(axes);
  let grid: GridHelper | null = null;
  let boundsHelper: Box3Helper | null = null;

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.listenToKeyEvents(canvas);

  let display = DEFAULT_DISPLAY;
  let model: Object3D | null = null;
  let clips: AnimationClip[] = [];
  let mixer: AnimationMixer | null = null;
  let action: AnimationAction | null = null;
  let playing = false;
  const clock = new Clock(false);
  const originals = new Map<Mesh, Mats>();
  const replacements: Material[] = [];
  const textures = new Set<Texture>();
  const flatState = new Map<Material, boolean>();
  let home = { centre: new Vector3(), radius: 1 };

  let frame = 0;
  const render = () => {
    frame = 0;
    if (mixer && playing) {
      mixer.update(clock.getDelta());
      if (action) onTime(action.time, action.getClip().duration, true);
    }
    const moving = controls.update();
    renderer.render(scene, camera);
    if (moving || playing) frame = requestAnimationFrame(render);
  };
  const invalidate = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };
  controls.addEventListener("change", invalidate);

  const resize = () => {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    invalidate();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  const frameCamera = () => {
    const { centre, radius } = home;
    const dist = (radius / Math.sin(MathUtils.degToRad(camera.fov / 2))) * 1.1;
    camera.position.copy(centre).addScaledVector(new Vector3(1, 0.7, 1.25).normalize(), dist);
    camera.near = dist / 200;
    camera.far = dist * 200;
    camera.updateProjectionMatrix();
    controls.target.copy(centre);
    controls.minDistance = radius * 0.05;
    controls.maxDistance = dist * 10;
    controls.update();
  };

  const applyDisplay = () => {
    renderer.setClearColor(new Color(BACKGROUNDS[display.background]));
    hemi.intensity = display.lights === "studio" ? 1.6 : display.lights === "soft" ? 1.1 : 0;
    sun.intensity = display.lights === "studio" ? 1.9 : display.lights === "soft" ? 0.6 : 0;
    ambient.intensity = display.lights === "flat" ? 2.6 : 0;
    if (grid) grid.visible = display.grid;
    axes.visible = display.axes;
    if (boundsHelper) boundsHelper.visible = display.bounds;
    for (const r of replacements) r.dispose();
    replacements.length = 0;
    const wire = new MeshBasicMaterial({ color: 0xe8e8e8, wireframe: true });
    const normals = new MeshNormalMaterial({ flatShading: display.flat });
    replacements.push(wire, normals);
    for (const [mesh, mats] of originals) {
      each(mats, (m) => {
        // flat shading on the file's own materials when they support it
        if ("flatShading" in m) {
          if (!flatState.has(m)) flatState.set(m, Boolean((m as { flatShading?: boolean }).flatShading));
          (m as { flatShading: boolean }).flatShading = display.flat || flatState.get(m)!;
          m.needsUpdate = true;
        }
      });
      if (display.mode === "shaded") mesh.material = mats;
      else if (display.mode === "wire") mesh.material = wire;
      else if (display.mode === "normals") mesh.material = normals;
      else {
        const unlit = (m: Material) => {
          const src = m as Material & { map?: Texture | null; color?: Color; vertexColors?: boolean };
          const u = new MeshBasicMaterial({ map: src.map ?? null, color: src.map ? 0xffffff : (src.color ?? new Color(0xcccccc)), transparent: m.transparent, alphaTest: m.alphaTest, side: m.side, vertexColors: src.vertexColors ?? false });
          replacements.push(u);
          return u;
        };
        mesh.material = Array.isArray(mats) ? mats.map(unlit) : unlit(mats);
      }
    }
    invalidate();
  };

  const unload = () => {
    if (mixer) {
      mixer.stopAllAction();
      if (model) mixer.uncacheRoot(model);
    }
    mixer = null;
    action = null;
    playing = false;
    clips = [];
    if (model) {
      model.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const sk = o as SkinnedMesh;
        if (sk.isSkinnedMesh) sk.skeleton.dispose();
      });
      scene.remove(model);
    }
    for (const mats of originals.values()) each(mats, (m) => m.dispose());
    for (const r of replacements) r.dispose();
    for (const t of textures) t.dispose();
    originals.clear();
    replacements.length = 0;
    textures.clear();
    flatState.clear();
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as Material).dispose();
      grid = null;
    }
    if (boundsHelper) {
      scene.remove(boundsHelper);
      boundsHelper.geometry.dispose();
      (boundsHelper.material as Material).dispose();
      boundsHelper = null;
    }
    model = null;
    renderer.renderLists.dispose();
    invalidate();
  };

  return {
    async load(src) {
      unload();
      const manager = new LoadingManager();
      if (src.kind === "gltf") manager.setURLModifier((url) => src.urls.get(url) ?? url);
      const loader = new GLTFLoader(manager);
      const gltf = await loader.parseAsync(src.kind === "glb" ? src.data : src.json, "");
      model = gltf.scene;
      clips = gltf.animations;
      scene.add(model);
      model.updateMatrixWorld(true);

      const info: InspectInfo = { meshes: [], materials: [], textures: [], animations: [], measured: { calls: 0, triangles: 0 }, size: [0, 0, 0] };
      const matInfo = new Map<Material, InspectInfo["materials"][number]>();
      const texInfo = new Map<Texture, InspectInfo["textures"][number]>();
      model.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        originals.set(mesh, mesh.material);
        const g = mesh.geometry;
        const count = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
        const names: string[] = [];
        each(mesh.material, (m) => {
          names.push(m.name || "(unnamed)");
          if (matInfo.has(m)) return;
          const maps: string[] = [];
          for (const slot of MAP_SLOTS) {
            const t = (m as unknown as Record<string, Texture | null | undefined>)[slot];
            if (!t) continue;
            maps.push(slot);
            textures.add(t);
            const img = t.image as { width?: number; height?: number } | undefined;
            const e = texInfo.get(t) ?? { name: t.name || `texture ${texInfo.size + 1}`, width: img?.width ?? 0, height: img?.height ?? 0, slots: [], nearest: t.magFilter === NearestFilter };
            e.slots.push(slot);
            texInfo.set(t, e);
          }
          matInfo.set(m, { name: m.name || "(unnamed)", type: m.type, maps, transparent: m.transparent, alphaTest: m.alphaTest, doubleSided: m.side === DoubleSide, vertexColors: Boolean((m as { vertexColors?: boolean }).vertexColors) });
        });
        info.meshes.push({
          name: mesh.name || "(unnamed)",
          triangles: Math.floor(count / 3),
          vertices: g.attributes.position?.count ?? 0,
          materials: names,
          skinned: Boolean((o as SkinnedMesh).isSkinnedMesh),
          morphs: g.morphAttributes.position?.length ?? 0,
        });
      });
      info.materials = [...matInfo.values()];
      info.textures = [...texInfo.values()];
      info.animations = clips.map((c) => ({ name: c.name || "(unnamed)", duration: c.duration, tracks: c.tracks.length }));

      const box = new Box3().setFromObject(model);
      const size = box.isEmpty() ? new Vector3() : box.getSize(new Vector3());
      const centre = box.isEmpty() ? new Vector3() : box.getCenter(new Vector3());
      info.size = [size.x, size.y, size.z];
      home = { centre, radius: Math.max(size.length() / 2, 0.01) };
      const cell = 10 ** Math.floor(Math.log10(home.radius));
      const divisions = Math.min(60, Math.max(4, Math.ceil((home.radius * 6) / cell)));
      grid = new GridHelper(cell * divisions, divisions, 0x5a5a5a, 0x262626);
      grid.position.y = box.isEmpty() ? 0 : box.min.y;
      scene.add(grid);
      boundsHelper = new Box3Helper(box, 0xffffff);
      scene.add(boundsHelper);
      axes.scale.setScalar(home.radius);
      frameCamera();
      if (clips.length) mixer = new AnimationMixer(model);

      // measure the model alone: hide the helpers for one render
      const vis = [grid.visible, axes.visible, boundsHelper.visible];
      grid.visible = axes.visible = boundsHelper.visible = false;
      renderer.render(scene, camera);
      info.measured = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
      [grid.visible, axes.visible, boundsHelper.visible] = vis;
      applyDisplay();
      return info;
    },
    unload,
    setDisplay(d) {
      display = d;
      applyDisplay();
    },
    reset() {
      frameCamera();
      invalidate();
    },
    select(i) {
      if (!mixer || !clips[i] || action?.getClip() === clips[i]) return;
      mixer.stopAllAction();
      action = mixer.clipAction(clips[i]!);
      action.play();
      action.paused = !playing;
      mixer.update(0);
      onTime(0, clips[i]!.duration, playing);
      invalidate();
    },
    play(i) {
      if (!mixer || !clips[i]) return;
      this.select(i);
      action!.paused = false;
      playing = true;
      clock.start();
      invalidate();
    },
    pause() {
      playing = false;
      clock.stop();
      if (action) {
        action.paused = true;
        onTime(action.time, action.getClip().duration, false);
      }
    },
    setTime(t) {
      if (!mixer || !action) return;
      action.time = Math.max(0, Math.min(t, action.getClip().duration));
      mixer.update(0);
      onTime(action.time, action.getClip().duration, playing);
      invalidate();
    },
    async screenshot() {
      renderer.render(scene, camera);
      const url = canvas.toDataURL("image/png");
      return (await fetch(url)).blob();
    },
    memory() {
      // draw first so the counts include everything the current view uses
      renderer.render(scene, camera);
      return { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
    },
    dispose() {
      unload();
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      scene.remove(axes);
      axes.geometry.dispose();
      (axes.material as Material).dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
