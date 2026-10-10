import { useAppDispatch, useAppSelector } from "@/store";
import { setBasemap, setExaggeration } from "@/store/uiSlice";
import { hasLinzBasemaps } from "@/lib/basemaps";
import type { Basemap } from "@/types";

export default function RightPanel() {
  const dispatch = useAppDispatch();
  const { basemap, exaggeration, viewMode } = useAppSelector((s) => s.ui);
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
        {viewMode === "2d" && <p className="mt-1 text-xs text-muted-foreground">Switch to 3D view to see the effect.</p>}
      </div>
    </div>
  );
}
