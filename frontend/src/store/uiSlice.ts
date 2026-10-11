import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Basemap, ViewMode } from "@/types";

interface UiState {
  viewMode: ViewMode;
  basemap: Basemap;
  /** vertical exaggeration for the 3D terrain */
  exaggeration: number;
  showWater: boolean;
  showWaterways: boolean;
  showRoads: boolean;
  showBuildings: boolean;
  /** Width in metres of the square context extent centred on the searched address. */
  coverageSizeM: number;
  /** bump to ask the 2D map to re-fit the lot */
  fitNonce: number;
}

const initialState: UiState = {
  viewMode: "2d",
  basemap: "streets",
  exaggeration: 1.5,
  showWater: true,
  showWaterways: true,
  showRoads: true,
  showBuildings: true,
  coverageSizeM: 1000,
  fitNonce: 0,
};

const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    setViewMode: (s, a: PayloadAction<ViewMode>) => { s.viewMode = a.payload; },
    setBasemap: (s, a: PayloadAction<Basemap>) => { s.basemap = a.payload; },
    setExaggeration: (s, a: PayloadAction<number>) => { s.exaggeration = a.payload; },
    setShowWater: (s, a: PayloadAction<boolean>) => { s.showWater = a.payload; },
    setShowWaterways: (s, a: PayloadAction<boolean>) => { s.showWaterways = a.payload; },
    setShowRoads: (s, a: PayloadAction<boolean>) => { s.showRoads = a.payload; },
    setShowBuildings: (s, a: PayloadAction<boolean>) => { s.showBuildings = a.payload; },
    setCoverageSizeM: (s, a: PayloadAction<number>) => { s.coverageSizeM = a.payload; },
    fitToLot: (s) => { s.fitNonce += 1; },
  },
});

export const {
  setViewMode,
  setBasemap,
  setExaggeration,
  setShowWater,
  setShowWaterways,
  setShowRoads,
  setShowBuildings,
  setCoverageSizeM,
  fitToLot,
} = uiSlice.actions;
export default uiSlice.reducer;
