"""Provenance for every derived or fetched value.

Spec principle: any number must be traceable to source, date and version, and
anything not measured must be explicitly flagged rather than silently filled.
"""

from datetime import date
from enum import StrEnum

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class Status(StrEnum):
    MEASURED = "MEASURED"  # read directly from an authoritative dataset
    DERIVED = "DERIVED"  # computed deterministically from measured inputs
    ASSUMED = "ASSUMED"  # a default or inference; needs user confirmation
    USER_CONFIRMED = "USER_CONFIRMED"  # a person explicitly confirmed or set it


class Provenance(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    status: Status
    source: str
    captured_at: date | None = None
    version: str | None = None
    note: str | None = None

    @property
    def needs_confirmation(self) -> bool:
        return self.status is Status.ASSUMED


class Provenanced[T](BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    value: T
    provenance: Provenance


def building_height_provenance(height_source: str) -> Provenance:
    """Map the building height source label used by the API onto a provenance record.

    OSM tags are community-mapped, not surveyed; heights from LiDAR are DSM minus DEM at
    roof samples (roof top, not eaves). Neither is authoritative, so the note says so.
    """
    match height_source:
        case "osm_height":
            return Provenance(status=Status.MEASURED, source="OpenStreetMap height tag", note="Community-mapped")
        case "osm_levels":
            return Provenance(
                status=Status.DERIVED, source="OpenStreetMap levels tag", note="Storeys x nominal storey height"
            )
        case "lidar_estimated":
            return Provenance(
                status=Status.DERIVED,
                source="LINZ LiDAR DSM minus DEM",
                note="Roof-top estimate, not eave height; confirm before relying on it for HIRB",
            )
        case _:
            return Provenance(
                status=Status.ASSUMED, source="Footprint use/area heuristic", note="Needs confirmation"
            )
