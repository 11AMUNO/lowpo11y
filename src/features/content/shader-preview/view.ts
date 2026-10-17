/**
 * Live preview for three.js shader entries: a small low-poly courtyard drawn
 * with the entry's own GLSL as a ShaderMaterial, at a low internal
 * resolution scaled up with nearest filtering. Imported on demand. Shader
 * compile errors are caught and reported instead of logged.
 */
import {
  BoxGeometry,
  type BufferAttribute,
  Color,
  CylinderGeometry,
  Fog,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  WebGLRenderer,
  type BufferGeometry,
  type IUniform,
  type Material,
  type Texture,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ShaderStages } from "./parse";

export type PreviewResolution = "240" | "480" | "full";

export interface ShaderPreviewView {
  /** Compiles the shader; returns the compiler's message when it fails. */
  setShader(stages: ShaderStages, values: Record<string, number>): string | null;
  setValue(name: string, value: number): void;
  setResolution(r: PreviewResolution): void;
  setCompare(standard: boolean): void;
  setPlaying(playing: boolean): void;
  dispose(): void;
}

const FOG = 0x0b0b0b;
const FOG_NEAR = 5;
const FOG_FAR = 17;

function scaleUv(g: BufferGeometry, sx: number, sy = sx): BufferGeometry {
  const uv = g.getAttribute("uv") as BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
  uv.needsUpdate = true;
  return g;
}

