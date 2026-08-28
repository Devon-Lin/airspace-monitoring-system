# Map-Based Data Visualization

## Problem

Display publicly available data on a map interface in real-time with at
least one interactive tool or view (i.2. Allow the creation of
polygons/zones on the map that interact with the real-time data) and at
least one simulated asset (drone or vehicle movement).

### Required

1. Connect to a public API or create a telemetry generator to ingest at
   least 100+ concurrent real-time assets.
2. Implement a simulated autonomous drone that follows a user-defined
   patrol path. The drone must recalculate its heading and velocity in
   real-time to "shadow" the nearest public asset that enters a
   restricted zone.
3. Allow users to draw polygons (Restricted Zones). Calculate the
   Time-To-Entry (TTE) based on the asset's current vector.
4. When an asset is clicked, render its historical trajectory as a faded
   polyline. Project a "predicted path" based on its last 5 minutes of
   heading and velocity. It should also show an info panel with basic
   information about the asset, such as TTE, distance to nearest zones,
   and threat level.
5. Clients should sync in real-time. An example of this would be to have
   two browser tabs open. When a change is made to the first tab it
   should automatically be visible in the second tab. We are expecting
   some sort of syncing mechanism over a backend service.

### Extra

1. When an asset breaches a restricted zone, a drone is dispatched from
   the nearest airport to monitor on it. On the drone's details panel,
   there should be a description of the target asset as well as the
   intercept time.
2. Change asset symbology (colour/icon) based on threat level: Normal,
   Warning (Closing in), and Critical (Breached)

## System Requirements

### 1. Base Station & Simulation Area

1. The map is centered on a single base station (ingestion point) with a
   radius of 100km.
   1. This defines the simulation area.
2. Assume that if an aircraft leaves the circumference of the map the
   telemetry data is dropped.

### 2. Aircraft Telemetry Generator

1. Aircraft must have altitude less than 120m agl and greater than 30m
   agl.
2. Aircraft speed must also be greater than 150m/s and 280m/s, with
   maximum turn rate of 2deg/s.
3. There should be a mix of speeds, straight aircraft, turning aircraft.
4. Aircraft should be generated uniformly in the map region (random
   seed).
5. Each aircraft will ping at 5Hz -> 5 pings/s.
6. The system shall support at least 150 concurrent aircraft.

### 3. Restricted Zones

(Use a geospatial library for this)

1. The map shall allow the user to click points on the map to create a
   restricted zone (polygon).
2. Users shall add and remove restriction zones.
3. The trajectory segment of the aircraft shall determine breaches in the
   polygon.
4. An aircraft's trajectory shall be evaluated against multiple
   restricted zones.
5. Aircraft shall be evaluated (TTE) against the nearest restricted zones
   in their proximity (this should be tunable).
6. The system shall update the nearest zone when the trajectory causes
   another zone to become closer.

### 4. Trajectory and Predicted Path

1. The system shall retain historical position data of each aircraft
   (5min). This supports rendering of the trajectory.
2. The system shall update the trajectory on the map, and whenever new
   telemetry data is received.
3. Historical telemetry data (stale) older than 5min is dropped.
4. The system shall indicate if there is a gap in historical data when
   the asset is clicked.
5. The system shall indicate when the aircraft is in the restricted zone.
6. The system shall handle insufficient historical data.
7. The system shall account for changes in aircraft heading.
8. The system shall predict predicted path 5 minutes into the future.
9. Aircraft proximity to restricted zones shall use the zone's boundary.
10. If the aircraft is not predicted to intercept a detection zone (5
    min) then N/A is reported for TTE.
11. If aircraft is inside the restricted area then TTE is 0.

### 5. Simulated Autonomous Drone

1. The base station has 10 Drones.
2. The drone is dispatched from the base station in the center of the
   map.
3. The drone must fly towards a predicted interception point.
   1. Approach:
      1. Estimate target position.
      2. Calculate target distance.
      3. Estimate intercept time.
      4. Predict target position at the intercept time.
      5. Adjust drone heading.
      6. Move drone.
4. The drone will maintain a distance of 200m from the aircraft.
   1. Use a simple feedback loop.
5. Drone is dispatched when an airplane has breached the restricted zone
   (status -> Critical).
   1. Only one drone per breach, if no drone is available then indicate
      that no drone is available.

### 6. Client Synchronization

1. The system shall support 50 clients.
2. The system shall propagate changes made on one client to the others.
3. The system shall update clients without a page refresh.
4. The system shall synchronize the following across clients:
   1. Restricted zone creation/deletion.
   2. Aircraft telemetry/state.
   3. Threat level changes.
   4. Drone state changes and dispatch events.
5. The system shall resolve conflicts between concurrent modifications to
   the state.
   1. The backend is responsible for the authoritative state.

### 7. Delivery of Telemetry / Real-Time Client Communication

1. The system shall establish a persistent connection between clients and
   the backend to receive updates.
