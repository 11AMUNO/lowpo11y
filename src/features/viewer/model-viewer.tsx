"use client";

import { useEffect, useRef, useState } from "react";
import { OnOff } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/controls";
import { Progress } from "@/components/ui/feedback";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { track } from "@/lib/analytics/client";

type Shading = "shaded" | "unlit" | "wire";

interface Handle {
  setShading(mode: Shading): void;
  setGrid(on: boolean): void;
  setSpin(on: boolean): void;
  reset(): void;
  dispose(): void;
}

interface Stats {
  triangles: number;
  vertices: number;
  meshes: number;
  textures: number;
  size: [number, number, number];
}

/**
 * Orbitable GLB preview. three.js is imported on mount so catalogue pages
 * never pay for it; the thumbnail stands in until the model is ready and
 * stays as the fallback when WebGL is unavailable.
 */
export function ModelViewer({ src, poster, title, className }: { src: string; poster?: string | null; title: string; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<Handle | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [shading, setShading] = useState<Shading>("shaded");
  const [grid, setGrid] = useState(true);
  const [spin, setSpin] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let cancelled = false;
    (async () => {
      const THREE = await import("three");
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
      if (cancelled) return;

      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      } catch {
        throw new Error("Your browser couldn't start WebGL, so the 3D preview is off. The thumbnail shows the model instead.");
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      const canvas = renderer.domElement;
      canvas.className = "block h-full w-full touch-none outline-none";
      canvas.tabIndex = 0;
      canvas.setAttribute("aria-label", `3D preview of ${title}. Drag to orbit, scroll or pinch to zoom, arrow keys to pan.`);
      canvas.setAttribute("role", "img");
      el.appendChild(canvas);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.9);
      sun.position.set(3, 5, 4);
      scene.add(sun);

      const gltf = await new GLTFLoader().loadAsync(src);
      if (cancelled) {
        renderer.dispose();
        return;
      }
      const model = gltf.scene;
      scene.add(model);

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const radius = Math.max(size.length() / 2, 0.01);

      // Grid cells snap to a power of ten near the model's size (0.1, 1, 10 units…).
      const cell = 10 ** Math.floor(Math.log10(radius));
      const divisions = Math.min(60, Math.max(4, Math.ceil((radius * 6) / cell)));
      const gridHelper = new THREE.GridHelper(cell * divisions, divisions, 0x5a5a5a, 0x262626);
      gridHelper.position.y = box.min.y;
      scene.add(gridHelper);

      // Materials for each shading mode, swapped in place.
      const originals = new Map<InstanceType<typeof THREE.Mesh>, InstanceType<typeof THREE.Material> | InstanceType<typeof THREE.Material>[]>();
      const unlit = new Map<InstanceType<typeof THREE.Mesh>, InstanceType<typeof THREE.Material>>();
      const wire = new THREE.MeshBasicMaterial({ color: 0xe8e8e8, wireframe: true });
      const textures = new Set<unknown>();
      let triangles = 0;
      let vertices = 0;
      let meshes = 0;
      model.traverse((o) => {
        const mesh = o as InstanceType<typeof THREE.Mesh>;
        if (!mesh.isMesh) return;
        meshes++;
        const g = mesh.geometry;
        const count = g.index ? g.index.count : g.attributes.position!.count;
        triangles += Math.floor(count / 3);
        vertices += g.attributes.position!.count;
        originals.set(mesh, mesh.material);
        const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as InstanceType<typeof THREE.MeshStandardMaterial>;
        if (src.map) textures.add(src.map);
        unlit.set(mesh, new THREE.MeshBasicMaterial({ map: src.map ?? null, color: src.map ? 0xffffff : src.color, transparent: src.transparent, alphaTest: src.alphaTest, side: src.side }));
      });

      const controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true;
      controls.dampingFactor = 0.12;
      controls.listenToKeyEvents(canvas);
      const home = () => {
        const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.08;
        const dir = new THREE.Vector3(1, 0.7, 1.25).normalize();
        camera.position.copy(centre).addScaledVector(dir, dist);
        camera.near = dist / 100;
        camera.far = dist * 100;
        camera.updateProjectionMatrix();
        controls.target.copy(centre);
        controls.minDistance = radius * 0.3;
        controls.maxDistance = dist * 6;
        controls.update();
      };
      home();

      let frame = 0;
      let spinning = false;
      const render = () => {
        frame = 0;
        const moving = controls.update();
        renderer.render(scene, camera);
        if (moving || spinning) frame = requestAnimationFrame(render);
      };
      const invalidate = () => {
        if (!frame) frame = requestAnimationFrame(render);
      };
      controls.addEventListener("change", invalidate);

      const resize = () => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        invalidate();
      };
      const ro = new ResizeObserver(resize);
      ro.observe(el);
      resize();

      handle.current = {
        setShading(mode) {
          for (const [mesh, mat] of originals) mesh.material = mode === "shaded" ? mat : mode === "unlit" ? unlit.get(mesh)! : wire;
          invalidate();
        },
        setGrid(on) {
          gridHelper.visible = on;
          invalidate();
        },
        setSpin(on) {
          spinning = on;
          controls.autoRotate = on;
          controls.autoRotateSpeed = 1.6;
          invalidate();
        },
        reset() {
          home();
          invalidate();
        },
        dispose() {
          cancelAnimationFrame(frame);
          ro.disconnect();
          controls.dispose();
          model.traverse((o) => {
            const mesh = o as InstanceType<typeof THREE.Mesh>;
            if (!mesh.isMesh) return;
            mesh.geometry.dispose();
            const mats = originals.get(mesh);
            for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) m.dispose();
          });
          for (const m of unlit.values()) m.dispose();
          for (const t of textures) (t as { dispose(): void }).dispose();
          wire.dispose();
          renderer.dispose();
          canvas.remove();
        },
      };
      setStats({ triangles, vertices, meshes, textures: textures.size, size: [size.x, size.y, size.z] });
      setState("ready");
      track("preview", "asset:ok");
    })().catch((e: unknown) => {
      if (cancelled) return;
      setError(e instanceof Error && e.message ? e.message : "The 3D preview couldn't be loaded.");
      setState("error");
      track("preview", "asset:error");
    });
    return () => {
      cancelled = true;
      handle.current?.dispose();
      handle.current = null;
    };
  }, [src, title]);

  const ready = state === "ready";
  return (
    <div className={cn("flex flex-col", className)}>
      <div className="relative aspect-[4/3] w-full overflow-hidden border border-rule-strong bg-sunken sm:aspect-[16/10]">
        <div ref={host} className={cn("absolute inset-0", !ready && "invisible")} />
        {!ready && poster ? (
          <img src={poster} alt={`${title} thumbnail`} className="absolute inset-0 m-auto h-full max-h-full w-auto max-w-full object-contain" />
        ) : null}
        {state === "loading" ? (
          <div className="absolute inset-x-4 bottom-4">
            <Progress value={null} label="Loading model" />
          </div>
        ) : null}
        {state === "error" ? (
          <p role="status" className="absolute inset-x-3 bottom-3 border border-rule-strong bg-black/85 px-3 py-2 font-ocr text-xs tracking-[0.04em] text-fg">
            ! {error}
          </p>
        ) : null}
        {ready && stats ? (
          <p aria-hidden className="pointer-events-none absolute top-2 left-2.5 font-ocr text-[11px] tracking-[0.08em] text-muted uppercase">
            {formatCount(stats.triangles)} tris // {formatCount(stats.vertices)} verts // {stats.meshes} {stats.meshes === 1 ? "mesh" : "meshes"}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border border-t-0 border-rule-strong bg-panel px-3 py-2">
        <SegmentedControl
          label="Shading"
          inline
          size="sm"
          className="w-[17rem] grid-cols-[64px_1fr]"
          value={shading}
          onChange={(v) => {
            setShading(v);
            handle.current?.setShading(v);
          }}
          options={[
            { value: "shaded", label: "Shaded", disabled: !ready },
            { value: "unlit", label: "Unlit", title: "Texture colours without lighting", disabled: !ready },
            { value: "wire", label: "Wire", disabled: !ready },
          ]}
        />
        <span className="flex items-center gap-2 font-ocr text-[11px] tracking-[0.08em] text-muted uppercase">
          Grid
          <OnOff
            on={grid}
            label="Show ground grid"
            disabled={!ready}
            onToggle={() => {
              setGrid(!grid);
              handle.current?.setGrid(!grid);
            }}
          />
        </span>
        <span className="flex items-center gap-2 font-ocr text-[11px] tracking-[0.08em] text-muted uppercase">
          Spin
          <OnOff
            on={spin}
            label="Turntable rotation"
            disabled={!ready}
            onToggle={() => {
              setSpin(!spin);
              handle.current?.setSpin(!spin);
            }}
          />
        </span>
        <button
          type="button"
          disabled={!ready}
          onClick={() => handle.current?.reset()}
          className="ml-auto cursor-pointer font-ocr text-[11px] tracking-[0.08em] text-muted uppercase hover:text-bright disabled:cursor-not-allowed disabled:opacity-35"
        >
          [ Reset view ]
        </button>
      </div>
      {stats ? (
        <p className="mt-1.5 font-ocr text-[11px] tracking-[0.06em] text-muted uppercase">
          Bounds {stats.size.map((v) => v.toFixed(2)).join(" × ")} units // {stats.textures} {stats.textures === 1 ? "texture" : "textures"} // drag to orbit, scroll to zoom
        </p>
      ) : null}
    </div>
  );
}
