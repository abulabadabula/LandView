import { describe, expect, it } from "vitest";
import { compass, parcelGeoJson, sampleElevation, toLocal } from "./geo";
import type { BoundaryPoint, TerrainGrid } from "@/types";

/** 3x3 grid, 100 m wide, elevation = 10 * column + 100 * row (rows run south -> north). */
const grid: TerrainGrid = {
  centerLat: -41,
  centerLon: 174,
  sizeM: 100,
  n: 3,
  elevations: [0, 10, 20, 100, 110, 120, 200, 210, 220],
  minElevation: 0,
  maxElevation: 220,
  source: "test",
};

describe("toLocal", () => {
  it("is zero at the centre", () => {
    expect(toLocal(174, -41, 174, -41)).toEqual({ east: 0, north: 0 });
  });
  it("north offset is ~111.32 km per degree and east shrinks with latitude", () => {
    const p = toLocal(174.001, -40.999, 174, -41);
    expect(p.north).toBeCloseTo(111.32, 2);
    expect(p.east).toBeCloseTo(111.32 * Math.cos((41 * Math.PI) / 180), 2);
  });
});

describe("sampleElevation", () => {
  it("returns corner values and the centre", () => {
    expect(sampleElevation(grid, -50, -50)).toBeCloseTo(0);
    expect(sampleElevation(grid, 50, 50)).toBeCloseTo(220);
    expect(sampleElevation(grid, 0, 0)).toBeCloseTo(110);
  });
  it("interpolates bilinearly between nodes", () => {
    expect(sampleElevation(grid, -25, -25)).toBeCloseTo(55); // 5 + 50
  });
  it("clamps outside the grid", () => {
    expect(sampleElevation(grid, -999, -999)).toBeCloseTo(0);
    expect(sampleElevation(grid, 999, 999)).toBeCloseTo(220);
  });
});

describe("compass", () => {
  it("maps degrees to 8-point names", () => {
    expect(compass(null)).toBe("Flat");
    expect(compass(0)).toBe("N");
    expect(compass(90)).toBe("E");
    expect(compass(359)).toBe("N");
    expect(compass(225)).toBe("SW");
  });
});

describe("parcelGeoJson", () => {
  it("closes the ring", () => {
    const pts: BoundaryPoint[] = [
      { index: 1, lon: 0, lat: 0, nztmE: 0, nztmN: 0 },
      { index: 2, lon: 1, lat: 0, nztmE: 0, nztmN: 0 },
      { index: 3, lon: 1, lat: 1, nztmE: 0, nztmN: 0 },
    ];
    const f = parcelGeoJson(pts, {});
    const ring = (f.geometry.coordinates as number[][][])[0];
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[3]);
  });
});
