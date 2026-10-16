import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useAppDispatch, useAppSelector } from "@/store";
import { loadParcelSetback, loadParcelTerrain } from "@/store/lotSlice";
import { sampleElevation, toLocal } from "@/lib/geo";
import { buildParcelTerrainMesh } from "@/lib/parcelTerrain";

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
  showContours: boolean;
  showGarage: boolean;
  showBoundary: boolean;
  showSetback: boolean;
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
  showContours: true,
  showGarage: true,
  showBoundary: true,
  showSetback: true,
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

function makeTextSprite(text: string, colour: string, x: number, y: number, z: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "rgba(255,255,255,0.94)";
    context.strokeStyle = colour;
    context.lineWidth = 7;
    context.fillRect(7, 7, 242, 82);
    context.strokeRect(7, 7, 242, 82);
    context.fillStyle = colour;
    context.font = "bold 34px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 128, 48);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.name = "Geospatial control point label " + text;
  sprite.position.set(x, y, z);
  sprite.scale.set(1.7, 0.64, 1);
  return sprite;
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

/**
 * Build 0.2 m contour lines directly from the selected parcel DEM triangles.
 * Coordinates are in the House Generator's local metre system.
 */
function addDemContourLines(
  parent: any,
  vertices: Array<{ x: number; z: number; elevationM: number }>,
  indices: ArrayLike<number>,
  baseElevationM: number,
  intervalM = 0.2,
) {
  if (vertices.length === 0 || indices.length < 3 || intervalM <= 0) return;

  const minorPositions: number[] = [];
  const majorPositions: number[] = [];
  const minimumElevation = Math.min(...vertices.map((vertex) => vertex.elevationM));
  const maximumElevation = Math.max(...vertices.map((vertex) => vertex.elevationM));
  const epsilon = 1e-7;
  const firstLevel = Math.ceil((minimumElevation - epsilon) / intervalM) * intervalM;
  const contourCount = Math.floor((maximumElevation - firstLevel + epsilon) / intervalM) + 1;

  // Guard against corrupt DEM values accidentally producing millions of levels.
  if (!Number.isFinite(contourCount) || contourCount <= 0 || contourCount > 5000) return;

  for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
    const a = vertices[indices[triangle]];
    const b = vertices[indices[triangle + 1]];
    const c = vertices[indices[triangle + 2]];
    if (!a || !b || !c) continue;

    const triangleMinimum = Math.min(a.elevationM, b.elevationM, c.elevationM);
    const triangleMaximum = Math.max(a.elevationM, b.elevationM, c.elevationM);
    let level = Math.ceil((triangleMinimum - epsilon) / intervalM) * intervalM;

    for (; level <= triangleMaximum + epsilon; level += intervalM) {
      const intersections: Array<{ x: number; z: number }> = [];
      const edges: Array<[typeof a, typeof b]> = [[a, b], [b, c], [c, a]];

      for (const [start, end] of edges) {
        const startElevation = start.elevationM;
        const endElevation = end.elevationM;
        const crossesLevel =
          (startElevation < level && endElevation >= level) ||
          (endElevation < level && startElevation >= level);
        if (!crossesLevel) continue;

        const denominator = endElevation - startElevation;
        if (Math.abs(denominator) < 1e-12) continue;
        const ratio = Math.max(0, Math.min(1, (level - startElevation) / denominator));
        const point = {
          x: start.x + (end.x - start.x) * ratio,
          z: start.z + (end.z - start.z) * ratio,
        };

        if (!intersections.some((existing) =>
          Math.abs(existing.x - point.x) < 1e-5 && Math.abs(existing.z - point.z) < 1e-5
        )) {
          intersections.push(point);
        }
      }

      if (intersections.length < 2) continue;

      // When a contour meets a vertex exactly, prefer the farthest pair and avoid zero-length segments.
      let first = intersections[0];
      let second = intersections[1];
      let farthestDistanceSquared = -1;
      for (let i = 0; i < intersections.length; i += 1) {
        for (let j = i + 1; j < intersections.length; j += 1) {
          const dx = intersections[i].x - intersections[j].x;
          const dz = intersections[i].z - intersections[j].z;
          const distanceSquared = dx * dx + dz * dz;
          if (distanceSquared > farthestDistanceSquared) {
            farthestDistanceSquared = distanceSquared;
            first = intersections[i];
            second = intersections[j];
          }
        }
      }
      if (farthestDistanceSquared < 1e-10) continue;

      const target = Math.abs(level / 1 - Math.round(level / 1)) < 1e-6
        ? majorPositions
        : minorPositions;
      const lineY = level - baseElevationM + 0.035;
      target.push(first.x, lineY, first.z, second.x, lineY, second.z);
    }
  }

  if (minorPositions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(minorPositions, 3));
    const lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: "#718064",
        transparent: true,
        opacity: 0.78,
        depthTest: false,
        depthWrite: false,
      }),
    );
    lines.name = "DEM contour lines every 0.2 m";
    lines.renderOrder = 3;
    parent.add(lines);
  }

  if (majorPositions.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(majorPositions, 3));
    const lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: "#4d5b45",
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      }),
    );
    lines.name = "Index contours every 1.0 m";
    lines.renderOrder = 4;
    parent.add(lines);
  }
}

