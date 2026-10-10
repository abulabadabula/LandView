import type { Geometry } from "geojson";

export interface AddressResult { id: number; fullAddress: string; lat: number; lon: number }

export interface BoundaryPoint { index: number; lon: number; lat: number; nztmE: number; nztmN: number }

export interface Parcel {
  id: number | null;
  appellation: string | null;
  titles: string | null;
  parcelIntent: string | null;
  landDistrict: string | null;
  areaM2: number;
  geometry: Geometry;
  boundary: BoundaryPoint[];
}

export interface Topography { elevationM: number; slopeDeg: number; aspectDeg: number | null }
export interface WindInfo { zone: string; maxGustMs: number; basis: string; disclaimer: string }
export interface Climate { meanTempC: number; annualRainMm: number; years: number }
export interface Environment { topography: Topography; wind: WindInfo; climate: Climate }

export interface TerrainGrid {
  centerLat: number;
  centerLon: number;
  sizeM: number;
  n: number;
  /** row-major, rows run south -> north, columns west -> east */
  elevations: number[];
  minElevation: number;
  maxElevation: number;
}

export type ViewMode = "2d" | "3d";
export type Basemap = "streets" | "aerial" | "topo";
