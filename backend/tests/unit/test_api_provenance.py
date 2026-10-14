from fastapi.testclient import TestClient

from app.main import app
from app.schemas import Building, BuildingCollection
from app.services import buildings as building_service


def test_buildings_endpoint_exposes_height_provenance(monkeypatch):
    async def fake(lat, lon, size_m):
        b = Building(
            area_m2=80, storeys=1, storeys_source="assumed", height_m=3, height_source="assumed", ring=[[0, 0], [1, 0], [1, 1]]
        )
        return BuildingCollection(buildings=[b], osm_available=False)

    monkeypatch.setattr(building_service, "buildings_around", fake)
    r = TestClient(app).get("/api/buildings", params={"lat": -41.28, "lon": 174.77})
    assert r.status_code == 200
    prov = r.json()["buildings"][0]["heightProvenance"]
    assert prov["status"] == "ASSUMED"
