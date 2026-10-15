import type { AddressResult, BoundaryPoint, Parcel, ParcelSetbackResult, TerrainGrid } from "@/types";
import { sampleElevation, toLocal } from "@/lib/geo";

const METRES_PER_DEGREE = 111_320;
const GEOMETRY_EPSILON = 1e-8;

interface LocalPoint {
  east: number;
  north: number;
}

interface TerrainPoint extends LocalPoint {
  elevationM: number;
}

interface ParcelTriangle {
  points: [LocalPoint, LocalPoint, LocalPoint];
  minEast: number;
  maxEast: number;
  minNorth: number;
  maxNorth: number;
}

export interface ParcelTerrainVertex {
  lon: number;
  lat: number;
  elevationM: number;
}

export interface ParcelBoundaryElevation extends BoundaryPoint {
  elevationM: number;
  /** Horizontal plan distance from this boundary endpoint to the next endpoint, in metres. */
  horizontalDistanceToNextM: number;
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

function cross(a: LocalPoint, b: LocalPoint, c: LocalPoint) {
  return (b.east - a.east) * (c.north - a.north)
    - (b.north - a.north) * (c.east - a.east);
}

function polygonSignedArea(polygon: LocalPoint[]) {
  let twiceArea = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i];
    const next = polygon[(i + 1) % polygon.length];
    twiceArea += current.east * next.north - next.east * current.north;
  }
  return twiceArea / 2;
}

function samePoint(a: LocalPoint, b: LocalPoint) {
  return Math.hypot(a.east - b.east, a.north - b.north) < 1e-5;
}

function pointInsideTriangle(point: LocalPoint, triangle: [LocalPoint, LocalPoint, LocalPoint]) {
  return (
    cross(triangle[0], triangle[1], point) >= -GEOMETRY_EPSILON
    && cross(triangle[1], triangle[2], point) >= -GEOMETRY_EPSILON
    && cross(triangle[2], triangle[0], point) >= -GEOMETRY_EPSILON
  );
}

/** Ear-clipping triangulation supports concave parcel outlines, unlike convex-only polygon clipping. */
function triangulatePolygon(input: LocalPoint[]): Array<[LocalPoint, LocalPoint, LocalPoint]> {
  let points: LocalPoint[] = [];
  for (const point of input) {
    if (!points.length || !samePoint(points[points.length - 1], point)) points.push(point);
  }
  if (points.length > 2 && samePoint(points[0], points[points.length - 1])) points.pop();
  if (points.length < 3) return [];
  if (polygonSignedArea(points) < 0) points = points.reverse();

  // Remove collinear vertices from the temporary triangulation ring only.
  let cleaned = true;
  while (cleaned && points.length > 3) {
    cleaned = false;
    for (let i = 0; i < points.length; i += 1) {
      const previous = points[(i + points.length - 1) % points.length];
      const current = points[i];
      const next = points[(i + 1) % points.length];
      if (Math.abs(cross(previous, current, next)) <= GEOMETRY_EPSILON) {
        points.splice(i, 1);
        cleaned = true;
        break;
      }
    }
  }

  const remaining = points.slice();
  const triangles: Array<[LocalPoint, LocalPoint, LocalPoint]> = [];
  let guard = remaining.length * remaining.length;

  while (remaining.length > 3 && guard > 0) {
    guard -= 1;
    let earFound = false;

    for (let i = 0; i < remaining.length; i += 1) {
      const previous = remaining[(i + remaining.length - 1) % remaining.length];
      const current = remaining[i];
      const next = remaining[(i + 1) % remaining.length];
      const ear: [LocalPoint, LocalPoint, LocalPoint] = [previous, current, next];

      if (cross(previous, current, next) <= GEOMETRY_EPSILON) continue;
      const containsOtherPoint = remaining.some((candidate, candidateIndex) =>
        candidateIndex !== i
        && candidateIndex !== (i + remaining.length - 1) % remaining.length
        && candidateIndex !== (i + 1) % remaining.length
        && pointInsideTriangle(candidate, ear),
      );
      if (containsOtherPoint) continue;

      triangles.push(ear);
      remaining.splice(i, 1);
      earFound = true;
      break;
    }

    if (!earFound) break;
  }

  if (remaining.length === 3 && cross(remaining[0], remaining[1], remaining[2]) > GEOMETRY_EPSILON) {
    triangles.push([remaining[0], remaining[1], remaining[2]]);
  }
  return triangles;
}

