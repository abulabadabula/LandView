from app.schemas import Building, Topography, WindInfo
from landview_core.provenance import Status


def _building(src: str) -> Building:
    return Building(
        area_m2=100, storeys=1, storeys_source="assumed", height_m=3, height_source=src, ring=[[0, 0], [1, 0], [1, 1]]
    )


def test_building_height_provenance_serialised_camel_case():
    d = _building("lidar_estimated").model_dump(by_alias=True, mode="json")
    assert d["heightProvenance"]["status"] == "DERIVED"
    assert "eave" in d["heightProvenance"]["note"]


def test_assumed_height_needs_confirmation():
    assert _building("assumed").height_provenance.needs_confirmation
    assert _building("osm_height").height_provenance.status is Status.MEASURED


def test_wind_is_always_assumed():
    w = WindInfo(zone="High", max_gust_ms=30, basis="ERA5", disclaimer="not NZS 3604")
    assert w.model_dump(by_alias=True, mode="json")["provenance"]["status"] == "ASSUMED"


def test_topography_provenance_optional_for_backwards_compat():
    assert Topography(elevation_m=1, slope_deg=2).provenance is None
