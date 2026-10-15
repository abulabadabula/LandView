import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Check,
  Download,
  Eye,
  EyeOff,
  House,
  Info,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppSelector } from "@/store";

type RoofStyle = "Gable roof" | "Hip roof" | "Flat roof" | "Mono-pitch roof" | "Mixed roof";
type GarageStyle = "No garage" | "Single garage" | "Double garage" | "Carport";
type TerrainMode = "Adapt to terrain" | "Level pad" | "Stepped floor plates";
type GfaBasis = "Undecided" | "Includes garage" | "Excludes garage";

interface HouseParameters {
  storeys: number;
  bedrooms: number;
  grossFloorAreaTargetM2: number;
  style: string;
  roof: RoofStyle;
  garage: GarageStyle;
  terrainAdaptation: TerrainMode;
  gfaBasis: GfaBasis;
  terrainSlopePercent: number;
  roofPitchDeg: number;
  showRoof: boolean;
  showWindows: boolean;
  showTerrain: boolean;
  showGarage: boolean;
}

interface MassingMetrics {
  mainWidthM: number;
  mainDepthM: number;
  garageAreaM2: number;
  indicativeGfaM2: number;
  heightM: number;
  totalFootprintM2: number;
  accountingNote: string;
}

const INITIAL_PARAMETERS: HouseParameters = {
  storeys: 2,
  bedrooms: 4,
  grossFloorAreaTargetM2: 200,
  style: "Contemporary",
  roof: "Gable roof",
  garage: "Double garage",
  terrainAdaptation: "Adapt to terrain",
  gfaBasis: "Undecided",
  terrainSlopePercent: 8,
  roofPitchDeg: 32,
  showRoof: true,
  showWindows: true,
  showTerrain: true,
  showGarage: true,
};

const GARAGE_DIMENSIONS: Record<GarageStyle, { width: number; depth: number }> = {
  "No garage": { width: 0, depth: 0 },
  "Single garage": { width: 3.4, depth: 6.0 },
  "Double garage": { width: 6.1, depth: 6.2 },
  Carport: { width: 5.8, depth: 5.8 },
};

function disposeGroup(group: any) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    child.traverse((object: any) => {
      if (object.geometry && typeof object.geometry.dispose === "function") object.geometry.dispose();
      if (object.material) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((item: any) => item.dispose?.());
      }
    });
  }
}

function makeMaterial(colour: string, roughness = 0.82, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color: colour, roughness, metalness });
}

function addBox(
  parent: any,
  name: string,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  colour: string,
  options: { roughness?: number; metalness?: number } = {},
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(width, 0.02), Math.max(height, 0.02), Math.max(depth, 0.02)),
    makeMaterial(colour, options.roughness ?? 0.82, options.metalness ?? 0),
  );
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addWindow(parent: any, x: number, y: number, z: number, width: number, height: number) {
  const frame = "#f8f8f3";
  addBox(parent, "Window glass (visual placeholder)", x, y, z, width, height, 0.08, "#8fc6d0", { roughness: 0.28, metalness: 0.08 });
  addBox(parent, "Window frame top", x, y + height / 2, z + 0.045, width + 0.12, 0.075, 0.12, frame);
  addBox(parent, "Window frame bottom", x, y - height / 2, z + 0.045, width + 0.12, 0.075, 0.12, frame);
  addBox(parent, "Window frame left", x - width / 2, y, z + 0.045, 0.075, height, 0.12, frame);
  addBox(parent, "Window frame right", x + width / 2, y, z + 0.045, 0.075, height, 0.12, frame);
  addBox(parent, "Window mullion", x, y, z + 0.08, 0.045, height, 0.06, frame);
}

function pitchAngle(pitchDeg: number) {
  return (pitchDeg * Math.PI) / 180;
}