/** Intersect a convex terrain triangle with a convex parcel triangle. Both are oriented counter-clockwise. */
function clipTriangleToTriangle(
  subject: LocalPoint[],
  clipTriangle: [LocalPoint, LocalPoint, LocalPoint],
): LocalPoint[] {
  let output = subject;

  for (let edgeIndex = 0; edgeIndex < 3 && output.length; edgeIndex += 1) {
    const edgeStart = clipTriangle[edgeIndex];
    const edgeEnd = clipTriangle[(edgeIndex + 1) % 3];
    const input = output;
    output = [];
    let previous = input[input.length - 1];
    let previousDistance = cross(edgeStart, edgeEnd, previous);
    let previousInside = previousDistance >= -GEOMETRY_EPSILON;

    for (const current of input) {
      const currentDistance = cross(edgeStart, edgeEnd, current);
      const currentInside = currentDistance >= -GEOMETRY_EPSILON;

      if (currentInside !== previousInside) {
        const denominator = previousDistance - currentDistance;
        if (Math.abs(denominator) > GEOMETRY_EPSILON) {
          const ratio = previousDistance / denominator;
          output.push({
            east: previous.east + ratio * (current.east - previous.east),
            north: previous.north + ratio * (current.north - previous.north),
          });
        }
      }
      if (currentInside) output.push(current);

      previous = current;
      previousDistance = currentDistance;
      previousInside = currentInside;
    }

    // Remove duplicate consecutive vertices introduced by intersections at a corner.
    output = output.filter((point, index) =>
      index === 0 || !samePoint(point, output[index - 1]),
    );
    if (output.length > 2 && samePoint(output[0], output[output.length - 1])) output.pop();
  }

  return output;
}

function interpolateTriangleElevation(point: LocalPoint, triangle: [TerrainPoint, TerrainPoint, TerrainPoint]) {
  const [a, b, c] = triangle;
  const area = cross(a, b, c);
  if (Math.abs(area) < GEOMETRY_EPSILON) return a.elevationM;

  const weightA = cross(b, c, point) / area;
  const weightB = cross(c, a, point) / area;
  const weightC = cross(a, b, point) / area;
  return weightA * a.elevationM + weightB * b.elevationM + weightC * c.elevationM;
}

function boundsOfTriangle(points: [LocalPoint, LocalPoint, LocalPoint]): ParcelTriangle {
  return {
    points,
    minEast: Math.min(...points.map((point) => point.east)),
    maxEast: Math.max(...points.map((point) => point.east)),
    minNorth: Math.min(...points.map((point) => point.north)),
    maxNorth: Math.max(...points.map((point) => point.north)),
  };
}

function boundsOverlap(a: ParcelTriangle, b: ParcelTriangle) {
  return a.maxEast >= b.minEast - GEOMETRY_EPSILON
    && b.maxEast >= a.minEast - GEOMETRY_EPSILON
    && a.maxNorth >= b.minNorth - GEOMETRY_EPSILON
    && b.maxNorth >= a.minNorth - GEOMETRY_EPSILON;
}

function localToVertex(point: TerrainPoint, terrain: TerrainGrid): ParcelTerrainVertex {
  const cosine = Math.cos((terrain.centerLat * Math.PI) / 180);
  return {
    lon: terrain.centerLon + point.east / (METRES_PER_DEGREE * cosine),
    lat: terrain.centerLat + point.north / METRES_PER_DEGREE,
    elevationM: point.elevationM,
  };
}

