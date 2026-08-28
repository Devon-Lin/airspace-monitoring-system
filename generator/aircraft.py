import itertools
import random
import uuid
from dataclasses import dataclass

import config
from sampling import destination, geodesic_distance_m, uniform_point_in_circle

_id_counter = itertools.count(1)


@dataclass
class Aircraft:
    id: str
    lat: float
    lng: float
    altitude_m: float
    heading_deg: float
    speed_mps: float
    turn_rate_deg_s: float

    def step(self, dt_s: float) -> None:
        self.heading_deg = (self.heading_deg + self.turn_rate_deg_s * dt_s) % 360
        distance_m = self.speed_mps * dt_s
        self.lat, self.lng = destination(self.lat, self.lng, self.heading_deg, distance_m)

    def distance_from_base_m(self) -> float:
        return geodesic_distance_m(config.BASE_STATION_LAT, config.BASE_STATION_LNG, self.lat, self.lng)

    def to_payload(self) -> dict:
        return {
            'id': self.id,
            'lat': self.lat,
            'lng': self.lng,
            'altitude_m': round(self.altitude_m, 2),
            'heading_deg': round(self.heading_deg, 3),
            'speed_mps': round(self.speed_mps, 2),
        }


def spawn_aircraft(rng: random.Random) -> Aircraft:
    lat, lng = uniform_point_in_circle(
        rng, config.BASE_STATION_LAT, config.BASE_STATION_LNG, config.SIMULATION_RADIUS_KM * 1000
    )
    altitude_m = rng.uniform(config.ALTITUDE_MIN_M, config.ALTITUDE_MAX_M)
    speed_mps = rng.uniform(config.SPEED_MIN_MPS, config.SPEED_MAX_MPS)
    heading_deg = rng.uniform(0, 360)

    if rng.random() < config.STRAIGHT_FRACTION:
        turn_rate_deg_s = 0.0
    else:
        sign = rng.choice([-1, 1])
        turn_rate_deg_s = sign * rng.uniform(0.2, config.MAX_TURN_RATE_DEG_S)

    return Aircraft(
        id=f'AC-{next(_id_counter):04d}-{uuid.uuid4().hex[:6]}',
        lat=lat,
        lng=lng,
        altitude_m=altitude_m,
        heading_deg=heading_deg,
        speed_mps=speed_mps,
        turn_rate_deg_s=turn_rate_deg_s,
    )
