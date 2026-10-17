export interface LegalEnvelopePoint {
  eastM: number;
  northM: number;
}

export interface LegalEnvelopeVertex extends LegalEnvelopePoint {
  /** Elevation relative to the local scene datum. */
  groundY: number;
  /** HIRB-limited upper elevation relative to the local scene datum. */
  capY: number;
  /** Index of the exact planar HIRB facet in planar mode. */
  surfaceIndex?: number;
}

export type HirbSurfaceMode = "planar" | "terrain-following";

export interface LegalEnvelopeSegment {
  start: LegalEnvelopePoint;
  end: LegalEnvelopePoint;
  startCapY: number;
  endCapY: number;
}

export interface LegalEnvelopeGeometry {
  /** Simple, non-closed footprint ring in local metres. */
  footprint: LegalEnvelopePoint[];
  /** Subdivided cap mesh. Indices are grouped in triples. */
  vertices: LegalEnvelopeVertex[];
  indices: number[];
  /** One vertex for each footprint corner, including ground and upper elevations. */
  boundaryVertices: LegalEnvelopeVertex[];
  /** Straight facet-to-facet breaklines, populated in planar mode. */
  ridgeSegments: LegalEnvelopeSegment[];
  triangleCount: number;
  clippedVertexCount: number;
  maximumHeightAboveGroundM: number;
}

export interface LegalEnvelopeParameters {
  startHeightM: number;
  recessionAngleDeg: number;
  /** Smaller cells depict changes in the limiting plane more accurately. */
  maxCellSizeM?: number;
  /** Planar uses true flat planes; terrain-following preserves the existing DEM-draped method. */
  mode?: HirbSurfaceMode;
}

const EPSILON = 1e-8;

/**
 * Build a tessellated, HIRB-limited volume cap for a simple buildable footprint.
 *
 * All coordinates are local metres: east increases +X and north increases +north.
 * The view layer maps north to Three.js -Z. Ground elevations supplied by groundYAt
 * must be relative to the same vertical datum as the Three.js scene.
 *
 * The caller is responsible for passing a planner-reviewed footprint and rule values.
 * This function performs geometry only; it does not determine whether a planning rule
 * applies to a particular zone, boundary, overlay or site.
 */
