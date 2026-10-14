import httpx
import pytest
import respx

from app.services import linz

SQUARE = [[174.7762, -41.2793], [174.7764, -41.2793], [174.7764, -41.2795], [174.7762, -41.2795], [174.7762, -41.2793]]


def _feature(pid, intent, titles, area):
    return {
        "properties": {
            "id": pid,
            "parcel_intent": intent,
            "titles": titles,
            "calc_area": area,
            "appellation": f"Lot {pid}",
        },
        "geometry": {"type": "Polygon", "coordinates": [SQUARE]},
    }


@respx.mock
async def test_parcel_prefers_titled_non_road():
    payload = {
        "vectorQuery": {
            "layers": {
                "50772": {
                    "features": [
                        _feature(1, "Road", None, 500.0),
                        _feature(2, "DCDB", "WN1/1", 612.4),
                    ]
                }
            }
        }
    }
    respx.get("https://data.linz.govt.nz/services/query/v1/vector.json").mock(
        return_value=httpx.Response(200, json=payload)
    )
    parcel = await linz.get_parcel_at(-41.2794, 174.7763)
    assert parcel is not None
    assert parcel.id == 2
    assert parcel.area_m2 == pytest.approx(612.4)
    assert len(parcel.boundary) == 4  # closing vertex dropped
    assert parcel.boundary[0].nztm_e > 1_000_000


@respx.mock
async def test_parcel_none_when_no_features():
    payload = {"vectorQuery": {"layers": {"50772": {"features": []}}}}
    respx.get("https://data.linz.govt.nz/services/query/v1/vector.json").mock(
        return_value=httpx.Response(200, json=payload)
    )
    assert await linz.get_parcel_at(-41.2794, 174.7763) is None
