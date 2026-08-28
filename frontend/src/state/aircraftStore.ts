import { create } from 'zustand';

export type ThreatLevel = 'normal' | 'warning' | 'critical';

export interface NearestZone {
  zone_id: string;
  distance_m: number;
  tte_seconds: number | null;
}

export interface AircraftPublic {
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
}

interface AircraftStoreState {
  seq: number;
  aircraft: Map<string, AircraftPublic>;
  applySnapshot: (seq: number, aircraft: AircraftPublic[]) => void;
  applyTick: (seq: number, updated: AircraftPublic[], removed: string[]) => void;
}

export const useAircraftStore = create<AircraftStoreState>((set, get) => ({
  seq: 0,
  aircraft: new Map(),

  applySnapshot: (seq, aircraft) => {
    set({ seq, aircraft: new Map(aircraft.map((a) => [a.id, a])) });
  },

  applyTick: (seq, updated, removed) => {
    const current = get();
    if (seq <= current.seq) return; // stale or duplicate event, per reconnect protocol
    const next = new Map(current.aircraft);
    for (const a of updated) next.set(a.id, a);
    for (const id of removed) next.delete(id);
    set({ seq, aircraft: next });
  },
}));
