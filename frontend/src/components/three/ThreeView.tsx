import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useAppSelector } from "@/store";
import { sampleElevation, toLocal } from "@/lib/geo";

interface Ctx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group;
}

function disposeGroup(g: THREE.Group) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
  });
  g.clear();
}

export default function ThreeView() {
  const { terrain, parcel, selected } = useAppSelector((s) => s.lot);
  const exaggeration = useAppSelector((s) => s.ui.exaggeration);
  const mountRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const framedFor = useRef<unknown>(null);

  // renderer, camera, controls, render loop (once)
  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#dfe7e1");
    scene.add(new THREE.HemisphereLight(0xffffff, 0x556b55, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(400, 800, 300);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(50, 1, 1, 20000);
    camera.position.set(0, 350, 450);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;

    const content = new THREE.Group();
    scene.add(content);
    ctxRef.current = { renderer, scene, camera, controls, content };

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    resize();

    let raf = 0;
    const loop = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      disposeGroup(content);
      renderer.dispose();
      renderer.domElement.remove();
      ctxRef.current = null;
    };
  }, []);

  // rebuild terrain + parcel when data / exaggeration change
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    disposeGroup(ctx.content);
    if (!terrain) return;

    const { n, sizeM, elevations, minElevation, maxElevation, centerLat, centerLon } = terrain;
    const half = sizeM / 2;
    const range = maxElevation - minElevation || 1;
    const yOf = (elev: number) => (elev - minElevation) * exaggeration;

    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const low = new THREE.Color("#5f8f5a"), high = new THREE.Color("#c9b98c"), peak = new THREE.Color("#f4f1ea");
    const tmp = new THREE.Color();
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const i = r * n + c;
        const e = elevations[i];
        pos[i * 3] = -half + (c / (n - 1)) * sizeM;
        pos[i * 3 + 1] = yOf(e);
        pos[i * 3 + 2] = -(-half + (r / (n - 1)) * sizeM); // z = -north
        const t = (e - minElevation) / range;
        (t < 0.6 ? tmp.copy(low).lerp(high, t / 0.6) : tmp.copy(high).lerp(peak, (t - 0.6) / 0.4));
        col.set([tmp.r, tmp.g, tmp.b], i * 3);
      }
    }
    const idx: number[] = [];
    for (let r = 0; r < n - 1; r++) {
      for (let c = 0; c < n - 1; c++) {
        const a = r * n + c, b = a + 1, d = a + n, e = d + 1;
        idx.push(a, b, d, b, e, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
    ctx.content.add(mesh);
    ctx.content.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x33473a, wireframe: true, transparent: true, opacity: 0.12 })));

    // parcel outline with posts so small lots remain visible
    if (parcel?.boundary.length) {
      const pts = parcel.boundary.map((p) => {
        const { east, north } = toLocal(p.lon, p.lat, centerLon, centerLat);
        return new THREE.Vector3(east, yOf(sampleElevation(terrain, east, north)) + 1, -north);
      });
      const loop = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xc2410c }));
      ctx.content.add(loop);
      const posts = new THREE.BufferGeometry().setFromPoints(pts.flatMap((p) => [p, p.clone().add(new THREE.Vector3(0, 25, 0))]));
      ctx.content.add(new THREE.LineSegments(posts, new THREE.LineBasicMaterial({ color: 0xc2410c })));
    }
    if (selected) {
      const { east, north } = toLocal(selected.lon, selected.lat, centerLon, centerLat);
      const s = new THREE.Mesh(new THREE.SphereGeometry(5, 16, 12), new THREE.MeshStandardMaterial({ color: 0xc2410c }));
      s.position.set(east, yOf(sampleElevation(terrain, east, north)) + 5, -north);
      ctx.content.add(s);
    }

    // re-frame the camera only when a new terrain arrives (not on slider changes)
    if (framedFor.current !== terrain) {
      framedFor.current = terrain;
      ctx.controls.target.set(0, 0, 0);
      ctx.camera.position.set(0, sizeM * 0.3, sizeM * 0.4);
    }
  }, [terrain, parcel, selected, exaggeration]);

  return (
    <div ref={mountRef} className="relative h-full w-full">
      {!terrain && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Search an address to build the 3D terrain.
        </div>
      )}
    </div>
  );
}
