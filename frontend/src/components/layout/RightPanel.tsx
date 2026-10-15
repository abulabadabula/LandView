import { useAppDispatch, useAppSelector } from "@/store";
import {
  setBasemap,
  setCoverageSizeM,
  setExaggeration,
  setShowBuildings,
  setShowRoads,
  setShowWater,
  setShowWaterways,
} from "@/store/uiSlice";
import { loadSurroundings } from "@/store/lotSlice";
import { hasLinzBasemaps } from "@/lib/basemaps";
import type { Basemap } from "@/types";

const COVERAGE_OPTIONS = [
  { value: 200, label: "100 m in each direction (200 m × 200 m)" },
  { value: 500, label: "500 m × 500 m" },
  { value: 1000, label: "1 km × 1 km" },
  { value: 1500, label: "1.5 km × 1.5 km" },
  { value: 2000, label: "2 km × 2 km" },
  { value: 3000, label: "3 km × 3 km" },
];

export default function RightPanel() {
  const dispatch = useAppDispatch();
  const {
    basemap,
    exaggeration,
    viewMode,
    showWater,
    showWaterways,
    showRoads,
    showBuildings,
    coverageSizeM,
  } = useAppSelector((s) => s.ui);
  const { buildings, context, selected, status, surroundingsLoading } = useAppSelector((s) => s.lot);
  const tagged = buildings?.buildings.filter((b) => b.heightSource === "osm_height" || b.heightSource === "osm_levels").length ?? 0;
  const lidarHeights = buildings?.buildings.filter((b) => b.heightSource === "lidar_estimated").length ?? 0;
  const options: { id: Basemap; label: string; needsKey?: boolean }[] = [
    { id: "streets", label: "Streets (OpenStreetMap)" },
    { id: "aerial", label: "Aerial (LINZ)", needsKey: true },
    { id: "topo", label: "Topographic (LINZ)", needsKey: true },
  ];

  const changeCoverage = (sizeM: number) => {
    dispatch(setCoverageSizeM(sizeM));
    if (selected) dispatch(loadSurroundings({ address: selected, sizeM }));
  };

  return (
    <div className="h-full space-y-5 overflow-y-auto p-4 text-sm">
      {viewMode === "parcel3d" ? (
        <div>
          <h3 className="mb-2 font-semibold">Parcel-only 3D model</h3>
          <p className="text-muted-foreground">
            This view isolates the selected parcel terrain and boundary. Surrounding buildings,
            roads, waterways and map imagery are hidden.
          </p>
          <p className="mt-3 text-muted-foreground">
            Parcel area and boundary endpoint elevations are shown over the model. Use
            “Download terrain JSON” in the upper-right of the view to export the terrain mesh.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Elevations and mesh resolution depend on available LINZ LiDAR coverage or the fallback
            elevation source. This model is for visualisation, not surveying or engineering design.
          </p>
        </div>
      ) : (
        <>
      <div>
        <h3 className="mb-2 font-semibold">Basemap</h3>
        <div className="space-y-1.5">
          {options.map((o) => {
            const disabled = o.needsKey && !hasLinzBasemaps;
            return (
              <label key={o.id} className={`flex items-center gap-2 ${disabled ? "opacity-50" : ""}`}>
                <input
                  type="radio"
                  name="basemap"
                  checked={basemap === o.id}
                  disabled={disabled}
                  onChange={() => dispatch(setBasemap(o.id))}
                />
                {o.label}
              </label>
            );
          })}
          {!hasLinzBasemaps && (
            <p className="text-xs text-muted-foreground">
              Set VITE_LINZ_BASEMAPS_KEY to enable LINZ tiles.
            </p>
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-2 font-semibold">3D scene</h3>
        <label className="block">
          <span className="text-muted-foreground">Coverage around address</span>
          <select
            value={coverageSizeM}
            disabled={!selected || surroundingsLoading}
            onChange={(event) => changeCoverage(Number(event.target.value))}
            className="mt-1 w-full rounded-md border bg-background px-2 py-1.5"
          >
            {COVERAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        {surroundingsLoading && (
          <p className="mt-1 text-xs text-muted-foreground">Loading terrain and surrounding features…</p>
        )}
        <label className="mt-3 block">
          <span className="text-muted-foreground">Vertical exaggeration: {exaggeration.toFixed(1)}×</span>
          <input
            type="range"
            min={1}
            max={6}
            step={0.5}
            value={exaggeration}
            onChange={(event) => dispatch(setExaggeration(Number(event.target.value)))}
            className="mt-1 w-full accent-[var(--primary)]"
          />
        </label>
        <div className="mt-3 space-y-1.5">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showBuildings} onChange={(e) => dispatch(setShowBuildings(e.target.checked))} />
            Buildings (extruded footprints)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showRoads} onChange={(e) => dispatch(setShowRoads(e.target.checked))} />
            Roads
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showWaterways} onChange={(e) => dispatch(setShowWaterways(e.target.checked))} />
            Rivers and streams
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={showWater} onChange={(e) => dispatch(setShowWater(e.target.checked))} />
            Water bodies and sea
          </label>
        </div>
        {viewMode === "2d" && (
          <p className="mt-2 text-xs text-muted-foreground">Switch to 3D view to see these layers.</p>
        )}
      </div>

      {buildings && (
        <div>
          <h3 className="mb-2 font-semibold">Building model</h3>
          <p>{buildings.buildings.length} footprints in the selected coverage</p>
          <p className="text-muted-foreground">
            {tagged} with OSM height/levels, {lidarHeights} LiDAR-derived, {buildings.buildings.length - tagged - lidarHeights} assumed
          </p>
          {!buildings.osmAvailable && (
            <p className="mt-1 text-xs text-destructive">
              OpenStreetMap building-height data was unavailable; all building heights are estimates.
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            In the 100 m model, LINZ DSM roof samples minus bare-earth DEM samples are used when available. Otherwise OSM levels or indicative defaults are used.
          </p>
        </div>
      )}

      {context && (
        <div>
          <h3 className="mb-2 font-semibold">Local context</h3>
          <p>{context.features.filter((f) => f.kind === "road").length} road segments</p>
          <p>{context.features.filter((f) => f.kind === "waterway").length} waterways</p>
          <p>{context.features.filter((f) => f.kind === "waterbody").length} water polygons</p>
          {!context.osmAvailable && (
            <p className="mt-1 text-xs text-destructive">OpenStreetMap context could not be loaded.</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">Road and hydrography data © OpenStreetMap contributors.</p>
        </div>
      )}

      {!buildings && status === "ready" && (
        <p className="text-xs text-muted-foreground">Building footprints could not be loaded.</p>
      )}
        </>
      )}
    </div>
  );
}
