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
  getBuildings: async (lat: number, lon: number, sizeM = 1000) => {
    const startedAt = performance.now();
    console.info("[LandView][buildings-api] request_start", { lat, lon, sizeM });
    try {
      const data = await get<BuildingCollection>("/buildings", { lat, lon, size_m: sizeM });
      console.info("[LandView][buildings-api] response_success", {
        durationMs: Math.round(performance.now() - startedAt),
        buildingCount: data.buildings.length,
        osmAvailable: data.osmAvailable,
        sampleBuilding: data.buildings[0]
          ? {
              id: data.buildings[0].id,
              ringPointCount: data.buildings[0].ring.length,
              firstPoint: data.buildings[0].ring[0],
              heightM: data.buildings[0].heightM,
              heightSource: data.buildings[0].heightSource,
            }
          : null,
      });
      return data;
    } catch (error) {
      console.error("[LandView][buildings-api] response_failed", {
        durationMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
  getContext: (lat: number, lon: number, sizeM = 1000) =>
    get<ContextCollection>("/context", { lat, lon, size_m: sizeM }),
};
