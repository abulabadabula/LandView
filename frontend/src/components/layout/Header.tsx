import { Layers3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAppDispatch, useAppSelector } from "@/store";
import { clearLot } from "@/store/lotSlice";
import { fitToLot, setViewMode } from "@/store/uiSlice";
import { parcelGeoJson } from "@/lib/geo";
import AddressSearch from "./AddressSearch";

export default function Header() {
  const dispatch = useAppDispatch();
  const { parcel, selected } = useAppSelector((s) => s.lot);

  const exportGeoJson = () => {
    if (!parcel) return;
    const fc = { type: "FeatureCollection", features: [parcelGeoJson(parcel.boundary, { address: selected?.fullAddress, areaM2: parcel.areaM2, appellation: parcel.appellation })] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(fc, null, 2)], { type: "application/geo+json" }));
    const a = document.createElement("a");
    a.href = url; a.download = "landview-parcel.geojson"; a.click();
    URL.revokeObjectURL(url);
  };

  const menu = (label: string, items: React.ReactNode) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="sm">{label}</Button></DropdownMenuTrigger>
      <DropdownMenuContent>{items}</DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-card px-3">
      <div className="flex items-center gap-2 pr-2 font-semibold tracking-tight text-primary">
        <Layers3 className="size-5" /> LandView
      </div>
      <nav className="flex items-center">
        {menu("File", <>
          <DropdownMenuItem disabled={!parcel} onSelect={exportGeoJson}>Export parcel as GeoJSON</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => dispatch(clearLot())}>Clear lot</DropdownMenuItem>
        </>)}
        {menu("View", <>
          <DropdownMenuItem onSelect={() => dispatch(setViewMode("2d"))}>2D map</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => dispatch(setViewMode("3d"))}>3D terrain</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!selected} onSelect={() => dispatch(fitToLot())}>Zoom to lot</DropdownMenuItem>
        </>)}
        {menu("Help", <>
          <DropdownMenuItem asChild><a href="https://data.linz.govt.nz" target="_blank" rel="noreferrer">LINZ Data Service</a></DropdownMenuItem>
          <DropdownMenuItem asChild><a href="https://open-meteo.com" target="_blank" rel="noreferrer">Open-Meteo</a></DropdownMenuItem>
        </>)}
      </nav>
      <div className="ml-auto flex w-full max-w-xl justify-end"><AddressSearch /></div>
    </header>
  );
}
