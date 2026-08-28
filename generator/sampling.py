import math
import random

from pyproj import Geod

WGS84 = Geod(ellps='WGS84')


def uniform_point_in_circle(rng: random.Random, center_lat: float, center_lng: float, radius_m: float):
    """Rejection-free uniform sampling within a geodesic circle: uniform
    bearing, radius drawn as radius_m * sqrt(u) so area (not radius) is
    uniform. See Design Analysis.md §4.2."""
    bearing_deg = rng.uniform(0, 360)
    r = radius_m * math.sqrt(rng.uniform(0, 1))
    lng2, lat2, _ = WGS84.fwd(center_lng, center_lat, bearing_deg, r)
    return lat2, lng2


def geodesic_distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    _, _, dist = WGS84.inv(lng1, lat1, lng2, lat2)
    return dist


def destination(lat: float, lng: float, bearing_deg: float, distance_m: float):
    lng2, lat2, _ = WGS84.fwd(lng, lat, bearing_deg, distance_m)
    return lat2, lng2
