import { Box, Crosshair, Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppDispatch, useAppSelector } from "@/store";
import { fitToLot, setViewMode } from "@/store/uiSlice";

export default function Toolbar() {
  const dispatch = useAppDispatch();
  const viewMode = useAppSelector((s) => s.ui.viewMode);
  const selected = useAppSelector((s) => s.lot.selected);
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-secondary/60 px-3">
      <Button size="sm" variant={viewMode === "2d" ? "default" : "ghost"} onClick={() => dispatch(setViewMode("2d"))}>
        <MapIcon /> Map
      </Button>
      <Button size="sm" variant={viewMode === "3d" ? "default" : "ghost"} onClick={() => dispatch(setViewMode("3d"))}>
        <Box /> 3D view
      </Button>
      <div className="mx-2 h-5 w-px bg-border" />
      <Button size="sm" variant="ghost" disabled={!selected || viewMode !== "2d"} onClick={() => dispatch(fitToLot())}>
        <Crosshair /> Zoom to lot
      </Button>
    </div>
  );
}