export function buildLegalEnvelopeGeometry(
  footprintInput: LegalEnvelopePoint[],
  boundaryInput: LegalEnvelopePoint[],
  groundYAt: (eastM: number, northM: number) => number,
  parameters: LegalEnvelopeParameters,
): LegalEnvelopeGeometry {
  const footprint = normalizeRing(footprintInput);
  const boundary = normalizeRing(boundaryInput);

  const empty: LegalEnvelopeGeometry = {
    footprint,
    vertices: [],
    indices: [],
    boundaryVertices: [],
    ridgeSegments: [],
    triangleCount: 0,
    clippedVertexCount: 0,
    maximumHeightAboveGroundM: 0,
  };

  if (footprint.length < 3 || boundary.length < 3) return empty;

  const baseTriangles = triangulateRing(footprint);
  if (baseTriangles.length === 0) return empty;

  const startHeightM = Number.isFinite(parameters.startHeightM)
    ? Math.max(0, parameters.startHeightM)
    : 0;
  const recessionAngleDeg = Number.isFinite(parameters.recessionAngleDeg)
    ? Math.min(89.5, Math.max(0, parameters.recessionAngleDeg))
    : 45;
  const maxCellSizeM = Number.isFinite(parameters.maxCellSizeM)
    ? Math.min(5, Math.max(0.25, parameters.maxCellSizeM as number))
    : 1.5;
  const tangent = Math.tan((recessionAngleDeg * Math.PI) / 180);

  if (parameters.mode === "planar") {
    return buildPlanarLegalEnvelope(
      footprint,
      boundary,
      baseTriangles,
      groundYAt,
      startHeightM,
      tangent,
    );
  }

  const vertices: LegalEnvelopeVertex[] = [];
  const indices: number[] = [];
  let clippedVertexCount = 0;
  let maximumHeightAboveGroundM = 0;

  const addVertex = (point: LegalEnvelopePoint) => {
    const groundY = sampleGround(groundYAt, point.eastM, point.northM);
    const unboundedCapY = getHirbCapY(
      point,
      boundary,
      groundYAt,
      startHeightM,
      tangent,
    );
    // Where a terrain sample is already above a limiting plane, the legal volume
    // has no positive height. Clamp the visual cap to ground rather than showing an
    // inverted volume below the terrain surface.
    const capY = Math.max(groundY, unboundedCapY);
    if (unboundedCapY < groundY - 0.05) clippedVertexCount += 1;
    maximumHeightAboveGroundM = Math.max(maximumHeightAboveGroundM, capY - groundY);
    vertices.push({ ...point, groundY, capY });
    return vertices.length - 1;
  };

  for (const triangle of baseTriangles) {
    const longestEdge = Math.max(
      distance(triangle[0], triangle[1]),
      distance(triangle[1], triangle[2]),
      distance(triangle[2], triangle[0]),
    );
    const divisions = Math.max(1, Math.ceil(longestEdge / maxCellSizeM));
    const grid: number[][] = [];

    for (let i = 0; i <= divisions; i += 1) {
      grid[i] = [];
      for (let j = 0; j <= divisions - i; j += 1) {
        const weightB = i / divisions;
        const weightC = j / divisions;
        const weightA = 1 - weightB - weightC;
        const point = {
          eastM: triangle[0].eastM * weightA
            + triangle[1].eastM * weightB
            + triangle[2].eastM * weightC,
          northM: triangle[0].northM * weightA
            + triangle[1].northM * weightB
            + triangle[2].northM * weightC,
        };
        grid[i][j] = addVertex(point);
      }
    }

    for (let i = 0; i < divisions; i += 1) {
      for (let j = 0; j < divisions - i; j += 1) {
        indices.push(grid[i][j], grid[i + 1][j], grid[i][j + 1]);
        if (i + j < divisions - 1) {
          indices.push(grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
        }
      }
    }
  }

  const boundaryVertices = footprint.map((point) => {
    const groundY = sampleGround(groundYAt, point.eastM, point.northM);
    const unboundedCapY = getHirbCapY(
      point,
      boundary,
      groundYAt,
      startHeightM,
      tangent,
    );
    const capY = Math.max(groundY, unboundedCapY);
    if (unboundedCapY < groundY - 0.05) clippedVertexCount += 1;
    maximumHeightAboveGroundM = Math.max(maximumHeightAboveGroundM, capY - groundY);
    return { ...point, groundY, capY };
  });

  return {
    footprint,
    vertices,
    indices,
    boundaryVertices,
    ridgeSegments: [],
    triangleCount: indices.length / 3,
    clippedVertexCount,
    maximumHeightAboveGroundM,
  };
}


interface AffinePlane {
  a: number;
  b: number;
  c: number;
  index: number;
}

function evaluatePlane(plane: AffinePlane, point: LegalEnvelopePoint) {
  return plane.a * point.eastM + plane.b * point.northM + plane.c;
}

/**
 * Planar mode builds one affine plane per parcel boundary edge, linearly
 * interpolating between that edge's two DEM endpoint elevations. The footprint
 * triangulation is clipped by all plane-pair inequalities so every output cap
 * triangle lies on exactly one true plane and every facet breakline is straight.
 */
function buildPlanarLegalEnvelope(
  footprint: LegalEnvelopePoint[],
  boundary: LegalEnvelopePoint[],
  baseTriangles: Array<[LegalEnvelopePoint, LegalEnvelopePoint, LegalEnvelopePoint]>,
  groundYAt: (eastM: number, northM: number) => number,
  startHeightM: number,
  tangent: number,
): LegalEnvelopeGeometry {
  const planes: AffinePlane[] = [];
  for (let index = 0; index < boundary.length; index += 1) {
    const start = boundary[index];
    const end = boundary[(index + 1) % boundary.length];
    const dx = end.eastM - start.eastM;
    const dn = end.northM - start.northM;
    const lengthSquared = dx * dx + dn * dn;
    const length = Math.sqrt(lengthSquared);
    if (length <= EPSILON) continue;

    const startGround = sampleGround(groundYAt, start.eastM, start.northM);
    const endGround = sampleGround(groundYAt, end.eastM, end.northM);
    const groundGradient = endGround - startGround;

    // Extend the linear endpoint datum along the boundary's supporting line.
    // The inward signed perpendicular distance is cross(edge, point-start)/length.
    planes.push({
      a: groundGradient * dx / lengthSquared - tangent * dn / length,
      b: groundGradient * dn / lengthSquared + tangent * dx / length,
      c: startGround + startHeightM
        - groundGradient * (dx * start.eastM + dn * start.northM) / lengthSquared
        + tangent * (dn * start.eastM - dx * start.northM) / length,
      index,
    });
  }

  const empty: LegalEnvelopeGeometry = {
    footprint,
    vertices: [],
    indices: [],
    boundaryVertices: [],
    ridgeSegments: [],
    triangleCount: 0,
    clippedVertexCount: 0,
    maximumHeightAboveGroundM: 0,
  };
  if (planes.length < 3) return empty;

  const vertices: LegalEnvelopeVertex[] = [];
  const indices: number[] = [];
  const ridgeSegments: LegalEnvelopeSegment[] = [];
  const ridgeKeys = new Set<string>();
  let clippedVertexCount = 0;
  let maximumHeightAboveGroundM = 0;

  const addPatchVertex = (point: LegalEnvelopePoint, plane: AffinePlane) => {
    const groundY = sampleGround(groundYAt, point.eastM, point.northM);
    const capY = evaluatePlane(plane, point);
    if (capY < groundY - 0.05) clippedVertexCount += 1;
    maximumHeightAboveGroundM = Math.max(maximumHeightAboveGroundM, capY - groundY);
    vertices.push({ ...point, groundY, capY, surfaceIndex: plane.index });
    return vertices.length - 1;
  };

  const addRidgeSegment = (
    start: LegalEnvelopePoint,
    end: LegalEnvelopePoint,
    startCapY: number,
    endCapY: number,
  ) => {
    if (distance(start, end) < 1e-5) return;
    const rounded = (point: LegalEnvelopePoint) =>
      point.eastM.toFixed(3) + "," + point.northM.toFixed(3);
    const a = rounded(start);
    const b = rounded(end);
    const key = a < b ? a + "|" + b : b + "|" + a;
    if (ridgeKeys.has(key)) return;
    ridgeKeys.add(key);
    ridgeSegments.push({
      start: { eastM: start.eastM, northM: start.northM },
      end: { eastM: end.eastM, northM: end.northM },
      startCapY,
      endCapY,
    });
  };

  for (const triangle of baseTriangles) {
    for (const plane of planes) {
      let polygon: LegalEnvelopePoint[] = triangle.map((point) => ({ ...point }));
      for (const otherPlane of planes) {
        if (otherPlane.index === plane.index || polygon.length === 0) continue;
        polygon = clipByHalfPlane(
          polygon,
          (point) => evaluatePlane(plane, point) - evaluatePlane(otherPlane, point),
        );
      }

      polygon = removeAdjacentDuplicates(polygon);
      if (polygon.length < 3 || Math.abs(signedArea(polygon)) <= 1e-6) continue;
      if (signedArea(polygon) < 0) polygon.reverse();

      const firstIndex = vertices.length;
      polygon.forEach((point) => addPatchVertex(point, plane));

      for (let index = 1; index < polygon.length - 1; index += 1) {
        indices.push(firstIndex, firstIndex + index, firstIndex + index + 1);
      }

      // Intersections between this active plane and another active plane are
      // exact straight segments created by the half-plane clipping operation.
      for (let edgeIndex = 0; edgeIndex < polygon.length; edgeIndex += 1) {
        const start = polygon[edgeIndex];
        const end = polygon[(edgeIndex + 1) % polygon.length];
        for (const otherPlane of planes) {
          if (otherPlane.index === plane.index) continue;
          const startDelta = evaluatePlane(plane, start) - evaluatePlane(otherPlane, start);
          const endDelta = evaluatePlane(plane, end) - evaluatePlane(otherPlane, end);
          if (Math.abs(startDelta) <= 1e-5 && Math.abs(endDelta) <= 1e-5) {
            addRidgeSegment(
              start,
              end,
              evaluatePlane(plane, start),
              evaluatePlane(plane, end),
            );
          }
        }
      }
    }
  }

  const boundaryVertices = footprint.map((point) => {
    const groundY = sampleGround(groundYAt, point.eastM, point.northM);
    const capY = Math.max(
      groundY,
      Math.min(...planes.map((plane) => evaluatePlane(plane, point))),
    );
    if (capY <= groundY + 0.05) clippedVertexCount += 1;
    maximumHeightAboveGroundM = Math.max(maximumHeightAboveGroundM, capY - groundY);
    return { ...point, groundY, capY };
  });

  return {
    footprint,
    vertices,
    indices,
    boundaryVertices,
    ridgeSegments,
    triangleCount: indices.length / 3,
    clippedVertexCount,
    maximumHeightAboveGroundM,
  };
}

function clipByHalfPlane(
  polygon: LegalEnvelopePoint[],
  evaluate: (point: LegalEnvelopePoint) => number,
) {
  if (polygon.length === 0) return polygon;
  const output: LegalEnvelopePoint[] = [];
  let previous = polygon[polygon.length - 1];
  let previousValue = evaluate(previous);
  let previousInside = previousValue <= 1e-8;

  for (const current of polygon) {
    const currentValue = evaluate(current);
    const currentInside = currentValue <= 1e-8;

    if (currentInside !== previousInside) {
      const denominator = previousValue - currentValue;
      if (Math.abs(denominator) > EPSILON) {
        const ratio = Math.min(1, Math.max(0, previousValue / denominator));
        output.push({
          eastM: previous.eastM + (current.eastM - previous.eastM) * ratio,
          northM: previous.northM + (current.northM - previous.northM) * ratio,
        });
      }
    }
    if (currentInside) output.push({ eastM: current.eastM, northM: current.northM });

    previous = current;
    previousValue = currentValue;
    previousInside = currentInside;
  }
  return removeAdjacentDuplicates(output);
}

function removeAdjacentDuplicates(polygon: LegalEnvelopePoint[]) {
  const output: LegalEnvelopePoint[] = [];
  for (const point of polygon) {
    if (!output.length || distance(output[output.length - 1], point) > 1e-6) output.push(point);
  }
  if (output.length > 2 && distance(output[0], output[output.length - 1]) <= 1e-6) output.pop();
  return output;
}

function sampleGround(
  groundYAt: (eastM: number, northM: number) => number,
  eastM: number,
  northM: number,
) {
  const elevation = groundYAt(eastM, northM);
  return Number.isFinite(elevation) ? elevation : 0;
}

function getHirbCapY(
  point: LegalEnvelopePoint,
  boundary: LegalEnvelopePoint[],
  groundYAt: (eastM: number, northM: number) => number,
  startHeightM: number,
  tangent: number,
) {
  let capY = Number.POSITIVE_INFINITY;

  for (let index = 0; index < boundary.length; index += 1) {
    const start = boundary[index];
    const end = boundary[(index + 1) % boundary.length];
    const dx = end.eastM - start.eastM;
    const dn = end.northM - start.northM;
    const lengthSquared = dx * dx + dn * dn;
    if (lengthSquared <= EPSILON) continue;

    const projection = Math.min(1, Math.max(
      0,
      ((point.eastM - start.eastM) * dx + (point.northM - start.northM) * dn)
        / lengthSquared,
    ));
    const nearestEast = start.eastM + projection * dx;
    const nearestNorth = start.northM + projection * dn;
    const horizontalDistance = Math.hypot(
      point.eastM - nearestEast,
      point.northM - nearestNorth,
    );
    const boundaryGround = sampleGround(groundYAt, nearestEast, nearestNorth);
    const planeY = boundaryGround + startHeightM + horizontalDistance * tangent;
    capY = Math.min(capY, planeY);
  }

  return Number.isFinite(capY) ? capY : 0;
}

function normalizeRing(input: LegalEnvelopePoint[]): LegalEnvelopePoint[] {
  const output: LegalEnvelopePoint[] = [];
  for (const point of input) {
    if (!Number.isFinite(point.eastM) || !Number.isFinite(point.northM)) continue;
    const previous = output[output.length - 1];
    if (!previous || distance(previous, point) > 1e-5) {
      output.push({ eastM: point.eastM, northM: point.northM });
    }
  }

  if (output.length > 2 && distance(output[0], output[output.length - 1]) <= 1e-5) {
    output.pop();
  }

  // Remove consecutive collinear points to make ear clipping more stable.
  let changed = true;
  while (changed && output.length > 3) {
    changed = false;
    for (let index = 0; index < output.length; index += 1) {
      const previous = output[(index + output.length - 1) % output.length];
      const current = output[index];
      const next = output[(index + 1) % output.length];
      if (Math.abs(cross(previous, current, next)) <= EPSILON) {
        output.splice(index, 1);
        changed = true;
        break;
      }
    }
  }

  if (signedArea(output) < 0) output.reverse();
  return output;
}

function triangulateRing(ring: LegalEnvelopePoint[]) {
  const remaining = ring.map((_, index) => index);
  const triangles: Array<[LegalEnvelopePoint, LegalEnvelopePoint, LegalEnvelopePoint]> = [];
  let guard = ring.length * ring.length;

  while (remaining.length > 3 && guard > 0) {
    guard -= 1;
    let earFound = false;

    for (let position = 0; position < remaining.length; position += 1) {
      const previousIndex = remaining[(position + remaining.length - 1) % remaining.length];
      const currentIndex = remaining[position];
      const nextIndex = remaining[(position + 1) % remaining.length];
      const a = ring[previousIndex];
      const b = ring[currentIndex];
      const c = ring[nextIndex];

      if (cross(a, b, c) <= EPSILON) continue;
      let containsPoint = false;
      for (const candidateIndex of remaining) {
        if (candidateIndex === previousIndex || candidateIndex === currentIndex || candidateIndex === nextIndex) continue;
        if (pointInTriangle(ring[candidateIndex], a, b, c)) {
          containsPoint = true;
          break;
        }
      }
      if (containsPoint) continue;

      triangles.push([a, b, c]);
      remaining.splice(position, 1);
      earFound = true;
      break;
    }

    if (!earFound) return [];
  }

  if (remaining.length === 3) {
    triangles.push([
      ring[remaining[0]],
      ring[remaining[1]],
      ring[remaining[2]],
    ]);
  }
  return triangles;
}

function signedArea(ring: LegalEnvelopePoint[]) {
  let twiceArea = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    twiceArea += current.eastM * next.northM - next.eastM * current.northM;
  }
  return twiceArea / 2;
}

function cross(a: LegalEnvelopePoint, b: LegalEnvelopePoint, c: LegalEnvelopePoint) {
  return (b.eastM - a.eastM) * (c.northM - a.northM)
    - (b.northM - a.northM) * (c.eastM - a.eastM);
}

function pointInTriangle(
  point: LegalEnvelopePoint,
  a: LegalEnvelopePoint,
  b: LegalEnvelopePoint,
  c: LegalEnvelopePoint,
) {
  return cross(a, b, point) >= -EPSILON
    && cross(b, c, point) >= -EPSILON
    && cross(c, a, point) >= -EPSILON;
}

function distance(a: LegalEnvelopePoint, b: LegalEnvelopePoint) {
  return Math.hypot(a.eastM - b.eastM, a.northM - b.northM);
}
