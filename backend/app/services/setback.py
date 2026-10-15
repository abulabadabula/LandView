"""Generate inward parcel setbacks in New Zealand Transverse Mercator metres."""
from __future__ import annotations

from collections.abc import Iterable

from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon

from app.schemas import (
    ParcelSetbackPoint,
    ParcelSetbackPolygon,
    ParcelSetbackRequest,
    ParcelSetbackResult,
)

_TO_WGS84 = Transformer.from_crs(2193, 4326, always_xy=True)


def _polygon_parts(geometry: Polygon | MultiPolygon) -> Iterable[Polygon]:
    if isinstance(geometry, Polygon):
        yield geometry
    elif isinstance(geometry, MultiPolygon):
        yield from geometry.geoms


def create_parcel_setback(request: ParcelSetbackRequest) -> ParcelSetbackResult:
    """Buffer the supplied legal boundary inward by distance_m in EPSG:2193.

    A mitred join preserves the intersection of adjacent offset boundary lines.
    Narrow or unusually shaped parcels can result in multiple inset polygons or
    no remaining polygon; those outcomes are returned explicitly to the caller.
    """
    coordinates = [(point.nztm_e, point.nztm_n) for point in request.boundary]
    legal_polygon = Polygon(coordinates)

    if not legal_polygon.is_valid:
        legal_polygon = legal_polygon.buffer(0)

    if legal_polygon.is_empty or legal_polygon.area <= 0:
        return ParcelSetbackResult(
            distance_m=request.distance_m,
            polygons=[],
            warning="The supplied parcel boundary is invalid; no setback line could be generated.",
        )

    inset = legal_polygon.buffer(-request.distance_m, join_style="mitre", mitre_limit=5.0)
    if inset.is_empty:
        return ParcelSetbackResult(
            distance_m=request.distance_m,
            polygons=[],
            warning=(
                f"The parcel has no remaining area after an inward {request.distance_m:g} m setback. "
                "Check the parcel outline or use a smaller setback distance."
            ),
        )

    parts = sorted(_polygon_parts(inset), key=lambda part: part.area, reverse=True)
    output: list[ParcelSetbackPolygon] = []
    for part in parts:
        ring = list(part.exterior.coords)[:-1]  # renderer closes the line itself
        if len(ring) < 3:
            continue

        points: list[ParcelSetbackPoint] = []
        for index, (easting, northing) in enumerate(ring, start=1):
            lon, lat = _TO_WGS84.transform(easting, northing)
            points.append(
                ParcelSetbackPoint(
                    index=index,
                    lon=round(lon, 9),
                    lat=round(lat, 9),
                    nztm_e=round(easting, 3),
                    nztm_n=round(northing, 3),
                )
            )
        output.append(
            ParcelSetbackPolygon(
                points=points,
                area_m2=round(float(part.area), 2),
            )
        )

    warning = None if output else "The setback geometry did not contain a drawable polygon."
    if len(output) > 1:
        warning = (
            f"The inward buffer produced {len(output)} separate polygons. "
            "Each polygon is shown as a separate setback line."
        )

    return ParcelSetbackResult(
        distance_m=request.distance_m,
        polygons=output,
        warning=warning,
    )
