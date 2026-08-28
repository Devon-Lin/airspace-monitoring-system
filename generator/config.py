import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / '.env')

# All defaults below match the values used throughout development, so this
# runs correctly out of the box for a fresh clone with no .env file at all
# (matching backend/config/settings.py's approach).
INGEST_URL = os.environ.get('INGEST_URL', 'http://localhost:8000/api/ingest/')
INGEST_API_KEY = os.environ.get('INGEST_API_KEY', 'dev-ingest-key')

BASE_STATION_LAT = float(os.environ.get('BASE_STATION_LAT', '37.7749'))
BASE_STATION_LNG = float(os.environ.get('BASE_STATION_LNG', '-122.4194'))
SIMULATION_RADIUS_KM = float(os.environ.get('SIMULATION_RADIUS_KM', '100'))
SIMULATION_SEED = int(os.environ.get('SIMULATION_SEED', '42'))
AIRCRAFT_COUNT = int(os.environ.get('AIRCRAFT_COUNT', '150'))
TICK_INTERVAL_MS = int(os.environ.get('TICK_INTERVAL_MS', '200'))

ALTITUDE_MIN_M = float(os.environ.get('ALTITUDE_MIN_M', '30'))
ALTITUDE_MAX_M = float(os.environ.get('ALTITUDE_MAX_M', '120'))
SPEED_MIN_MPS = float(os.environ.get('SPEED_MIN_MPS', '150'))
SPEED_MAX_MPS = float(os.environ.get('SPEED_MAX_MPS', '280'))
MAX_TURN_RATE_DEG_S = float(os.environ.get('MAX_TURN_RATE_DEG_S', '2'))
STRAIGHT_FRACTION = float(os.environ.get('STRAIGHT_FRACTION', '0.4'))
