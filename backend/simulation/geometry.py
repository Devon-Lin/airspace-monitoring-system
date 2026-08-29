"""Geometry math for restricted zones: projection, breach detection, nearest-
zone tracking, and time-to-entry. Uses Shapely + pyproj rather than PostGIS/
GeoDjango — see docs/Design Analysis.md §4.3.

All real math happens in a local azimuthal-equidistant (AEQD) projection
centered on the base station, so distances/intersections are accurate in
meters across the full 100km simulation area, rather than naive lat/lng math.
"""

import math

from django.conf import settings
from pyproj import Proj
from shapely.geometry import LineString, Point, Polygon

_proj = Proj(
    proj='aeqd',
    lat_0=settings.SIMULATION['BASE_STATION_LAT'],
    lon_0=settings.SIMULATION['BASE_STATION_LNG'],
    units='m',
    ellps='WGS84',
)


def project(lat: float, lng: float) -> tuple[float, float]:
    x, y = _proj(lng, lat)
    return x, y


def unproject(point_xy: tuple[float, float]) -> tuple[float, float]:
    lng, lat = _proj(point_xy[0], point_xy[1], inverse=True)
    return lat, lng


def build_zone_polygon(coordinates: list[list[float]]) -> Polygon:
    """coordinates: [[lat, lng], ...]"""
    return Polygon([project(lat, lng) for lat, lng in coordinates])


def distance_xy(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def bearing_xy(from_xy: tuple[float, float], to_xy: tuple[float, float]) -> float:
    """Bearing in degrees (0=north, clockwise), matching the convention used
    for aircraft/drone headings throughout this module."""
    dx, dy = to_xy[0] - from_xy[0], to_xy[1] - from_xy[1]
    return math.degrees(math.atan2(dx, dy)) % 360


def move_point(point_xy: tuple[float, float], heading_deg: float, distance_m: float) -> tuple[float, float]:
    heading_rad = math.radians(heading_deg)
    return (
        point_xy[0] + math.sin(heading_rad) * distance_m,
        point_xy[1] + math.cos(heading_rad) * distance_m,
    )


def clamp_turn(current_heading_deg: float, desired_heading_deg: float, max_turn_deg: float) -> float:
    """Turns current_heading toward desired_heading by at most max_turn_deg
    (wraparound-safe) — used to bound drone maneuvering per tick."""
    delta = ((desired_heading_deg - current_heading_deg + 180) % 360) - 180
    delta = max(-max_turn_deg, min(max_turn_deg, delta))
    return (current_heading_deg + delta) % 360


def validate_zone_coordinates(coordinates) -> str | None:
    """Returns an error message, or None if the polygon is acceptable.
    Validates shape/type before touching Shapely — this endpoint is
    unauthenticated, so a malformed payload must get a clean 400, not an
    unhandled exception."""
    if not isinstance(coordinates, list) or len(coordinates) < 3:
        return 'A restricted zone needs at least 3 points.'
    for point in coordinates:
        if not isinstance(point, (list, tuple)) or len(point) != 2:
            return 'Each point must be a [lat, lng] pair.'
        lat, lng = point
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            return 'Each point must be a [lat, lng] pair of numbers.'
        if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
            return 'Coordinates must be valid latitude/longitude values.'

    try:
        polygon = build_zone_polygon(coordinates)
    except Exception:
        return 'Zone polygon is invalid.'
    if not polygon.is_valid:
        return 'Zone polygon is self-intersecting or otherwise invalid.'
    return None


def segment_breaches(polygon: Polygon, prev_xy: tuple[float, float], curr_xy: tuple[float, float]) -> bool:
    """True if the aircraft's most recent movement segment enters the zone
    (requirement 3.3) — not just whether the current point happens to be
    inside it, so a fast mover can't tunnel through a thin zone between ticks."""
    return polygon.intersects(LineString([prev_xy, curr_xy]))


def distance_to_boundary_m(polygon: Polygon, point_xy: tuple[float, float]) -> float:
    """0 if inside the zone (requirement 4.9 — proximity uses the boundary)."""
    point = Point(point_xy)
    if polygon.contains(point):
        return 0.0
    return polygon.exterior.distance(point)


def predicted_path_points(
    point_xy: tuple[float, float],
    heading_deg: float,
    speed_mps: float,
    turn_rate_deg_s: float,
    horizon_s: float,
    step_s: float = 15.0,
) -> list[tuple[float, float]]:
    """Turn-rate-aware predicted path: a constant-turn-rate arc (or a
    straight line when turn_rate_deg_s is ~0) stepped forward in `step_s`
    increments out to horizon_s. docs/Design Analysis.md §4.1 — this is also what
    TTE is computed against, so TTE and the rendered predicted path always
    agree with each other."""
    points = [point_xy]
    heading = heading_deg
    x, y = point_xy
    steps = max(1, round(horizon_s / step_s))

    for _ in range(steps):
        heading = (heading + turn_rate_deg_s * step_s) % 360
        heading_rad = math.radians(heading)
        distance = speed_mps * step_s
        x = x + math.sin(heading_rad) * distance
        y = y + math.cos(heading_rad) * distance
        points.append((x, y))

    return points


def time_to_entry_along_path(
    polygon: Polygon,
    path_points: list[tuple[float, float]],
    speed_mps: float,
    step_s: float,
) -> float | None:
    """TTE by walking the predicted path segment by segment, rather than a
    naive straight-line ray — correctly handles turning aircraft (requirement
    4.7). Returns 0 if already inside (4.11), None if no intercept within the
    path's horizon (4.10)."""
    if polygon.contains(Point(path_points[0])):
        return 0.0
    if speed_mps <= 0:
        return None

    cumulative_time = 0.0
    for start_xy, end_xy in zip(path_points, path_points[1:]):
        segment = LineString([start_xy, end_xy])
        intersection = polygon.exterior.intersection(segment)
        if not intersection.is_empty:
            geoms = list(intersection.geoms) if hasattr(intersection, 'geoms') else [intersection]
            candidate_points = []
            for geom in geoms:
                if isinstance(geom, Point):
                    candidate_points.append(geom)
                elif hasattr(geom, 'coords'):
                    candidate_points.extend(Point(c) for c in geom.coords)
            if candidate_points:
                start_point = Point(start_xy)
                nearest_distance = min(start_point.distance(c) for c in candidate_points)
                return cumulative_time + nearest_distance / speed_mps
        cumulative_time += step_s

    return None
