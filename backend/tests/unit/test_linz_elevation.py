import io

import httpx
import numpy as np
import pytest
import respx
from PIL import Image

from app.services import linz_elevation
from app.services.errors import UpstreamError
from landview_core.cache import LRUCache


def _terrain_rgb_png(height_m: float) -> bytes:
    v = round((height_m + 10000) / 0.1)
    rgb = (v // 65536, (v % 65536) // 256, v % 256)
    img = Image.new("RGBA", (256, 256), (*rgb, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_decode_terrain_rgb():
    tile = linz_elevation._decode(_terrain_rgb_png(12.3))
    assert tile.shape == (256, 256)
    assert float(tile[0, 0]) == pytest.approx(12.3, abs=0.05)


def test_decode_marks_transparent_and_background_as_nan():
    img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    assert np.isnan(linz_elevation._decode(buf.getvalue())).all()


@respx.mock
async def test_elevations_sample_constant_tile(monkeypatch):
    monkeypatch.setattr(linz_elevation, "_tile_cache", LRUCache(64))
    route = respx.get(url__regex=r"https://basemaps\.linz\.govt\.nz/v1/tiles/elevation/.*").mock(
        return_value=httpx.Response(200, content=_terrain_rgb_png(42.0))
    )
    out = await linz_elevation.elevations([(-41.2793, 174.7762), (-41.2795, 174.7765)], spacing_m=10)
    assert out == [pytest.approx(42.0, abs=0.1)] * 2
    calls_after_first = route.call_count
    await linz_elevation.elevations([(-41.2793, 174.7762)], spacing_m=10)
    assert route.call_count == calls_after_first  # served from the bounded cache


@respx.mock
async def test_missing_tiles_raise_404_style_error(monkeypatch):
    monkeypatch.setattr(linz_elevation, "_tile_cache", LRUCache(64))
    respx.get(url__regex=r"https://basemaps\.linz\.govt\.nz/.*").mock(return_value=httpx.Response(404))
    with pytest.raises(UpstreamError) as exc:
        await linz_elevation.elevations([(-41.2793, 174.7762)], spacing_m=10)
    assert exc.value.status_code == 404
