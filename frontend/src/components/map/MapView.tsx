import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useAppSelector } from "@/store";
import { basemapSource } from "@/lib/basemaps";

export default function MapView() {
  const { selected, parcel } = useAppSelector((s) => s.lot);
  const { basemap, fitNonce } = useAppSelector((s) => s.ui);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);

  // create the map once
  useEffect(() => {
    const el = containerRef.current!;
    const map = L.map(el).setView([-41.0, 174.0], 5); // New Zealand
    overlayRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // keep tiles correct when the resizable panels move
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; tileRef.current = null; };
  }, []);

  // basemap
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tileRef.current?.remove();
    const src = basemapSource(basemap);
    tileRef.current = L.tileLayer(src.url, { attribution: src.attribution, maxZoom: 21, maxNativeZoom: 19 }).addTo(map);
  }, [basemap]);

  // selected address + parcel
  useEffect(() => {
    const map = mapRef.current, overlay = overlayRef.current;
    if (!map || !overlay) return;
    overlay.clearLayers();
    if (!selected) return;
    L.circleMarker([selected.lat, selected.lon], { radius: 6, color: "#fff", weight: 2, fillColor: "#c2410c", fillOpacity: 1 })
      .bindTooltip(selected.fullAddress).addTo(overlay);
    if (parcel) {
      const layer = L.geoJSON(parcel.geometry, { style: { color: "#c2410c", weight: 2, fillColor: "#c2410c", fillOpacity: 0.15 } }).addTo(overlay);
      map.fitBounds(layer.getBounds().pad(1.5), { maxZoom: 19, animate: true });
    } else {
      map.setView([selected.lat, selected.lon], 18);
    }
  }, [selected, parcel, fitNonce]);

  return <div ref={containerRef} className="h-full w-full" />;
}
