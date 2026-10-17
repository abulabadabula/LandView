import { describe, expect, it } from "vitest";
import { buildLegalEnvelopeGeometry } from "./legalEnvelope";

const boundary = [
  { eastM: 0, northM: 0 },
  { eastM: 20, northM: 0 },
  { eastM: 20, northM: 20 },
  { eastM: 0, northM: 20 },
];

const footprint = [
  { eastM: 2, northM: 2 },
  { eastM: 18, northM: 2 },
  { eastM: 18, northM: 18 },
  { eastM: 2, northM: 18 },
];

describe("buildLegalEnvelopeGeometry", () => {
  it("builds a subdivided HIRB cap over the inset footprint", () => {
    const geometry = buildLegalEnvelopeGeometry(
      footprint,
      boundary,
      () => 0,
      { startHeightM: 2.5, recessionAngleDeg: 45, maxCellSizeM: 2 },
    );

    expect(geometry.footprint).toHaveLength(4);
    expect(geometry.vertices.length).toBeGreaterThan(4);
    expect(geometry.indices.length).toBeGreaterThan(0);
    expect(geometry.indices.length % 3).toBe(0);
    expect(geometry.boundaryVertices).toHaveLength(4);
    expect(geometry.boundaryVertices[0].capY).toBeCloseTo(4.5, 4);
    expect(geometry.maximumHeightAboveGroundM).toBeGreaterThan(10);
  });

  it("supports concave footprints without filling the exterior corners", () => {
    const concave = [
      { eastM: 2, northM: 2 },
      { eastM: 18, northM: 2 },
      { eastM: 18, northM: 8 },
      { eastM: 9, northM: 8 },
      { eastM: 9, northM: 18 },
      { eastM: 2, northM: 18 },
    ];
    const geometry = buildLegalEnvelopeGeometry(
      concave,
      boundary,
      () => 0,
      { startHeightM: 2.5, recessionAngleDeg: 45, maxCellSizeM: 3 },
    );

    expect(geometry.triangleCount).toBeGreaterThan(0);
    expect(geometry.indices.length / 3).toBe(geometry.triangleCount);
  });

  it("builds exact planar facets and straight ridge segments in planar mode", () => {
    const geometry = buildLegalEnvelopeGeometry(
      footprint,
      boundary,
      (eastM, northM) => eastM * 0.08 + northM * 0.04,
      { startHeightM: 2.5, recessionAngleDeg: 45, mode: "planar" },
    );

    expect(geometry.triangleCount).toBeGreaterThan(0);
    expect(geometry.ridgeSegments.length).toBeGreaterThan(0);
    expect(geometry.vertices.every((vertex) => Number.isInteger(vertex.surfaceIndex))).toBe(true);

    for (let index = 0; index < geometry.indices.length; index += 3) {
      const a = geometry.vertices[geometry.indices[index]];
      const b = geometry.vertices[geometry.indices[index + 1]];
      const c = geometry.vertices[geometry.indices[index + 2]];
      expect(b.surfaceIndex).toBe(a.surfaceIndex);
      expect(c.surfaceIndex).toBe(a.surfaceIndex);
    }

    expect(geometry.ridgeSegments.every(
      (segment) => Math.hypot(
        segment.end.eastM - segment.start.eastM,
        segment.end.northM - segment.start.northM,
      ) > 0,
    )).toBe(true);
  });

  it("returns an empty mesh for an unusable footprint or boundary", () => {
    const geometry = buildLegalEnvelopeGeometry(
      [{ eastM: 0, northM: 0 }, { eastM: 1, northM: 0 }],
      boundary,
      () => 0,
      { startHeightM: 2.5, recessionAngleDeg: 45 },
    );
    expect(geometry.vertices).toHaveLength(0);
    expect(geometry.indices).toHaveLength(0);
  });

  it("clips the visible volume at ground where the limiting plane falls below the terrain", () => {
    const geometry = buildLegalEnvelopeGeometry(
      footprint,
      boundary,
      (eastM) => eastM < 10 ? 8 : 0,
      { startHeightM: 0, recessionAngleDeg: 0, maxCellSizeM: 4 },
    );

    expect(geometry.clippedVertexCount).toBeGreaterThan(0);
    expect(geometry.vertices.every((vertex) => vertex.capY >= vertex.groundY)).toBe(true);
  });
});
