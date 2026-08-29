import uuid

from django.db import models


class RestrictedZone(models.Model):
    """A user-drawn polygon. Coordinates are stored as [[lat, lng], ...],
    Shapely/pyproj (not PostGIS) does the actual geometry math in-process —
    see docs/Design Analysis.md §4.3."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, blank=True)
    coordinates = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)


class PatrolPath(models.Model):
    """Single shared drone patrol route (docs/Design Analysis.md §4.1). Only one
    row is expected to exist at a time; saving a new one replaces it."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    coordinates = models.JSONField()
    updated_at = models.DateTimeField(auto_now=True)


class TelemetrySample(models.Model):
    """Durable mirror of the in-memory 5-minute rolling history window
    (docs/Design Analysis.md §4.1) — same retention, pruned by the same policy."""

    aircraft_id = models.CharField(max_length=64, db_index=True)
    timestamp = models.DateTimeField(db_index=True)
    lat = models.FloatField()
    lng = models.FloatField()
    altitude_m = models.FloatField()
    heading_deg = models.FloatField()
    speed_mps = models.FloatField()

    class Meta:
        indexes = [
            models.Index(fields=['aircraft_id', 'timestamp']),
        ]
