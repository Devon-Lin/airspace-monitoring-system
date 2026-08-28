"""Simulated autonomous drone fleet.

Single-trigger, two-phase design (Design Analysis.md §4.1): idle drones fly a
shared patrol path; on an aircraft breach, the nearest available drone
leaves patrol, computes an intercept course (requirement 5.3's estimate ->
distance -> intercept-time -> predicted-position -> heading -> move loop),
then holds ~200m via a simple feedback loop once it arrives (5.4) and this
also serves as the "shadow" behavior. It disengages and returns to base when
the target leaves the zone, disappears, or a max monitor duration elapses
(Design Analysis.md §4.1 recycle policy) — freeing it for the next breach.
"""

import math
from dataclasses import dataclass

from django.conf import settings

from . import geometry

DRONE_COUNT = settings.SIMULATION['DRONE_COUNT']
MAX_SPEED_MPS = settings.SIMULATION['DRONE_MAX_SPEED_MPS']
MAX_TURN_RATE_DEG_S = settings.SIMULATION['DRONE_MAX_TURN_RATE_DEG_S']
HOLD_DISTANCE_M = settings.SIMULATION['DRONE_HOLD_DISTANCE_M']
MAX_MONITOR_SECONDS = settings.SIMULATION['DRONE_MAX_MONITOR_SECONDS']
BASE_LAT = settings.SIMULATION['BASE_STATION_LAT']
BASE_LNG = settings.SIMULATION['BASE_STATION_LNG']

PATROL_SPEED_MPS = MAX_SPEED_MPS * 0.4
RETURN_ARRIVAL_THRESHOLD_M = 500.0
HOLD_FEEDBACK_GAIN = 0.5  # proportional gain, 1/s, for the 200m-hold loop


def _closed_path_segments(path_xy: list[tuple[float, float]]):
    segments = list(zip(path_xy, path_xy[1:] + path_xy[:1]))
    total_length = sum(geometry.distance_xy(a, b) for a, b in segments)
    return segments, total_length


def _position_along_path(segments, total_length: float, distance_m: float):
    if total_length <= 0:
        return segments[0][0], 0.0
    remaining = distance_m % total_length
    for a, b in segments:
        seg_len = geometry.distance_xy(a, b)
        if seg_len <= 0:
            continue
        if remaining <= seg_len:
            t = remaining / seg_len
            point = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            return point, geometry.bearing_xy(a, b)
        remaining -= seg_len
    return segments[-1][1], 0.0


@dataclass
class DroneState:
    id: str
    lat: float
    lng: float
    heading_deg: float = 0.0
    speed_mps: float = 0.0
    status: str = 'patrol'  # 'patrol' | 'intercept' | 'monitor' | 'returning'
    target_aircraft_id: str | None = None
    patrol_offset_fraction: float = 0.0  # this drone's fixed slot in the patrol rotation, 0..1
    patrol_distance_m: float = 0.0  # distance traveled since (re)joining patrol
    monitor_started_at: float | None = None
    intercept_time_estimate: float | None = None

    def to_public_dict(self) -> dict:
        return {
            'id': self.id,
            'lat': self.lat,
            'lng': self.lng,
            'heading_deg': self.heading_deg,
            'speed_mps': self.speed_mps,
            'status': self.status,
            'target_aircraft_id': self.target_aircraft_id,
            'intercept_time_estimate': self.intercept_time_estimate,
        }


