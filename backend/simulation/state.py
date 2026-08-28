"""In-process, in-memory simulation state.

Design Analysis.md §4.3: state lives entirely in this single ASGI process
(no Redis) — this only works correctly with a single Uvicorn worker, since
multiple workers would each hold their own separate copy of this state.
"""

import asyncio
import time
from collections import deque
from dataclasses import dataclass, field

from django.conf import settings

from . import geometry
from .drones import DRONE_FLEET

HISTORY_WINDOW_SECONDS = settings.SIMULATION['HISTORY_WINDOW_SECONDS']
NEAREST_ZONES_COUNT = settings.SIMULATION['NEAREST_ZONES_COUNT']
WARNING_TTE_SECONDS = settings.SIMULATION['WARNING_TTE_SECONDS']
TICK_INTERVAL_S = settings.SIMULATION['TICK_INTERVAL_MS'] / 1000.0

# An aircraft that hasn't sent telemetry for this long is evicted even if it
# was never explicitly reported as "removed" — covers generator restarts/
# crashes, not just normal boundary-exit drops. 10x the 200ms tick interval.
STALE_THRESHOLD_SECONDS = 2.0

# A gap between two consecutive historical samples wider than this counts as
# a break in coverage (requirement 4.4). 2x the expected tick interval.
HISTORY_GAP_THRESHOLD_SECONDS = 2 * TICK_INTERVAL_S

# Resolution of the predicted path / path-based TTE walk (Design Analysis
# §4.1: turn-rate-aware, stepped rather than a single straight-line ray).
PREDICTED_PATH_STEP_S = 15.0

MIN_HISTORY_FOR_TURN_RATE = 2


def estimate_turn_rate_deg_s(history: deque) -> float:
    """Finite-difference turn rate from the two most recent samples, with
    heading-wraparound handled correctly (e.g. 359deg -> 1deg is +2, not
    -358). Falls back to 0 (straight-line assumption) with insufficient
    history — requirement 4.6."""
    if len(history) < MIN_HISTORY_FOR_TURN_RATE:
        return 0.0
    t1, _, _, _, h1, _ = history[-2]
    t2, _, _, _, h2, _ = history[-1]
    dt = t2 - t1
    if dt <= 0:
        return 0.0
    delta = ((h2 - h1 + 180) % 360) - 180
    return delta / dt


@dataclass
class AircraftState:
    id: str
    lat: float
    lng: float
    altitude_m: float
    heading_deg: float
    speed_mps: float
    last_seen: float
    history: deque = field(default_factory=deque)  # of (timestamp, lat, lng, altitude_m, heading_deg, speed_mps)
    threat_level: str = 'normal'
    nearest_zones: list = field(default_factory=list)  # [{zone_id, distance_m, tte_seconds}]
    breached_zone_ids: list = field(default_factory=list)
    predicted_path: list = field(default_factory=list)  # [[lat, lng], ...], turn-rate-aware
    no_drone_available: bool = False

    def to_public_dict(self) -> dict:
        return {
            'id': self.id,
            'lat': self.lat,
            'lng': self.lng,
            'altitude_m': self.altitude_m,
            'heading_deg': self.heading_deg,
            'speed_mps': self.speed_mps,
            'threat_level': self.threat_level,
            'nearest_zones': self.nearest_zones,
            'breached_zone_ids': self.breached_zone_ids,
            'no_drone_available': self.no_drone_available,
        }


