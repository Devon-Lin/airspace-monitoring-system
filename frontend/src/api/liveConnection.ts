import { API_BASE_URL } from '../config';
import { useAircraftStore, type AircraftPublic } from '../state/aircraftStore';
import { useZoneStore, type Zone } from '../state/zoneStore';
import { useDroneStore, type DronePublic } from '../state/droneStore';
import { usePatrolPathStore } from '../state/patrolPathStore';
import { useConnectionStore } from '../state/connectionStore';

type ServerEvent =
  | { seq: number; type: 'tick'; timestamp: number; updated: AircraftPublic[]; removed: string[]; drones: DronePublic[] }
  | { seq: number; type: 'zone_created'; zone: Zone }
  | { seq: number; type: 'zone_deleted'; zone_id: string }
  | { seq: number; type: 'patrol_path_updated'; coordinates: [number, number][] | null };

interface SnapshotResponse {
  seq: number;
  aircraft: AircraftPublic[];
  zones: Zone[];
  drones: DronePublic[];
  patrol_path: [number, number][] | null;
}

function applyEvent(event: ServerEvent) {
  switch (event.type) {
    case 'tick':
      useAircraftStore.getState().applyTick(event.seq, event.updated, event.removed);
      useDroneStore.getState().applyTick(event.drones);
      return;
    case 'zone_created':
      useZoneStore.getState().addZone(event.zone);
      return;
    case 'zone_deleted':
      useZoneStore.getState().removeZone(event.zone_id);
      return;
    case 'patrol_path_updated':
      usePatrolPathStore.getState().set(event.coordinates);
      return;
  }
}

/**
 * Subscribe-then-snapshot reconnect protocol (docs/Design Analysis.md §4.2):
 * open the stream first (buffering events), then fetch a snapshot, then
 * discard buffered events at or below the snapshot's sequence number and
 * apply the rest in order. EventSource's native auto-reconnect re-fires
 * `onopen`, which re-runs this same handshake after any drop.
 */
export function startLiveConnection(): () => void {
  // Bumped on every onopen (initial connect and every auto-reconnect) so a
  // fetch or retry left over from a previous connection cycle can detect
  // it's been superseded and no-op instead of racing the current cycle for
  // `buffered`/`snapshotApplied` — without this, a slow fetch from a stale
  // reconnect could resolve after a newer one and silently roll back state
  // applied since.
  let generation = 0;
  let snapshotApplied = false;
  let buffered: ServerEvent[] = [];

  const source = new EventSource(`${API_BASE_URL}/stream/`);

  const fetchSnapshotAndApply = (myGeneration: number) => {
    fetch(`${API_BASE_URL}/snapshot/`)
      .then((response) => {
        if (!response.ok) throw new Error(`snapshot fetch failed: ${response.status}`);
        return response.json();
      })
      .then((snapshot: SnapshotResponse) => {
        if (myGeneration !== generation) return; // superseded by a later reconnect
        useAircraftStore.getState().applySnapshot(snapshot.seq, snapshot.aircraft);
        useZoneStore.getState().applySnapshot(snapshot.zones);
        useDroneStore.getState().applySnapshot(snapshot.drones);
        usePatrolPathStore.getState().set(snapshot.patrol_path);
        for (const event of buffered) {
          if (event.seq > snapshot.seq) applyEvent(event);
        }
        buffered = [];
        snapshotApplied = true;
      })
      // The SSE connection can stay open even if this one fetch fails —
      // without a retry, snapshotApplied would never flip to true and every
      // subsequent tick event would buffer forever instead of applying.
      .catch(() => {
        if (myGeneration !== generation) return; // superseded by a later reconnect
        setTimeout(() => fetchSnapshotAndApply(myGeneration), 1000);
      });
  };

  source.onopen = () => {
    useConnectionStore.getState().setConnected(true);
    generation += 1;
    snapshotApplied = false;
    buffered = [];
    fetchSnapshotAndApply(generation);
  };

  // Requirement 7.4: detect when the connection is lost, not just silently
  // reconnect. EventSource retries on its own; this only surfaces that state.
  source.onerror = () => {
    useConnectionStore.getState().setConnected(false);
  };

  source.onmessage = (raw) => {
    const event: ServerEvent = JSON.parse(raw.data);
    if (!snapshotApplied) {
      buffered.push(event);
      return;
    }
    applyEvent(event);
  };

  return () => source.close();
}
