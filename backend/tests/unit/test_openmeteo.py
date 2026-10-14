import httpx
import respx

from app.services import openmeteo
from landview_core.cache import LRUCache


def _elevation_route(mock):
    def handler(request: httpx.Request) -> httpx.Response:
        lats = request.url.params["latitude"].split(",")
        # elevation = 1000 * |lat| so results are checkable per point
        return httpx.Response(200, json={"elevation": [abs(float(v)) * 1000 for v in lats]})

    return mock.get(url__regex=r"https://api\.open-meteo\.com/v1/elevation.*").mock(side_effect=handler)


@respx.mock
async def test_elevations_cached_and_ordered(monkeypatch):
    monkeypatch.setattr(openmeteo, "_elev_cache", LRUCache(1000))
    route = _elevation_route(respx.mock)
    pts = [(-41.0, 174.0), (-41.1, 174.0), (-41.0, 174.0)]  # includes a duplicate
    first = await openmeteo.elevations(pts)
    assert first == [41000.0, 41100.0, 41000.0]
    assert route.call_count == 1
    await openmeteo.elevations(pts)
    assert route.call_count == 1  # fully served from cache


@respx.mock
async def test_elevations_survive_cache_smaller_than_request(monkeypatch):
    """A request larger than the cache must still return every value (no KeyError)."""
    monkeypatch.setattr(openmeteo, "_elev_cache", LRUCache(5))
    _elevation_route(respx.mock)
    pts = [(-41.0 - i * 0.001, 174.0) for i in range(30)]
    out = await openmeteo.elevations(pts)
    assert len(out) == 30
    assert out[0] == 41000.0
