import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { api } from "@/lib/api";
import { toLocal } from "@/lib/geo";
import type {
  AddressResult,
  BuildingCollection,
  ContextCollection,
  Environment,
  Parcel,
  TerrainGrid,
} from "@/types";

interface LotState {
  results: AddressResult[];
  searching: boolean;
  selected: AddressResult | null;
  parcel: Parcel | null;
  env: Environment | null;
  terrain: TerrainGrid | null;
  parcelTerrain: TerrainGrid | null;
  parcelTerrainLoading: boolean;
  buildings: BuildingCollection | null;
  context: ContextCollection | null;
  status: "idle" | "loading" | "ready" | "error";
  surroundingsLoading: boolean;
  error: string | null;
}

const initialState: LotState = {
  results: [],
  searching: false,
  selected: null,
  parcel: null,
  env: null,
  terrain: null,
  parcelTerrain: null,
  parcelTerrainLoading: false,
  buildings: null,
  context: null,
  status: "idle",
  surroundingsLoading: false,
  error: null,
};

export const searchAddresses = createAsyncThunk("lot/search", (q: string) => api.searchAddresses(q));

export const loadLot = createAsyncThunk("lot/load", async (address: AddressResult) => {
  const sizeM = 1000;
  const [parcel, env, terrain, buildings, context] = await Promise.all([
    api.getLot(address.lat, address.lon),
    api.getEnvironment(address.lat, address.lon),
    api.getTerrain(address.lat, address.lon, sizeM),
    // Optional context sources must not prevent a parcel from loading.
    api.getBuildings(address.lat, address.lon, sizeM).catch(() => null),
    api.getContext(address.lat, address.lon, sizeM).catch(() => null),
  ]);
  return { address, parcel, env, terrain, buildings, context };
});

export const loadSurroundings = createAsyncThunk(
  "lot/loadSurroundings",
  async ({ address, sizeM, detailed = false }: { address: AddressResult; sizeM: number; detailed?: boolean }) => {
    const [terrain, buildings, context] = await Promise.all([
      api.getTerrain(address.lat, address.lon, sizeM, detailed ? 129 : 33),
      api.getBuildings(address.lat, address.lon, sizeM).catch(() => null),
      api.getContext(address.lat, address.lon, sizeM).catch(() => null),
    ]);
    return { terrain, buildings, context };
  },
);

export const loadParcelTerrain = createAsyncThunk(
  "lot/loadParcelTerrain",
  async ({ address, parcel }: { address: AddressResult; parcel: Parcel }) => {
    // Size the local elevation request to include the parcel plus a small margin.
    const offsets = parcel.boundary.map((point) =>
      toLocal(point.lon, point.lat, address.lon, address.lat),
    );
    const maxOffset = offsets.reduce(
      (max, point) => Math.max(max, Math.abs(point.east), Math.abs(point.north)),
      0,
    );
    const sizeM = Math.min(
      2000,
      Math.max(200, Math.ceil(((maxOffset + 10) * 2) / 25) * 25),
    );
    return api.getTerrain(address.lat, address.lon, sizeM, 129);
  },
);

const lotSlice = createSlice({
  name: "lot",
  initialState,
  reducers: {
    clearResults: (s) => { s.results = []; },
    clearLot: () => initialState,
  },
  extraReducers: (b) => {
    b.addCase(searchAddresses.pending, (s) => { s.searching = true; });
    b.addCase(searchAddresses.fulfilled, (s, a) => { s.searching = false; s.results = a.payload; });
    b.addCase(searchAddresses.rejected, (s, a) => {
      s.searching = false;
      s.results = [];
      s.status = "error";
      s.error = a.error.message ?? "Address search failed";
    });
    b.addCase(loadLot.pending, (s, a) => {
      s.status = "loading";
      s.surroundingsLoading = true;
      s.error = null;
      s.selected = a.meta.arg;
      s.parcelTerrain = null;
      s.parcelTerrainLoading = false;
      s.results = [];
    });
    b.addCase(loadLot.fulfilled, (s, a) => {
      s.status = "ready";
      s.surroundingsLoading = false;
      s.selected = a.payload.address;
      s.parcel = a.payload.parcel;
      s.env = a.payload.env;
      s.terrain = a.payload.terrain;
      s.buildings = a.payload.buildings;
      s.context = a.payload.context;
    });
    b.addCase(loadLot.rejected, (s, a) => {
      s.status = "error";
      s.surroundingsLoading = false;
      s.error = a.error.message ?? "Failed to load lot";
    });
    b.addCase(loadSurroundings.pending, (s) => {
      s.surroundingsLoading = true;
      s.error = null;
    });
    b.addCase(loadSurroundings.fulfilled, (s, a) => {
      s.surroundingsLoading = false;
      s.terrain = a.payload.terrain;
      s.buildings = a.payload.buildings;
      s.context = a.payload.context;
    });
    b.addCase(loadSurroundings.rejected, (s, a) => {
      s.surroundingsLoading = false;
      s.error = a.error.message ?? "Failed to load surroundings";
    });
    b.addCase(loadParcelTerrain.pending, (s) => {
      s.parcelTerrainLoading = true;
      s.error = null;
    });
    b.addCase(loadParcelTerrain.fulfilled, (s, a) => {
      s.parcelTerrainLoading = false;
      s.parcelTerrain = a.payload;
    });
    b.addCase(loadParcelTerrain.rejected, (s, a) => {
      s.parcelTerrainLoading = false;
      s.error = a.error.message ?? "Failed to load parcel terrain";
    });
  },
});

export const { clearResults, clearLot } = lotSlice.actions;
export default lotSlice.reducer;
