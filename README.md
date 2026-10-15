# LandView

Search a New Zealand address, inspect its parcel and environmental context, and switch to a rotatable CesiumJS 3D view of surrounding terrain, building masses, roads and water features.

| Layer | Stack |
|---|---|
| Frontend | TypeScript, React, Redux Toolkit, CesiumJS, Leaflet, Tailwind, shadcn/ui |
| Backend | FastAPI, httpx, pyproj, Shapely |
| Data | LINZ addresses/parcels/building outlines, Open-Meteo elevation/climate, OpenStreetMap context |

## Layout

The application has a header and toolbar, with resizable left/right information panels surrounding the main canvas.
The left panel lists the selected lot, boundary points, topography and environmental information.
The toolbar includes a **100 m 3D model** button. It loads a 200 m × 200 m square centred on the selected address (100 m from the centre in each cardinal direction), using a denser terrain grid and optional LiDAR DSM/DEM building-height estimates. The **Parcel 3D** button opens an isolated, rotatable terrain mesh for the selected parcel, labels each boundary endpoint with its interpolated elevation, labels each boundary edge with its horizontal plan length in metres, reports parcel area and terrain elevation range, and downloads the clipped mesh plus boundary distances and metadata as JSON. The right panel controls the basemap and 3D scene, including vertical exaggeration, visible layers, and context coverage width (200 m square to 3 km). Changing the coverage reloads terrain and nearby features around the selected address.

## Environment parameters

Copy the examples and fill in the keys:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

| File | Variable | Purpose |
|---|---|---|
| `backend/.env` | `LINZ_API_KEY` | **Required** for address, parcel and building-outline access. Get a free key from https://data.linz.govt.nz. |
| `backend/.env` | `LINZ_BASEMAPS_KEY` | Enables LINZ national LiDAR DEM/DSM Terrain-RGB tiles for detailed terrain and building-height estimates. |
| `backend/.env` | `CORS_ORIGINS` | Allowed browser origins, comma separated. |
| `backend/.env` | `LINZ_ADDRESS_LAYER`, `LINZ_PARCEL_LAYER`, `LINZ_BUILDING_LAYER`, `HTTP_TIMEOUT` | Optional overrides; building outlines default to layer 101290. |
| `backend/.env` | `OVERPASS_URL` | Optional override for the OpenStreetMap Overpass endpoint; defaults to `https://overpass-api.de/api/interpreter`. |
| `frontend/.env` | `VITE_API_BASE_URL` | API base, default `/api`. |
| `frontend/.env` | `VITE_DEV_PROXY_TARGET` | Backend URL for the Vite dev proxy, default `http://localhost:8000`. |
| `frontend/.env` | `VITE_LINZ_BASEMAPS_KEY` | Optional LINZ aerial/topographic tile key. Falls back to OpenStreetMap streets. |
| `frontend/.env` | `VITE_CESIUM_ION_TOKEN` | Optional Cesium ion access token. Enables streamed Cesium World Terrain; without it, the app uses the backend elevation grid as a fallback. |

Open-Meteo and OpenStreetMap Overpass do not require a key, subject to their service availability and usage policies.

## Run locally

```bash
# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload          # http://localhost:8000/docs

# frontend (new terminal)
cd frontend
npm install
npm run dev                            # http://localhost:5173
```

## API

| Endpoint | Returns |
|---|---|
| `GET /api/address/search?q=` | Address matches from LINZ |
| `GET /api/lot?lat=&lon=` | Parcel geometry, legal description and boundary points |
| `POST /api/parcel/setback` | Inward setback line, NZTM2000 control points and WGS84 display coordinates |
| `GET /api/environment?lat=&lon=` | Elevation, slope, aspect, indicative wind zone and climate |
| `GET /api/terrain?lat=&lon=&size_m=&n=` | Elevation grid used by the 3D view |
| `GET /api/buildings?lat=&lon=&size_m=` | LINZ building footprints enriched with OSM height/levels where available |
| `GET /api/context?lat=&lon=&size_m=` | OSM roads, waterways and closed-way/multipolygon water bodies |

