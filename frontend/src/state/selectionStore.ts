import { create } from 'zustand';
import { API_BASE_URL, HISTORY_WINDOW_SECONDS } from '../config';
import type { NearestZone, ThreatLevel } from './aircraftStore';

export interface AircraftDetail {
  id: string;
  lat: number;
  lng: number;
  altitude_m: number;
  heading_deg: number;
  speed_mps: number;
  threat_level: ThreatLevel;
  nearest_zones: NearestZone[];
  breached_zone_ids: string[];
  no_drone_available: boolean;
  historical_trajectory: { timestamp: number; lat: number; lng: number }[];
  predicted_path: [number, number][];
  has_gap: boolean;
  insufficient_history: boolean;
}

export type DroneStatus = 'patrol' | 'intercept' | 'monitor' | 'returning';

export interface DroneDetail {
  id: string;
  lat: number;
  lng: number;
  heading_deg: number;
  speed_mps: number;
  status: DroneStatus;
  target_aircraft_id: string | null;
  intercept_time_estimate: number | null;
  target: {
    id: string;
    lat: number;
    lng: number;
    altitude_m: number;
    heading_deg: number;
    speed_mps: number;
    threat_level: ThreatLevel;
  } | null;
}

type Selection =
  | { kind: 'aircraft'; id: string; detail: AircraftDetail | null }
  | { kind: 'drone'; id: string; detail: DroneDetail | null }
  | null;

interface SelectionState {
  selection: Selection;
  selectAircraft: (id: string) => void;
  selectDrone: (id: string) => void;
  clear: () => void;
}

let pollHandle: ReturnType<typeof setInterval> | null = null;

async function fetchJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.json();
}

/** Merges a page of newly-fetched trajectory points onto what's already
 * displayed, then drops anything older than the retention window (mirroring
 * the backend's own pruning) — polling only ever hands us points appended
 * since the last request, never a signal for points the backend aged out. */
function mergeTrajectory(
  existing: AircraftDetail['historical_trajectory'],
  incoming: AircraftDetail['historical_trajectory']
): AircraftDetail['historical_trajectory'] {
  const merged = incoming.length > 0 ? [...existing, ...incoming] : existing;
  if (merged.length === 0) return merged;
  const cutoff = merged[merged.length - 1].timestamp - HISTORY_WINDOW_SECONDS;
  return merged.filter((p) => p.timestamp > cutoff);
}

function startPolling(get: () => SelectionState, set: (s: Partial<SelectionState>) => void) {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = setInterval(() => {
    const current = get().selection;
    if (!current) return;
    if (current.kind === 'aircraft') {
      const previousTrajectory = current.detail?.historical_trajectory ?? [];
      const since = previousTrajectory.length > 0 ? previousTrajectory[previousTrajectory.length - 1].timestamp : undefined;
      const url = since
        ? `${API_BASE_URL}/aircraft/${current.id}/?trajectory_since=${since}`
        : `${API_BASE_URL}/aircraft/${current.id}/`;
      fetchJson<AircraftDetail>(url).then((detail) => {
        const s = get().selection;
        if (!detail || !s || s.kind !== 'aircraft' || s.id !== current.id) return;
        const historical_trajectory = mergeTrajectory(previousTrajectory, detail.historical_trajectory);
        set({ selection: { ...s, detail: { ...detail, historical_trajectory } } });
      });
    } else {
      fetchJson<DroneDetail>(`${API_BASE_URL}/drones/${current.id}/`).then((detail) => {
        const s = get().selection;
        if (s && s.kind === 'drone' && s.id === current.id) set({ selection: { ...s, detail } });
      });
    }
  }, 1000);
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selection: null,

  selectAircraft: (id) => {
    set({ selection: { kind: 'aircraft', id, detail: null } });
    fetchJson<AircraftDetail>(`${API_BASE_URL}/aircraft/${id}/`).then((detail) => {
      const s = get().selection;
      if (s && s.kind === 'aircraft' && s.id === id) set({ selection: { ...s, detail } });
    });
    startPolling(get, set);
  },

  selectDrone: (id) => {
    set({ selection: { kind: 'drone', id, detail: null } });
    fetchJson<DroneDetail>(`${API_BASE_URL}/drones/${id}/`).then((detail) => {
      const s = get().selection;
      if (s && s.kind === 'drone' && s.id === id) set({ selection: { ...s, detail } });
    });
    startPolling(get, set);
  },

  clear: () => {
    if (pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
    set({ selection: null });
  },
}));
