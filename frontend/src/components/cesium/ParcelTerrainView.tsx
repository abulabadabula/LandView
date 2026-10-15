import { useEffect, useMemo, useRef } from "react";
import {
  ArcType,
  BoundingSphere,
  CameraEventType,
  Cartesian2,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  ComponentDatatype,
  EllipsoidTerrainProvider,
  Geometry,
  GeometryAttribute,
  GeometryAttributes,
  GeometryInstance,
  HeadingPitchRange,
  LabelStyle,
  Matrix4,
  Math as CesiumMath,
  PerInstanceColorAppearance,
  Primitive,
  PrimitiveType,
  SceneMode,
  Viewer,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { Button } from "@/components/ui/button";
import { useAppSelector } from "@/store";
import { sampleElevation, toLocal } from "@/lib/geo";
import { buildParcelTerrainMesh, parcelTerrainExport } from "@/lib/parcelTerrain";

(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = "/cesium";

const TERRAIN_COLOR = Color.fromCssColorString("#8eb49a");
const BOUNDARY_COLOR = Color.fromCssColorString("#e87526");

export default function ParcelTerrainView() {
  const { selected, parcel, parcelTerrain, parcelTerrainLoading, error } = useAppSelector((state) => state.lot);
  const mountRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const surfaceRef = useRef<Primitive | null>(null);

  const mesh = useMemo(
    () => parcel && parcelTerrain ? buildParcelTerrainMesh(parcel, parcelTerrain) : null,
    [parcel, parcelTerrain],
  );

  useEffect(() => {
    if (!mountRef.current) return undefined;
    const viewer = new Viewer(mountRef.current, {
      baseLayer: false,
      sceneMode: SceneMode.SCENE3D,
      terrainProvider: new EllipsoidTerrainProvider(),
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
    });
    viewer.scene.globe.show = false;
    viewer.scene.backgroundColor = Color.fromCssColorString("#edf2f5");
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 4;
    viewer.scene.screenSpaceCameraController.enableRotate = true;
    viewer.scene.screenSpaceCameraController.enableTilt = true;
    viewer.scene.screenSpaceCameraController.enableTranslate = true;
    viewer.scene.screenSpaceCameraController.enableZoom = true;
    viewer.scene.screenSpaceCameraController.rotateEventTypes = CameraEventType.LEFT_DRAG;
    viewer.scene.screenSpaceCameraController.tiltEventTypes = [
      CameraEventType.RIGHT_DRAG,
      CameraEventType.MIDDLE_DRAG,
    ];
    viewer.scene.screenSpaceCameraController.zoomEventTypes = [
      CameraEventType.WHEEL,
      CameraEventType.PINCH,
    ];
    viewerRef.current = viewer;

    return () => {
      viewer.destroy();
      viewerRef.current = null;
      surfaceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (surfaceRef.current) {
      viewer.scene.primitives.remove(surfaceRef.current);
      surfaceRef.current = null;
    }
    viewer.entities.removeAll();

    if (!selected || !parcel || !parcelTerrain || !mesh || mesh.vertices.length < 3 || mesh.indices.length < 3) {
      viewer.scene.requestRender();
      return;
    }

    const positionValues = new Float64Array(mesh.vertices.length * 3);
    mesh.vertices.forEach((vertex, index) => {
      const position = Cartesian3.fromDegrees(vertex.lon, vertex.lat, vertex.elevationM);
      positionValues[index * 3] = position.x;
      positionValues[index * 3 + 1] = position.y;
      positionValues[index * 3 + 2] = position.z;
    });

    // Smooth per-vertex normals make the elevation changes visible under scene lighting.
    const normalAccumulator = new Float64Array(positionValues.length);
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const ia = mesh.indices[i] * 3;
      const ib = mesh.indices[i + 1] * 3;
      const ic = mesh.indices[i + 2] * 3;
      const ux = positionValues[ib] - positionValues[ia];
      const uy = positionValues[ib + 1] - positionValues[ia + 1];
      const uz = positionValues[ib + 2] - positionValues[ia + 2];
      const vx = positionValues[ic] - positionValues[ia];
      const vy = positionValues[ic + 1] - positionValues[ia + 1];
      const vz = positionValues[ic + 2] - positionValues[ia + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      for (const offset of [ia, ib, ic]) {
        normalAccumulator[offset] += nx;
        normalAccumulator[offset + 1] += ny;
        normalAccumulator[offset + 2] += nz;
      }
    }
    const normalValues = new Float32Array(positionValues.length);
    for (let i = 0; i < normalValues.length; i += 3) {
      const length = Math.hypot(normalAccumulator[i], normalAccumulator[i + 1], normalAccumulator[i + 2]) || 1;
      normalValues[i] = normalAccumulator[i] / length;
      normalValues[i + 1] = normalAccumulator[i + 1] / length;
      normalValues[i + 2] = normalAccumulator[i + 2] / length;
    }

    const geometry = new Geometry({
      attributes: new GeometryAttributes({
        position: new GeometryAttribute({
          componentDatatype: ComponentDatatype.DOUBLE,
          componentsPerAttribute: 3,
          values: positionValues,
        }),
        normal: new GeometryAttribute({
          componentDatatype: ComponentDatatype.FLOAT,
          componentsPerAttribute: 3,
          values: normalValues,
        }),
      }),
      indices: new Uint32Array(mesh.indices),
      primitiveType: PrimitiveType.TRIANGLES,
      boundingSphere: BoundingSphere.fromVertices(positionValues),
    });
    const primitive = new Primitive({
      geometryInstances: new GeometryInstance({
        geometry,
        attributes: {
          color: ColorGeometryInstanceAttribute.fromColor(TERRAIN_COLOR),
        },
      }),
      appearance: new PerInstanceColorAppearance({
        flat: false,
        translucent: false,
        closed: false,
      }),
      asynchronous: false,
    });
    viewer.scene.primitives.add(primitive);
    surfaceRef.current = primitive;

    const boundaryPositions = mesh.boundary.map((point) =>
      Cartesian3.fromDegrees(point.lon, point.lat, point.elevationM + 0.08),
    );
    if (boundaryPositions.length > 2) {
      boundaryPositions.push(boundaryPositions[0]);
      viewer.entities.add({
        name: "Selected parcel boundary",
        polyline: {
          positions: boundaryPositions,
          width: 4,
          material: BOUNDARY_COLOR,
          clampToGround: false,
          arcType: ArcType.NONE,
        },
      });
    }

    for (const point of mesh.boundary) {
      viewer.entities.add({
        name: "Boundary point " + point.index,
        position: Cartesian3.fromDegrees(point.lon, point.lat, point.elevationM + 0.15),
        point: {
          pixelSize: 7,
          color: BOUNDARY_COLOR,
          outlineColor: Color.WHITE,
          outlineWidth: 1.5,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: "P" + point.index + " · " + point.elevationM.toFixed(2) + " m",
          font: "12px sans-serif",
          fillColor: Color.WHITE,
          outlineColor: Color.fromCssColorString("#1d2b32"),
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cartesian2(0, -15),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }

    // Tight framing follows the parcel extent rather than the 200 m sampling square.
    const lons = mesh.boundary.map((point) => point.lon);
    const lats = mesh.boundary.map((point) => point.lat);
    const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
    const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const localPoints = mesh.boundary.map((point) => toLocal(point.lon, point.lat, centerLon, centerLat));
    const width = Math.max(...localPoints.map((point) => Math.abs(point.east))) * 2;
    const depth = Math.max(...localPoints.map((point) => Math.abs(point.north))) * 2;
    const diagonal = Math.hypot(width, depth);
    const localCenter = toLocal(centerLon, centerLat, parcelTerrain.centerLon, parcelTerrain.centerLat);
    const centerElevation = sampleElevation(parcelTerrain, localCenter.east, localCenter.north);
    const target = Cartesian3.fromDegrees(centerLon, centerLat, centerElevation);
    viewer.camera.lookAt(
      target,
      new HeadingPitchRange(
        CesiumMath.toRadians(18),
        CesiumMath.toRadians(-52),
        Math.max(diagonal * 1.9, 25),
      ),
    );
    viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    viewer.scene.requestRender();
  }, [selected, parcel, parcelTerrain, mesh]);

  const downloadJson = () => {
    if (!selected || !parcel || !parcelTerrain || !mesh) return;
    const payload = parcelTerrainExport(selected, parcel, parcelTerrain, mesh);
    const blobUrl = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = (selected.fullAddress.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "parcel") + "-terrain.json";
    anchor.click();
    URL.revokeObjectURL(blobUrl);
  };

  const fmt = (value: number, digits = 1) =>
    value.toLocaleString("en-NZ", { minimumFractionDigits: digits, maximumFractionDigits: digits });

  return (
    <div ref={mountRef} className="relative h-full w-full">
      <div className="pointer-events-none absolute left-3 top-3 z-10 max-w-sm rounded-md border border-slate-300/70 bg-slate-950/85 px-3 py-2 text-xs text-white shadow-lg">
        <div className="text-sm font-semibold">Parcel-only 3D terrain</div>
        <div className="mt-1">{selected?.fullAddress ?? "No address selected"}</div>
        {parcel && <div className="mt-1">Parcel area: {fmt(parcel.areaM2, 1)} m² ({fmt(parcel.areaM2 / 10000, 4)} ha)</div>}
        {mesh && parcelTerrain && (
          <>
            <div>Ground elevation: {fmt(mesh.minElevationM, 2)}–{fmt(mesh.maxElevationM, 2)} m</div>
            <div>Mesh spacing: approx. {fmt(mesh.gridSpacingM, 2)} m · {parcelTerrain.source}</div>
          </>
        )}
        <div className="mt-1 text-white/80">Left-drag to rotate · Right-drag to tilt · Scroll to zoom</div>
        {parcelTerrainLoading && <div className="mt-1 text-amber-200">Loading parcel elevation grid…</div>}
        {error && !parcelTerrainLoading && <div className="mt-1 text-amber-200">{error}</div>}
        {parcelTerrain && parcel && mesh && mesh.indices.length === 0 && (
          <div className="mt-1 text-amber-200">No terrain cells fell inside this parcel. Check parcel geometry and elevation coverage.</div>
        )}
      </div>

      <div className="pointer-events-auto absolute right-3 top-3 z-10 w-64 max-w-[48%] rounded-md border border-slate-300/70 bg-slate-950/85 p-2 text-xs text-white shadow-lg">
        <div className="mb-2 font-semibold">Boundary endpoint elevations</div>
        <div className="max-h-64 overflow-auto">
          {mesh?.boundary.length ? (
            <table className="w-full tabular-nums">
              <thead className="sticky top-0 bg-slate-800 text-left">
                <tr><th className="px-1 py-1">Point</th><th className="px-1 py-1 text-right">Elevation</th></tr>
              </thead>
              <tbody>
                {mesh.boundary.map((point) => (
                  <tr key={point.index} className="border-t border-white/10">
                    <td className="px-1 py-1">P{point.index}</td>
                    <td className="px-1 py-1 text-right">{fmt(point.elevationM, 2)} m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="py-2 text-white/70">Boundary elevations appear after the parcel terrain is loaded.</div>
          )}
        </div>
        <Button className="mt-2 w-full" size="sm" onClick={downloadJson} disabled={!mesh || mesh.indices.length < 3}>
          Download terrain JSON
        </Button>
      </div>
    </div>
  );
}