2. The system shall distribute updates to all connected clients without
   the need for the clients to poll the backend.
3. Order of events received by the clients shall be preserved.
4. The client shall attempt to reconnect when the connection fails and
   detect when the connection is lost.
5. When a client connects/reconnects the backend shall allow the client
   to obtain the state of all aircrafts.

### 8. UI / Visualization Requirements

**Aircraft visualization**

1. Aircraft shall be rendered using a plane/aircraft icon rather than a
   circular marker.
2. The aircraft icon shall rotate to reflect the aircraft's current
   heading.
3. The aircraft icon shall update its position and orientation whenever
   new aircraft state is received.
4. Aircraft symbology shall reflect threat level:
   1. Normal → standard aircraft appearance
   2. Warning → visually emphasized aircraft appearance
   3. Critical → highly emphasized aircraft appearance
5. Aircraft shall smoothly transition between received positions rather
   than appearing to teleport between updates.

**Live map visualization**

1. The map shall provide a clear visual distinction between aircraft,
   drones, restricted zones, historical trajectories, and predicted
   paths.
2. Restricted zones shall be visually prominent while remaining
   sufficiently transparent to see aircraft underneath them.
3. The currently selected aircraft shall be visually emphasized.
4. The map shall automatically update as aircraft, threats, and drones
   change without requiring a page refresh.

**Aircraft selection**

1. Clicking an aircraft shall select it and display its information
   panel.
2. The selected aircraft shall remain visually distinct from other
   aircraft.
3. The information panel shall display:
   1. Aircraft ID
   2. Current position
   3. Altitude
   4. Speed
   5. Heading
   6. Threat level
   7. TTE
   8. Distance to nearest restricted zone
   9. Historical trajectory
   10. Predicted path

**Historical and predicted paths**

1. The selected aircraft's historical trajectory shall be rendered as a
   faded polyline.
2. The predicted trajectory shall be visually distinguishable from the
   historical trajectory.
3. The predicted trajectory shall reflect the aircraft's current heading,
   velocity, and estimated turn rate.
4. Gaps in historical telemetry shall be visually indicated on the
   trajectory.

**Drone visualization**

1. Drones shall use a distinct aircraft/drone icon from the simulated
   aircraft.
2. Drone icons shall rotate according to their current heading.
3. Drone state shall be visually distinguishable between available,
   patrolling, intercepting, monitoring, and returning to base.
4. When a drone is dispatched, the UI shall provide a visible indication
   of the dispatch event.

**Restricted-zone interaction**

1. Users shall be able to visually distinguish between drawing a new zone
   and viewing existing zones.
2. Zone creation and deletion shall produce immediate visual feedback.
3. The currently selected/editing zone shall be visually emphasized.

**Simulation status**

1. The UI shall display high-level simulation information such as:
   1. Number of active aircraft
   2. Number of active restricted zones
   3. Number of available drones
   4. Number of aircraft in Warning state
   5. Number of aircraft in Critical state
2. The UI shall provide a visible indication that the telemetry stream is
   connected.
3. Connection loss shall be clearly indicated to the user.

**Real-time visual feedback**

1. Threat-level changes shall produce an immediate visual update to the
   affected aircraft.
2. Aircraft entering a restricted zone shall produce a visible breach
   indication.
3. Drone dispatches shall produce a visible event/notification.
4. Real-time updates shall not require the user to refresh the page.

## High Level Architecture: Component Responsibilities

**Aircraft Telemetry Generator**

- Generates 150+ aircraft.
- Generates telemetry at 5 Hz.
- Sends telemetry to the backend via HTTP POST.

**API Gateway**

- Routes requests.
- Performs authentication.
- Handles rate limiting.

**Backend (Django)**

- Telemetry ingestion.
- Restricted zone management.
- Aircraft queries.
- Threat evaluation.
- TTE calculation.
- Trajectory/predicted path processing.
- Drone dispatch.
- Maintains state.
- Publishes state changes to connected clients.

**PostgreSQL**

- Stores persistent/historical telemetry.
- Stores restricted zones.
- Stores aircraft and drone information/state where persistence is
  required.

**Cache**

- Stores current aircraft state.
- Stores current threats.
- Stores current velocity, heading, position, etc.
- Provides fast access to current state.

**Geospatial / Threat Processing**

- Restricted-zone intersection and proximity.
- TTE.
- Threat-level determination.
- Predicted trajectory calculations.

**Drone Management**

- Drone dispatch.
- Interception calculations.
- Drone navigation.
- 200m tracking/feedback loop.
- Drone state.

**Real-Time Event Stream**

- Distributes state changes to connected clients.
- Maintains event ordering.
- Supports client reconnection/state synchronization.

**React Frontend**

- Displays map and aircraft.
- Allows restricted-zone creation/deletion.
- Displays trajectories and predicted paths.
- Displays aircraft/drone information.
- Receives real-time updates.