## 3D scene

The 3D view uses CesiumJS in 3D globe mode. Drag the left mouse button to rotate, right-drag to tilt, and use the wheel to zoom. The selected parcel is outlined over the terrain. Nearby roads and waterways are drawn as ground-clamped lines, mapped water bodies as ground-clamped polygons, and each building footprint is extruded using its mapped/estimated height. Mapped and estimated building heights use different colours.

The context width can be changed from 500 m to 3 km. The scene re-frames for the newly loaded coverage, but changing layer toggles or vertical exaggeration does not reset the chosen camera view.

Cesium workers and assets are served from `/cesium` (see `frontend/vite.config.ts`).

## Parcel-only 3D terrain and JSON export

Parcel 3D uses the selected parcel's LINZ boundary and a local elevation grid to construct a terrain triangle mesh clipped to the supplied parcel polygon. The mesh is clipped by intersecting terrain triangles with an ear-clipped triangulation of the parcel outline, so the footprint edge follows the legal boundary rather than whole-cell centres. The view does not render surrounding buildings, roads, waterways or map imagery. Drag with the left mouse button to rotate, right-drag to tilt, and use the wheel to zoom. Boundary endpoint elevations are bilinearly interpolated from the downloaded grid. Each boundary point and the map labels include the horizontal plan distance to the next point, calculated from the supplied NZTM easting/northing coordinates. The JSON export includes the parcel metadata and area, endpoint coordinates/elevations, horizontal edge distances, terrain source and sample spacing, mesh vertices (longitude, latitude and elevation in metres), and triangle indices.

The 1 m setback is a geometric inward buffer from the supplied parcel polygon in NZTM2000; it does not infer jurisdiction-specific planning rules or prove that 1 m is the legally required setback. Confirm applicable council planning controls and survey data before relying on it for design. The mesh is intended for visualisation and early-stage site context, not survey, setting-out, earthworks quantities or engineering design. The visible perimeter follows the parcel outline, but elevation resolution and datum still depend on the source grid. When LINZ LiDAR elevation tiles are not configured or available, the backend falls back to a coarser elevation source/grid; check the exported source and spacing before using the data.

## Data limitations and attribution

- **Terrain fallback is for visualisation only.** With `LINZ_BASEMAPS_KEY`, the detailed local scene samples LINZ LiDAR-derived DEM tiles. Without it, the backend limits grid density and uses Open-Meteo elevation samples, which rely on a coarse global DEM and do not provide lot-scale LiDAR detail. For high-detail terrain, configure a terrain provider backed by suitable LINZ LiDAR DEM coverage or use Cesium World Terrain where its resolution/coverage meets the purpose. Do not use the fallback grid for surveying, earthworks quantities or engineering design.
- LINZ publishes New Zealand LiDAR-based elevation data for much of the country. The available resolution and capture date vary by location; verify coverage and the dataset metadata before relying on it. See [LINZ elevation data access](https://www.linz.govt.nz/products-services/data/types-linz-data/elevation-data/access-elevation-data).
- **Building heights are not complete national attributes.** Heights/levels are taken from tagged OpenStreetMap buildings when a nearby match can be made; otherwise they are estimated using footprint use/area and a nominal storey height. The 3D massing is indicative, not a verified building survey.
- Road and hydrography lines/polygons come from OpenStreetMap's Overpass API and will reflect only mapped features available there. Water multipolygon outer rings are stitched from their member ways; inner holes are not modelled in this first version. Respect [OpenStreetMap attribution and usage guidance](https://www.openstreetmap.org/copyright).
- **Wind zone is indicative.** It is bucketed from historical ERA5 gusts and is not an NZS 3604 site-specific wind zone. Confirm with council or a structural engineer.
- Parcel and building outline data are supplied by LINZ under its published licence terms. Retain attribution when redistributing derived data.