export function createShaderPreview(host: HTMLElement, opts: { autoRotate: boolean }): ShaderPreviewView {
  let renderer: WebGLRenderer;
  try {
    // preserveDrawingBuffer lets the canvas be read back (tests, screenshots).
    renderer = new WebGLRenderer({ antialias: false, powerPreference: "low-power", preserveDrawingBuffer: true });
  } catch {
    throw new Error("Your browser couldn't start WebGL, so the live preview is unavailable. The code and download below still work.");
  }
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(FOG);
  let compileError: string | null = null;
  renderer.debug.onShaderError = (gl, _program, vs, fs) => {
    const logs = [gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)].map((l) => (l ?? "").trim()).filter(Boolean);
    compileError = logs.join("\n").slice(0, 2000) || "The shader failed to compile or link.";
  };
  const canvas = renderer.domElement;
  canvas.className = "block size-full touch-none outline-none [image-rendering:pixelated]";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Live preview of the shader on a small courtyard scene. Drag to orbit, scroll to zoom.");
  host.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(55, 4 / 3, 0.1, 60);
  camera.position.set(6.5, 3.2, 7.5);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.9, 0);
  controls.enableDamping = true;
  controls.minDistance = 2.5;
  controls.maxDistance = 16;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.autoRotate = opts.autoRotate;
  controls.autoRotateSpeed = 0.6;

  const loader = new TextureLoader();
  const textures: Texture[] = [];
  const tex = (name: string) => {
    const t = loader.load(`/demo/textures/${name}.png`, () => draw());
    t.magFilter = NearestFilter;
    t.minFilter = NearestFilter;
    t.generateMipmaps = false;
    t.wrapS = t.wrapT = RepeatWrapping;
    textures.push(t);
    return t;
  };
  const maps = { ground: tex("demo-cobblestones"), crate: tex("demo-wood-planks"), wall: tex("demo-red-brick"), pillar: tex("demo-poured-concrete") };

  const geometries: BufferGeometry[] = [];
  const geo = <G extends BufferGeometry>(g: G) => (geometries.push(g), g);
  const parts: { mesh: Mesh; map: Texture }[] = [];
  const add = (g: BufferGeometry, map: Texture, x: number, y: number, z: number, ry = 0) => {
    const mesh = new Mesh(g, new MeshBasicMaterial());
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    scene.add(mesh);
    parts.push({ mesh, map });
  };
  // Large, coarsely divided polygons on purpose: affine warping shows on them, as it did on the console.
  const ground = scaleUv(geo(new PlaneGeometry(18, 18, 3, 3)), 6);
  ground.rotateX(-Math.PI / 2);
  add(ground, maps.ground, 0, 0, 0);
  add(geo(new BoxGeometry(1.2, 1.2, 1.2)), maps.crate, 0.4, 0.6, 0.2, 0.35);
  add(geo(new BoxGeometry(0.8, 0.8, 0.8)), maps.crate, 0.55, 1.6, 0.1, -0.2);
  add(geo(new BoxGeometry(1, 1, 1)), maps.crate, -1.3, 0.5, 1.1, 0.9);
  add(scaleUv(geo(new BoxGeometry(9, 2.6, 0.5)), 4, 1.2), maps.wall, 0, 1.3, -3.2);
  add(scaleUv(geo(new BoxGeometry(0.5, 2.6, 6)), 1, 1.2), maps.wall, -4.3, 1.3, -0.45);
  add(scaleUv(geo(new CylinderGeometry(0.45, 0.45, 3.2, 8, 1)), 2, 1.5), maps.pillar, 2.8, 1.6, -1.6);
  add(scaleUv(geo(new CylinderGeometry(0.45, 0.45, 3.2, 8, 1)), 2, 1.5), maps.pillar, 2.8, 1.6, 2.6);

  const shared: Record<string, IUniform> = {
    uTime: { value: 0 },
    uResolution: { value: new Vector2(320, 240) },
    fogColor: { value: new Color(FOG) },
    fogNear: { value: FOG_NEAR },
    fogFar: { value: FOG_FAR },
  };
  const fog = new Fog(FOG, FOG_NEAR, FOG_FAR);
  let shaderMats: ShaderMaterial[] = [];
  const standardMats = parts.map((p) => new MeshBasicMaterial({ map: p.map }));
  let compare = false;
  let resolution: PreviewResolution = "240";
  let playing = true;
  let frame = 0;
  const start = performance.now();

  function applyMaterials() {
    scene.fog = compare ? fog : null;
    parts.forEach((p, i) => (p.mesh.material = compare || !shaderMats[i] ? standardMats[i]! : shaderMats[i]!));
  }

  function resize() {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (resolution === "full") {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h, false);
    } else {
      const rows = Number(resolution);
      renderer.setPixelRatio(1);
      renderer.setSize(Math.max(1, Math.round((rows * w) / h)), rows, false);
    }
    const size = renderer.getDrawingBufferSize(new Vector2());
    (shared.uResolution!.value as Vector2).copy(size);
    draw();
  }

  function draw() {
    shared.uTime!.value = (performance.now() - start) / 1000;
    renderer.render(scene, camera);
  }

  // Controls update every frame (damping, auto-rotate) and announce camera moves with
  // "change"; while paused, only those moves redraw. draw() never calls update(),
  // so a "change" can't recurse.
  function loop() {
    frame = requestAnimationFrame(loop);
    controls.update();
    if (playing) draw();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  frame = requestAnimationFrame(loop);
  controls.addEventListener("change", () => !playing && draw());

  return {
    setShader(stages, values) {
      const next = parts.map(
        (p) =>
          new ShaderMaterial({
            vertexShader: stages.vertex,
            fragmentShader: stages.fragment,
            uniforms: { ...shared, ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v }])), map: { value: p.map } },
          }),
      );
      // Controls share one uniform object across materials, so a slider updates every mesh.
      for (const name of Object.keys(values)) {
        const u = next[0]!.uniforms[name]!;
        for (const m of next) m.uniforms[name] = u;
      }
      const old = shaderMats;
      shaderMats = next;
      compileError = null;
      parts.forEach((p, i) => (p.mesh.material = next[i]!));
      scene.fog = null;
      renderer.compile(scene, camera);
      if (!compileError) {
        // compile() can defer; one real render surfaces link errors too.
        renderer.render(scene, camera);
      }
      old.forEach((m) => m.dispose());
      applyMaterials();
      draw();
      return compileError;
    },
    setValue(name, value) {
      const u = shaderMats[0]?.uniforms[name];
      if (u) u.value = value;
      if (!playing) draw();
    },
    setResolution(r) {
      resolution = r;
      resize();
    },
    setCompare(standard) {
      compare = standard;
      applyMaterials();
      draw();
    },
    setPlaying(p) {
      playing = p;
      controls.autoRotate = p && opts.autoRotate;
    },
    dispose() {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      for (const g of geometries) g.dispose();
      const mats: Material[] = [...shaderMats, ...standardMats];
      for (const m of mats) m.dispose();
      for (const t of textures) t.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
