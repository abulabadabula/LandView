import { useEffect, useRef } from "react";
import {
  Cartesian3,
  Color,
  CustomHeightmapTerrainProvider,
  EllipsoidTerrainProvider,
  HeadingPitchRange,
  HeightReference,
  Matrix4,
  Math as CesiumMath,
  Rectangle,
  UrlTemplateImageryProvider,
  Viewer,
  WebMercatorTilingScheme,
  createWorldTerrainAsync,
  Ion,
  type TerrainProvider,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { useAppSelector } from "@/store";
import { basemapSource } from "@/lib/basemaps";
import { sampleElevation } from "@/lib/geo";
import type { TerrainGrid } from "@/types";

// Cesium loads workers and assets from here (see vite.config.ts)
(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = "/cesium";

const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
if (ION_TOKEN) Ion.defaultAccessToken = ION_TOKEN;

const SEABED = -3; // DEM cells at or below 0 m are sea: sink them so the water plane reads as water
const TILE = 65; // heightmap samples per terrain tile edge
const M_PER_DEG = 111_320;

/** Terrain provider that serves the backend's elevation grid (clamped to its edge outside the grid). */
function gridTerrain(t: TerrainGrid): TerrainProvider {
  const eff = (e: number) => (e <= 0 ? SEABED : e);
  const cosLat = Math.cos((t.centerLat * Math.PI) / 180);
  return new CustomHeightmapTerrainProvider({
    width: TILE,
    height: TILE,
    tilingScheme: new WebMercatorTilingScheme(),
    callback: (x, y, level) => {
      const scheme = new WebMercatorTilingScheme();
      const rect = scheme.tileXYToRectangle(x, y, level);
      const out = new Float32Array(TILE * TILE);
      for (let r = 0; r < TILE; r++) {
        const lat = CesiumMath.toDegrees(rect.north - ((rect.north - rect.south) * r) / (TILE - 1));
        for (let c = 0; c < TILE; c++) {
          const lon = CesiumMath.toDegrees(rect.west + ((rect.east - rect.west) * c) / (TILE - 1));
          const east = (lon - t.centerLon) * M_PER_DEG * cosLat;
          const north = (lat - t.centerLat) * M_PER_DEG;
          out[r * TILE + c] = eff(sampleElevation(t, east, north));
        }
      }
      return out;
    },
  });
}

/** Lon/lat rectangle covered by the terrain grid. */
function gridRectangle(t: TerrainGrid) {
  const half = t.sizeM / 2;
  const dLat = half / M_PER_DEG;
  const dLon = half / (M_PER_DEG * Math.cos((t.centerLat * Math.PI) / 180));
  return Rectangle.fromDegrees(t.centerLon - dLon, t.centerLat - dLat, t.centerLon + dLon, t.centerLat + dLat);
}

export default function CesiumView() {
  const { terrain, parcel, selected, buildings } = useAppSelector((s) => s.lot);
  const { basemap, exaggeration, showWater, showBuildings } = useAppSelector((s) => s.ui);
  const mountRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const framedFor = useRef<unknown>(null);

  // viewer (once)
  useEffect(() => {
    const viewer = new Viewer(mountRef.current!, {
      baseLayer: false,
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
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.globe.baseColor = Color.fromCssColorString("#dfe7e1");
    viewer.scene.globe.enableLighting = false;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 5;
    viewerRef.current = viewer;
    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // imagery follows the basemap choice
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const src = basemapSource(basemap);
    const layers = viewer.imageryLayers;
    layers.removeAll();
    layers.addImageryProvider(
      new UrlTemplateImageryProvider({
        url: src.url,
        credit: src.attribution.replace(/<[^>]+>/g, "").replace(/&copy;/g, "©"),
        maximumLevel: 19,
      }),
    );
    viewer.scene.requestRender();
  }, [basemap]);

  // terrain from the elevation grid (or Cesium World Terrain when an Ion token is configured)
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let cancelled = false;
    if (!terrain) {
      viewer.terrainProvider = new EllipsoidTerrainProvider();
      return;
    }
    if (ION_TOKEN) {
      createWorldTerrainAsync().then((p) => {
        if (!cancelled && viewerRef.current) viewerRef.current.terrainProvider = p;
      }).catch(() => {
        if (!cancelled && viewerRef.current) viewerRef.current.terrainProvider = gridTerrain(terrain);
      });
    } else {
      viewer.terrainProvider = gridTerrain(terrain);
    }
    return () => { cancelled = true; };
  }, [terrain]);

  // vertical exaggeration
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.scene.verticalExaggeration = exaggeration;
    viewer.scene.requestRender();
  }, [exaggeration]);

  // sea, buildings, parcel outline, selected address
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.entities.removeAll();
    if (!terrain) { viewer.scene.requestRender(); return; }

    const { centerLat, centerLon, sizeM } = terrain;
    const orange = Color.fromCssColorString("#c2410c");

    if (showWater && terrain.elevations.some((e) => e <= 0)) {
      viewer.entities.add({
        rectangle: {
          coordinates: gridRectangle(terrain),
          height: 0,
          material: Color.fromCssColorString("#2b86c5").withAlpha(0.6),
        },
      });
    }

    // existing buildings: footprint extruded to storeys x 3 m, base follows the ground
    if (showBuildings && buildings?.buildings.length) {
      for (const b of buildings.buildings) {
        if (b.ring.length < 3) continue;
        viewer.entities.add({
          polygon: {
            hierarchy: Cartesian3.fromDegreesArray(b.ring.flat()),
            height: 0,
            heightReference: HeightReference.RELATIVE_TO_GROUND,
            extrudedHeight: b.heightM,
            extrudedHeightReference: HeightReference.RELATIVE_TO_GROUND,
            material: Color.WHITE,
            outline: true,
            outlineColor: Color.fromCssColorString("#7b827e"),
          },
        });
      }
    }

    // parcel outline draped on the terrain, with corner markers
    if (parcel?.boundary.length) {
      const ring = parcel.boundary.flatMap((p) => [p.lon, p.lat]);
      ring.push(parcel.boundary[0].lon, parcel.boundary[0].lat);
      viewer.entities.add({
        polyline: { positions: Cartesian3.fromDegreesArray(ring), width: 3, material: orange, clampToGround: true },
      });
      for (const p of parcel.boundary) {
        viewer.entities.add({
          position: Cartesian3.fromDegrees(p.lon, p.lat),
          point: { pixelSize: 6, color: orange, outlineColor: Color.WHITE, outlineWidth: 1, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        });
      }
    }
    if (selected) {
      viewer.entities.add({
        position: Cartesian3.fromDegrees(selected.lon, selected.lat),
        point: { pixelSize: 11, color: orange, outlineColor: Color.WHITE, outlineWidth: 2, heightReference: HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      });
    }

    // re-frame the camera only when a new terrain arrives (not on slider changes)
    if (framedFor.current !== terrain) {
      framedFor.current = terrain;
      const groundY = Math.max(sampleElevation(terrain, 0, 0), 0) * exaggeration;
      const target = Cartesian3.fromDegrees(centerLon, centerLat, groundY);
      viewer.camera.lookAt(target, new HeadingPitchRange(0, CesiumMath.toRadians(-35), sizeM * 0.9));
      viewer.camera.lookAtTransform(Matrix4.IDENTITY); // release the target lock so normal orbit/pan/zoom works
    }
    viewer.scene.requestRender();
  }, [terrain, parcel, selected, buildings, showWater, showBuildings]); // exaggeration is read only for the first framing

  return (
    <div ref={mountRef} className="relative h-full w-full">
      {!terrain && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">
          Search an address to build the 3D terrain.
        </div>
      )}
    </div>
  );
}
