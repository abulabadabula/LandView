import math

import pytest

from landview_core.crs import from_nztm, offset_latlon, ring_area_m2, to_nztm

# Wellington Railway Station area, roughly.
LON, LAT = 174.7762, -41.2793


def test_nztm_roundtrip():
    e, n = to_nztm(LON, LAT)
    lon, lat = from_nztm(e, n)
    assert lon == pytest.approx(LON, abs=1e-9)
    assert lat == pytest.approx(LAT, abs=1e-9)


def test_nztm_values_plausible_for_wellington():
    e, n = to_nztm(LON, LAT)
    assert 1_740_000 < e < 1_750_000
    assert 5_420_000 < n < 5_430_000


def test_ring_area_of_100m_square():
    lat2, lon2 = offset_latlon(LAT, LON, 100, 100)
    lat1, lon1 = LAT, LON
    ring = [[lon1, lat1], [lon2, lat1], [lon2, lat2], [lon1, lat2]]
    # NZTM is near-conformal; scale error across 100 m is tiny.
    assert ring_area_m2(ring) == pytest.approx(10_000, rel=0.01)


def test_offset_latlon_north_is_positive_lat():
    lat, lon = offset_latlon(LAT, LON, 0, 1000)
    assert lat > LAT and lon == pytest.approx(LON)
    assert math.isclose((lat - LAT) * 111_320, 1000, rel_tol=1e-6)
