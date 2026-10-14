"""Small bounded LRU cache (dict-like) so process-level caches cannot grow forever."""
from collections import OrderedDict
from collections.abc import Iterable, Iterator


class LRUCache[K, V]:
    def __init__(self, max_items: int) -> None:
        if max_items < 1:
            raise ValueError("max_items must be >= 1")
        self._max = max_items
        self._data: OrderedDict[K, V] = OrderedDict()

    def __contains__(self, key: object) -> bool:
        return key in self._data

    def __len__(self) -> int:
        return len(self._data)

    def __iter__(self) -> Iterator[K]:
        return iter(self._data)

    def __getitem__(self, key: K) -> V:
        value = self._data[key]  # raises KeyError like a dict
        self._data.move_to_end(key)
        return value

    def __setitem__(self, key: K, value: V) -> None:
        self._data[key] = value
        self._data.move_to_end(key)
        while len(self._data) > self._max:
            self._data.popitem(last=False)

    def get(self, key: K, default: V | None = None) -> V | None:
        return self[key] if key in self._data else default

    def update(self, items: Iterable[tuple[K, V]]) -> None:
        for k, v in items:
            self[k] = v
