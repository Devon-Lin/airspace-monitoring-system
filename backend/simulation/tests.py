import math

from django.test import TestCase

from .geometry import validate_zone_coordinates
from .state import SimulationState
from .zones import ZoneCache


class FakePatrolCache:
    coordinates = None


VALID_SQUARE = [[37.76, -122.44], [37.79, -122.44], [37.79, -122.40], [37.76, -122.40]]
# A bowtie: edges 0-1 and 2-3 cross, self-intersecting.
SELF_INTERSECTING = [[37.76, -122.44], [37.79, -122.40], [37.79, -122.44], [37.76, -122.40]]


class ZoneValidationTests(TestCase):
    """Covers the "lines should not be allowed to cross" requirement, and
    that a clear error message reaches the caller instead of a bare 400."""

    def test_valid_polygon_accepted(self):
        self.assertIsNone(validate_zone_coordinates(VALID_SQUARE))

    def test_self_intersecting_polygon_rejected_with_message(self):
        error = validate_zone_coordinates(SELF_INTERSECTING)
        self.assertIsNotNone(error)
        self.assertIn('self-intersecting', error)

    def test_too_few_points_rejected_with_message(self):
        error = validate_zone_coordinates([[37.76, -122.44], [37.79, -122.40]])
        self.assertIsNotNone(error)
        self.assertIn('3 points', error)


class TrajectoryPollingTests(TestCase):
    """Covers the incremental trajectory fetch added to cut down the
    per-second info-panel payload: a client polling with `trajectory_since`
    should only get points appended after that timestamp, not the whole
    history again."""

    def setUp(self):
        self.state = SimulationState()
        self.zone_cache = ZoneCache()

    def _post_tick(self, lat, lng):
        self.state.apply_ingest_batch(
            [{'id': 'AC-1', 'lat': lat, 'lng': lng, 'altitude_m': 80.0, 'heading_deg': 90.0, 'speed_mps': 150.0}],
            [], self.zone_cache, FakePatrolCache(),
        )

    def test_full_fetch_returns_all_points(self):
        for i in range(5):
            self._post_tick(37.7749, -122.4194 + i * 0.001)
        detail = self.state.get_aircraft_detail('AC-1')
        self.assertEqual(len(detail['historical_trajectory']), 5)

    def test_incremental_fetch_returns_only_new_points(self):
        for i in range(5):
            self._post_tick(37.7749, -122.4194 + i * 0.001)
        full = self.state.get_aircraft_detail('AC-1')
        cutoff = full['historical_trajectory'][2]['timestamp']

        partial = self.state.get_aircraft_detail('AC-1', trajectory_since=cutoff)
        self.assertEqual(len(partial['historical_trajectory']), 2)
        self.assertTrue(all(p['timestamp'] > cutoff for p in partial['historical_trajectory']))

    def test_unknown_aircraft_returns_none(self):
        self.assertIsNone(self.state.get_aircraft_detail('does-not-exist'))


class DroneDispatchTargetTests(TestCase):
    """Covers the drone dispatch/intercept/monitor/target lifecycle: an
    aircraft that stays inside a restricted zone should pull in a drone and
    the drone's target should stay populated for the whole monitor phase,
    not just the moment of dispatch."""

    def setUp(self):
        from .drones import DRONE_FLEET

        # DRONE_FLEET is a module-level singleton (in-memory sim state, by
        # design — see Design Analysis.md §4.3), so it has to be reset by
        # hand between tests or dispatches from one test leak into the next.
        DRONE_FLEET.drones.clear()
        DRONE_FLEET.no_drone_available_ids = set()
        DRONE_FLEET._initialized = False

        self.state = SimulationState()
        self.zone_cache = ZoneCache()
        self.zone_cache.add('zone-1', 'Test Zone', VALID_SQUARE)

    def _loiter_tick(self, angle_deg):
        center_lat, center_lng = 37.775, -122.42
        radius_deg = 0.002
        lat = center_lat + radius_deg * math.sin(math.radians(angle_deg))
        lng = center_lng + radius_deg * math.cos(math.radians(angle_deg))
        heading = (angle_deg + 90) % 360
        return self.state.apply_ingest_batch(
            [{'id': 'AC-LOITER', 'lat': lat, 'lng': lng, 'altitude_m': 80.0, 'heading_deg': heading, 'speed_mps': 150.0}],
            [], self.zone_cache, FakePatrolCache(),
        )

    def test_drone_dispatches_and_reaches_monitor_with_target(self):
        from .drones import DRONE_FLEET

        reached_monitor = False
        for tick in range(150):
            self._loiter_tick(tick * 8.0)
            active = [d for d in DRONE_FLEET.drones.values() if d.status in ('intercept', 'monitor')]
            if active and active[0].status == 'monitor':
                reached_monitor = True
                drone = active[0]
                detail = self.state.get_drone_detail(drone.id)
                self.assertEqual(detail['target_aircraft_id'], 'AC-LOITER')
                self.assertIsNotNone(detail['target'])
                self.assertEqual(detail['target']['id'], 'AC-LOITER')
                break

        self.assertTrue(reached_monitor, 'drone never reached monitor status against a continuously-breaching aircraft')

    def test_drone_disengages_when_target_leaves_zone(self):
        from .drones import DRONE_FLEET

        for tick in range(150):
            self._loiter_tick(tick * 8.0)
            active = [d for d in DRONE_FLEET.drones.values() if d.status in ('intercept', 'monitor')]
            if active:
                break

        self.assertTrue(active, 'no drone was ever dispatched against the breaching aircraft')
        dispatched_id = active[0].id

        # Fly the aircraft far outside the zone; the drone should disengage.
        for _ in range(20):
            self.state.apply_ingest_batch(
                [{'id': 'AC-LOITER', 'lat': 34.0, 'lng': -118.0, 'altitude_m': 80.0, 'heading_deg': 90.0, 'speed_mps': 150.0}],
                [], self.zone_cache, FakePatrolCache(),
            )

        drone = DRONE_FLEET.drones[dispatched_id]
        self.assertIn(drone.status, ('returning', 'patrol'))
        self.assertIsNone(drone.target_aircraft_id)
