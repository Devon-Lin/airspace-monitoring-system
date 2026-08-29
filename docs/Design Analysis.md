# Design Analysis: Map-Based Data Visualization System

**Process note.** The original requirements (see `Original Design and
Requirements.md`) were drafted without AI assistance. They were then used
as the prompting material for this design process. The AI was used to
design the main system components. As the components were built, both the
components and the requirements were iterated on. The rest of this
document is the result of that process.

AI Model: Sonnet 5

Scope note: "Client Spec" below refers to the Problem/Required/Extra sections (given).
Everything from "System Requirements" onward is my own design. This document
reviews my design against the client spec, flags places where they diverge or
leave gaps, and lists the technical decisions that need to be locked before
implementation.

**Status: resolved.** §4 below (renamed "Decisions Log") records the outcome of
every item, walked through interactively. Sections 1–3 are kept as-is as the
reasoning trail behind those decisions.

---

## 1. Major System Components

Derived from my System Requirements + the two architecture diagrams.

| Component | Responsibility | Notes |
|---|---|---|
| **Aircraft Telemetry Generator** | Owns aircraft kinematics (position/heading/speed integration, turning behavior), batches telemetry for all aircraft every 200ms tick, POSTs to backend | External process, decoupled from backend. It is the source of truth for aircraft *physics*, backend is source of truth for aircraft *state as known to the system*. |
| **Backend (Django, single ASGI process)** | Ingestion, zone CRUD, threat evaluation, TTE, trajectory/prediction, drone dispatch, authoritative state, SSE fanout, API-key auth on ingest | One deployable service — no separate API Gateway or Cache process (see §4.3: dropped as unnecessary at this scale). This is really several sub-engines bundled together (see below) — worth keeping them as separate modules even if deployed as one service. |
| ↳ In-memory state store | Current aircraft/threat/drone state, position/heading/velocity, 5-min rolling history | Plain Python state (dict/dataclasses) guarded by the asyncio event loop — no Redis. Single process, so no cross-process sharing problem to solve. |
| ↳ Geospatial/Threat Engine | Zone intersection, proximity/nearest-zone tracking, TTE, threat-level classification | Needs spatial indexing at 150 aircraft × N zones scale. |
| ↳ Trajectory/Prediction Engine | Maintains 5-min rolling history, computes predicted path | Turn-rate-aware extrapolation (see §2.4, §4.1). |
| ↳ Drone Management | Dispatch policy, intercept math, navigation feedback loop, drone state | Runs inside the same tick loop as threat evaluation. |
| ↳ Simulation Tick Loop | asyncio task inside the Django ASGI process, runs every 200ms: recomputes TTE/threat/drone-nav for all aircraft, then emits one SSE diff event | See §3.2 / §4.1 — now a named, resolved component. |
| **PostgreSQL** | Persistent zones, and telemetry history mirroring the same 5-min window as in-memory state | Retention policy resolved — see §4.1. |
| **Real-Time Event Stream (SSE)** | Fanout to clients, event ordering (global sequence number), reconnect/resync support | Implemented as an in-process broadcaster (per-client asyncio queue) inside the same Django ASGI process — no external pub/sub needed since there's only one process. |
| **React Frontend** | Map rendering (Leaflet + canvas), zone + patrol-path drawing, trajectories/predicted paths, info panels, live updates | Rendering strategy decided — see §4.1. |

---

## 2. Ambiguities, By Section

### 2.0 Top issue: the patrol-path drone behavior appears to have been dropped

Client Required #2 (a **Required**, not Extra, item) asks for a drone that:
1. Follows a **user-defined patrol path** by default.
2. Recalculates heading/velocity to **shadow** the nearest asset that **enters a restricted zone**.

My System Requirements §5 only specifies: 10 drones idle at base, dispatched only
**on breach (Critical)**, fly an intercept, hold 200m. There is no patrol path, no
patrol-path drawing UI (my React Frontend component list only mentions
zone creation, not patrol-path creation), and no "shadow" behavior distinct from
the Extra-1 breach-dispatch behavior.

Two readings are possible:
- **(a)** I've deliberately merged Required-2 and Extra-1 into one behavior,
  reasoning that "enters a restricted zone" and "breaches" are the same event,
  so patrol path is either dropped or considered out-of-scope busywork before
  a drone is needed for anything.
