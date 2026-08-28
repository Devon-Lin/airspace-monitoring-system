import { create } from 'zustand';
import { API_BASE_URL } from '../config';
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

function startPolling(get: () => SelectionState, set: (s: Partial<SelectionState>) => void) {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = setInterval(() => {
    const current = get().selection;
    if (!current) return;
    if (current.kind === 'aircraft') {
      fetchJson<AircraftDetail>(`${API_BASE_URL}/aircraft/${current.id}/`).then((detail) => {
        const s = get().selection;
        if (s && s.kind === 'aircraft' && s.id === current.id) set({ selection: { ...s, detail } });
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
