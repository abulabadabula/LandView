import type {
  AddressResult,
  BuildingCollection,
  ContextCollection,
  Environment,
  Parcel,
  TerrainGrid,
} from "@/types";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${BASE}${path}?${qs}`);
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  searchAddresses: (q: string) => get<AddressResult[]>("/address/search", { q }),
  getLot: (lat: number, lon: number) => get<Parcel | null>("/lot", { lat, lon }),
  getEnvironment: (lat: number, lon: number) => get<Environment>("/environment", { lat, lon }),
  getTerrain: (lat: number, lon: number, sizeM = 1000, n = 33) =>
    get<TerrainGrid>("/terrain", { lat, lon, size_m: sizeM, n }),
  getBuildings: (lat: number, lon: number, sizeM = 1000) =>
    get<BuildingCollection>("/buildings", { lat, lon, size_m: sizeM }),
  getContext: (lat: number, lon: number, sizeM = 1000) =>
    get<ContextCollection>("/context", { lat, lon, size_m: sizeM }),
};
