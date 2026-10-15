import { Box, Building2, Crosshair, Map as MapIcon, Mountain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/store";
import { loadParcelTerrain, loadSurroundings } from "@/store/lotSlice";
import { fitToLot, setCoverageSizeM, setViewMode } from "@/store/uiSlice";

export default function Toolbar() {
  const dispatch = useAppDispatch();
  const viewMode = useAppSelector((s) => s.ui.viewMode);
  const coverageSizeM = useAppSelector((s) => s.ui.coverageSizeM);
  const { selected, parcel, surroundingsLoading, parcelTerrainLoading } = useAppSelector((s) => s.lot);
  const localModelActive = viewMode === "3d" && coverageSizeM === 200;

  const showLocalModel = () => {
    if (!selected) return;
    dispatch(setCoverageSizeM(200));
    dispatch(setViewMode("3d"));
    dispatch(loadSurroundings({ address: selected, sizeM: 200, detailed: true }));
  };

  const showParcelTerrain = () => {
    if (!selected || !parcel) return;
    dispatch(setViewMode("parcel3d"));
    void dispatch(loadParcelTerrain({ address: selected, parcel }));
  };

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-secondary/60 px-3">
      <Button size="sm" variant={viewMode === "2d" ? "default" : "ghost"} onClick={() => dispatch(setViewMode("2d"))}>
        <MapIcon /> Map
      </Button>
      <Button size="sm" variant={viewMode === "3d" && coverageSizeM !== 200 ? "default" : "ghost"} onClick={() => dispatch(setViewMode("3d"))}>
        <Box /> 3D view
      </Button>
      <Button
        size="sm"
        variant={localModelActive ? "default" : "outline"}
        disabled={!selected || surroundingsLoading}
        onClick={showLocalModel}
        title="Show terrain and buildings in a 200 m square centred on the selected address"
      >
        <Building2 /> 100 m 3D model
      </Button>
      <Button
        size="sm"
        variant={viewMode === "parcel3d" ? "default" : "outline"}
        disabled={!selected || !parcel || surroundingsLoading || parcelTerrainLoading}
        onClick={showParcelTerrain}
        title="Show only the selected parcel's 3D terrain and boundary, with endpoint elevations"
      >
        <Mountain /> Parcel 3D
      </Button>
      <div className="mx-2 h-5 w-px bg-border" />
      <Button size="sm" variant="ghost" disabled={!selected || viewMode !== "2d"} onClick={() => dispatch(fitToLot())}>
        <Crosshair /> Zoom to lot
      </Button>
    </div>
  );
}
