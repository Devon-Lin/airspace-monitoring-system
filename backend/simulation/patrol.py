from .models import PatrolPath


class PatrolPathCache:
    """Single shared drone patrol route (docs/Design Analysis.md §4.1) — at most
    one row ever exists; setting a new one replaces it. Same lazy-load
    pattern as ZoneCache, for the same reason (avoid DB access in
    AppConfig.ready())."""

    def __init__(self):
        self.coordinates: list[list[float]] | None = None
        self.loaded = False

    def load_from_db(self) -> None:
        row = PatrolPath.objects.first()
        self.coordinates = row.coordinates if row else None
        self.loaded = True

    def set(self, coordinates: list[list[float]]) -> None:
        self.coordinates = coordinates

    def clear(self) -> None:
        self.coordinates = None


PATROL_PATH_CACHE = PatrolPathCache()
