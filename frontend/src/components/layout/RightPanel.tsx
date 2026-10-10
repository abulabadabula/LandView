import { useAppDispatch, useAppSelector } from "@/store";
import { setBasemap, setExaggeration, setShowBuildings, setShowWater } from "@/store/uiSlice";
import { hasLinzBasemaps } from "@/lib/basemaps";
import type { Basemap } from "@/types";

export default function RightPanel() {
  const dispatch = useAppDispatch();
  const { basemap, exaggeration, viewMode, showWater, showBuildings } = useAppSelector((s) => s.ui);
  const buildings = useAppSelector((s) => s.lot.buildings);
  const status = useAppSelector((s) => s.lot.status);
  const tagged = buildings?.buildings.filter((b) => b.storeysSource === "osm").length ?? 0;
  const options: { id: Basemap; label: string; needsKey?: boolean }[] = [
    { id: "streets", label: "Streets (OpenStreetMap)" },
    { id: "aerial", label: "Aerial (LINZ)", needsKey: true },
    { id: "topo", label: "Topographic (LINZ)", needsKey: true },
  ];
  return (
    <div className="h-full space-y-5 overflow-y-auto p-4 text-sm">
      <div>
        <h3 className="mb-2 font-semibold">Basemap</h3>
        <div className="space-y-1.5">
          {options.map((o) => {
            const disabled = o.needsKey && !hasLinzBasemaps;
            return (
              <label key={o.id} className={`flex items-center gap-2 ${disabled ? "opacity-50" : ""}`}>
                <input type="radio" name="basemap" checked={basemap === o.id} disabled={disabled} onChange={() => dispatch(setBasemap(o.id))} />
                {o.label}
              </label>
            );
          })}
          {!hasLinzBasemaps && <p className="text-xs text-muted-foreground">Set VITE_LINZ_BASEMAPS_KEY to enable LINZ tiles.</p>}
        </div>
      </div>
      <div>
        <h3 className="mb-2 font-semibold">3D terrain</h3>
        <label className="block">
          <span className="text-muted-foreground">Vertical exaggeration: {exaggeration.toFixed(1)}×</span>
          <input type="range" min={1} max={6} step={0.5} value={exaggeration} onChange={(e) => dispatch(setExaggeration(Number(e.target.value)))} className="mt-1 w-full accent-[var(--primary)]" />
        </label>
        <div className="mt-3 space-y-1.5">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showWater} onChange={(e) => dispatch(setShowWater(e.target.checked))} /> Sea
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showBuildings} onChange={(e) => dispatch(setShowBuildings(e.target.checked))} /> Buildings
          </label>
        </div>
        {viewMode === "2d" && <p className="mt-2 text-xs text-muted-foreground">Switch to 3D view to see these.</p>}
      </div>
      {buildings && (
        <div>
          <h3 className="mb-2 font-semibold">Buildings</h3>
          <p>{buildings.buildings.length} footprints within 500 m</p>
          <p className="text-muted-foreground">{tagged} with mapped storeys, {buildings.buildings.length - tagged} assumed</p>
          {!buildings.osmAvailable && <p className="mt-1 text-xs text-destructive">OpenStreetMap storey data was unavailable, so all heights are assumed.</p>}
          <p className="mt-1 text-xs text-muted-foreground">Each storey is drawn 3 m tall. Assumed buildings use 1 storey, or 2 for larger non-residential footprints.</p>
        </div>
      )}
      {!buildings && status === "ready" && <p className="text-xs text-muted-foreground">Building footprints could not be loaded.</p>}
    </div>
  );
}
