import { useAppSelector } from "@/store";

export default function StatusBar() {
  const { status, error, selected } = useAppSelector((s) => s.lot);
  const viewMode = useAppSelector((s) => s.ui.viewMode);
  const text =
    status === "loading" ? "Loading lot data…" :
    status === "error" ? error :
    status === "ready" ? "Ready" : "Search an address to begin";
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t bg-card px-3 text-xs text-muted-foreground">
      <span className={status === "error" ? "text-destructive" : ""}>{text}</span>
      {selected && <span>{selected.lat.toFixed(6)}, {selected.lon.toFixed(6)}</span>}
      <span className="ml-auto">{viewMode === "2d" ? "Map view" : "3D view"}</span>
      <span>Data: LINZ, Open-Meteo</span>
    </footer>
  );
}
