import type { Geometry } from "geojson";

export type ProvenanceStatus = "MEASURED" | "DERIVED" | "ASSUMED" | "USER_CONFIRMED";
export interface Provenance {
  status: ProvenanceStatus;
  source: string;
  capturedAt?: string | null;
  version?: string | null;
  note?: string | null;
}

export interface AddressResult { id: number; fullAddress: string; lat: number; lon: number }

export interface BoundaryPoint { index: number; lon: number; lat: number; nztmE: number; nztmN: number }

export interface ParcelSetbackPoint {
  index: number;
  lon: number;
  lat: number;
  nztmE: number;
  nztmN: number;
}

export interface ParcelSetbackPolygon {
  points: ParcelSetbackPoint[];
  areaM2: number;
}

export interface ParcelSetbackResult {
  distanceM: number;
  polygons: ParcelSetbackPolygon[];
  warning: string | null;
}

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

export interface Topography { elevationM: number; slopeDeg: number; aspectDeg: number | null; provenance?: Provenance | null }
export interface WindInfo { zone: string; maxGustMs: number; basis: string; disclaimer: string; provenance?: Provenance }
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
  source: string;
}

export interface Building {
  id: number | null;
  areaM2: number;
  storeys: number;
  storeysSource: "osm" | "lidar" | "assumed";
  heightM: number;
  heightSource: "osm_height" | "osm_levels" | "lidar_estimated" | "assumed" | string;
  heightConfidence: "high" | "medium" | "low" | string;
  heightProvenance?: Provenance;
  use: string | null;
  /** [lon, lat] exterior ring, not closed */
  ring: [number, number][];
}
export interface BuildingCollection { buildings: Building[]; osmAvailable: boolean }

export type ContextFeatureKind = "road" | "waterway" | "waterbody";
export interface ContextFeature {
  id: string;
  kind: ContextFeatureKind;
  /** [lon, lat] sequence; waterbody rings are not closed */
  coordinates: [number, number][];
  name: string | null;
  subtype: string | null;
  widthM: number | null;
}
export interface ContextCollection { features: ContextFeature[]; osmAvailable: boolean }

export type ViewMode = "2d" | "3d" | "parcel3d" | "house3d";
export type Basemap = "streets" | "aerial" | "topo";
