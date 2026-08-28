from . import geometry
from .models import RestrictedZone


class ZoneCache:
    """In-memory mirror of RestrictedZone rows, keyed by id (as str), each
    holding a pre-built Shapely polygon so the per-tick recompute never hits
    the database. Loaded lazily on first use (see views.ensure_zones_loaded)
    rather than in AppConfig.ready(), since ready() can run before migrations
    exist (e.g. during `makemigrations`)."""

    def __init__(self):
        self.zones: dict[str, dict] = {}
        self.loaded = False

    def load_from_db(self) -> None:
        self.zones = {
            str(z.id): {
                'id': str(z.id),
                'name': z.name,
                'coordinates': z.coordinates,
                'polygon': geometry.build_zone_polygon(z.coordinates),
            }
            for z in RestrictedZone.objects.all()
        }
        self.loaded = True

    def add(self, zone_id: str, name: str, coordinates: list[list[float]]) -> None:
        self.zones[zone_id] = {
            'id': zone_id,
            'name': name,
            'coordinates': coordinates,
            'polygon': geometry.build_zone_polygon(coordinates),
        }

    def remove(self, zone_id: str) -> None:
        self.zones.pop(zone_id, None)

    def all(self):
        return list(self.zones.values())

    def public_zone(self, zone_id: str) -> dict:
        z = self.zones[zone_id]
        return {'id': z['id'], 'name': z['name'], 'coordinates': z['coordinates']}


ZONE_CACHE = ZoneCache()
