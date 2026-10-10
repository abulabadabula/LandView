import type { BoundaryPoint, TerrainGrid } from "@/types";

const M_PER_DEG = 111_320;

/** Local ENU offsets (metres) of a lon/lat relative to a centre. */
export function toLocal(lon: number, lat: number, cLon: number, cLat: number) {
  return {
    east: (lon - cLon) * M_PER_DEG * Math.cos((cLat * Math.PI) / 180),
    north: (lat - cLat) * M_PER_DEG,
  };
}

/** Bilinear ground elevation (metres, absolute) at a local east/north offset. */
export function sampleElevation(t: TerrainGrid, east: number, north: number) {
  const half = t.sizeM / 2;
  const fx = Math.min(Math.max((east + half) / t.sizeM, 0), 1) * (t.n - 1);
  const fy = Math.min(Math.max((north + half) / t.sizeM, 0), 1) * (t.n - 1);
  const c0 = Math.floor(fx), r0 = Math.floor(fy);
  const c1 = Math.min(c0 + 1, t.n - 1), r1 = Math.min(r0 + 1, t.n - 1);
  const tx = fx - c0, ty = fy - r0;
  const e = (r: number, c: number) => t.elevations[r * t.n + c];
  const bottom = e(r0, c0) * (1 - tx) + e(r0, c1) * tx;
  const top = e(r1, c0) * (1 - tx) + e(r1, c1) * tx;
  return bottom * (1 - ty) + top * ty;
}

export function compass(deg: number | null) {
  if (deg == null) return "Flat";
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round(deg / 45) % 8];
}

export function parcelGeoJson(boundary: BoundaryPoint[], props: Record<string, unknown>) {
  const ring = boundary.map((p) => [p.lon, p.lat]);
  if (ring.length) ring.push(ring[0]);
  return { type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [ring] } };
}
