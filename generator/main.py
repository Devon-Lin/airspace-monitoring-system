import itertools
import random
import time
from datetime import datetime, timezone

import requests

import config
from aircraft import spawn_aircraft

_tick_counter = itertools.count(1)


def build_fleet(rng: random.Random):
    return {a.id: a for a in (spawn_aircraft(rng) for _ in range(config.AIRCRAFT_COUNT))}


def run():
    rng = random.Random(config.SIMULATION_SEED)
    fleet = build_fleet(rng)
    session = requests.Session()
    dt_s = config.TICK_INTERVAL_MS / 1000.0
    radius_m = config.SIMULATION_RADIUS_KM * 1000

    print(
        f'Generator starting: {len(fleet)} aircraft, {config.TICK_INTERVAL_MS}ms tick, '
        f'posting to {config.INGEST_URL}'
    )

    next_tick = time.monotonic()
    while True:
        tick = next(_tick_counter)
        removed = []

        for aircraft in list(fleet.values()):
            aircraft.step(dt_s)
            if aircraft.distance_from_base_m() > radius_m:
                # Requirement: telemetry is dropped once an aircraft leaves
                # the simulation area. We actively evict + respawn to hold
                # the fleet at a steady 150 concurrent aircraft.
                removed.append(aircraft.id)
                del fleet[aircraft.id]

        for _ in removed:
            replacement = spawn_aircraft(rng)
            fleet[replacement.id] = replacement

        payload = {
            'tick': tick,
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'aircraft': [a.to_payload() for a in fleet.values()],
            'removed': removed,
        }

        try:
            response = session.post(
                config.INGEST_URL,
                json=payload,
                headers={'X-API-Key': config.INGEST_API_KEY},
                timeout=1.0,
            )
            if response.status_code != 200 and tick % 25 == 0:
                print(f'[tick {tick}] ingest returned {response.status_code}: {response.text[:200]}')
        except requests.RequestException as exc:
            if tick % 25 == 0:
                print(f'[tick {tick}] ingest unreachable: {exc}')

        next_tick += dt_s
        sleep_for = next_tick - time.monotonic()
        if sleep_for > 0:
            time.sleep(sleep_for)
        else:
            next_tick = time.monotonic()


if __name__ == '__main__':
    run()
