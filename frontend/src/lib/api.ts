import type {
  AddressResult,
  BuildingCollection,
  ContextCollection,
  Environment,
  Parcel,
  ParcelSetbackResult,
  TerrainGrid,
} from "@/types";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

export interface HouseDesignChatCurrentDesign {
  storeys: number;
  bedrooms: number;
  grossFloorAreaTargetM2: number;
  style: string;
  roof: "Gable roof" | "Hip roof" | "Flat roof" | "Mono-pitch roof" | "Mixed roof";
  garage: "No garage" | "Single garage" | "Double garage" | "Carport";
  terrainAdaptation: "Adapt to terrain" | "Level pad" | "Stepped floor plates";
}
export interface HouseDesignChatRequest {
  conversationId: string;
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  blackboardVersion: number;
  currentDesign: HouseDesignChatCurrentDesign;
  siteContext: { address?: string; parcelLoaded: boolean; siteDataConfidence?: string };
}
export interface HouseDesignIntentPatch {
  storeys?: number;
  bedrooms?: number;
  grossFloorAreaTargetM2?: number;
  style?: string;
  roof?: HouseDesignChatCurrentDesign["roof"];
  garage?: HouseDesignChatCurrentDesign["garage"];
  terrainAdaptation?: HouseDesignChatCurrentDesign["terrainAdaptation"];
}
export interface HouseDesignChatResponse {
  conversationId: string;
  assistantMessage: string;
  intentPatch: HouseDesignIntentPatch;
  workflowStage: string;
  auditStatus: "NOT_EVALUATED";
  auditReason: string;
  agentTrace: Array<{ agent: string; status: string; summary: string }>;
  provider: string;
  blackboardVersion: number;
}


async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail ?? detail; } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

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
  chatHouseDesign: (payload: HouseDesignChatRequest) => post<HouseDesignChatResponse>("/house-design/agent/chat", payload),
  searchAddresses: (q: string) => get<AddressResult[]>("/address/search", { q }),
  getLot: (lat: number, lon: number) => get<Parcel | null>("/lot", { lat, lon }),
  getParcelSetback: (boundary: Parcel["boundary"], distanceM = 1) =>
    post<ParcelSetbackResult>("/parcel/setback", {
      distanceM,
      boundary: boundary.map((point) => ({
        index: point.index,
        nztmE: point.nztmE,
        nztmN: point.nztmN,
      })),
    }),
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