function addRoof(parent: any, width: number, depth: number, eaveY: number, pitchDeg: number, style: RoofStyle) {
  const roofGroup = new THREE.Group();
  roofGroup.name = "Roof assembly";
  const roofColour = "#45534f";
  const rise = Math.min((width / 2) * Math.tan(pitchAngle(pitchDeg)), 3.4);
  if (style === "Gable roof" || style === "Mixed roof") {
    const halfSpan = width / 2 + 0.22;
    const slopeLength = Math.sqrt(halfSpan * halfSpan + rise * rise);
    const angle = Math.atan2(rise, halfSpan);
    addBox(roofGroup, "Left gable roof plane", -width / 4, eaveY + rise / 2, 0, slopeLength, 0.18, depth + 0.85, roofColour, { roughness: 0.52, metalness: 0.15 }).rotation.z = angle;
    addBox(roofGroup, "Right gable roof plane", width / 4, eaveY + rise / 2, 0, slopeLength, 0.18, depth + 0.85, roofColour, { roughness: 0.52, metalness: 0.15 }).rotation.z = -angle;
    for (const side of [-1, 1]) {
      const shape = new THREE.Shape();
      shape.moveTo(-width / 2, 0);
      shape.lineTo(width / 2, 0);
      shape.lineTo(0, rise);
      shape.closePath();
      const gable = new THREE.Mesh(new THREE.ShapeGeometry(shape), makeMaterial("#e3e8df"));
      gable.name = "Gable end";
      gable.position.set(0, eaveY, side * (depth / 2 + 0.015));
      if (side < 0) gable.rotation.y = Math.PI;
      gable.castShadow = true;
      roofGroup.add(gable);
    }
  } else if (style === "Hip roof") {
    addBox(roofGroup, "Hip roof cap", 0, eaveY + rise * 0.42, 0, width + 0.7, 0.2, depth + 1.0, roofColour, { roughness: 0.52, metalness: 0.15 }).rotation.z = -0.035;
    addBox(roofGroup, "Hip roof ridge", 0, eaveY + rise * 0.8, 0, width * 0.35, 0.2, depth + 0.35, roofColour);
  } else if (style === "Flat roof") {
    addBox(roofGroup, "Flat roof parapet cap", 0, eaveY + 0.12, 0, width + 0.45, 0.25, depth + 0.45, roofColour);
    addBox(roofGroup, "Flat roof slab", 0, eaveY + 0.04, 0, width + 0.25, 0.12, depth + 0.25, "#9ca9a0");
  } else {
    addBox(roofGroup, "Mono-pitch roof", 0, eaveY + rise / 2, 0, width + 0.65, 0.18, depth + 0.85, roofColour, { roughness: 0.52, metalness: 0.15 }).rotation.z = -pitchAngle(pitchDeg);
  }
  parent.add(roofGroup);
  return roofGroup;
}

function addTerrain(parent: any, extentX: number, extentZ: number, slope: number) {
  const terrainGroup = new THREE.Group();
  terrainGroup.name = "Terrain and ground grid";
  const cols = 44;
  const rows = 36;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    const z = -extentZ / 2 + (extentZ * row) / rows;
    for (let col = 0; col <= cols; col += 1) {
      const x = -extentX / 2 + (extentX * col) / cols;
      positions.push(x, -slope * z, z);
    }
  }
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const a = row * (cols + 1) + col;
      const b = a + 1;
      const c = a + cols + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const ground = new THREE.Mesh(geometry, makeMaterial("#cbd6c1", 1));
  ground.name = "Slope surface (conceptual)";
  ground.receiveShadow = true;
  terrainGroup.add(ground);

  const gridPositions: number[] = [];
  for (let x = -Math.floor(extentX / 2); x <= Math.floor(extentX / 2); x += 1) {
    gridPositions.push(x, -slope * (-extentZ / 2), -extentZ / 2, x, -slope * (extentZ / 2), extentZ / 2);
  }
  for (let z = -Math.floor(extentZ / 2); z <= Math.floor(extentZ / 2); z += 1) {
    gridPositions.push(-extentX / 2, -slope * z, z, extentX / 2, -slope * z, z);
  }
  const gridGeometry = new THREE.BufferGeometry();
  gridGeometry.setAttribute("position", new THREE.Float32BufferAttribute(gridPositions, 3));
  terrainGroup.add(new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: "#aab6a3", transparent: true, opacity: 0.6 })));
  parent.add(terrainGroup);
  return terrainGroup;
}