class SimulationState:
    def __init__(self):
        self.aircraft: dict[str, AircraftState] = {}
        self.sequence = 0
        self.subscribers: set[asyncio.Queue] = set()

    def next_sequence(self) -> int:
        self.sequence += 1
        return self.sequence

    def apply_ingest_batch(self, aircraft_payload: list[dict], removed_ids: list[str], zone_cache, patrol_cache) -> dict:
        """Updates in-memory state from one generator tick and returns the
        diff event to broadcast. Pure dict/list mutation and in-memory
        geometry (no `await`, no DB/network I/O) — keeps the update atomic
        with respect to other coroutines. Also drives the drone fleet
        (dispatch/intercept/monitor/return) once per tick, since drones react
        to global aircraft state rather than any single payload entry."""
        now = time.time()
        updated_ids = []
        zones = zone_cache.all()

        for entry in aircraft_payload:
            aircraft_id = entry['id']
            existing = self.aircraft.get(aircraft_id)
            history = existing.history if existing else deque()
            prev_lat, prev_lng = (existing.lat, existing.lng) if existing else (entry['lat'], entry['lng'])

            history.append((now, entry['lat'], entry['lng'], entry['altitude_m'], entry['heading_deg'], entry['speed_mps']))
            self._prune_history(history, now)

            turn_rate_deg_s = estimate_turn_rate_deg_s(history)
            threat_level, nearest_zones, breached_zone_ids, predicted_path = self._evaluate_aircraft(
                prev_lat, prev_lng, entry['lat'], entry['lng'], entry['heading_deg'], entry['speed_mps'],
                turn_rate_deg_s, zones,
            )

            self.aircraft[aircraft_id] = AircraftState(
                id=aircraft_id,
                lat=entry['lat'],
                lng=entry['lng'],
                altitude_m=entry['altitude_m'],
                heading_deg=entry['heading_deg'],
                speed_mps=entry['speed_mps'],
                last_seen=now,
                history=history,
                threat_level=threat_level,
                nearest_zones=nearest_zones,
                breached_zone_ids=breached_zone_ids,
                predicted_path=predicted_path,
            )
            updated_ids.append(aircraft_id)

        for aircraft_id in removed_ids:
            self.aircraft.pop(aircraft_id, None)

        stale_ids = [
            aircraft_id
            for aircraft_id, aircraft in self.aircraft.items()
            if now - aircraft.last_seen > STALE_THRESHOLD_SECONDS
        ]
        for aircraft_id in stale_ids:
            del self.aircraft[aircraft_id]

        DRONE_FLEET.update(TICK_INTERVAL_S, now, self.aircraft, patrol_cache.coordinates)
        for aircraft_id in updated_ids:
            aircraft = self.aircraft.get(aircraft_id)
            if aircraft is not None:
                aircraft.no_drone_available = aircraft_id in DRONE_FLEET.no_drone_available_ids

        updated = [self.aircraft[aid].to_public_dict() for aid in updated_ids if aid in self.aircraft]
        all_removed = removed_ids + stale_ids

        return {
            'seq': self.next_sequence(),
            'type': 'tick',
            'timestamp': now,
            'updated': updated,
            'removed': all_removed,
            'drones': DRONE_FLEET.snapshot(),
        }

    @staticmethod
    def _evaluate_aircraft(prev_lat, prev_lng, lat, lng, heading_deg, speed_mps, turn_rate_deg_s, zones):
        """Requirements 3.3-3.6, 4.7-4.11: breach against ALL zones (a fast
        mover could tunnel through any of them), nearest-N by boundary
        distance for TTE/proximity display, TTE walked along the turn-rate-
        aware predicted path (not a naive straight-line ray) so TTE and the
        rendered predicted path always agree, threat level derived from both."""
        curr_xy = geometry.project(lat, lng)
        predicted_path_xy = geometry.predicted_path_points(
            curr_xy, heading_deg, speed_mps, turn_rate_deg_s, HISTORY_WINDOW_SECONDS, PREDICTED_PATH_STEP_S
        )
        predicted_path = [geometry.unproject(p) for p in predicted_path_xy]

        if not zones:
            return 'normal', [], [], predicted_path

        prev_xy = geometry.project(prev_lat, prev_lng)

        breached_zone_ids = [
            z['id'] for z in zones if geometry.segment_breaches(z['polygon'], prev_xy, curr_xy)
        ]

        distances = [(z, geometry.distance_to_boundary_m(z['polygon'], curr_xy)) for z in zones]
        distances.sort(key=lambda pair: pair[1])
        nearest = distances[:NEAREST_ZONES_COUNT]

        nearest_zones = []
        min_tte = None
        for zone, distance_m in nearest:
            tte = geometry.time_to_entry_along_path(zone['polygon'], predicted_path_xy, speed_mps, PREDICTED_PATH_STEP_S)
            nearest_zones.append({'zone_id': zone['id'], 'distance_m': distance_m, 'tte_seconds': tte})
            if tte is not None and (min_tte is None or tte < min_tte):
                min_tte = tte

        if breached_zone_ids:
            threat_level = 'critical'
        elif min_tte is not None and min_tte <= WARNING_TTE_SECONDS:
            threat_level = 'warning'
        else:
            threat_level = 'normal'

        return threat_level, nearest_zones, breached_zone_ids, predicted_path

    @staticmethod
    def _prune_history(history: deque, now: float) -> None:
        cutoff = now - HISTORY_WINDOW_SECONDS
        while history and history[0][0] < cutoff:
            history.popleft()

    def get_aircraft_detail(self, aircraft_id: str, trajectory_since: float | None = None) -> dict | None:
        """Backs the click-to-inspect info panel (requirement 4): historical
        trajectory, predicted path, TTE/distance/threat, gap-in-history and
        insufficient-history flags (requirements 4.4, 4.6).

        `trajectory_since` lets a polling client fetch only the trajectory
        points appended since its last poll instead of the full up-to-5-minute
        history every second; every other field is still returned in full
        since none of them are large enough to matter."""
        aircraft = self.aircraft.get(aircraft_id)
        if aircraft is None:
            return None

        history = list(aircraft.history)
        historical_trajectory = [
            {'timestamp': t, 'lat': lat, 'lng': lng}
            for t, lat, lng, _, _, _ in history
            if trajectory_since is None or t > trajectory_since
        ]
        has_gap = any(
            b[0] - a[0] > HISTORY_GAP_THRESHOLD_SECONDS for a, b in zip(history, history[1:])
        )

        return {
            'id': aircraft.id,
            'lat': aircraft.lat,
            'lng': aircraft.lng,
            'altitude_m': aircraft.altitude_m,
            'heading_deg': aircraft.heading_deg,
            'speed_mps': aircraft.speed_mps,
            'threat_level': aircraft.threat_level,
            'nearest_zones': aircraft.nearest_zones,
            'breached_zone_ids': aircraft.breached_zone_ids,
            'no_drone_available': aircraft.no_drone_available,
            'historical_trajectory': historical_trajectory,
            'predicted_path': [[lat, lng] for lat, lng in aircraft.predicted_path],
            'has_gap': has_gap,
            'insufficient_history': len(history) < MIN_HISTORY_FOR_TURN_RATE,
        }

    def get_drone_detail(self, drone_id: str) -> dict | None:
        """Backs the drone info panel (Extra-1): target description + intercept time."""
        DRONE_FLEET._ensure_initialized()
        drone = DRONE_FLEET.drones.get(drone_id)
        if drone is None:
            return None

        detail = drone.to_public_dict()
        target = self.aircraft.get(drone.target_aircraft_id) if drone.target_aircraft_id else None
        detail['target'] = target.to_public_dict() if target is not None else None
        return detail

    def snapshot(self) -> dict:
        return {
            'seq': self.sequence,
            'aircraft': [a.to_public_dict() for a in self.aircraft.values()],
            'drones': DRONE_FLEET.snapshot(),
        }

    def publish(self, event: dict) -> None:
        for queue in list(self.subscribers):
            queue.put_nowait(event)

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self.subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self.subscribers.discard(queue)


STATE = SimulationState()