function addPlanFootprint(
  parent: any,
  label: string,
  centreX: number,
  centreZ: number,
  width: number,
  depth: number,
  elevation: number,
  fillColour: string,
  lineColour: string,
) {
  if (width <= 0 || depth <= 0) return;
  const corners = [
    new THREE.Vector3(centreX - width / 2, elevation, centreZ - depth / 2),
    new THREE.Vector3(centreX + width / 2, elevation, centreZ - depth / 2),
    new THREE.Vector3(centreX + width / 2, elevation, centreZ + depth / 2),
    new THREE.Vector3(centreX - width / 2, elevation, centreZ + depth / 2),
  ];

  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(corners.flatMap((point) => [point.x, point.y, point.z]), 3),
  );
  fillGeometry.setIndex([0, 1, 2, 0, 2, 3]);
  fillGeometry.computeVertexNormals();
  const fill = new THREE.Mesh(
    fillGeometry,
    new THREE.MeshBasicMaterial({
      color: fillColour,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
  );
  fill.name = label + " 2D footprint fill";
  fill.renderOrder = 5;
  parent.add(fill);

  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(corners),
    new THREE.LineBasicMaterial({ color: lineColour, depthTest: false, depthWrite: false }),
  );
  outline.name = label + " 2D footprint outline";
  outline.renderOrder = 6;
  parent.add(outline);
  parent.add(makeTextSprite(label, lineColour, centreX, elevation + 0.12, centreZ));
}

