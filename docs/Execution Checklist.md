# Execution Checklist

Tracks build progress against `Design Analysis.md`. Checked items are done and
verified working (server starts, migration applies, etc.) — not just written.

## Phase 0 — Environment & Scaffolding
- [x] git init + .gitignore
- [x] Top-level layout: `backend/`, `frontend/`, `generator/`, `docker-compose.yml`
- [x] Install Node.js (none present) via Homebrew
- [x] Postgres running via Docker Compose (plain `postgres`, no PostGIS — see note below)

## Phase 1 — Backend Skeleton
- [x] Django project (`config`) + `simulation` app, on ASGI (Uvicorn)
- [x] Postgres connection via psycopg3, `.env`-based settings
- [x] Health-check endpoint (`GET /api/health/`, verified via curl)
- [x] API-key guard for the ingest endpoint (`simulation/auth.py`, decorator — applied once the ingest view exists in Phase 6)

## Phase 2 — Frontend Skeleton
- [x] Vite + React + TypeScript scaffold
- [x] Leaflet installed, base map centered on base station + 100km radius circle (verified in-browser)
- [x] Basic project structure (map/, state/, api/, ui/) — all added as later phases needed them (`ui/` in place of the originally-planned `panels/`)

## Phase 3 — Database
- [x] Models: `RestrictedZone`, `PatrolPath`, `TelemetrySample` (5-min mirror)
- [x] Migrations applied against Docker Postgres
- [x] Zone polygons stored as coordinate JSON (not PostGIS geometry — see note)
- Note: no `DroneRecord` model — drone state is derived simulation state with
  no need to survive a backend restart, so it stays in-memory only (unlike
  zones/patrol path, which are user-created and should persist).

## Phase 4 — Telemetry Generator
- [x] Aircraft kinematics model (altitude/speed/turn-rate bounds, straight + turning mix) — bounds verified by script (30-120m alt, 150-280m/s speed, ±2deg/s turn rate)
- [x] Uniform-in-circle seeded sampling for initial placement (geodesic, via pyproj)
- [x] 200ms tick loop, batched POST of all aircraft to `/ingest`
- [x] Drop-at-boundary behavior (exits 100km circle) — evicts + respawns to hold steady-state count

## Phase 5 — Map
- [x] Render live aircraft positions (canvas renderer, `L.circleMarker` via `preferCanvas`) — verified in-browser with 150 live aircraft
- [x] Aircraft click → info panel shell — built out fully in Phase 8 (`InfoPanel.tsx`)
- [x] Base station + radius rendering finalized

