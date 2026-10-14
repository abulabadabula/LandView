from datetime import date

from landview_core.provenance import Provenance, Provenanced, Status


def test_assumed_needs_confirmation():
    p = Provenance(status=Status.ASSUMED, source="aerial_2023")
    assert p.needs_confirmation
    assert not Provenance(status=Status.MEASURED, source="LINZ").needs_confirmation


def test_serialises_camel_case():
    v = Provenanced[float](
        value=2.4,
        provenance=Provenance(status=Status.DERIVED, source="dsm-dem", captured_at=date(2024, 6, 1)),
    )
    d = v.model_dump(by_alias=True, mode="json")
    assert d["provenance"]["capturedAt"] == "2024-06-01"
    assert d["provenance"]["status"] == "DERIVED"