class DroneFleet:
    def __init__(self):
        self.drones: dict[str, DroneState] = {}
        self.no_drone_available_ids: set[str] = set()
        self._initialized = False

    def _ensure_initialized(self):
        if self._initialized:
            return
        for i in range(DRONE_COUNT):
            drone_id = f'DRONE-{i + 1:02d}'
            self.drones[drone_id] = DroneState(
                id=drone_id, lat=BASE_LAT, lng=BASE_LNG, patrol_offset_fraction=i / DRONE_COUNT
            )
        self._initialized = True

    def update(self, dt_s: float, now: float, aircraft: dict, patrol_coordinates: list[list[float]] | None) -> None:
        self._ensure_initialized()

        patrol_segments, patrol_total = None, 0.0
        if patrol_coordinates and len(patrol_coordinates) >= 2:
            patrol_xy = [geometry.project(lat, lng) for lat, lng in patrol_coordinates]
            patrol_segments, patrol_total = _closed_path_segments(patrol_xy)

        self._process_disengage(now, aircraft)
        for drone in self.drones.values():
            self._move_drone(drone, dt_s, now, aircraft, patrol_segments, patrol_total)
        self._dispatch(aircraft)

    def _process_disengage(self, now: float, aircraft: dict) -> None:
        for drone in self.drones.values():
            if drone.status not in ('intercept', 'monitor'):
                continue
            target = aircraft.get(drone.target_aircraft_id)
            monitor_expired = (
                drone.status == 'monitor'
                and drone.monitor_started_at is not None
                and now - drone.monitor_started_at > MAX_MONITOR_SECONDS
            )
            if target is None or not target.breached_zone_ids or monitor_expired:
                drone.status = 'returning'
                drone.target_aircraft_id = None
                drone.monitor_started_at = None
                drone.intercept_time_estimate = None

    def _move_drone(self, drone, dt_s, now, aircraft, patrol_segments, patrol_total) -> None:
        drone_xy = geometry.project(drone.lat, drone.lng)

        if drone.status == 'returning':
            base_xy = geometry.project(BASE_LAT, BASE_LNG)
            if geometry.distance_xy(drone_xy, base_xy) <= RETURN_ARRIVAL_THRESHOLD_M:
                drone.status, drone.lat, drone.lng, drone.speed_mps = 'patrol', BASE_LAT, BASE_LNG, 0.0
                drone.patrol_distance_m = 0.0
                return
            desired_heading = geometry.bearing_xy(drone_xy, base_xy)
            drone.heading_deg = geometry.clamp_turn(drone.heading_deg, desired_heading, MAX_TURN_RATE_DEG_S * dt_s)
            drone.speed_mps = MAX_SPEED_MPS
            drone.lat, drone.lng = geometry.unproject(geometry.move_point(drone_xy, drone.heading_deg, drone.speed_mps * dt_s))

        elif drone.status == 'patrol':
            if patrol_segments:
                drone.patrol_distance_m += PATROL_SPEED_MPS * dt_s
                effective_distance = drone.patrol_distance_m + drone.patrol_offset_fraction * patrol_total
                xy, heading = _position_along_path(patrol_segments, patrol_total, effective_distance)
                drone.lat, drone.lng = geometry.unproject(xy)
                drone.heading_deg = heading
                drone.speed_mps = PATROL_SPEED_MPS
            else:
                drone.lat, drone.lng, drone.speed_mps = BASE_LAT, BASE_LNG, 0.0

        elif drone.status == 'intercept':
            target = aircraft.get(drone.target_aircraft_id)
            if target is None:
                return
            target_xy = geometry.project(target.lat, target.lng)
            target_velocity = _velocity_xy(target.heading_deg, target.speed_mps)

            # Requirement 5.3's approach, re-run every tick as the target moves:
            # estimate position -> distance -> intercept time -> predicted
            # position at intercept -> adjust heading -> move.
            distance = geometry.distance_xy(drone_xy, target_xy)
            intercept_time = distance / MAX_SPEED_MPS if MAX_SPEED_MPS > 0 else 0.0
            predicted_xy = (
                target_xy[0] + target_velocity[0] * intercept_time,
                target_xy[1] + target_velocity[1] * intercept_time,
            )
            desired_heading = geometry.bearing_xy(drone_xy, predicted_xy)
            drone.heading_deg = geometry.clamp_turn(drone.heading_deg, desired_heading, MAX_TURN_RATE_DEG_S * dt_s)
            drone.speed_mps = MAX_SPEED_MPS
            drone.intercept_time_estimate = intercept_time
            new_xy = geometry.move_point(drone_xy, drone.heading_deg, drone.speed_mps * dt_s)
            drone.lat, drone.lng = geometry.unproject(new_xy)

            if geometry.distance_xy(new_xy, target_xy) <= HOLD_DISTANCE_M:
                drone.status = 'monitor'
                drone.monitor_started_at = now

        elif drone.status == 'monitor':
            target = aircraft.get(drone.target_aircraft_id)
            if target is None:
                return
            target_xy = geometry.project(target.lat, target.lng)
            target_velocity = _velocity_xy(target.heading_deg, target.speed_mps)

            # Simple feedback loop (5.4.1): match the target's velocity, plus
            # a proportional correction that closes/opens the gap to exactly
            # HOLD_DISTANCE_M.
            error = geometry.distance_xy(drone_xy, target_xy) - HOLD_DISTANCE_M
            closing_speed = max(-MAX_SPEED_MPS, min(MAX_SPEED_MPS, HOLD_FEEDBACK_GAIN * error))
            to_target_heading = geometry.bearing_xy(drone_xy, target_xy)
            correction = _velocity_xy(to_target_heading, closing_speed)
            move_x = (target_velocity[0] + correction[0]) * dt_s
            move_y = (target_velocity[1] + correction[1]) * dt_s
            move_distance = math.hypot(move_x, move_y)

            if move_distance > 0:
                move_heading = math.degrees(math.atan2(move_x, move_y)) % 360
                drone.heading_deg = geometry.clamp_turn(drone.heading_deg, move_heading, MAX_TURN_RATE_DEG_S * dt_s)
                drone.speed_mps = min(MAX_SPEED_MPS, move_distance / dt_s)
                new_xy = geometry.move_point(drone_xy, drone.heading_deg, drone.speed_mps * dt_s)
            else:
                new_xy = drone_xy
                drone.speed_mps = 0.0

            drone.lat, drone.lng = geometry.unproject(new_xy)
            drone.intercept_time_estimate = 0.0

    def _dispatch(self, aircraft: dict) -> None:
        assigned_target_ids = {d.target_aircraft_id for d in self.drones.values() if d.target_aircraft_id}
        available_drones = [d for d in self.drones.values() if d.status == 'patrol']
        critical_unassigned = [
            a for a in aircraft.values() if a.breached_zone_ids and a.id not in assigned_target_ids
        ]

        self.no_drone_available_ids = set()
        for target in critical_unassigned:
            if not available_drones:
                self.no_drone_available_ids.add(target.id)
                continue
            target_xy = geometry.project(target.lat, target.lng)
            nearest = min(
                available_drones, key=lambda d: geometry.distance_xy(geometry.project(d.lat, d.lng), target_xy)
            )
            nearest.status = 'intercept'
            nearest.target_aircraft_id = target.id
            available_drones.remove(nearest)

    def snapshot(self) -> list[dict]:
        self._ensure_initialized()
        return [d.to_public_dict() for d in self.drones.values()]


def _velocity_xy(heading_deg: float, speed_mps: float) -> tuple[float, float]:
    heading_rad = math.radians(heading_deg)
    return math.sin(heading_rad) * speed_mps, math.cos(heading_rad) * speed_mps


DRONE_FLEET = DroneFleet()
