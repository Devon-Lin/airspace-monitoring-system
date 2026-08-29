# Map-Based Data Visualization

Real-time map visualization of simulated aircraft, restricted zones, and
autonomous drone response. See `docs/Design Analysis.md` for the full design
reasoning and `docs/Execution Checklist.md` for what was built and verified.
This README covers how to run it, the high-level architecture, and the
major design decisions.

For notes on the usage of AI (Sonnet 5), see the first section in `docs/Design Analysis.md`

## Architecture

- **Aircraft Telemetry Generator.** Owns aircraft kinematics (position,
  heading, speed integration, turning behavior). Batches telemetry for
  all aircraft every 200ms and POSTs it to the backend. A separate
  process from the backend.
- **Backend (Django, single ASGI process).** Ingests telemetry, evaluates
  threats, computes TTE, manages zones and drone dispatch, holds the
  authoritative state, and fans state changes out over SSE. Internally
  split into a few sub-engines, run as one deployable service:
  - In-memory state store: current aircraft/threat/drone state, 5-minute
    rolling history.
  - Geospatial/threat engine: zone intersection, proximity, TTE, threat
    classification.
  - Trajectory/prediction engine: turn-rate-aware predicted path.
  - Drone management: dispatch policy, intercept math, 200m hold loop.
  - Simulation tick loop: recomputes TTE/threat/drone-nav every 200ms and
    emits one SSE diff event.
- **Database.** Persists restricted zones and the patrol path. Postgres
  in local dev, SQLite in the single-machine production deploy.
- **Real-time event stream (SSE).** Fans state changes out to every
  connected client, with a global sequence number for ordering and
  reconnect/resync.
- **React frontend.** Leaflet map rendering, zone and patrol-path
  drawing, trajectories and predicted paths, info panels, live updates.

## Key design decisions

- **Single trigger, two phases for drones.** Entering a restricted zone
  and breaching it are the same event. On breach, the nearest available
  drone leaves patrol, flies an intercept course, then holds 200m via a
  feedback loop. One mechanic covers both the "shadow" and "dispatch"
  requirements.
- **Patrol path is a real, separate feature.** Drones follow a single,
  shared, user-drawn patrol route while idle, using the same
  click-to-place-point interaction as zone drawing.
- **Turn-rate-aware prediction, not a straight-line ray.** The predicted
  path estimates a turn rate from recent history and extrapolates an arc,
  falling back to a straight line when history is thin. TTE is computed
  against that same predicted path, so TTE and the rendered path can
  never contradict each other.
- **SSE for server to client, REST for client to server.** Telemetry,
  threat, and drone state push over SSE. Zone create/delete are plain
  REST calls. No WebSockets needed since the frontend never needs to
  push telemetry-like data back.
- **Everything in one process, no Redis cache, no separate API gateway.** The
  simulation tick loop, telemetry ingest, and SSE fanout all live inside
  one Django ASGI process. This is a deliberate simplification: it only
  works correctly with a single Uvicorn worker, since multiple workers
  would each hold their own separate copy of the in-memory state.
- **Drones recycle automatically.** A drone disengages and returns to
  base once its target leaves the zone, leaves the map, or a maximum
  monitor duration elapses, freeing it for the next breach.
- **Leaflet with the canvas renderer.** Handles 150 aircraft plus drones,
  trajectories, and zones updating at 5Hz without an external map API
  key.

See `docs/Design Analysis.md` for the full reasoning behind each of these,
including the ambiguities in the original spec that drove them.

## Running locally

Requires Docker, Python 3.11+, and Node.js 18+.

### 1. Database

```bash
docker compose up -d postgres
```

### 2. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
uvicorn config.asgi:application --port 8000
```

### 3. Telemetry generator (in a new terminal)

```bash
cd generator
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 main.py
```

### 4. Frontend (in a new terminal)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Aircraft should appear and start moving within
a few seconds.

No `.env` files are required for local dev. Every setting has a default
matching the values above. Use `.env` files only to override something (see
each service's config file for the full list of variables).

## Deployment

Visit https://linlabs.dev. 
Please use a maximum of 3 concurrent tabs. 
The droplet is not very powerful and is already under stress from the 150 aircraft simulation.
For more information see `docs/DEPLOYMENT.md`.
