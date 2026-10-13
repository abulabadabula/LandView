import { useEffect, useRef } from "react";
import {
  CameraEventType,
  Cartesian3,
  Color,
  CustomHeightmapTerrainProvider,
  EllipsoidTerrainProvider,
  HeadingPitchRange,
  HeightReference,
  Matrix4,
  Math as CesiumMath,
  Rectangle,
  SceneMode,
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
import type { ContextFeature, TerrainGrid } from "@/types";

// Cesium loads workers and assets from here (see vite.config.ts)
(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = "/cesium";

const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
if (ION_TOKEN) Ion.defaultAccessToken = ION_TOKEN;

const SEABED = -3;
const TILE = 65;
const M_PER_DEG = 111_320;

/** Heightmap backed by the local elevation grid. The grid is interpolated onto Cesium terrain tiles. */
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
      const half = t.sizeM / 2;
      for (let row = 0; row < TILE; row++) {
        const lat = CesiumMath.toDegrees(rect.north - ((rect.north - rect.south) * row) / (TILE - 1));
        for (let col = 0; col < TILE; col++) {
          const lon = CesiumMath.toDegrees(rect.west + ((rect.east - rect.west) * col) / (TILE - 1));
          const east = (lon - t.centerLon) * M_PER_DEG * cosLat;
          const north = (lat - t.centerLat) * M_PER_DEG;
          // Do not extend the edge elevations around the entire globe.
          if (Math.abs(east) > half || Math.abs(north) > half) {
            out[row * TILE + col] = 0;
          } else {
            out[row * TILE + col] = eff(sampleElevation(t, east, north));
          }
        }
      }
      return out;
    },
  });
}

/** Longitude/latitude rectangle covered by the elevation grid. */
function gridRectangle(t: TerrainGrid) {
  const half = t.sizeM / 2;
  const dLat = half / M_PER_DEG;
  const dLon = half / (M_PER_DEG * Math.cos((t.centerLat * Math.PI) / 180));
  return Rectangle.fromDegrees(
    t.centerLon - dLon,
    t.centerLat - dLat,
    t.centerLon + dLon,
    t.centerLat + dLat,
  );
}

function roadWidth(subtype: string | null) {
  switch (subtype) {
    case "motorway":
    case "motorway_link":
      return 5;
    case "trunk":
    case "trunk_link":
      return 4;
    case "primary":
    case "primary_link":
      return 3.5;
    case "secondary":
    case "secondary_link":
      return 3;
    case "tertiary":
    case "tertiary_link":
      return 2.5;
    default:
      return 1.6;
  }
}

function addContextFeature(
  viewer: Viewer,
  feature: ContextFeature,
  showRoads: boolean,
  showWaterways: boolean,
  showWater: boolean,
) {
  const positions = Cartesian3.fromDegreesArray(feature.coordinates.flat());
  if (feature.kind === "road" && showRoads) {
    const mainRoad = ["motorway", "trunk", "primary"].includes(feature.subtype ?? "");
    viewer.entities.add({
      id: `context-${feature.id}`,
      name: feature.name ?? `${feature.subtype ?? "Road"}`,
      polyline: {
        positions,
        clampToGround: true,
        width: roadWidth(feature.subtype),
        material: mainRoad
          ? Color.fromCssColorString("#e2a75b").withAlpha(0.9)
          : Color.fromCssColorString("#888d91").withAlpha(0.82),
      },
    });
  } else if (feature.kind === "waterway" && showWaterways) {
    viewer.entities.add({
      id: `context-${feature.id}`,
      name: feature.name ?? feature.subtype ?? "Waterway",
      polyline: {
        positions,
        clampToGround: true,
        width: feature.subtype === "river" || feature.subtype === "canal" ? 3.2 : 2,
        material: Color.fromCssColorString("#299ed3").withAlpha(0.95),
      },
    });
  } else if (feature.kind === "waterbody" && showWater && feature.coordinates.length >= 3) {
    viewer.entities.add({
      id: `context-${feature.id}`,
      name: feature.name ?? "Water body",
      polygon: {
        hierarchy: positions,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        material: Color.fromCssColorString("#268ec2").withAlpha(0.62),
        outline: true,
        outlineColor: Color.fromCssColorString("#1676a8").withAlpha(0.95),
      },
    });
  }
}

