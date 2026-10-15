from __future__ import annotations

from app.schemas import ParcelSetbackRequest, SetbackBoundaryPoint
from app.services.setback import create_parcel_setback


def test_square_parcel_gets_one_metre_inward_mitred_setback() -> None:
    request = ParcelSetbackRequest(
        distance_m=1,
        boundary=[
            SetbackBoundaryPoint(index=1, nztm_e=1_750_000, nztm_n=5_920_000),
            SetbackBoundaryPoint(index=2, nztm_e=1_750_020, nztm_n=5_920_000),
            SetbackBoundaryPoint(index=3, nztm_e=1_750_020, nztm_n=5_920_020),
            SetbackBoundaryPoint(index=4, nztm_e=1_750_000, nztm_n=5_920_020),
        ],
    )

    result = create_parcel_setback(request)

    assert len(result.polygons) == 1
    inset = result.polygons[0]
    assert len(inset.points) == 4
    assert inset.area_m2 == 324.0
    assert {(p.nztm_e, p.nztm_n) for p in inset.points} == {
        (1_750_001, 5_920_001),
        (1_750_019, 5_920_001),
        (1_750_019, 5_920_019),
        (1_750_001, 5_920_019),
    }
    assert all(-180 <= p.lon <= 180 and -90 <= p.lat <= 90 for p in inset.points)


def test_setback_reports_when_a_narrow_parcel_disappears() -> None:
    request = ParcelSetbackRequest(
        distance_m=1,
        boundary=[
            SetbackBoundaryPoint(index=1, nztm_e=1_750_000, nztm_n=5_920_000),
            SetbackBoundaryPoint(index=2, nztm_e=1_750_001.5, nztm_n=5_920_000),
            SetbackBoundaryPoint(index=3, nztm_e=1_750_001.5, nztm_n=5_920_010),
            SetbackBoundaryPoint(index=4, nztm_e=1_750_000, nztm_n=5_920_010),
        ],
    )

    result = create_parcel_setback(request)

    assert result.polygons == []
    assert result.warning is not None
    assert "no remaining area" in result.warning
