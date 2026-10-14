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