export default function CesiumView() {
  const { terrain, parcel, selected, buildings, context } = useAppSelector((s) => s.lot);
  const {
    basemap,
    exaggeration,
    showWater,
    showWaterways,
    showRoads,
    showBuildings,
  } = useAppSelector((s) => s.ui);
  const mountRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const framedFor = useRef<unknown>(null);

  // Create a true Cesium 3D scene once. The default scene is 3D too, but setting
  // the mode and gestures explicitly makes the orbit/tilt/zoom interaction clear.
  useEffect(() => {
    const viewer = new Viewer(mountRef.current!, {
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

    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.globe.baseColor = Color.fromCssColorString("#dfe7e1");
    viewer.scene.globe.enableLighting = true;
    viewer.scene.fog.enabled = true;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 20;
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
    viewer.scene.requestRender();

    viewerRef.current = viewer;
    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // Basemap follows the selected source.
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

  // Use the detailed local grid when it is based on LINZ data. World Terrain is
  // only preferred for coarse fallback data when an Ion token is configured.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let cancelled = false;
    if (!terrain) {
      viewer.terrainProvider = new EllipsoidTerrainProvider();
      viewer.scene.requestRender();
      return;
    }
    const isLinzGrid = terrain.source.toLowerCase().startsWith("linz");
    if (isLinzGrid || !ION_TOKEN) {
      viewer.terrainProvider = gridTerrain(terrain);
      viewer.scene.requestRender();
      return;
    }
    createWorldTerrainAsync()
      .then((provider) => {
        if (!cancelled && viewerRef.current) {
          viewerRef.current.terrainProvider = provider;
          viewerRef.current.scene.requestRender();
        }
      })
      .catch(() => {
        if (!cancelled && viewerRef.current) {
          viewerRef.current.terrainProvider = gridTerrain(terrain);
          viewerRef.current.scene.requestRender();
        }
      });
    return () => { cancelled = true; };
  }, [terrain]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.scene.verticalExaggeration = exaggeration;
    viewer.scene.requestRender();
  }, [exaggeration]);

  // All surrounding features are rendered as real Cesium ground-clamped lines or
  // polygon volumes; buildings use each footprint and its individual height.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.entities.removeAll();

    const inputBuildings = buildings?.buildings ?? [];
    const validRingCount = inputBuildings.filter((building) =>
      building.ring.length >= 3 && building.ring.every(([lon, lat]) =>
        Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90,
      ),
    ).length;
    console.info("[LandView][Cesium-buildings] render_start", {
      terrainReady: Boolean(terrain),
      showBuildings,
      payloadReceived: buildings !== null,
      buildingCount: inputBuildings.length,
      validRingCount,
      invalidRingCount: inputBuildings.length - validRingCount,
      terrainSizeM: terrain?.sizeM ?? null,
      sampleBuilding: inputBuildings[0]
        ? {
            id: inputBuildings[0].id,
            ringPointCount: inputBuildings[0].ring.length,
            firstPoint: inputBuildings[0].ring[0],
            heightM: inputBuildings[0].heightM,
            heightSource: inputBuildings[0].heightSource,
          }
        : null,
    });

    if (!terrain) {
      console.warn("[LandView][Cesium-buildings] render_skipped reason=terrain_not_ready");
      viewer.scene.requestRender();
      return;
    }

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

    if (context?.features.length) {
      for (const feature of context.features) {
        addContextFeature(viewer, feature, showRoads, showWaterways, showWater);
      }
    }

    let buildingEntitiesAdded = 0;
    let buildingEntitiesFailed = 0;
    let buildingRingsSkipped = 0;
    if (!showBuildings) {
      console.info("[LandView][Cesium-buildings] render_skipped reason=layer_disabled");
    } else if (!buildings) {
      console.warn("[LandView][Cesium-buildings] render_skipped reason=building_payload_null");
    } else {
      for (const building of buildings.buildings) {
        const validRing = building.ring.length >= 3 && building.ring.every(([lon, lat]) =>
          Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90,
        );
        if (!validRing) {
          buildingRingsSkipped += 1;
          console.warn("[LandView][Cesium-buildings] invalid_ring_skipped", {
            buildingId: building.id,
            ringPointCount: building.ring.length,
            firstPoints: building.ring.slice(0, 3),
          });
          continue;
        }
        const mappedHeight = building.heightSource === "osm_height" || building.heightSource === "osm_levels";
        const lidarHeight = building.heightSource === "lidar_estimated";
        try {
          viewer.entities.add({
            id: `building-${building.id ?? "unknown"}-${building.ring[0]?.[0]}-${building.ring[0]?.[1]}`,
            name: building.use ?? (mappedHeight ? "Building (OSM height)" : lidarHeight ? "Building (LiDAR-estimated height)" : "Building (assumed height)"),
            polygon: {
              hierarchy: Cartesian3.fromDegreesArray(building.ring.flat()),
              height: 0,
              heightReference: HeightReference.RELATIVE_TO_GROUND,
              extrudedHeight: Math.max(building.heightM, 1),
              extrudedHeightReference: HeightReference.RELATIVE_TO_GROUND,
              material: (mappedHeight
                ? Color.fromCssColorString("#aebdca")
                : lidarHeight
                  ? Color.fromCssColorString("#91b6a0")
                  : Color.fromCssColorString("#cbbda5")).withAlpha(0.98),
              outline: true,
              outlineColor: Color.fromCssColorString("#5d6b75").withAlpha(0.95),
            },
          });
          buildingEntitiesAdded += 1;
        } catch (error) {
          buildingEntitiesFailed += 1;
          console.error("[LandView][Cesium-buildings] entity_creation_failed", {
            buildingId: building.id,
            ringPointCount: building.ring.length,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    console.info("[LandView][Cesium-buildings] render_summary", {
      received: inputBuildings.length,
      entitiesAdded: buildingEntitiesAdded,
      invalidRingsSkipped: buildingRingsSkipped,
      entityCreationFailures: buildingEntitiesFailed,
      totalSceneEntitiesAfterBuildings: viewer.entities.values.length,
      showBuildings,
    });

    // Highlight the selected parcel on the terrain surface.
    if (parcel?.boundary.length) {
      const ring = parcel.boundary.flatMap((point) => [point.lon, point.lat]);
      ring.push(parcel.boundary[0].lon, parcel.boundary[0].lat);
      viewer.entities.add({
        polyline: {
          positions: Cartesian3.fromDegreesArray(ring),
          width: 3,
          material: orange,
          clampToGround: true,
        },
      });
      for (const point of parcel.boundary) {
        viewer.entities.add({
          position: Cartesian3.fromDegrees(point.lon, point.lat),
          point: {
            pixelSize: 6,
            color: orange,
            outlineColor: Color.WHITE,
            outlineWidth: 1,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
    }

    if (selected) {
      viewer.entities.add({
        position: Cartesian3.fromDegrees(selected.lon, selected.lat),
        point: {
          pixelSize: 11,
          color: orange,
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }

    // Only re-frame when the terrain extent changes. Slider and layer changes do not
    // reset the user's chosen camera orientation.
    if (framedFor.current !== terrain) {
      framedFor.current = terrain;
      const groundY = Math.max(sampleElevation(terrain, 0, 0), 0) * exaggeration;
      const target = Cartesian3.fromDegrees(centerLon, centerLat, groundY);
      viewer.camera.lookAt(
        target,
        new HeadingPitchRange(
          CesiumMath.toRadians(15),
          CesiumMath.toRadians(-48),
          sizeM * 1.55,
        ),
      );
      viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    }
    viewer.scene.requestRender();
  }, [
    terrain,
    parcel,
    selected,
    buildings,
    context,
    showWater,
    showWaterways,
    showRoads,
    showBuildings,
  ]);

  return (
    <div ref={mountRef} className="relative h-full w-full">
      {!terrain && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">
          Search an address to build the 3D terrain.
        </div>
      )}
      {terrain && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-md border border-white/30 bg-slate-950/75 px-3 py-2 text-xs text-white shadow">
          <div className="font-medium">3D terrain · {terrain.sizeM} m × {terrain.sizeM} m</div>
          <div className="mt-0.5 text-white/80">Elevation source: {terrain.source}</div>
          <div className="mt-0.5 text-white/80">Left-drag to rotate · Right-drag to tilt · Scroll to zoom</div>
          {terrain.source.toLowerCase().includes("open-meteo") && (
            <div className="mt-0.5 text-amber-200">Coarse fallback elevation data: local ground detail is limited. Configure LINZ_BASEMAPS_KEY for LiDAR coverage.</div>
          )}
        </div>
      )}
    </div>
  );
}
