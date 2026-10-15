import { describe, expect, it } from "vitest";
import { buildParcelTerrainMesh, parcelTerrainExport } from "./parcelTerrain";
import type { AddressResult, Parcel, TerrainGrid } from "@/types";

const centerLat = -41;
const centerLon = 174;

function fromLocal(east: number, north: number) {
  return {
    lon: centerLon + east / (111_320 * Math.cos((centerLat * Math.PI) / 180)),
    lat: centerLat + north / 111_320,
  };
}

const coords = [
  fromLocal(-40, -40),
  fromLocal(40, -40),
  fromLocal(40, 40),
  fromLocal(-40, 40),
];

const parcel: Parcel = {
  id: 12,
  appellation: "Lot 12",
  titles: "Test title",
  parcelIntent: "Primary Parcel",
  landDistrict: "Auckland",
  areaM2: 6400,
  geometry: { type: "Polygon", coordinates: [[...coords.map((p) => [p.lon, p.lat]), [coords[0].lon, coords[0].lat]]] },
  boundary: coords.map((point, index) => ({
    index: index + 1,
    lon: point.lon,
    lat: point.lat,
    nztmE: index * 10,
    nztmN: index * 20,
  })),
};

const terrain: TerrainGrid = {
  centerLat,
  centerLon,
  sizeM: 100,
  n: 5,
  elevations: Array.from({ length: 25 }, (_, index) => 10 + index),
  minElevation: 10,
  maxElevation: 34,
  source: "test DEM",
};

const address: AddressResult = {
  id: 1,
  fullAddress: "1 Test Street, Auckland",
  lat: centerLat,
  lon: centerLon,
};

describe("buildParcelTerrainMesh", () => {
  it("creates indexed surface triangles inside the parcel and elevations for every boundary point", () => {
    const mesh = buildParcelTerrainMesh(parcel, terrain);
    expect(mesh.boundary).toHaveLength(4);
    expect(mesh.boundary.every((point) => Number.isFinite(point.elevationM))).toBe(true);
    expect(mesh.boundary[0].horizontalDistanceToNextM).toBeCloseTo(Math.sqrt(500), 2);
    expect(mesh.boundary[3].horizontalDistanceToNextM).toBeCloseTo(Math.sqrt(4500), 2);
    expect(mesh.vertices.length).toBeGreaterThan(0);
    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(mesh.indices.length % 3).toBe(0);
    expect(Math.max(...mesh.indices)).toBeLessThan(mesh.vertices.length);
    expect(mesh.gridSpacingM).toBe(25);

    // The clipped perimeter should include points on each exact parcel edge,
    // not stop at the nearest whole DEM cell.
    const localVertices = mesh.vertices.map((vertex) => ({
      east: (vertex.lon - centerLon) * 111_320 * Math.cos((centerLat * Math.PI) / 180),
      north: (vertex.lat - centerLat) * 111_320,
    }));
    expect(Math.min(...localVertices.map((point) => point.east))).toBeCloseTo(-40, 2);
    expect(Math.max(...localVertices.map((point) => point.east))).toBeCloseTo(40, 2);
    expect(Math.min(...localVertices.map((point) => point.north))).toBeCloseTo(-40, 2);
    expect(Math.max(...localVertices.map((point) => point.north))).toBeCloseTo(40, 2);
  });

  it("exports parcel area, endpoint elevations and an indexed terrain mesh", () => {
    const mesh = buildParcelTerrainMesh(parcel, terrain);
    const output = parcelTerrainExport(address, parcel, terrain, mesh);
    expect(output.schemaVersion).toBe("landview.parcel-terrain.v2");
    expect(output.parcel.areaM2).toBe(6400);
    expect(output.parcel.boundaryEndpoints).toHaveLength(4);
    expect(output.parcel.boundarySegments).toHaveLength(4);
    expect(output.parcel.boundarySegments[0].horizontalDistanceM).toBeCloseTo(Math.sqrt(500), 2);
    expect(output.terrain.triangles.length).toBe(mesh.indices.length / 3);
    expect(output.terrain.source).toBe("test DEM");
  });
});
