import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Basemap, ViewMode } from "@/types";

interface UiState {
  viewMode: ViewMode;
  basemap: Basemap;
  /** vertical exaggeration for the 3D terrain */
  exaggeration: number;
  /** bump to ask the 2D map to re-fit the lot */
  fitNonce: number;
}

const initialState: UiState = { viewMode: "2d", basemap: "streets", exaggeration: 1.5, fitNonce: 0 };

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setViewMode: (s, a: PayloadAction<ViewMode>) => { s.viewMode = a.payload; },
    setBasemap: (s, a: PayloadAction<Basemap>) => { s.basemap = a.payload; },
    setExaggeration: (s, a: PayloadAction<number>) => { s.exaggeration = a.payload; },
    fitToLot: (s) => { s.fitNonce += 1; },
  },
});

export const { setViewMode, setBasemap, setExaggeration, fitToLot } = uiSlice.actions;
export default uiSlice.reducer;