function buildParametricHouse(parent: any, params: HouseParameters, slopePercent: number): MassingMetrics {
  const garageDimensions = GARAGE_DIMENSIONS[params.garage];
  const garageAreaM2 = garageDimensions.width * garageDimensions.depth;
  const targetForMainHouse = params.gfaBasis === "Includes garage"
    ? Math.max(35, params.grossFloorAreaTargetM2 - garageAreaM2)
    : params.grossFloorAreaTargetM2;
  const targetPerStorey = targetForMainHouse / params.storeys;
  const aspectRatio = 1.25;
  const mainWidth = Math.sqrt(targetPerStorey * aspectRatio);
  const mainDepth = targetPerStorey / mainWidth;
  const floorHeight = 2.8;
  const slabThickness = 0.18;
  const floorStep = floorHeight + slabThickness;
  const slope = slopePercent / 100;
  const garageDepth = garageDimensions.depth;
  const garageFrontZ = mainDepth / 2;
  const garageCenterZ = garageDepth > 0 ? garageFrontZ - garageDepth / 2 : 0;
  const rearExtent = Math.max(mainDepth / 2, garageCenterZ + garageDepth / 2);
  const frontExtent = Math.max(mainDepth / 2, garageCenterZ - garageDepth / 2);
  const maximumAbsZ = Math.max(Math.abs(rearExtent), Math.abs(frontExtent));
  const buildingBaseY = slope * maximumAbsZ + (params.terrainAdaptation === "Adapt to terrain" ? 0.42 : 0.55);

  if (params.terrainAdaptation === "Level pad") {
    addBox(parent, "Level pad platform (conceptual)", -garageDimensions.width / 2, buildingBaseY - 0.23, 0, mainWidth + garageDimensions.width + 1.4, 0.36, Math.max(mainDepth, garageDimensions.depth) + 1.3, "#b7b2a3");
  }

  const mainGroup = new THREE.Group();
  mainGroup.name = "Main house";
  const wallColour = params.style === "Coastal" ? "#f0e9d8" : params.style === "Scandinavian" ? "#e8e9e1" : "#e5e9e2";
  const accentColour = params.style === "Minimalist" ? "#d0d4cf" : "#c4cdc4";

  for (let level = 0; level < params.storeys; level += 1) {
    const floorBase = buildingBaseY + level * floorStep;
    addBox(mainGroup, "Storey " + (level + 1) + " external shell", 0, floorBase + floorHeight / 2, 0, mainWidth, floorHeight, mainDepth, level === 0 ? wallColour : accentColour);
    addBox(mainGroup, "Storey " + (level + 1) + " floor plate", 0, floorBase - 0.08, 0, mainWidth + 0.1, slabThickness, mainDepth + 0.1, "#9ba69c");
    if (level > 0) {
      addBox(mainGroup, "Storey " + (level + 1) + " separating slab", 0, floorBase - slabThickness / 2, 0, mainWidth + 0.12, slabThickness, mainDepth + 0.12, "#c2c9c0");
    }
  }

  const frontZ = mainDepth / 2 + 0.06;
  const windowGroup = new THREE.Group();
  windowGroup.name = "Window openings (visual placeholders)";
  for (let level = 0; level < params.storeys; level += 1) {
    const floorBase = buildingBaseY + level * floorStep;
    const windowY = floorBase + 1.65;
    const windowWidth = Math.min(2.0, mainWidth / 5);
    const positionsX = [-mainWidth * 0.29, mainWidth * 0.02, mainWidth * 0.30];
    positionsX.forEach((x, index) => {
      if (!(level === 0 && index === 2)) addWindow(windowGroup, x, windowY, frontZ, windowWidth, 1.25);
    });
    addWindow(windowGroup, 0, windowY, -mainDepth / 2 - 0.06, windowWidth * 1.25, 1.2);
  }
  mainGroup.add(windowGroup);
  const frontDoorX = mainWidth * 0.31;
  addBox(mainGroup, "Front entrance door", frontDoorX, buildingBaseY + 1.05, frontZ + 0.02, 0.95, 2.1, 0.12, "#72543e");
  addBox(mainGroup, "Entrance canopy", frontDoorX, buildingBaseY + 2.22, frontZ + 0.38, 1.7, 0.12, 0.8, "#4d5a55");

  const roofEaveY = buildingBaseY + params.storeys * floorHeight + (params.storeys - 1) * slabThickness;
  const roofGroup = addRoof(mainGroup, mainWidth, mainDepth, roofEaveY, params.roofPitchDeg, params.roof);
  roofGroup.visible = params.showRoof;
  windowGroup.visible = params.showWindows;
  parent.add(mainGroup);

  const garageGroup = new THREE.Group();
  garageGroup.name = "Garage module";
  if (params.garage !== "No garage") {
    const garageX = -mainWidth / 2 - garageDimensions.width / 2 + 0.08;
    const garageBodyHeight = params.garage === "Carport" ? 0.24 : 2.7;
    addBox(garageGroup, params.garage === "Carport" ? "Carport roof" : "Garage shell", garageX, buildingBaseY + garageBodyHeight / 2, garageCenterZ, garageDimensions.width, garageBodyHeight, garageDimensions.depth, params.garage === "Carport" ? "#52645b" : "#cbd3ca");
    if (params.garage !== "Carport") {
      const garageDoorWidth = garageDimensions.width * 0.86;
      addBox(garageGroup, "Garage door panel", garageX, buildingBaseY + 1.25, garageFrontZ + 0.08, garageDoorWidth, 2.3, 0.12, "#87958b");
      for (let line = 1; line <= 4; line += 1) {
        addBox(garageGroup, "Garage door horizontal rib", garageX, buildingBaseY + 0.45 + line * 0.36, garageFrontZ + 0.15, garageDoorWidth, 0.035, 0.03, "#d9ded7");
      }
      addBox(garageGroup, "Garage flat roof", garageX, buildingBaseY + 2.83, garageCenterZ, garageDimensions.width + 0.16, 0.2, garageDimensions.depth + 0.25, "#58665e");
    }
  }
  garageGroup.visible = params.showGarage;
  parent.add(garageGroup);

  if (params.terrainAdaptation === "Adapt to terrain" || params.terrainAdaptation === "Stepped floor plates") {
    const supportGroup = new THREE.Group();
    supportGroup.name = "Terrain support piers (conceptual)";
    const supportGarageWidth = params.showGarage ? garageDimensions.width : 0;
    const xMin = -mainWidth / 2 - supportGarageWidth;
    const xMax = mainWidth / 2;
    const zMin = -mainDepth / 2;
    const zMax = mainDepth / 2;
    for (let i = 0; i < 5; i += 1) {
      const x = xMin + ((xMax - xMin) * i) / 4;
      for (let j = 0; j < 4; j += 1) {
        const z = zMin + ((zMax - zMin) * j) / 3;
        const groundY = -slope * z;
        const height = buildingBaseY - groundY;
        if (height > 0.18) {
          const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, height, 8), makeMaterial("#8c9990"));
          pier.name = "Adjustable-height foundation support (conceptual)";
          pier.position.set(x, groundY + height / 2, z);
          pier.castShadow = true;
          supportGroup.add(pier);
        }
      }
    }
    parent.add(supportGroup);
    if (params.terrainAdaptation === "Stepped floor plates") {
      for (let step = 0; step < 3; step += 1) {
        addBox(parent, "Stepped entrance landing", frontDoorX, Math.max(0.16, buildingBaseY - (step + 1) * 0.22), mainDepth / 2 + 0.7 + step * 0.36, 1.4, 0.14, 0.52, "#b7bdb4");
      }
    }
  }

  const footprint = mainWidth * mainDepth + (params.showGarage ? garageAreaM2 : 0);
  const roofRise = params.roof === "Flat roof" ? 0.3 : Math.min((mainWidth / 2) * Math.tan(pitchAngle(params.roofPitchDeg)), 3.4);
  const height = params.storeys * floorHeight + (params.storeys - 1) * slabThickness + roofRise;
  const indicativeGfaM2 = targetForMainHouse + garageAreaM2;
  const accountingNote = params.gfaBasis === "Undecided"
    ? "GFA basis is undecided; for this visual study the target is treated as excluding the garage."
    : params.gfaBasis === "Includes garage"
      ? "The target is allocated across house floor plates plus the selected garage area."
      : "The target is allocated to house floor plates; garage area is shown separately.";
  return {
    mainWidthM: mainWidth,
    mainDepthM: mainDepth,
    garageAreaM2,
    indicativeGfaM2,
    heightM: height,
    totalFootprintM2: footprint,
    accountingNote,
  };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center justify-between gap-2 text-xs font-medium text-foreground">
        {label}
        {hint ? <span className="font-normal text-muted-foreground">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function SelectControl({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <select className="h-9 w-full rounded-md border border-input bg-card px-2.5 text-sm shadow-xs focus-visible:outline-2" value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  );
}

export default function HouseGeneratorView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<any>(null);
  const controlsRef = useRef<any>(null);
  const modelRootRef = useRef<any>(null);
  const terrainRootRef = useRef<any>(null);
  const [params, setParams] = useState<HouseParameters>(INITIAL_PARAMETERS);
  const [metrics, setMetrics] = useState<MassingMetrics | null>(null);
  const [generation, setGeneration] = useState(0);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const selectedAddress = useAppSelector((s) => s.lot.selected);

  const update = <K extends keyof HouseParameters>(key: K, value: HouseParameters[K]) => {
    setParams((current) => ({ ...current, [key]: value }));
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let renderer: any;
    try {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#edf1eb");
      scene.fog = new THREE.Fog("#edf1eb", 45, 120);
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
      camera.position.set(20, 16, 23);
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.domElement.className = "block h-full w-full";
      renderer.domElement.setAttribute("aria-label", "Interactive Three.js parametric house preview");
      host.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.07;
      controls.maxPolarAngle = Math.PI * 0.49;
      controls.minDistance = 5;
      controls.maxDistance = 100;
      controls.target.set(0, 3.3, 0);

      const ambient = new THREE.HemisphereLight("#ffffff", "#7c8b7a", 2.2);
      scene.add(ambient);
      const sun = new THREE.DirectionalLight("#fff5df", 3.1);
      sun.position.set(-12, 22, 15);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.left = -28;
      sun.shadow.camera.right = 28;
      sun.shadow.camera.top = 28;
      sun.shadow.camera.bottom = -28;
      scene.add(sun);

      const modelRoot = new THREE.Group();
      modelRoot.name = "LandView parametric house candidate";
      scene.add(modelRoot);
      const terrainRoot = new THREE.Group();
      terrainRoot.name = "Context terrain";
      scene.add(terrainRoot);
      cameraRef.current = camera;
      controlsRef.current = controls;
      modelRootRef.current = modelRoot;
      terrainRootRef.current = terrainRoot;

      const resize = () => {
        const width = Math.max(host.clientWidth, 1);
        const height = Math.max(host.clientHeight, 1);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      let frame = 0;
      const animate = () => {
        frame = window.requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      };
      animate();

      return () => {
        window.cancelAnimationFrame(frame);
        observer.disconnect();
        controls.dispose();
        disposeGroup(modelRoot);
        disposeGroup(terrainRoot);
        renderer.dispose();
        if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
        cameraRef.current = null;
        controlsRef.current = null;
        modelRootRef.current = null;
        terrainRootRef.current = null;
      };
    } catch (error) {
      setWebglError(error instanceof Error ? error.message : "WebGL could not be initialised in this browser.");
      return undefined;
    }
  }, []);

  useEffect(() => {
    const modelRoot = modelRootRef.current;
    const terrainRoot = terrainRootRef.current;
    if (!modelRoot || !terrainRoot) return;
    disposeGroup(modelRoot);
    disposeGroup(terrainRoot);
    const garageWidth = params.showGarage ? GARAGE_DIMENSIONS[params.garage].width : 0;
    const targetPerFloor = params.grossFloorAreaTargetM2 / Math.max(params.storeys, 1);
    const extentWidth = Math.max(Math.sqrt(targetPerFloor * 1.25) + garageWidth + 14, 24);
    const extentDepth = Math.max(Math.sqrt(targetPerFloor / 1.25) + 16, 24);
    addTerrain(terrainRoot, extentWidth, extentDepth, params.terrainSlopePercent / 100);
    const modelMetrics = buildParametricHouse(modelRoot, params, params.terrainSlopePercent);
    terrainRoot.visible = params.showTerrain;
    modelRoot.updateMatrixWorld(true);
    setMetrics(modelMetrics);
    if (controlsRef.current) {
      controlsRef.current.target.set(0, modelMetrics.heightM * 0.43, 0);
      controlsRef.current.update();
    }
  }, [params, generation]);

  const resetCamera = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) return;
    cameraRef.current.position.set(20, 16, 23);
    controlsRef.current.target.set(0, (metrics?.heightM ?? 6) * 0.43, 0);
    controlsRef.current.update();
  }, [metrics]);

  const exportGlb = useCallback(() => {
    const modelRoot = modelRootRef.current;
    if (!modelRoot) return;
    setExportMessage(null);
    const exporter = new GLTFExporter();
    try {
      exporter.parse(
        modelRoot,
        (result: unknown) => {
          if (!(result instanceof ArrayBuffer)) {
            setExportMessage("The GLB exporter returned an unexpected result; no file was downloaded.");
            return;
          }
          const blob = new Blob([result], { type: "model/gltf-binary" });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = "landview-house-concept.glb";
          anchor.click();
          URL.revokeObjectURL(url);
          setExportMessage("Concept massing exported as GLB. This is not a consent or construction model.");
        },
        (error: unknown) => {
          setExportMessage(error instanceof Error ? error.message : "GLB export failed.");
        },
        { binary: true },
      );
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : "GLB export failed.");
    }
  }, []);

  const resetInputs = () => {
    setParams(INITIAL_PARAMETERS);
    setGeneration((value) => value + 1);
    setExportMessage(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-card px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><House className="size-5" /></div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">AI House Generator · Parametric Studio</h1>
            <p className="truncate text-xs text-muted-foreground">
              {selectedAddress ? selectedAddress.fullAddress : "Standalone concept study · choose an address in LandView to associate the site later"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-amber-900 sm:inline-flex">CONCEPT MODEL · NOT FOR CONSENT</span>
          <Button variant="outline" size="sm" onClick={resetInputs} title="Restore the sample design input"><RotateCcw /> Reset</Button>
          <Button size="sm" onClick={exportGlb} disabled={!modelRootRef.current}><Download /> Export GLB</Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="max-h-[44vh] w-full shrink-0 overflow-y-auto border-b bg-card lg:max-h-none lg:w-[330px] lg:border-b-0 lg:border-r xl:w-[360px]">
          <div className="space-y-5 p-4">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="size-4 text-primary" />
              <h2 className="text-sm font-semibold">Design inputs</h2>
              <span className="ml-auto rounded bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">LIVE PARAMETRIC</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Storeys">
                <Input type="number" min={1} max={4} step={1} value={params.storeys} onChange={(event) => update("storeys", clampInteger(event.target.value, 1, 4))} />
              </Field>
              <Field label="Bedrooms">
                <Input type="number" min={1} max={10} step={1} value={params.bedrooms} onChange={(event) => update("bedrooms", clampInteger(event.target.value, 1, 10))} />
              </Field>
              <div className="col-span-2">
                <Field label="Gross floor area target" hint="m²">
                  <Input type="number" min={20} max={2000} step={5} value={params.grossFloorAreaTargetM2} onChange={(event) => update("grossFloorAreaTargetM2", clampNumber(event.target.value, 20, 2000))} />
                </Field>
              </div>
              <div className="col-span-2">
                <Field label="GFA accounting basis">
                  <SelectControl value={params.gfaBasis} options={["Undecided", "Includes garage", "Excludes garage"]} onChange={(value) => update("gfaBasis", value as GfaBasis)} />
                </Field>
              </div>
              <div className="col-span-2">
                <Field label="Architectural style">
                  <SelectControl value={params.style} options={["Contemporary", "Modern", "Traditional", "Minimalist", "Coastal", "Scandinavian"]} onChange={(value) => update("style", value)} />
                </Field>
              </div>
              <div className="col-span-2">
                <Field label="Roof type">
                  <SelectControl value={params.roof} options={["Gable roof", "Hip roof", "Flat roof", "Mono-pitch roof", "Mixed roof"]} onChange={(value) => update("roof", value as RoofStyle)} />
                </Field>
              </div>
              <div className="col-span-2">
                <Field label="Garage">
                  <SelectControl value={params.garage} options={["No garage", "Single garage", "Double garage", "Carport"]} onChange={(value) => update("garage", value as GarageStyle)} />
                </Field>
              </div>
              <div className="col-span-2">
                <Field label="Terrain adaptation">
                  <SelectControl value={params.terrainAdaptation} options={["Adapt to terrain", "Level pad", "Stepped floor plates"]} onChange={(value) => update("terrainAdaptation", value as TerrainMode)} />
                </Field>
              </div>
            </div>

            <div className="space-y-4 border-t pt-4">
              <Field label="Site slope" hint={params.terrainSlopePercent + "%"}>
                <input aria-label="Site slope percentage" className="w-full accent-primary" type="range" min={0} max={25} step={1} value={params.terrainSlopePercent} onChange={(event) => update("terrainSlopePercent", Number(event.target.value))} />
                <div className="flex justify-between text-[10px] text-muted-foreground"><span>Flat · 0%</span><span>Steep · 25%</span></div>
              </Field>
              <Field label="Roof pitch" hint={params.roofPitchDeg + "°"}>
                <input aria-label="Roof pitch in degrees" className="w-full accent-primary" type="range" min={15} max={45} step={1} value={params.roofPitchDeg} onChange={(event) => update("roofPitchDeg", Number(event.target.value))} />
                <div className="flex justify-between text-[10px] text-muted-foreground"><span>15°</span><span>45°</span></div>
              </Field>
            </div>

            <div className="space-y-3 border-t pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Display options</h3>
              <ToggleRow label="Show roof" checked={params.showRoof} onChange={(value) => update("showRoof", value)} />
              <ToggleRow label="Show window panels" checked={params.showWindows} onChange={(value) => update("showWindows", value)} />
              <ToggleRow label="Show terrain mesh" checked={params.showTerrain} onChange={(value) => update("showTerrain", value)} />
              <ToggleRow label="Show garage" checked={params.showGarage} onChange={(value) => update("showGarage", value)} />
            </div>

            <div className="rounded-lg border bg-muted/35 p-3">
              <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold"><Info className="size-4 text-primary" /> How to interact</div>
              <p className="text-xs leading-5 text-muted-foreground">
                Drag to orbit, right-drag to pan, and scroll to zoom. Changes rebuild the concept geometry immediately. Bedroom count is a design-program input at this stage; internal room partitions are not yet generated.
              </p>
            </div>
          </div>
        </aside>

        <section className="relative flex min-h-[390px] flex-1 flex-col">
          {webglError ? (
            <div className="m-6 rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-sm">
              <p className="font-semibold">Three.js viewport could not start</p>
              <p className="mt-2 text-muted-foreground">{webglError}</p>
              <p className="mt-2 text-muted-foreground">Check that the browser supports WebGL and hardware acceleration is enabled.</p>
            </div>
          ) : (
            <div ref={hostRef} className="absolute inset-0" />
          )}

          <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap gap-2">
            <span className="rounded-md border border-white/70 bg-white/90 px-2.5 py-1 text-xs font-medium shadow-sm backdrop-blur"><span className="mr-1.5 inline-block size-1.5 rounded-full bg-emerald-600" />Three.js · Parametric massing</span>
            <span className="rounded-md border border-amber-200 bg-amber-50/95 px-2.5 py-1 text-xs font-medium text-amber-900 shadow-sm"><TriangleAlert className="mr-1 inline size-3.5" /> Unverified concept</span>
          </div>

          <div className="absolute right-3 top-3 z-10 flex gap-2">
            <Button variant="outline" size="sm" className="border-white/70 bg-white/90 shadow-sm" onClick={resetCamera} title="Reset camera"><RotateCcw /> Reset view</Button>
            <Button variant="outline" size="sm" className="border-white/70 bg-white/90 shadow-sm" onClick={() => setGeneration((value) => value + 1)} title="Rebuild the same design parameters"><Sparkles /> Rebuild</Button>
          </div>

          {metrics ? (
            <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-wrap gap-2">
              <Metric label="Main block" value={metrics.mainWidthM.toFixed(1) + " × " + metrics.mainDepthM.toFixed(1) + " m"} />
              <Metric label="Approx. height" value={metrics.heightM.toFixed(1) + " m"} />
              <Metric label="Ground footprint" value={metrics.totalFootprintM2.toFixed(0) + " m²"} />
              <Metric label="Target GFA" value={params.grossFloorAreaTargetM2 + " m²"} />
            </div>
          ) : null}
        </section>
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t bg-card px-4 py-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          {metrics ? <Check className="mt-0.5 size-4 shrink-0 text-primary" /> : <Info className="mt-0.5 size-4 shrink-0" />}
          <span>{metrics?.accountingNote ?? "Preparing a parametric concept model."} This is not a surveyed site fit, consenting design, or verified floor-area calculation.</span>
        </div>
        {exportMessage ? <p className="text-xs text-muted-foreground">{exportMessage}</p> : null}
      </div>
    </div>
  );
}

function clampNumber(value: string, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

function clampInteger(value: string, min: number, max: number) {
  return Math.round(clampNumber(value, min, max));
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={"relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors " + (checked ? "bg-primary" : "bg-muted-foreground/30")}>
        <span className={"inline-flex size-4 items-center justify-center rounded-full bg-white shadow transition-transform " + (checked ? "translate-x-4" : "translate-x-0.5")}>
          {checked ? <Eye className="size-2.5 text-primary" /> : <EyeOff className="size-2.5 text-muted-foreground" />}
        </span>
      </button>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/60 bg-white/90 px-3 py-2 shadow-sm backdrop-blur">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}
