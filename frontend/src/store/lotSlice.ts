import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { api } from "@/lib/api";
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
  async ({ address, sizeM }: { address: AddressResult; sizeM: number }) => {
    const [terrain, buildings, context] = await Promise.all([
      api.getTerrain(address.lat, address.lon, sizeM),
      api.getBuildings(address.lat, address.lon, sizeM).catch(() => null),
      api.getContext(address.lat, address.lon, sizeM).catch(() => null),
    ]);
    return { terrain, buildings, context };
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
  },
});

export const { clearResults, clearLot } = lotSlice.actions;
export default lotSlice.reducer;
