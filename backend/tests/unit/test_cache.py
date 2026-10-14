import pytest

from landview_core.cache import LRUCache


def test_evicts_least_recently_used():
    c = LRUCache[str, int](2)
    c["a"], c["b"] = 1, 2
    assert c["a"] == 1  # touch a -> b is now oldest
    c["c"] = 3
    assert "b" not in c and "a" in c and "c" in c
    assert len(c) == 2


def test_stores_none_values_and_get_default():
    c = LRUCache[str, int | None](2)
    c["missing-tile"] = None
    assert "missing-tile" in c and c["missing-tile"] is None
    assert c.get("nope", 7) == 7


def test_update_and_validation():
    c = LRUCache[int, int](3)
    c.update((i, i) for i in range(10))
    assert list(c) == [7, 8, 9]
    with pytest.raises(ValueError):
        LRUCache[int, int](0)
