import pytest

from app.config import get_settings


@pytest.fixture(autouse=True)
def _settings(monkeypatch):
    """Deterministic settings; never read a developer's real .env keys in tests."""
    monkeypatch.setenv("LINZ_API_KEY", "test-linz-key")
    monkeypatch.setenv("LINZ_BASEMAPS_KEY", "test-basemaps-key")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()
