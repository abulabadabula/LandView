import type { AddressResult, BoundaryPoint, Parcel, TerrainGrid } from "@/types";
import { sampleElevation, toLocal } from "@/lib/geo";

export interface ParcelTerrainVertex {
  lon: number;
  lat: number;
  elevationM: number;
}

export interface ParcelBoundaryElevation extends BoundaryPoint {
  elevationM: number;
}

export interface ParcelTerrainMesh {
  vertices: ParcelTerrainVertex[];
  /** Flat array of indexed triangle vertices; each three entries define one face. */
  indices: number[];
  boundary: ParcelBoundaryElevation[];
  minElevationM: number;
  maxElevationM: number;
  gridSpacingM: number;
}

function pointInPolygon(east: number, north: number, polygon: Array<{ east: number; north: number }>) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = (a.north > north) !== (b.north > north);
    if (crosses) {
      const xAtNorth = ((b.east - a.east) * (north - a.north)) / (b.north - a.north) + a.east;
      if (east < xAtNorth) inside = !inside;
    }
  }
  return inside;
}

/**
 * Builds a local triangle surface using terrain-grid cells whose centres fall
 * inside the parcel ring. The visible mesh can extend by at most about one grid
 * cell near the boundary; the exact LINZ parcel boundary is drawn separately.
 */
export function buildParcelTerrainMesh(
  parcel: Parcel,
  terrain: TerrainGrid,
): ParcelTerrainMesh {
  const n = terrain.n;
  const half = terrain.sizeM / 2;
  const gridSpacingM = n > 1 ? terrain.sizeM / (n - 1) : terrain.sizeM;
  const polygon = parcel.boundary.map((point) =>
    toLocal(point.lon, point.lat, terrain.centerLon, terrain.centerLat),
  );
  const boundary: ParcelBoundaryElevation[] = parcel.boundary.map((point) => {
    const local = toLocal(point.lon, point.lat, terrain.centerLon, terrain.centerLat);
    return {
      ...point,
      elevationM: Number(sampleElevation(terrain, local.east, local.north).toFixed(2)),
    };
  });

  if (n < 2 || terrain.elevations.length < n * n || polygon.length < 3) {
    return { vertices: [], indices: [], boundary, minElevationM: 0, maxElevationM: 0, gridSpacingM };
  }

  const rawVertices: ParcelTerrainVertex[] = [];
  for (let row = 0; row < n; row += 1) {
    const north = -half + row * gridSpacingM;
    const lat = terrain.centerLat + north / 111_320;
    for (let col = 0; col < n; col += 1) {
      const east = -half + col * gridSpacingM;
      const lon = terrain.centerLon + east / (111_320 * Math.cos((terrain.centerLat * Math.PI) / 180));
      rawVertices.push({
        lon,
        lat,
        elevationM: terrain.elevations[row * n + col],
      });
    }
  }

  const rawIndices: number[] = [];
  for (let row = 0; row < n - 1; row += 1) {
    const north = -half + (row + 0.5) * gridSpacingM;
    for (let col = 0; col < n - 1; col += 1) {
      const east = -half + (col + 0.5) * gridSpacingM;
      if (!pointInPolygon(east, north, polygon)) continue;

      const southWest = row * n + col;
      const southEast = southWest + 1;
      const northWest = (row + 1) * n + col;
      const northEast = northWest + 1;
      rawIndices.push(southWest, southEast, northEast, southWest, northEast, northWest);
    }
  }

  const used = Array.from(new Set(rawIndices)).sort((a, b) => a - b);
  const remap = new Map<number, number>();
  const vertices = used.map((index, newIndex) => {
    remap.set(index, newIndex);
    return rawVertices[index];
  });
  const indices = rawIndices.map((index) => remap.get(index) ?? 0);
  const elevations = vertices.map((vertex) => vertex.elevationM);

  return {
    vertices,
    indices,
    boundary,
    minElevationM: elevations.length ? Math.min(...elevations) : 0,
    maxElevationM: elevations.length ? Math.max(...elevations) : 0,
    gridSpacingM,
  };
}

export function parcelTerrainExport(
  address: AddressResult,
  parcel: Parcel,
  terrain: TerrainGrid,
  mesh: ParcelTerrainMesh,
) {
  const triangles: number[][] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    triangles.push([mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]]);
  }
  return {
    schemaVersion: "landview.parcel-terrain.v1",
    generatedAt: new Date().toISOString(),
    address: {
      id: address.id,
      fullAddress: address.fullAddress,
      latitude: address.lat,
      longitude: address.lon,
    },
    parcel: {
      id: parcel.id,
      appellation: parcel.appellation,
      titles: parcel.titles,
      intent: parcel.parcelIntent,
      landDistrict: parcel.landDistrict,
      areaM2: parcel.areaM2,
      geometry: parcel.geometry,
      boundaryEndpoints: mesh.boundary,
    },
    terrain: {
      source: terrain.source,
      gridSizeM: terrain.sizeM,
      gridCount: terrain.n,
      approximateGridSpacingM: Number(mesh.gridSpacingM.toFixed(3)),
      minElevationM: Number(mesh.minElevationM.toFixed(2)),
      maxElevationM: Number(mesh.maxElevationM.toFixed(2)),
      coordinateSystem: "WGS84 longitude/latitude with source elevation in metres",
      vertices: mesh.vertices,
      triangles,
      indexBuffer: mesh.indices,
      surfaceMethod: "Regular elevation-grid cells selected by parcel-centre inclusion; boundary elevations are bilinearly interpolated.",
      limitation: "Visualisation mesh only. Cell-centre inclusion can extend the visible edge by up to about one grid cell; elevation datum and resolution depend on the source.",
    },
  };
}