- **(b)** This is a genuine gap — drones should idle/patrol along a user-drawn
  route near the base until a breach occurs, and that patrol path is a separate
  drawable feature (same UI paradigm as zones) that hasn't been designed yet.

This determines whether I need an entire additional frontend feature
(patrol-path drawing + persistence + patrol-flight simulation) or not. **This is
worth deciding explicitly rather than discovering mid-implementation.**

Related, smaller simplification (probably fine, but should be stated
explicitly): Extra-1 says drones dispatch from "the nearest airport"
(implying multiple airports); my design collapses this to a single base
station, which is consistent with §1 ("single base station") — just note it's
an intentional scope reduction, not an oversight.

### 2.1 Base Station & Simulation Area
- **Coordinate system/projection unspecified.** At 100km radius, naive planar
  lat/lng math will introduce meaningful distance/area error. Need to pick:
  geodesic functions (e.g. Turf.js `distance`/`destination`) on the frontend,
  and on the backend either PostGIS `geography` type or a local projection
  (e.g. azimuthal equidistant centered on the base station) for TTE/breach math.
- **"Telemetry is dropped" when an aircraft exits the 100km circle** — dropped
  by whom? Options: (a) generator stops emitting for that aircraft, (b) backend
  actively evicts it from state and broadcasts a removal event, (c) both. Needs
  to be explicit, since the frontend needs to know when an aircraft disappears
  vs. is just stale.
- Base station lat/lng itself is arbitrary — fine, just needs to be picked and
  documented as a config constant.

