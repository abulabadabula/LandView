import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { api } from "@/lib/api";
import type { AddressResult, Environment, Parcel, TerrainGrid } from "@/types";

interface LotState {
  results: AddressResult[];
  searching: boolean;
  selected: AddressResult | null;
  parcel: Parcel | null;
  env: Environment | null;
  terrain: TerrainGrid | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
}

const initialState: LotState = {
  results: [], searching: false, selected: null, parcel: null,
  env: null, terrain: null, status: "idle", error: null,
};

export const searchAddresses = createAsyncThunk("lot/search", (q: string) => api.searchAddresses(q));

export const loadLot = createAsyncThunk("lot/load", async (address: AddressResult) => {
  const [parcel, env, terrain] = await Promise.all([
    api.getLot(address.lat, address.lon),
    api.getEnvironment(address.lat, address.lon),
    api.getTerrain(address.lat, address.lon),
  ]);
  return { address, parcel, env, terrain };
});

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
    b.addCase(searchAddresses.rejected, (s, a) => { s.searching = false; s.results = []; s.status = "error"; s.error = a.error.message ?? "Address search failed"; });
    b.addCase(loadLot.pending, (s, a) => { s.status = "loading"; s.error = null; s.selected = a.meta.arg; s.results = []; });
    b.addCase(loadLot.fulfilled, (s, a) => {
      s.status = "ready";
      s.selected = a.payload.address;
      s.parcel = a.payload.parcel;
      s.env = a.payload.env;
      s.terrain = a.payload.terrain;
    });
    b.addCase(loadLot.rejected, (s, a) => { s.status = "error"; s.error = a.error.message ?? "Failed to load lot"; });
  },
});

export const { clearResults, clearLot } = lotSlice.actions;
export default lotSlice.reducer;