/**
 * Build a terrain TIN clipped to the actual parcel polygon. The parcel ring is
 * triangulated first; every DEM triangle is then intersected with those parcel
 * triangles. This works for concave parcel outlines and puts mesh perimeter
 * vertices directly on the supplied boundary instead of selecting whole cells.
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

  const boundaryBase = parcel.boundary.map((point) => {
    const local = toLocal(point.lon, point.lat, terrain.centerLon, terrain.centerLat);
    return {
      ...point,
      elevationM: Number(sampleElevation(terrain, local.east, local.north).toFixed(2)),
    };
  });
  const boundary: ParcelBoundaryElevation[] = boundaryBase.map((point, index) => {
    const next = boundaryBase[(index + 1) % boundaryBase.length];
    const deltaE = next.nztmE - point.nztmE;
    const deltaN = next.nztmN - point.nztmN;
    return {
      ...point,
      horizontalDistanceToNextM: Number(Math.hypot(deltaE, deltaN).toFixed(2)),
    };
  });

  if (n < 2 || terrain.elevations.length < n * n || polygon.length < 3) {
    return { vertices: [], indices: [], boundary, minElevationM: 0, maxElevationM: 0, gridSpacingM };
  }

  const parcelTriangles = triangulatePolygon(polygon).map(boundsOfTriangle);
  if (!parcelTriangles.length) {
    return { vertices: [], indices: [], boundary, minElevationM: 0, maxElevationM: 0, gridSpacingM };
  }

  const vertices: ParcelTerrainVertex[] = [];
  const indices: number[] = [];
  // Adjacent clipped patches share vertices so lighting remains continuous.
  const vertexIndexByKey = new Map<string, number>();
  const addVertex = (point: TerrainPoint) => {
    const key = Math.round(point.east * 1000) + ":" + Math.round(point.north * 1000);
    const existing = vertexIndexByKey.get(key);
    if (existing !== undefined) return existing;
    const index = vertices.length;
    vertices.push(localToVertex(point, terrain));
    vertexIndexByKey.set(key, index);
    return index;
  };

  const gridPoint = (row: number, col: number): TerrainPoint => ({
    east: -half + col * gridSpacingM,
    north: -half + row * gridSpacingM,
    elevationM: terrain.elevations[row * n + col],
  });

  const addClippedPatch = (
    sourceTriangle: [TerrainPoint, TerrainPoint, TerrainPoint],
    parcelTriangle: ParcelTriangle,
  ) => {
    const clipped = clipTriangleToTriangle(sourceTriangle, parcelTriangle.points);
    if (clipped.length < 3 || Math.abs(polygonSignedArea(clipped)) < 1e-7) return;

    const patchIndices = clipped.map((point) => {
      const terrainPoint: TerrainPoint = {
        east: point.east,
        north: point.north,
        elevationM: interpolateTriangleElevation(point, sourceTriangle),
      };
      return addVertex(terrainPoint);
    });

    for (let index = 1; index < patchIndices.length - 1; index += 1) {
      const a = patchIndices[0];
      const b = patchIndices[index];
      const c = patchIndices[index + 1];
      if (a !== b && b !== c && c !== a) indices.push(a, b, c);
    }
  };

  // Source DEM cells each contain two triangles sharing the SW-to-NE diagonal.
  for (let row = 0; row < n - 1; row += 1) {
    for (let col = 0; col < n - 1; col += 1) {
      const southWest = gridPoint(row, col);
      const southEast = gridPoint(row, col + 1);
      const northWest = gridPoint(row + 1, col);
      const northEast = gridPoint(row + 1, col + 1);
      const terrainTriangles: Array<[TerrainPoint, TerrainPoint, TerrainPoint]> = [
        [southWest, southEast, northEast],
        [southWest, northEast, northWest],
      ];

      for (const terrainTriangle of terrainTriangles) {
        const terrainBounds = boundsOfTriangle(terrainTriangle);
        // Only clip against parcel triangles whose bounding boxes overlap this DEM face.
        for (const parcelTriangle of parcelTriangles) {
          if (boundsOverlap(terrainBounds, parcelTriangle)) {
            addClippedPatch(terrainTriangle, parcelTriangle);
          }
        }
      }
    }
  }

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
  setback: ParcelSetbackResult | null = null,
) {
  const triangles: number[][] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    triangles.push([mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]]);
  }
  return {
    schemaVersion: "landview.parcel-terrain.v3",
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
      boundarySegments: mesh.boundary.map((point, index) => ({
        fromPoint: point.index,
        toPoint: mesh.boundary[(index + 1) % mesh.boundary.length].index,
        horizontalDistanceM: point.horizontalDistanceToNextM,
      })),
    },
    setback: setback ? {
      distanceM: setback.distanceM,
      coordinateSystem: "NZTM2000 / EPSG:2193",
      method: "Negative planar buffer of the legal parcel polygon with mitred corners.",
      warning: setback.warning,
      polygons: setback.polygons.map((polygon) => ({
        areaM2: polygon.areaM2,
        controlPoints: polygon.points,
      })),
    } : null,
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
      surfaceMethod: "Each terrain-grid triangle is clipped against an ear-clipped triangulation of the parcel outline. Intersection elevations are linearly interpolated on their source terrain triangle.",
      limitation: "Visualisation mesh only. The perimeter follows the supplied parcel outline, while elevation resolution and datum still depend on the source grid. Boundary endpoint elevations are bilinearly interpolated from the grid.",
    },
  };
}
