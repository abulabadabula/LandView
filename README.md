# LandView

Search a New Zealand address, see its lot on a map, read its boundary, area, topography and environment data, and switch to a 3D terrain view.

| Layer | Stack |
|---|---|
| Frontend | TypeScript, React, Redux Toolkit, CesiumJS, Leaflet, Tailwind, shadcn/ui |
| Backend | FastAPI, httpx, pyproj |
| Data | LINZ Data Service (addresses, parcels), LINZ Basemaps (tiles), Open-Meteo (elevation, climate) |

## Layout

Menu header with address search, toolbar, status bar, and resizable left and right panels around the centre canvas.
The left panel lists the lot (legal description, title, area), boundary points (WGS84 and NZTM2000), topography and environment.
The right panel holds basemap and 3D settings. Panel sizes persist in localStorage.

## Environment parameters

Copy the examples and fill in the keys:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

| File | Variable | Purpose |
|---|---|---|
| `backend/.env` | `LINZ_API_KEY` | **Required.** Free key from https://data.linz.govt.nz (needs layers 53353 Street Address and 50772 Primary Parcels). |
| `backend/.env` | `CORS_ORIGINS` | Allowed browser origins, comma separated. |
| `backend/.env` | `LINZ_ADDRESS_LAYER`, `LINZ_PARCEL_LAYER`, `HTTP_TIMEOUT` | Optional overrides. |
| `frontend/.env` | `VITE_API_BASE_URL` | API base, default `/api` (Vite dev proxy). |
| `frontend/.env` | `VITE_DEV_PROXY_TARGET` | Backend URL for the proxy, default `http://localhost:8000`. |
| `frontend/.env` | `VITE_LINZ_BASEMAPS_KEY` | Optional key from https://basemaps.linz.govt.nz for aerial and topographic tiles. Falls back to OpenStreetMap. |
| `frontend/.env` | `VITE_CESIUM_ION_TOKEN` | Optional free token from https://ion.cesium.com. Enables Cesium World Terrain; without it the 3D view uses the backend elevation grid. |

Open-Meteo needs no key.

## Run

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
| `GET /api/address/search?q=` | Matching addresses (LINZ WFS, layer 53353) |
| `GET /api/lot?lat=&lon=` | Parcel at the point: appellation, title, area, boundary points (LINZ Query API, layer 50772) |
| `GET /api/environment?lat=&lon=` | Elevation, slope, aspect, indicative wind zone, climate normals |
| `GET /api/terrain?lat=&lon=&size_m=&n=` | Elevation grid used by the 3D view |

## 3D view (CesiumJS)

The 3D view is a Cesium globe with the selected basemap draped over terrain, the parcel boundary clamped to the ground, extruded building footprints, a translucent sea plane and a vertical exaggeration slider. Terrain comes from the backend elevation grid (served to Cesium as a custom heightmap provider, clamped at the grid edge) or, if `VITE_CESIUM_ION_TOKEN` is set, from Cesium World Terrain. Cesium's workers and assets are served from `/cesium` (dev middleware / copied to `dist/cesium` on build, see `frontend/vite.config.ts`).

## Data caveats

- **Wind zone is indicative.** It is bucketed from 5 years of ERA5 gusts and is not an NZS 3604 site-specific zone. Replace `indicative_wind_zone` in `backend/app/services/environment.py` with council wind-zone data when you have it.
- **Topography is coarse.** Elevation comes from Open-Meteo's ~90 m DEM. For lot-scale detail, switch `openmeteo.elevations` to the LINZ NZ 8m DEM.
- Parcel data is CC BY 4.0 (LINZ). Keep the attribution.

## Ideas for next steps

Council hazard layers (flood, liquefaction, slope failure), zoning from district plans, contours in 3D, building footprints (LINZ layer 101290), tests and CI.
