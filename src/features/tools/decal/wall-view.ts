/**
 * 3D wall preview for the decal tool: a lit, textured wall with the decal
 * on a quad just in front of it. Imported on demand (three.js).
 */
import {
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export interface WallView {
  setDecal(bitmap: ImageBitmap, width: number, height: number): void;
  setWall(url: string): void;
  dispose(): void;
}

export function createWallView(host: HTMLElement): WallView {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x050505);
  const canvas = renderer.domElement;
  canvas.className = "block size-full touch-none outline-none";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "The decal on a lit 3D wall. Drag to look around, scroll to zoom.");
  host.appendChild(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.05, 50);
  camera.position.set(0.9, 0.2, 2.6);
  scene.add(new HemisphereLight(0xffffff, 0x202020, 1.1));
  const sun = new DirectionalLight(0xffffff, 2.2);
  sun.position.set(-2.5, 1.5, 2); // raking light shows the wall's surface
  scene.add(sun);

  const wallMat = new MeshStandardMaterial({ roughness: 0.95 });
  const wall = new Mesh(new PlaneGeometry(3.2, 2.2), wallMat);
  scene.add(wall);
  const decalMat = new MeshStandardMaterial({ transparent: true, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
  const decal = new Mesh(new PlaneGeometry(1, 1), decalMat);
  decal.position.z = 0.002;
  scene.add(decal);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);
  controls.minDistance = 0.6;
  controls.maxDistance = 6;
  controls.maxAzimuthAngle = 1.2;
  controls.minAzimuthAngle = -1.2;

  let frame = 0;
  const render = () => {
    frame = 0;
    const moving = controls.update();
    renderer.render(scene, camera);
    if (moving) frame = requestAnimationFrame(render);
  };
  const invalidate = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };
  controls.addEventListener("change", invalidate);
  const ro = new ResizeObserver(() => {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    invalidate();
  });
  ro.observe(host);

  let wallTex: Texture | null = null;
  let decalTex: Texture | null = null;
  const loader = new TextureLoader();
  return {
    setDecal(bitmap, width, height) {
      decalTex?.dispose();
      decalTex = new Texture(bitmap);
      decalTex.colorSpace = SRGBColorSpace;
      decalTex.flipY = false; // the bitmap arrives already flipped for WebGL
      decalTex.needsUpdate = true;
      decalMat.map = decalTex;
      decalMat.needsUpdate = true;
      const s = 1.1 / Math.max(width, height);
      decal.scale.set(width * s, height * s, 1);
      invalidate();
    },
    setWall(url) {
      loader.load(url, (t) => {
        wallTex?.dispose();
        wallTex = t;
        t.colorSpace = SRGBColorSpace;
        t.wrapS = t.wrapT = RepeatWrapping;
        t.repeat.set(3.2, 2.2);
        t.magFilter = t.minFilter = NearestFilter;
        wallMat.map = t;
        wallMat.needsUpdate = true;
        invalidate();
      });
    },
    dispose() {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      wall.geometry.dispose();
      decal.geometry.dispose();
      wallMat.dispose();
      decalMat.dispose();
      wallTex?.dispose();
      decalTex?.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