## Phase 6 — State & Real-Time Sync
- [x] In-memory state store (aircraft registry) inside the ASGI process — drone registry deferred to Phase 10
- [x] Ingest endpoint updates state from generator batches (API-key guarded)
- [x] Recompute triggered by each ingest batch (tied to the generator's steady 200ms cadence rather than an independent timer — simpler, same effective cadence; revisit if drone-only recompute needs to run when ingest stalls)
- [x] SSE endpoint broadcasting per-tick diffs with global sequence numbers
- [x] REST snapshot endpoint + subscribe-then-snapshot reconnect protocol (client-side handshake in `liveConnection.ts`, reusing `EventSource`'s native auto-reconnect)
- [x] Frontend SSE client + zustand store applying diffs/snapshots
- [x] **Bug found + fixed:** aircraft state had no staleness eviction — only explicit boundary-exit removals cleared entries, so restarting the generator (new random IDs) left old aircraft stuck in state forever (150 + 150 = 300 observed). Added a 2-second (10-tick) staleness sweep in `state.py`.
- Constraint to remember: this only works correctly with **one Uvicorn worker** — multiple workers would each hold separate in-memory state.

## Phase 7 — Restricted Zones
- [x] Zone drawing UI (click vertices, close on double-click/first-vertex, min 3) — verified interactively in-browser
- [x] Zone CRUD REST endpoints + Postgres persistence
- [x] Zone create/delete broadcast (immediate, outside tick cadence)
- [x] Segment-vs-polygon breach detection (against all zones; via Shapely in a local AEQD projection, not PostGIS)
- [x] Nearest-N zones tracking (N=3 default, boundary distance) + zone-deletion cleanup (self-healing: nearest-zones/TTE recomputed fresh from the current zone set every tick, no stale references to clean up)
- [x] **Bug found + fixed:** zone DELETE removed the row from Postgres correctly but silently failed to clear the in-memory `ZONE_CACHE`, because the `<uuid:zone_id>` URL converter hands the view a `UUID` object while cache keys are strings — `dict.pop(uuid_obj, None)` no-ops instead of erroring. Deleted zones kept reappearing in `GET /api/zones/`. Fixed by casting to `str(zone_id)` immediately in the view.
- [x] **Bug found + fixed (same root cause, different symptom):** that stray `UUID` also broke the SSE stream — `json.dumps(event)` on a `zone_deleted` event raised `TypeError: Object of type UUID is not JSON serializable` *inside* the async generator, which Django's `StreamingHttpResponse.__aiter__` fallback path re-raised as a confusing unrelated `TypeError: 'async_generator' object is not iterable`. Same string-cast fix resolved it; added `default=str` to the stream's `json.dumps` as defense-in-depth against the next non-JSON-native field.

## Phase 8 — Trajectory & Prediction
- [x] 5-min rolling history per aircraft (in-memory only — **Postgres mirror deferred**: doesn't affect any live/visible requirement since the backend process isn't being restarted mid-demo; would add ~750 writes/sec of DB load for a restart-survival guarantee nothing currently needs. Add via bulk_create in a non-blocking task if this becomes a real requirement.)
- [x] Historical trajectory (faded polyline) rendering — verified in-browser
- [x] Turn-rate-aware predicted path (fallback to linear when history insufficient) — verified: a straight-ish aircraft predicted a near-straight path; a hard-turning aircraft's predicted path formed a loop, which is mathematically correct (2°/s max turn rate × 300s horizon = 600°, more than a full circle)
- [x] TTE computed against predicted path (0 inside zone, N/A beyond 5min horizon) — replaced the earlier straight-line-ray TTE from Phase 7 with a path-walking version so TTE and the rendered predicted path can never disagree
- [x] Gap-in-history detection + insufficient-history handling (400ms threshold = 2x tick interval)
- [x] Info panel: TTE, distance to nearest zones, threat level, gap/insufficient-history indicators, live-refreshing every 1s while an aircraft is selected — verified in-browser via exact pixel-targeted clicks (computed via `map.latLngToContainerPoint` against the live snapshot position, since aircraft move fast enough that screenshot-then-click coordinates routinely missed)

## Phase 9 — Threat Levels & Symbology
- [x] Normal/Warning/Critical classification (TTE-based threshold, 60s default) — built alongside Phase 7 since threat level is derived directly from TTE/breach; verified all three states occur via live snapshot (`{'normal': 111, 'warning': 2, 'critical': 37}` during testing)
- [x] Frontend color/icon changes per threat level (green/orange/red circle markers) — verified interactively in-browser

## Phase 10 — Simulated Drones
- [x] Patrol path drawing UI (single shared route, same click/close mechanic as zones, replaces any existing route)
- [x] Idle drones fly patrol loop — staggered evenly around the loop via a fixed per-drone offset fraction (bug caught in testing: without it, all 10 drones clumped at one point since they all started at distance 0)
- [x] Dispatch-on-breach: nearest available drone, intercept calc (estimate position → distance → intercept time → predicted position → heading → move, re-run every tick) — verified live: intercept_time_estimate counted down smoothly from 21s to 0 as a drone closed in
- [x] 200m feedback-loop hold once intercepted — verified transition into 'monitor' status with distance converging toward 200m
- [x] Disengage + return-to-base recycle policy (target leaves zone, disappears, or max monitor duration elapses; zone-deletion falls out of the same check for free since breached_zone_ids is recomputed fresh every tick) — verified full cycle: breach → intercept → target exits zone → returning → arrives at base → rejoins patrol
- [x] "No drone available" indication when fleet exhausted — verified via isolated test (12 simultaneous breaches against a fresh 10-drone fleet → exactly 10 dispatched, 2 correctly flagged `no_drone_available`)
- [x] Drone info panel (target description, intercept time) — `GET /api/drones/<id>/` includes embedded target aircraft detail

Verified in-browser: patrol path renders as a dashed loop with 10 evenly-spaced
blue markers; a live breach turned the nearest drone orange (intercept),
another visibly gray (returning) after a separate disengage, while the
breaching/warning aircraft showed red/orange — all four color states visible
simultaneously in one screenshot.

## Phase 11 — Multi-Client Validation
- [x] Two-tab sync test (zone create/delete, aircraft state, threat, drone events) — verified live: a zone created via one client appeared in both open tabs with no refresh, including the resulting drone dispatch; deleting it reverted both tabs identically
- [x] Reconnect test (kill/reopen SSE connection mid-session) — killed the backend mid-session, confirmed the frontend holds last-known state (doesn't blank out) while disconnected, then auto-reconnects and re-syncs cleanly once the backend returns
- [x] Concurrent zone mutation test (two tabs, same zone) — fired two simultaneous DELETE requests at the same zone; both returned 200 (Django's `.filter().delete()` is a no-op on an already-gone row, not an error), final state consistent, no crash
- [x] **Bug found + fixed:** the reconnect test surfaced a real console exception (`TypeError: Cannot read properties of undefined (reading 'clearRect')` in Leaflet's canvas renderer). Root cause: React StrictMode's dev-only mount→unmount→remount cycle was destroying and recreating the Leaflet map instance on every load, and the canvas renderer's already-scheduled redraw (via `requestAnimationFrame`) fired after teardown against a stale context. Fixed by not tearing down the map on effect cleanup at all — `MapView` is the app's single persistent view and never legitimately unmounts mid-session, so guarding creation on `mapRef.current` is sufficient to make StrictMode's double-invoke a safe no-op. Verified clean across multiple fresh reloads post-fix.

## Phase 12 — Scale/Perf Validation
- [x] Generator scaled to 150 aircraft sustained at 200ms tick — measured over an 18s window: avg tick interval 199.1ms (target 200ms), aircraft count held at exactly 150 the entire time
- [x] Several concurrent SSE clients open simultaneously without degradation — load-tested 50 concurrent SSE connections (requirement 6.1's target) for 8s: all 50 received exactly 40 events each (matching the 200ms cadence), zero errors, zero clients missing events, no errors in the backend log, aircraft/drone counts unaffected afterward
- [x] Frontend render stays smooth (canvas renderer doing its job) — confirmed qualitatively via repeated screenshots throughout Phases 5-11 (150 aircraft + 10 drones + zones rendering and updating without visual artifacts); no formal FPS profiling was run

## Phase 13 — Requirements Traceability Pass

Walked every line of the original spec against the running, tested system.

**Client spec — Required**
- [x] 1. Public API or telemetry generator, 100+ concurrent assets — 150, generator-driven
- [x] 2. Autonomous drone follows a user-defined patrol path, recalculates heading/velocity to shadow an asset entering a restricted zone — patrol path + breach-triggered intercept/shadow
- [x] 3. Draw polygons (restricted zones), TTE based on asset's vector — TTE upgraded to walk the turn-rate-aware predicted path rather than a raw straight-line vector (Phase 8 decision), a strictly more accurate superset of "based on current vector"
- [x] 4. Click asset → faded historical trajectory, predicted path, info panel (TTE, distance to nearest zones, threat level)
- [x] 5. Clients sync in real-time across tabs via a backend service — verified live in Phase 11

**Client spec — Extra**
- [x] 1. Drone dispatched from nearest airport on breach, panel shows target description + intercept time — collapsed "nearest airport" to the single base station per Design Analysis §2.0 (documented, deliberate)
- [x] 2. Asset symbology changes by threat level — color-only (spec says "colour/icon", either suffices)

**System Requirements**
- [x] 1.1-1.2 Single base station, 100km radius, telemetry dropped past the boundary
- [x] 2.1-2.6 Altitude/speed/turn-rate bounds, straight+turning mix, uniform seeded placement, 150 concurrent sustained — all bounds verified by script in Phase 4
- [x] 2.5 note: "each aircraft pings at 5Hz" is satisfied as a fleet-wide 5Hz batched POST (one request/tick covering all aircraft) rather than 750 individual requests/sec — a deliberate, documented architecture decision (Design Analysis §4.1), not a literal per-aircraft ping
- [x] 3.1-3.6 Zone draw/add/remove, segment-based multi-zone breach detection, nearest-N (tunable) TTE, self-healing nearest-zone recompute
- [x] 4.1-4.11 5-min history retention/pruning, gap/insufficient-history detection, turn-rate-aware prediction, boundary-based proximity, TTE=N/A beyond horizon, TTE=0 inside — all verified in Phase 8
- [x] 5.1-5.5 10-drone fleet, dispatch from base, literal estimate→distance→intercept-time→predicted-position→heading→move approach, 200m feedback loop, one-drone-per-breach with "no drone available" flagging — all verified in Phase 10
- [x] 6.1-6.5 50 concurrent clients (load-tested), zone/aircraft/threat/drone sync, no-poll push updates, conflict resolution (concurrent-delete race tested) — Phase 11-12
- [x] 7.1-7.3 Persistent connection (SSE), push-based updates, global sequence numbers preserving order
- [x] 7.4 Reconnect + **detect** lost connection — reconnect already worked; detection was missing a user-visible signal until this pass, now fixed with a connection-status banner (see below)
- [x] 7.5 Reconnect obtains full state — subscribe-then-snapshot protocol, verified in Phase 11

**Gap found and fixed during this pass:** requirement 7.4 asks the client to both reconnect *and* detect a lost connection. Reconnection worked (EventSource auto-retry, verified in Phase 11), but nothing surfaced the "detect" half to the user — a dropped connection was invisible. Added `connectionStore.ts` + a visible "Connection lost — reconnecting…" banner driven by `EventSource.onerror`/`onopen`. Verified live: killing the backend shows the banner within ~1s; restarting it clears the banner automatically.

**Noted, not changed (acceptable tradeoffs):**
- The per-selected-entity detail poll (1s interval in `selectionStore.ts`) is a narrow, deliberate exception to "no client polling" — it only covers the on-demand historical-trajectory/predicted-path/gap detail for whichever single aircraft or drone is currently selected, not the main telemetry feed (which is fully push-based for all 150 aircraft). Broadcasting full history+prediction for every aircraft every tick regardless of selection was explicitly ruled out as wasteful in Design Analysis §2.7.
- Base station lat/lng and simulation radius are duplicated across three separate `.env` files (backend, frontend, generator) with no single source of truth — currently consistent (verified), but nothing enforces that if one is edited without the others. Would be worth a shared config endpoint if this moves beyond a take-home.
- The Postgres telemetry-history mirror remains deferred (see Phase 8 note) — still doesn't affect any live/tested requirement.

---

**Note on Phase 0/3:** Design Analysis §4.2 called for "PostGIS geography type"
for accurate meters-based geometry. Implementing this, that's being simplified
further: plain Postgres (no PostGIS extension, no GeoDjango/GDAL dependency)
with zone polygons stored as coordinate JSON, and all real geometry math
(breach detection, TTE, distances) done in Python via Shapely + pyproj,
projecting to a local azimuthal-equidistant CRS centered on the base station
for accurate meters math. Same accuracy goal as the original PostGIS plan,
without the GDAL/PostGIS system-dependency footprint — consistent with the
Redis/nginx simplification already decided.

## Phase 14 — Post-Deployment Bug Fixes & UI Additions

Found and fixed after the app was live at linlabs.dev, driven by hands-on testing of the deployed site plus a few new requests.

- [x] **Bug found + fixed: base station icon broken in production only.** The base station used Leaflet's plain default marker icon. Leaflet auto-detects its own marker image path by scanning the page for a `<script src="leaflet.js">` tag, but Vite's production build bundles everything into one hashed file with no such tag, so the icon 404'd (this didn't show up in dev, where Vite's dev server happens to resolve it differently). Fixed by giving the base station a custom inline-SVG icon, consistent with how the aircraft and drone icons already work. Verified on the live site before and after: broken-image glyph replaced with a proper broadcast-tower icon.

- [x] **Feature: trimmed the per-second info-panel payload.** The selected-aircraft polling (`selectionStore.ts`, 1s interval) was re-fetching the full up-to-5-minute historical trajectory (up to 1,500 points) on every poll, even though only a handful of new points are appended per second. Added a `trajectory_since` query param to `GET /api/aircraft/<id>/`; the backend now returns only trajectory points newer than that timestamp, and the frontend merges them onto what it already has instead of replacing it, trimming to the same 5-minute window the backend uses. Verified live: a poll after a 2-second gap returned 11 new points instead of the 96-point full history.

- [x] **Feature: zone/patrol point validation against the simulation radius.** Clicking outside the 100km base-station radius while drawing a restricted zone or patrol path is now rejected client-side (no point added) with a visible message, instead of silently letting the point through.

- [x] **Feature: visible error messaging for rejected shapes.** The backend already rejected self-intersecting zone/patrol polygons (`geometry.validate_zone_coordinates`), but the rejection reason only ever reached the browser console. Both drawing hooks now surface the backend's error message (or the new radius error) as a banner near the drawing controls, auto-dismissing after a few seconds.

- [x] **Feature: aircraft status filter.** Added Normal/Warning/Critical checkboxes to the status panel, with live counts, that show/hide aircraft on the map by threat level.
  - **Bug found + fixed (caught before shipping):** the first version wired both the checkbox's `onChange` and the row `<div>`'s `onClick` to the same toggle, so a real click bubbled from the checkbox to the row and toggled the filter twice, canceling itself out. Fixed by wrapping the row in a `<label>` (native browsers toggle a nested checkbox exactly once per click, whichever part of the label is clicked). Verified via direct DOM click on the live site: aircraft correctly disappear/reappear on toggle.

- [x] **Bug found + fixed: intermittent "drone target not appearing in the info panel."** Backend logic was verified correct in isolation first (an automated test drives an aircraft to loiter inside a zone through a full dispatch → intercept → monitor cycle and asserts the target is present on every tick, see `simulation/tests.py`), which ruled out the drone/target computation itself. The real cause: Leaflet z-orders markers by latitude for a pseudo-3D "closer is in front" effect. A monitoring drone holds station within ~200m of its target aircraft, essentially on top of it on screen, so as both markers move, whichever one happens to sit marginally further south wins clicks at random. Sometimes that's the aircraft underneath, not the drone. Fixed by giving drone markers a dedicated Leaflet pane (`dronePane`, z-index 610, above the default marker pane's 600) so a drone always wins the click over any aircraft it's sitting on top of. Verified locally by forcing a monitor-state drone (synthetic loitering aircraft posted directly to a local backend) and confirming the drone's marker DOM element now lives in the higher pane.

- [x] **Automated backend tests added** (`backend/simulation/tests.py`, previously an empty stub): zone validation (valid polygon accepted, self-intersecting and too-few-points rejected with the right message), incremental trajectory fetch (`trajectory_since` returns only new points), and the drone dispatch/intercept/monitor lifecycle (target stays populated through monitor, disengages and clears target when the aircraft leaves the zone). All 8 pass (`python manage.py test simulation`).

- [x] **Local verification pass.** Ran the full stack locally (Postgres via Docker, backend, generator, frontend dev server) rather than trusting the production deploy alone. Found and killed two leftover background processes from earlier in this session that had never been stopped, a duplicate backend and generator, one of which had been silently running at ~99% CPU for roughly four hours. Confirmed a fresh single instance of each reports the expected 150 aircraft with no duplication.

All fixes deployed to https://linlabs.dev and verified live except where noted above as locally verified only.

## Phase 15 — Client-Side CPU Investigation

Live report: the deployed tab pinned the browser's renderer at 173% CPU. Fixed across four rounds:

- [x] `markerAnimator.ts` re-queried `.rotator` via the DOM on every animation frame for every marker instead of caching it. Cached per-marker, re-resolved only on icon swap.
- [x] Same loop rewrote `filter` every frame regardless of change, and ran at full display refresh rate instead of the data's 5Hz. Now only touches `filter` on an actual selection change, capped to 30fps.
- [x] `useSelectedAircraftLayer.ts` rebuilt the full trajectory polyline (up to ~1,500 points) from scratch on every 1s poll. Now reuses the polyline via `setLatLngs()`.
- [x] The pulsing selection ring combined `box-shadow` with an animated `transform: scale()`, forcing GPU repaint instead of compositing. Switched to `filter: drop-shadow`, found via a DevTools profile showing the JS main thread idle while CPU stayed high, pointing at GPU/compositor cost instead.

Note: this session's browser automation runs tabs as `hidden`, which suspends `requestAnimationFrame`, so the animation loop couldn't be verified live through it.
