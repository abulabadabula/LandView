import type { Basemap } from "@/types";

const key = import.meta.env.VITE_LINZ_BASEMAPS_KEY;
export const hasLinzBasemaps = Boolean(key);

const OSM = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "&copy; OpenStreetMap contributors",
};

export function basemapSource(b: Basemap) {
  if (!key || b === "streets") return OSM;
  const layer = b === "aerial" ? "aerial" : "topographic";
  return {
    url: `https://basemaps.linz.govt.nz/v1/tiles/${layer}/WebMercatorQuad/{z}/{x}/{y}.webp?api=${key}`,
    attribution: '&copy; <a href="https://www.linz.govt.nz">LINZ</a> CC BY 4.0',
  };
}