function buildParametricHouse(
  parent: any,
  params: HouseParameters,
  slopePercent: number,
  groundYAt?: (eastM: number, northM: number) => number,
): MassingMetrics {
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
  const terrainAt = groundYAt ?? ((_east: number, north: number) => -slope * north);
  const minX = -mainWidth / 2 - (params.showGarage && params.garage !== "No garage" ? garageDimensions.width : 0);
  const maxX = mainWidth / 2;
  const minZ = Math.min(-mainDepth / 2, garageCenterZ - garageDepth / 2);
  const maxZ = Math.max(mainDepth / 2, garageCenterZ + garageDepth / 2);
  let maxGroundY = Number.NEGATIVE_INFINITY;
  // Sample the planned building zone against the actual parcel DEM when supplied.
  for (let row = 0; row <= 6; row += 1) {
    for (let col = 0; col <= 6; col += 1) {
      const x = minX + ((maxX - minX) * col) / 6;
      const z = minZ + ((maxZ - minZ) * row) / 6;
      maxGroundY = Math.max(maxGroundY, terrainAt(x, z));
    }
  }
  if (!Number.isFinite(maxGroundY)) maxGroundY = 0;
  const freeboard = params.terrainAdaptation === "Adapt to terrain" ? 0.42 : 0.55;
  const buildingBaseY = maxGroundY + freeboard;

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
        const groundY = terrainAt(x, z);
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
  const perspectiveCameraRef = useRef<any>(null);
  const orthographicCameraRef = useRef<any>(null);
  const activeCameraRef = useRef<any>(null);
  const sceneRef = useRef<any>(null);
  const controlsRef = useRef<any>(null);
  const perspectiveTargetRef = useRef<any>(null);
  const perspectivePositionRef = useRef<any>(null);
  const orthographicHalfHeightRef = useRef(20);
  const viewModeRef = useRef<"3D" | "2D">("3D");
  const modelRootRef = useRef<any>(null);
  const terrainRootRef = useRef<any>(null);
  const contourRootRef = useRef<any>(null);
  const boundaryRootRef = useRef<any>(null);
  const setbackRootRef = useRef<any>(null);
  const planRootRef = useRef<any>(null);
  const [params, setParams] = useState<HouseParameters>(INITIAL_PARAMETERS);
  const [metrics, setMetrics] = useState<MassingMetrics | null>(null);
  const [generation, setGeneration] = useState(0);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  // Keep viewport overlays collapsed by default so the model remains easy to inspect.
  const [showViewportInfo, setShowViewportInfo] = useState(false);
  const [viewMode, setViewMode] = useState<"3D" | "2D">("3D");
  const dispatch = useAppDispatch();
  const {
    selected: selectedAddress,
    parcel,
    status: lotStatus,
    parcelTerrain,
    parcelTerrainLoading,
    parcelTerrainError,
    parcelSetback,
    parcelSetbackLoading,
    parcelSetbackError,
  } = useAppSelector((s) => s.lot);

  const siteReady = lotStatus === "ready" && !!selectedAddress && !!parcel && !!parcelTerrain;
  const parcelMesh = useMemo(
    () => siteReady && parcel && parcelTerrain ? buildParcelTerrainMesh(parcel, parcelTerrain) : null,
    [siteReady, parcel, parcelTerrain],
  );
  const siteAnchor = useMemo(() => {
    if (!parcel?.boundary.length) return null;
    const points = parcel.boundary;
    return {
      lon: points.reduce((sum, point) => sum + point.lon, 0) / points.length,
      lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    };
  }, [parcel]);

  useEffect(() => {
    if (lotStatus !== "ready" || !selectedAddress || !parcel) return;
    if (!parcelTerrain && !parcelTerrainLoading && !parcelTerrainError) {
      void dispatch(loadParcelTerrain({ address: selectedAddress, parcel }));
    }
    if (!parcelSetback && !parcelSetbackLoading && !parcelSetbackError) {
      void dispatch(loadParcelSetback({ parcel, distanceM: 1 }));
    }
  }, [
    dispatch, lotStatus, selectedAddress, parcel,
    parcelTerrain, parcelTerrainLoading, parcelTerrainError,
    parcelSetback, parcelSetbackLoading, parcelSetbackError,
  ]);

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
      const orthographicCamera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 5000);
      // Local scene north is -Z, so the 2D view is north-up.
      orthographicCamera.up.set(0, 0, -1);
      orthographicCamera.position.set(0, 80, 0);
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
      terrainRoot.name = "Parcel terrain surface";
      scene.add(terrainRoot);
      const boundaryRoot = new THREE.Group();
      boundaryRoot.name = "Parcel boundary and endpoint controls";
      scene.add(boundaryRoot);
      const contourRoot = new THREE.Group();
      contourRoot.name = "DEM contour lines at 0.2 m intervals";
      scene.add(contourRoot);
      const setbackRoot = new THREE.Group();
      setbackRoot.name = "Parcel inward setback";
      scene.add(setbackRoot);
      const planRoot = new THREE.Group();
      planRoot.name = "Orthographic 2D house footprints";
      scene.add(planRoot);
      cameraRef.current = camera;
      perspectiveCameraRef.current = camera;
      orthographicCameraRef.current = orthographicCamera;
      activeCameraRef.current = camera;
      sceneRef.current = scene;
      controlsRef.current = controls;
      modelRootRef.current = modelRoot;
      terrainRootRef.current = terrainRoot;
      contourRootRef.current = contourRoot;
      boundaryRootRef.current = boundaryRoot;
      setbackRootRef.current = setbackRoot;
      planRootRef.current = planRoot;

      const resize = () => {
        const width = Math.max(host.clientWidth, 1);
        const height = Math.max(host.clientHeight, 1);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        orthographicCamera.left = -orthographicHalfHeightRef.current * (width / height);
        orthographicCamera.right = orthographicHalfHeightRef.current * (width / height);
        orthographicCamera.top = orthographicHalfHeightRef.current;
        orthographicCamera.bottom = -orthographicHalfHeightRef.current;
        orthographicCamera.updateProjectionMatrix();
        renderer.setSize(width, height);
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      let frame = 0;
      const animate = () => {
        frame = window.requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, activeCameraRef.current ?? camera);
      };
      animate();

      return () => {
        window.cancelAnimationFrame(frame);
        observer.disconnect();
        controls.dispose();
        disposeGroup(modelRoot);
        disposeGroup(terrainRoot);
        disposeGroup(contourRoot);
        disposeGroup(boundaryRoot);
        disposeGroup(setbackRoot);
        disposeGroup(planRoot);
        renderer.dispose();
        if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
        cameraRef.current = null;
        perspectiveCameraRef.current = null;
        orthographicCameraRef.current = null;
        activeCameraRef.current = null;
        sceneRef.current = null;
        controlsRef.current = null;
        perspectiveTargetRef.current = null;
        perspectivePositionRef.current = null;
        modelRootRef.current = null;
        terrainRootRef.current = null;
        contourRootRef.current = null;
        boundaryRootRef.current = null;
        setbackRootRef.current = null;
        planRootRef.current = null;
      };
    } catch (error) {
      setWebglError(error instanceof Error ? error.message : "WebGL could not be initialised in this browser.");
      return undefined;
    }
  }, []);

  useEffect(() => {
    const modelRoot = modelRootRef.current;
    const terrainRoot = terrainRootRef.current;
    const contourRoot = contourRootRef.current;
    const boundaryRoot = boundaryRootRef.current;
    const setbackRoot = setbackRootRef.current;
    const planRoot = planRootRef.current;
    if (!modelRoot || !terrainRoot || !contourRoot || !boundaryRoot || !setbackRoot || !planRoot) return;
    disposeGroup(modelRoot);
    disposeGroup(terrainRoot);
    disposeGroup(contourRoot);
    disposeGroup(boundaryRoot);
    disposeGroup(setbackRoot);
    disposeGroup(planRoot);

    const garageWidth = params.showGarage ? GARAGE_DIMENSIONS[params.garage].width : 0;
    const targetPerFloor = params.grossFloorAreaTargetM2 / Math.max(params.storeys, 1);
    const extentWidth = Math.max(Math.sqrt(targetPerFloor * 1.25) + garageWidth + 14, 24);
    const extentDepth = Math.max(Math.sqrt(targetPerFloor / 1.25) + 16, 24);

    let baseElevationM = 0;
    let groundYAt: ((eastM: number, northM: number) => number) | undefined;

    if (siteReady && parcel && parcelTerrain && parcelMesh && siteAnchor) {
      baseElevationM = parcelMesh.minElevationM;
      const terrainCentreAtAnchor = toLocal(
        siteAnchor.lon, siteAnchor.lat, parcelTerrain.centerLon, parcelTerrain.centerLat,
      );
      const toScenePoint = (lon: number, lat: number) => {
        const local = toLocal(lon, lat, siteAnchor.lon, siteAnchor.lat);
        return { x: local.east, z: -local.north };
      };
      const terrainGeometry = new THREE.BufferGeometry();
      const positions: number[] = [];
      const contourVertices: Array<{ x: number; z: number; elevationM: number }> = [];
      parcelMesh.vertices.forEach((vertex) => {
        const local = toScenePoint(vertex.lon, vertex.lat);
        positions.push(local.x, vertex.elevationM - baseElevationM, local.z);
        contourVertices.push({ x: local.x, z: local.z, elevationM: vertex.elevationM });
      });
      terrainGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      terrainGeometry.setIndex(parcelMesh.indices);
      addDemContourLines(contourRoot, contourVertices, parcelMesh.indices, baseElevationM, 0.2);
      terrainGeometry.computeVertexNormals();
      const terrainSurface = new THREE.Mesh(
        terrainGeometry,
        new THREE.MeshStandardMaterial({
          color: "#cbd6c1",
          roughness: 0.96,
          side: THREE.DoubleSide,
        }),
      );
      terrainSurface.name = "Parcel 3D DEM surface (shared parcel terrain grid)";
      terrainSurface.receiveShadow = true;
      terrainRoot.add(terrainSurface);

      groundYAt = (eastM, northM) => sampleElevation(
        parcelTerrain,
        terrainCentreAtAnchor.east + eastM,
        terrainCentreAtAnchor.north - northM,
      ) - baseElevationM;

      const boundaryPositions: any[] = [];
      for (const point of parcelMesh.boundary) {
        const local = toScenePoint(point.lon, point.lat);
        const groundY = point.elevationM - baseElevationM + 0.06;
        boundaryPositions.push(new THREE.Vector3(local.x, groundY, local.z));
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(0.12, 12, 8),
          new THREE.MeshStandardMaterial({ color: "#e87526", emissive: "#6b2f0a" }),
        );
        marker.name = "Boundary endpoint P" + point.index;
        marker.position.set(local.x, groundY + 0.04, local.z);
        boundaryRoot.add(marker);
        boundaryRoot.add(makeTextSprite("P" + point.index, "#9a4316", local.x, groundY + 0.72, local.z));
      }
      if (boundaryPositions.length >= 3) {
        const line = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints(boundaryPositions),
          new THREE.LineBasicMaterial({ color: "#e87526", linewidth: 2 }),
        );
        line.name = "Legal parcel boundary";
        boundaryRoot.add(line);
      }

      for (const [polyIndex, setbackPolygon] of (parcelSetback?.polygons ?? []).entries()) {
        const points = setbackPolygon.points.map((point) => {
          const local = toScenePoint(point.lon, point.lat);
          const groundY = sampleElevation(
            parcelTerrain,
            toLocal(point.lon, point.lat, parcelTerrain.centerLon, parcelTerrain.centerLat).east,
            toLocal(point.lon, point.lat, parcelTerrain.centerLon, parcelTerrain.centerLat).north,
          ) - baseElevationM + 0.11;
          return new THREE.Vector3(local.x, groundY, local.z);
        });
        if (points.length >= 3) {
          const line = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(points),
            new THREE.LineBasicMaterial({ color: "#7354c7" }),
          );
          line.name = "Parcel setback " + (polyIndex + 1) + " m=" + parcelSetback?.distanceM;
          setbackRoot.add(line);
        }
        setbackPolygon.points.forEach((point, pointIndex) => {
          const local = toScenePoint(point.lon, point.lat);
          const gridLocal = toLocal(point.lon, point.lat, parcelTerrain.centerLon, parcelTerrain.centerLat);
          const groundY = sampleElevation(parcelTerrain, gridLocal.east, gridLocal.north) - baseElevationM;
          const marker = new THREE.Mesh(
            new THREE.SphereGeometry(0.09, 10, 8),
            new THREE.MeshStandardMaterial({ color: "#7354c7" }),
          );
          marker.name = "Setback control point SB" + (pointIndex + 1);
          marker.position.set(local.x, groundY + 0.13, local.z);
          setbackRoot.add(marker);
          setbackRoot.add(makeTextSprite("SB" + (pointIndex + 1), "#5636a6", local.x, groundY + 0.7, local.z));
        });
      }

    } else if (!selectedAddress) {
      // Without a selected address, keep the standalone parameter preview usable.
      // Once an address is selected, never substitute this illustrative plane for real DEM data.
      addTerrain(terrainRoot, extentWidth, extentDepth, params.terrainSlopePercent / 100);
      groundYAt = (_eastM, northM) => -(params.terrainSlopePercent / 100) * northM;
    } else {
      // Keep the house preview available while the requested parcel data is loading, but do not fake site terrain.
      groundYAt = () => 0;
    }

    const modelMetrics = buildParametricHouse(
      modelRoot, params, siteReady ? 0 : params.terrainSlopePercent, groundYAt,
    );

    // The 2D plan displays a simple orthographic site plan of the house and garage footprints.
    // It is intentionally a massing footprint, not an architectural floor plan.
    const garageDimensions = GARAGE_DIMENSIONS[params.garage];
    const planElevation = siteReady && parcelMesh
      ? parcelMesh.maxElevationM - baseElevationM + 0.45
      : (params.terrainSlopePercent / 100) * extentDepth / 2 + 1;
    addPlanFootprint(
      planRoot,
      "MAIN BLOCK",
      0,
      0,
      modelMetrics.mainWidthM,
      modelMetrics.mainDepthM,
      planElevation,
      "#a8c3ae",
      "#315d42",
    );
    if (params.showGarage && params.garage !== "No garage") {
      const garageCentreX = -modelMetrics.mainWidthM / 2 - garageDimensions.width / 2 + 0.08;
      const garageCentreZ = modelMetrics.mainDepthM / 2 - garageDimensions.depth / 2;
      addPlanFootprint(
        planRoot,
        params.garage === "Carport" ? "CARPORT" : "GARAGE",
        garageCentreX,
        garageCentreZ,
        garageDimensions.width,
        garageDimensions.depth,
        planElevation + 0.015,
        "#c8d0d2",
        "#485a65",
      );
    }

    terrainRoot.visible = params.showTerrain && (siteReady || !selectedAddress);
    contourRoot.visible = siteReady && params.showTerrain && params.showContours;
    boundaryRoot.visible = siteReady && params.showBoundary;
    setbackRoot.visible = siteReady && params.showSetback;
    modelRoot.visible = viewModeRef.current === "3D";
    planRoot.visible = viewModeRef.current === "2D";
    modelRoot.updateMatrixWorld(true);
    setMetrics(modelMetrics);
    if (controlsRef.current) {
      controlsRef.current.target.set(0, modelMetrics.heightM * 0.43, 0);
      controlsRef.current.update();
    }
  }, [
    params, generation, siteReady, parcel, parcelTerrain, parcelMesh,
    parcelSetback, siteAnchor, selectedAddress,
  ]);

  const selectedTerrainSummary = siteReady && parcel && parcelTerrain && parcelMesh
    ? {
        areaM2: parcel.areaM2,
        source: parcelTerrain.source,
        spacingM: parcelMesh.gridSpacingM,
        minElevationM: parcelMesh.minElevationM,
        maxElevationM: parcelMesh.maxElevationM,
        boundaryCount: parcelMesh.boundary.length,
        setbackCount: parcelSetback?.polygons.reduce((sum, polygon) => sum + polygon.points.length, 0) ?? 0,
      }
    : null;

  const fitPlanCamera = useCallback(() => {
    const orthographicCamera = orthographicCameraRef.current;
    const controls = controlsRef.current;
    const host = hostRef.current;
    if (!orthographicCamera || !controls || !host) return;

    const bounds = new THREE.Box3();
    [
      terrainRootRef.current,
      contourRootRef.current,
      boundaryRootRef.current,
      setbackRootRef.current,
      planRootRef.current,
    ].forEach((group) => {
      if (group) bounds.expandByObject(group);
    });

    let centre = new THREE.Vector3(0, 0, 0);
    let size = new THREE.Vector3(30, 2, 30);
    if (
      Number.isFinite(bounds.min.x) && Number.isFinite(bounds.min.y) && Number.isFinite(bounds.min.z) &&
      Number.isFinite(bounds.max.x) && Number.isFinite(bounds.max.y) && Number.isFinite(bounds.max.z)
    ) {
      centre = bounds.getCenter(new THREE.Vector3());
      size = bounds.getSize(new THREE.Vector3());
    }

    const aspect = Math.max(host.clientWidth, 1) / Math.max(host.clientHeight, 1);
    const halfHeight = Math.max(size.z / 2, size.x / (2 * aspect), 8) * 1.14;
    orthographicHalfHeightRef.current = halfHeight;
    orthographicCamera.left = -halfHeight * aspect;
    orthographicCamera.right = halfHeight * aspect;
    orthographicCamera.top = halfHeight;
    orthographicCamera.bottom = -halfHeight;
    orthographicCamera.up.set(0, 0, -1);
    orthographicCamera.position.set(
      centre.x,
      Math.max(bounds.max.y + Math.max(size.x, size.z, 15) * 2, centre.y + 30),
      centre.z,
    );
    orthographicCamera.lookAt(centre);
    orthographicCamera.updateProjectionMatrix();

    controls.object = orthographicCamera;
    controls.enableRotate = false;
    controls.enablePan = true;
    controls.maxPolarAngle = 0;
    controls.target.copy(centre);
    controls.update();
    cameraRef.current = orthographicCamera;
    activeCameraRef.current = orthographicCamera;
  }, []);

  useEffect(() => {
    viewModeRef.current = viewMode;
    const modelRoot = modelRootRef.current;
    const planRoot = planRootRef.current;
    const controls = controlsRef.current;
    const perspectiveCamera = perspectiveCameraRef.current;
    if (modelRoot) modelRoot.visible = viewMode === "3D";
    if (planRoot) planRoot.visible = viewMode === "2D";
    if (!controls || !perspectiveCamera) return;

    if (viewMode === "2D") {
      perspectiveTargetRef.current = controls.target.clone();
      perspectivePositionRef.current = perspectiveCamera.position.clone();
      fitPlanCamera();
      return;
    }

    const target = perspectiveTargetRef.current ?? new THREE.Vector3(0, (metrics?.heightM ?? 6) * 0.43, 0);
    const position = perspectivePositionRef.current ?? new THREE.Vector3(20, 16, 23);
    controls.object = perspectiveCamera;
    controls.enableRotate = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.copy(target);
    perspectiveCamera.position.copy(position);
    perspectiveCamera.up.set(0, 1, 0);
    perspectiveCamera.lookAt(target);
    controls.update();
    cameraRef.current = perspectiveCamera;
    activeCameraRef.current = perspectiveCamera;
  }, [viewMode, fitPlanCamera, metrics]);

  const resetCamera = useCallback(() => {
    if (viewMode === "2D") {
      fitPlanCamera();
      return;
    }
    const camera = perspectiveCameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const target = new THREE.Vector3(0, (metrics?.heightM ?? 6) * 0.43, 0);
    camera.position.set(20, 16, 23);
    controls.object = camera;
    controls.target.copy(target);
    controls.enableRotate = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    camera.lookAt(target);
    controls.update();
    perspectiveTargetRef.current = target.clone();
    perspectivePositionRef.current = camera.position.clone();
  }, [metrics, viewMode, fitPlanCamera]);

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
              <Field label="Illustrative slope" hint={siteReady ? "Using selected parcel DEM" : params.terrainSlopePercent + "%"}>
                <input aria-label="Illustrative site slope percentage" disabled={siteReady} className="w-full accent-primary disabled:opacity-40" type="range" min={0} max={25} step={1} value={params.terrainSlopePercent} onChange={(event) => update("terrainSlopePercent", Number(event.target.value))} />
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
              <ToggleRow label="Show 0.2 m contour lines" checked={params.showContours} onChange={(value) => update("showContours", value)} />
              <ToggleRow label="Show parcel boundary and endpoints" checked={params.showBoundary} onChange={(value) => update("showBoundary", value)} />
              <ToggleRow label="Show 1 m setback line" checked={params.showSetback} onChange={(value) => update("showSetback", value)} />
              <ToggleRow label="Show garage" checked={params.showGarage} onChange={(value) => update("showGarage", value)} />
            </div>

            <div className="rounded-lg border bg-muted/35 p-3">
              <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold"><Info className="size-4 text-primary" /> How to interact</div>
              <p className="text-xs leading-5 text-muted-foreground">
                Drag to orbit, right-drag to pan, and scroll to zoom. The selected parcel DEM, exact boundary endpoints and 1 m setback line are shared with Parcel 3D. Changes rebuild the concept geometry immediately. Bedroom count is a design-program input at this stage; internal room partitions are not yet generated.
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
            <span className="rounded-md border border-white/70 bg-white/90 px-2.5 py-1 text-xs font-medium shadow-sm backdrop-blur"><span className="mr-1.5 inline-block size-1.5 rounded-full bg-emerald-600" />{viewMode === "3D" ? "3D · Parametric massing" : "2D plan · orthographic"}</span>
            {siteReady && params.showTerrain && params.showContours ? <span className="rounded-md border border-white/70 bg-white/90 px-2.5 py-1 text-xs font-medium shadow-sm backdrop-blur">Contours · 0.2 m interval</span> : null}
            <span className="rounded-md border border-amber-200 bg-amber-50/95 px-2.5 py-1 text-xs font-medium text-amber-900 shadow-sm"><TriangleAlert className="mr-1 inline size-3.5" /> Unverified concept</span>
            {selectedAddress && !siteReady ? <span className="rounded-md border bg-white/95 px-2.5 py-1 text-xs shadow-sm">{parcelTerrainLoading || lotStatus === "loading" ? "Loading selected parcel terrain…" : parcelTerrainError ? "Parcel terrain unavailable" : "Waiting for parcel data"}</span> : null}
          </div>

          <div className="absolute right-3 top-3 z-10 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-white/70 bg-white/90 shadow-sm"
              onClick={() => setViewMode((current) => current === "3D" ? "2D" : "3D")}
              title={viewMode === "3D" ? "Switch to 2D site plan" : "Switch to 3D terrain view"}
              aria-label={viewMode === "3D" ? "Switch to 2D site plan" : "Switch to 3D terrain view"}
            >
              {viewMode === "3D" ? "2D plan" : "3D view"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-white/70 bg-white/90 shadow-sm"
              onClick={() => setShowViewportInfo((visible) => !visible)}
              title={showViewportInfo ? "Hide viewport information" : "Show viewport information"}
              aria-label={showViewportInfo ? "Hide viewport information" : "Show viewport information"}
              aria-expanded={showViewportInfo}
            >
              {showViewportInfo ? <EyeOff /> : <Eye />}
              {showViewportInfo ? "Hide info" : "Show info"}
            </Button>
            <Button variant="outline" size="sm" className="border-white/70 bg-white/90 shadow-sm" onClick={resetCamera} title="Reset camera"><RotateCcw /> Reset view</Button>
            <Button variant="outline" size="sm" className="border-white/70 bg-white/90 shadow-sm" onClick={() => setGeneration((value) => value + 1)} title="Rebuild the same design parameters"><Sparkles /> Rebuild</Button>
          </div>

          {showViewportInfo && (
  selectedTerrainSummary ? (
              <div className="pointer-events-none absolute left-3 top-14 z-10 max-w-[min(30rem,80%)] rounded-md border border-white/70 bg-white/90 p-2.5 text-xs shadow-sm backdrop-blur">
                <div className="font-semibold">Selected parcel · shared Parcel 3D data</div>
                <div className="mt-1 text-muted-foreground">
                  Area {selectedTerrainSummary.areaM2.toLocaleString("en-NZ", { maximumFractionDigits: 1 })} m² · DEM {selectedTerrainSummary.source}
                </div>
                <div className="mt-1 text-muted-foreground">
                  Elevation {selectedTerrainSummary.minElevationM.toFixed(2)}–{selectedTerrainSummary.maxElevationM.toFixed(2)} m · grid spacing ≈ {selectedTerrainSummary.spacingM.toFixed(2)} m
                </div>
                <div className="mt-1 text-muted-foreground">
                  {selectedTerrainSummary.boundaryCount} boundary points · {selectedTerrainSummary.setbackCount} setback points
                </div>
                {parcelSetbackLoading ? <div className="mt-1 text-violet-700">Loading 1 m setback geometry…</div> : null}
                {parcelSetbackError ? <div className="mt-1 text-amber-700">Setback load failed: {parcelSetbackError}</div> : null}
                {parcelSetback?.warning ? <div className="mt-1 text-amber-700">{parcelSetback.warning}</div> : null}
              </div>
            ) : selectedAddress && parcelTerrainError ? (
              <div className="pointer-events-none absolute left-3 top-14 z-10 max-w-md rounded-md border border-amber-300 bg-amber-50/95 p-3 text-xs text-amber-900 shadow-sm">
                Could not load the selected parcel terrain: {parcelTerrainError}
              </div>
            ) : null
          )}

          {showViewportInfo && siteReady && parcelMesh && (
            <div className="pointer-events-auto absolute right-3 top-14 z-10 max-h-[56%] w-[27rem] max-w-[48%] overflow-y-auto rounded-md border border-slate-300/70 bg-white/95 p-2.5 text-xs text-slate-900 shadow-lg backdrop-blur">
              <div className="mb-1.5 font-semibold">Boundary control points</div>
              <table className="w-full tabular-nums">
                <thead className="sticky top-0 bg-slate-100 text-left">
                  <tr>
                    <th className="px-1 py-1">Point</th>
                    <th className="px-1 py-1 text-right">Elev. (m)</th>
                    <th className="px-1 py-1 text-right">To next (m)</th>
                  </tr>
                </thead>
                <tbody>
                  {parcelMesh.boundary.map((point) => (
                    <tr key={point.index} className="border-t border-slate-200">
                      <td className="px-1 py-1">P{point.index}</td>
                      <td className="px-1 py-1 text-right">{point.elevationM.toFixed(2)}</td>
                      <td className="px-1 py-1 text-right">{point.horizontalDistanceToNextM.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parcelSetback?.polygons.map((polygon, polygonIndex) => (
                <div key={polygonIndex} className="mt-3 border-t border-slate-200 pt-2">
                  <div className="mb-1 font-semibold text-violet-800">Setback {parcelSetback.distanceM.toFixed(1)} m · NZTM2000</div>
                  <table className="w-full tabular-nums">
                    <thead className="sticky top-0 bg-violet-50 text-left">
                      <tr>
                        <th className="px-1 py-1">Point</th>
                        <th className="px-1 py-1 text-right">Easting (m)</th>
                        <th className="px-1 py-1 text-right">Northing (m)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {polygon.points.map((point) => (
                        <tr key={point.index} className="border-t border-slate-200">
                          <td className="px-1 py-1">SB{polygonIndex + 1}.{point.index}</td>
                          <td className="px-1 py-1 text-right">{point.nztmE.toFixed(3)}</td>
                          <td className="px-1 py-1 text-right">{point.nztmN.toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {showViewportInfo && metrics ? (
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