### 2.2 Aircraft Telemetry Generator
- **Internal spec inconsistency worth flagging (not my doc, the client's):**
  altitude 30–120m AGL (drone-like) combined with speed 150–280 m/s (jet-like,
  540–1000 km/h) is physically odd. Doesn't block implementation, but worth a
  one-line note in my own doc that I'm implementing it as specified.
- **Count discrepancy:** client's Required says "100+", my System Requirements
  says "150". Treat 150 as authoritative (more specific, and it's the doc I
  authored to operationalize the ask). Just say so somewhere.
- **Ingest transport shape:** 150 aircraft × 5Hz = **750 telemetry messages/sec**.
  Is that 750 individual HTTP POSTs/sec, or does the generator batch multiple
  aircraft per POST at each tick (e.g. one POST every 200ms with an array of
  150 updates = 5 req/sec of larger payloads)? This is a real architecture
  decision, not a detail — it changes what the API Gateway/backend need to
  handle and is trivial to get wrong by not deciding.
- **"Uniform in the map region, random seed"** — uniform by area within the
  circle (not naively uniform in lat/lng, which clusters at the center) or
  uniform in lat/lng box then reject outside the circle? Also: is a fixed/
  configurable seed wanted for reproducible test runs? Recommend yes, expose
  it as a config param.
- **Who owns kinematics integration** — confirm explicitly that the generator
  simulates full flight (position update, turn-rate-bounded heading changes)
  and the backend only *consumes* telemetry, never recomputes aircraft motion.
  (My diagrams imply this but it's not stated in prose anywhere.)

### 2.3 Restricted Zones
- **Polygon completion UX** not specified: how does a user finish a polygon
  (double-click, explicit "done" button, minimum vertex count, auto-close)?
- **"Nearest N zones" is called out as tunable but no default/mechanism is
  given.** Needs a concrete config value (e.g., top-3 nearest) and a decision
  on what "nearest" means — centroid distance, boundary distance, or the zone
  actually on the aircraft's predicted path.
- **Recompute cost:** re-evaluating nearest-zone-per-aircraft every tick is
  O(aircraft × zones) without an index. At 150 aircraft this is fine for a
  handful of zones but will not scale gracefully if zone count grows — worth
  using a spatial index (PostGIS GiST, or an in-memory R-tree for the hot
  path) rather than brute force, decided now rather than retrofitted.
- **Zone deletion while referenced:** if a zone currently tracked as an
  aircraft's "nearest zone" (or one it has breached) is deleted, what happens
  to that aircraft's TTE/threat state? Needs an explicit cleanup rule.
- **Self-intersecting / degenerate polygons** (e.g. 2-point or self-crossing)
  — validate on creation or handle gracefully in breach math? Needs a rule.

### 2.4 Trajectory & Predicted Path
- **Storage split is unresolved.** Cache clearly holds current state; Postgres
  is said to hold "persistent/historical telemetry" — but is that the *same*
  5-minute rolling window (in which case why is it in two places?) or does
  Postgres retain history indefinitely as an audit log, separate from the
  5-min live window used for trajectory rendering? At 750 writes/sec, an
  unbounded Postgres history is ~65M rows/day — not impossible, but should be
  a deliberate choice, not a default. Recommend: Cache holds the 5-min rolling
  window (what trajectory rendering actually needs), Postgres either mirrors
  only that same window (simplifies retention: TTL/eviction identical) or is
  explicitly scoped as an audit trail with its own separate retention policy.
- **Predicted-path algorithm is not pinned down**, and this matters because
  two requirements pull in different directions:
  - Client spec (Required #4): predicted path "based on its last 5 minutes of
    heading and velocity."
  - My System Requirements #4.7–4.8: "account for changes in aircraft
    heading" + "predict 5 minutes into the future."
  A literal "current heading/velocity, extrapolated linearly" satisfies the
  client's Required wording but ignores turning aircraft (which the generator
  explicitly includes per §2.2.3). My own #4.7 suggests I intend something
  turn-aware. Recommend deciding explicitly: estimate a turn rate from the
  recent history (finite difference over the last few samples) and extrapolate
  a constant-turn-rate arc, falling back to a straight line when the estimated
  turn rate is near zero or history is insufficient (per #4.6).
- **TTE basis is similarly split**: client spec says TTE is "based on the
  asset's current vector" (implies straight-line), while my requirements
  imply consistency with the (possibly curved) predicted path. Recommend TTE
  be computed against whatever the predicted-path model produces, so TTE and
  the rendered predicted path are never contradictory to the user — but this
  should be a stated decision, not an accident of implementation order.
- **"Gap in historical data" is undefined** — what threshold of missing
  samples counts as a gap (e.g., missing an expected 200ms sample by more than
  Xms)? Needs a concrete rule to implement #4.4.

### 2.5 Simulated Autonomous Drone
- **Drone kinematics are unspecified anywhere** (max speed, turn rate). The
  client spec never gives drone performance numbers the way it does for
  aircraft. I'll need to pick values (and they should probably let the
  drone out-run/out-turn the aircraft it's meant to intercept and then loiter
  at 200m, or the intercept math in §5.3 can't converge).
- **Post-intercept "monitor" behavior is undefined.** After the 200m feedback
  loop engages, does the drone continuously re-track the moving aircraft
  indefinitely (a real pursuit/orbit, since "monitor" implies ongoing
  observation), or does it hold position at the intercept point? If it's
  continuous tracking, when/how does the drone ever return to base and become
  available again for the next breach? This directly affects whether the
  fleet of 10 can realistically service multiple breaches over a session.
- **Threat-level thresholds are never given numerically.** "Normal / Warning
  (closing in) / Critical (breached)" is qualitative only. Critical = inside a
  zone polygon is clear. Warning needs an explicit rule (e.g., TTE below some
  tunable threshold on a converging vector toward a zone). This rule is also
  what would gate the (possibly-dropped, see §2.0) patrol-shadow behavior, so
  resolving §2.0 and this point together makes sense.
- **Backpressure when no drone is available:** is "indicate no drone
  available" a one-time transient notification, or does the breach enter a
  pending queue that gets serviced once a drone frees up? Given only 10
  drones and no stated recycle time, this could realistically bind.

### 2.6 Client Synchronization
- **"Resolve conflicts" needs a concrete mechanism**, not just "backend is
  authoritative." Since aircraft/drone state is backend-computed (no client
  writes there), the only real write conflicts are on **zones** (e.g.
  delete-delete race, edit racing a delete). Recommend: all zone mutations go
  through the backend as a single serialization point (DB transaction per
  mutation), the backend always broadcasts the resulting canonical state back
  to *all* clients including the one that issued the mutation (no optimistic
  local-only state), and stale operations (e.g. delete of an already-deleted
  zone) become server-side no-ops rather than errors.
- **Auth scope is undefined.** API Gateway is said to "perform authentication"
  but no user/account model appears anywhere else. Worth explicitly scoping
  this down for a take-home (e.g., a static API key protecting the generator's
  ingest endpoint only, no end-user auth) rather than leaving it implied as a
  real multi-user auth system.

### 2.7 Real-Time Delivery
- **Transport not chosen.** My diagram lists "SSE / WebSockets / Fanout" as
  options, not a decision. Since clients only need server→client push for
  telemetry/threat/drone updates, and zone creation/deletion is naturally a
  separate client→server write, **SSE + REST** is simpler than standing up
  Django Channels for bidirectional WebSockets. This is my call to make,
  and it affects §3.2 below either way.
- **Event granularity.** Broadcasting every raw telemetry update to every
  client (750/sec × 50 clients = 37,500 sends/sec) is unnecessary. Recommend
  coalescing into periodic batched snapshots (e.g., one broadcast every 200ms
  containing all aircraft that changed) — decide this now, since it changes
  the shape of the "Real-Time Event Stream" component.
- **Ordering guarantee scope:** per-aircraft ordering, or a single global
  ordering across all event types (zone/aircraft/threat/drone)? Needs a
  sequence-number scheme either way.
- **Snapshot+stream race on (re)connect.** #7.5 requires that a
  connecting/reconnecting client can get full aircraft state. The classic bug
  here is: client fetches a snapshot, then subscribes to the stream, and
  misses events that happened in between (or double-applies events that
  happened just before the snapshot). Needs an explicit protocol, e.g.:
  subscribe to the stream first (buffering incoming events), then fetch a
  snapshot tagged with a sequence number, then discard/apply buffered events
  relative to that sequence number.

---

## 3. Cross-Cutting Risks

### 3.1 Throughput math (worth sanity-checking now, not during load testing)
- Ingest: 150 aircraft × 5Hz = **750 msgs/sec** into the backend.
- Live trajectory window: 5 min × 5Hz × 150 aircraft = **225,000 points** held
  in the rolling window at any time.
- Naive per-event fanout: 750/sec × 50 clients = **37,500 sends/sec** — almost
  certainly needs batching (see §2.7).
- Turn geometry sanity check: at max turn rate 2°/s and ~200 m/s, turn radius
  ≈ v/ω ≈ 5.7km. Restricted zones smaller than a few km may rarely be
  "enterable" by a turning aircraft in a natural-looking way — worth keeping
  in mind when choosing default zone sizes for testing/demo.
- Per-tick movement at max speed: 280 m/s × 0.2s ≈ 56m/tick. This validates
  my own requirement (§3.3, segment-based breach detection rather than
  point-sampling) — a point-in-polygon check per tick could tunnel through a
  thin zone, but segment-intersection (already specified) handles it correctly.

### 3.2 Missing "simulation tick" concept
Nothing in my component list owns *when* TTE/threat/drone-navigation
recompute happens. Two very different architectures satisfy the same
requirements text:
- **Event-driven:** recompute a given aircraft's TTE/threat whenever its own
  telemetry POST arrives (cadence naturally follows the generator, but 150
  independent async streams make global consistency and "nearest zone changed"
  cross-aircraft comparisons awkward).
- **Fixed-tick batch:** a scheduler (e.g. every 200ms) recomputes zone
  proximity/TTE/threat/drone-nav for all aircraft in one pass, decoupled from
  arrival timing.
The fixed-tick model is more predictable and is the standard approach for
this kind of simulation; recommend naming it as an explicit component
("Simulation Tick Loop") owned by the backend, separate from request handling.
This also directly determines whether Django needs to run as ASGI (async) with
a background task/worker, since a sync WSGI Django process can't cleanly run a
concurrent scheduler alongside handling 750 ingest requests/sec and holding 50
long-lived stream connections.

### 3.3 Frontend rendering at scale
150 aircraft + up to 10 drones + trajectories + predicted paths + zones,
updating at up to 5Hz (or my chosen broadcast batch rate), will likely
overwhelm default DOM/SVG marker rendering (e.g. plain Leaflet markers
re-rendered via React state). Recommend deciding now whether to use a
canvas/WebGL rendering layer (Leaflet's canvas renderer, or deck.gl/
react-map-gl) and whether the frontend interpolates smoothly between server
updates (client-side dead reckoning at 60fps) rather than snapping position
only on each received update.

---

## 4. Decisions Log (Resolved)

### 4.1 Decided interactively

- **Patrol path scope (§2.0):** In scope, as a distinct feature. Drones follow
  a **single, shared, user-drawn patrol route** near the base (same
  click-to-place-point interaction as zone drawing) while idle.
- **Drone trigger model:** **Single trigger, two phases.** "Entering a
  restricted zone" and "breaching" it are the same event (Critical). On
  breach, the nearest available drone (patrolling or at base) leaves patrol
  and enters an intercept+shadow phase: computes intercept time (§5.3), flies
  to intercept, then holds 200m via the feedback loop (§5.4). This single
  mechanic satisfies both Required-2's "shadow" wording and Extra-1's
  dispatch/intercept-time wording — no separate "closing in" shadow trigger
  before breach.
- **Drone recycle policy:** Once the target leaves the zone, leaves the map,
  or a max monitor duration elapses, the drone disengages, flies back to
  base, and re-enters the available pool. **Zone deletion also counts as an
  implicit disengage condition** for any drone whose mission was tied to that
  zone (see §4.2 zone-deletion cleanup below).
- **Real-time transport:** **SSE (server→client) + REST (client→server)**.
  Zone create/delete are REST POST/DELETE; everything else (telemetry,
  threat, drone state) is pushed via SSE. No WebSocket/Channels needed.
- **Postgres retention:** Mirrors the **same 5-minute rolling window** as the
  cache — no indefinite audit log. One retention/TTL policy, shared.
- **Telemetry ingest shape:** **Batched POST per tick.** The generator sends
  one POST every 200ms containing an array of all aircraft updates for that
  tick (5/sec of larger payloads, not 750/sec of tiny ones).
- **Predicted path model:** **Turn-rate-aware extrapolation.** Estimate
  current turn rate from the last few historical samples, extrapolate a
  constant-turn-rate arc; fall back to a straight line when turn rate ≈0 or
  history is insufficient. TTE is computed against this same predicted path,
  so TTE and the rendered path are never contradictory.
- **Warning threshold:** **TTE-based.** Warning fires when TTE to the nearest
  zone drops below a tunable threshold (default 60s) on a converging vector;
  Critical fires at actual breach (TTE=0); otherwise Normal.
- **Simulation tick loop:** **In-process async task inside the Django ASGI
  process** (Daphne/Uvicorn), sharing the same Redis-backed state as ingest
  and SSE. One deployable service, not a separate worker.
- **Map rendering:** **Leaflet + canvas renderer** (`L.canvas`). No external
  API key dependency; canvas renderer handles the expected marker count.
- **Auth scope:** **API key on the generator's ingest endpoint only.** No
  end-user login; all simulated clients connect anonymously.

### 4.2 Settled directly (mechanical/objective, not preference calls)

- **Projection/geodesic strategy:** All server-side distance/area/
  intersection math uses PostGIS `geography` type (meters-accurate) rather
  than planar lat/lng math. Frontend uses Turf.js geodesic functions
  (`distance`, `destination`, `booleanPointInPolygon`) so both sides agree on
  what "meters" means at this scale.
- **Uniform sampling:** Rejection sampling — generate points uniformly in the
  bounding box of the 100km circle, reject/retry any point outside the
  circle (geodesic distance from the base station). RNG seeded via a
  configurable constant (e.g. `SIMULATION_SEED`), defaulting to a fixed value
  for reproducible runs.
- **Nearest-N zones default:** N=3, exposed as a config constant
  (`NEAREST_ZONES_COUNT`). "Nearest" = geodesic distance from the aircraft's
  current position to the zone's **boundary** (per requirement 4.9), not its
  centroid.
- **Historical data gap threshold:** A gap is flagged when the interval
  between two consecutive stored samples for an aircraft exceeds 2× the
  expected tick interval (400ms at the 200ms tick rate).
- **Drone kinematics:** Max speed 320 m/s (above the aircraft's 280 m/s max,
  so intercept geometry always converges), max turn rate 6°/s (3× the
  aircraft's 2°/s cap). Both are config constants, tunable if intercepts
  don't converge cleanly in testing.
- **Reconnect/snapshot protocol:** Client opens the SSE connection first
  (buffering incoming events by sequence number), then calls a REST snapshot
  endpoint returning full current state tagged with a sequence number. Client
  discards buffered events at or below that sequence and applies the rest in
  order. Every event (telemetry batch, zone change, threat change, drone
  state change) carries one global monotonically increasing sequence number.
- **Backend→client broadcast granularity:** Aligned with the 200ms
  simulation tick — after each tick's recompute, one SSE event carries a diff
  of everything that changed (aircraft deltas, threat changes, drone state).
  Zone create/delete broadcast immediately as their own event, outside the
  tick cadence, since they're discrete user actions rather than continuous
  state.
- **Polygon completion UX:** Click to add vertices; double-click (or clicking
  the first vertex again) closes the polygon; minimum 3 vertices required;
  an in-progress polyline is shown while drawing.
- **Zone deletion cleanup:** Deleting a zone immediately drops it from every
  aircraft's nearest-zone tracking; threat level/TTE are recomputed against
  the remaining zones on the next tick. If an aircraft was Critical solely
  due to the deleted zone, it reverts based on remaining zones, and any drone
  whose mission was tied to that zone disengages per the recycle policy
  (§4.1).
- **Degenerate polygons:** Rejected at creation time (fewer than 3 vertices,
  or self-intersecting per Turf's kinks check), with a UI error rather than
  being persisted.

### 4.3 Infra simplification: Redis and nginx dropped

Both were part of the originally-diagrammed architecture (`Cache` and
`API Gateway` components) but turn out to be unnecessary given the decisions
in §4.1: the simulation tick loop, telemetry ingest, and SSE fanout all live
in **one Django ASGI process**, so there's no cross-process state-sharing
problem for Redis to solve, and no reverse-proxy/rate-limiting need beyond
what Django middleware can do directly. Decision: **drop both.**

- **Redis → in-memory state.** Current aircraft/threat/drone state and the
  5-min rolling history live in plain Python state inside the single process,
  guarded by the asyncio event loop. Redis would only earn its place back if
  the app ever ran multiple worker processes, needed state to survive a
  restart without a DB round-trip, or moved to Django Channels for
  WebSockets (which needs a channel layer to fan out across processes).
- **nginx → dropped.** The ASGI server (Uvicorn/Daphne) is run directly for
  local dev/demo; a PaaS would front it if deployed. The ingest endpoint's
  API-key check and any rate limiting are implemented as Django middleware
  instead of a separate gateway layer.
- Both tools are free/open-source to self-host either way (cost only appears
  with a managed hosted version, e.g. AWS ElastiCache or a paid nginx tier) —
  the decision here is about reducing moving parts for a time-boxed build,
  not cost.

---

## 5. UI / Visualization Requirements

Supplied after Phases 0–13 were already built and verified (see
`Execution Checklist.md`). Every item below was subsequently implemented
in the UI polish pass that followed (see §7); this section is kept as the
original requirement-by-requirement review, with each line's outcome noted.

### 5.1 Aircraft visualization
- Rendered as a plane icon rather than a circular marker. Done: a rotating
  SVG dart icon (`icons.ts`), colored by threat level.
- Icon rotates to reflect heading. Done, via direct DOM transform on the
  icon element rather than rebuilding the icon each tick.
- Position/orientation updates on new state. Done (updates every 200ms
  tick via SSE).
- Symbology reflects threat level (Normal/Warning/Critical). Done,
  color-coded (green/orange/red). Decided: color alone is sufficient, no
  additional visual weight needed.
- Smooth transition between positions, no teleporting. Initially done via
  a shared RAF interpolation loop across all markers (`markerAnimator.ts`).
  Later removed (see `Execution Checklist.md` Phase 15) once profiling
  showed the loop itself was a meaningful CPU cost on its own, moving
  ~160 markers 30x/second against the server's actual 5Hz update rate.
  Markers now snap directly to each server tick instead. Deliberate
  tradeoff: a small, largely imperceptible per-tick "hop" in exchange for
  removing the loop's cost entirely.

### 5.2 Live map visualization
- Clear visual distinction between aircraft, drones, zones, historical
  trajectories, predicted paths. Done. Aircraft use a dart icon, drones a
  distinct quadcopter icon, so the two no longer share ambiguous meaning
  even when both happen to show the same color.
- Restricted zones visually prominent but transparent enough to see
  aircraft underneath. Done (15% fill opacity, 2px border).
- Currently selected aircraft visually emphasized. Done. A pulsing
  selection ring plus the aircraft's own icon scaling up and glowing.
- Map auto-updates without refresh. Done (SSE push).

### 5.3 Aircraft selection
- Click to select plus info panel. Done.
- Selected aircraft remains visually distinct. Done, same as above.
- Info panel fields. Done for ID, position (lat/lng as text), threat
  level, altitude, speed, heading, TTE, distance to nearest zone(s).
  Historical trajectory and predicted path are rendered on the map rather
  than as panel text, which satisfies "display."

### 5.4 Historical and predicted paths
- Historical trajectory as faded polyline. Done.
- Predicted trajectory visually distinguishable. Done (dashed purple vs.
  solid faded blue).
- Predicted trajectory reflects heading/velocity/turn rate. Done
  (turn-rate-aware extrapolation, §4.1).
- Gaps in historical telemetry visually indicated on the trajectory. Done.
  The polyline splits into separate segments at a detected gap, with a
  marker placed at the break, rather than only a text warning in the info
  panel.

### 5.5 Drone visualization
- Distinct icon from simulated aircraft. Done. A quadcopter-style icon,
  colored by status.
- Icon rotates per heading. Done.
- Distinguishable state: available, patrolling, intercepting, monitoring,
  returning. Decided: "available" and "patrolling" are the same state
  here. A drone flying the shared patrol loop *is* the
  available-for-dispatch state, so the existing 4-state model already
  covers all 5 named states.
- Visible indication when dispatched. Decided: the status color change
  (patrol-blue to intercept-orange) at the next tick is sufficient.

### 5.6 Restricted-zone interaction
- Distinguish drawing a new zone from viewing existing ones. Done (dashed
  in-progress polyline plus vertex markers while drawing vs. solid filled
  polygons for existing zones).
- Immediate visual feedback on create/delete. Done (verified live in
  Phase 11 multi-client testing).
- Currently selected/editing zone visually emphasized. Decided: "editing"
  means the in-progress drawing state only, no zone-reshape feature is in
  scope. Done: the zone brightens (lighter fill, thicker border) while its
  popup is open.

### 5.7 Simulation status
- Dashboard showing active aircraft/zone/available-drone counts, Warning
  count, Critical count. Done (`StatusDashboard.tsx`).
- Visible indication the telemetry stream is connected. Done. A
  persistent LIVE/DISCONNECTED indicator in the dashboard, alongside the
  existing disconnect banner.
- Connection loss clearly indicated. Done (`ConnectionBanner.tsx`, added
  and verified in Phase 13).

### 5.8 Real-time visual feedback
- Threat-level changes produce immediate visual update. Done.
- Breach produces a visible indication. Done, as the threat-level color
  change. Decided: no separate transient notification needed.
- Drone dispatch produces a visible event/notification. Done, as the
  status color change. Decided: no separate transient notification
  needed.
- No refresh required. Done.

## 6. UI/Visualization Decisions

- **Threat emphasis:** color-coding alone (green/orange/red) satisfies
  "visually emphasized"/"highly emphasized" for Warning/Critical. No
  additional size/glow/pulse treatment.
- **Drone "available" state:** not a distinct state. A drone in the
  shared patrol loop *is* "available"; the implementation's 4-state model
  (patrol/intercept/monitor/returning) already covers all 5 named states.
- **Zone "editing":** means the in-progress drawing state only. No
  zone-reshape/edit-in-place feature is in scope.
- **Event notifications:** the color/state change at the moment of a
  breach or dispatch is the visible indication. No separate toast/banner
  system.

## 7. UI/Visualization Gaps: Resolved

The 8 gaps this pass originally surfaced were all closed in the UI polish
work that followed. Recorded here for the history, not as an open list:
1. Aircraft and drones rendered as rotating plane/drone icons instead of
   plain circles. This also resolved the aircraft/drone visual-distinction
   requirement in §5.2.
2. Smooth client-side position interpolation between ticks (no
   teleporting). Later replaced by direct per-tick snapping for
   performance; see §5.1 and `Execution Checklist.md` Phase 15.
3. A visual highlight on the currently-selected aircraft's own marker.
4. A visual marker on the historical trajectory polyline at the location
   of a detected gap.
5. A simulation status dashboard (aircraft/zone/drone/Warning/Critical
   counts).
6. A persistent positive "connected" indicator.
7. A lightweight highlight on a zone while its popup is open.
8. Current lat/lng shown as text in the aircraft info panel.
