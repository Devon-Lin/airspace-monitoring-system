import { create } from 'zustand';
import type { DroneStatus } from './selectionStore';

export interface DronePublic {
  id: string;
  lat: number;
  lng: number;
  heading_deg: number;
  speed_mps: number;
  status: DroneStatus;
  target_aircraft_id: string | null;
  intercept_time_estimate: number | null;
}

interface DroneStoreState {
  drones: Map<string, DronePublic>;
  applySnapshot: (drones: DronePublic[]) => void;
  applyTick: (drones: DronePublic[]) => void;
}

export const useDroneStore = create<DroneStoreState>((set) => ({
  drones: new Map(),
  applySnapshot: (drones) => set({ drones: new Map(drones.map((d) => [d.id, d])) }),
  applyTick: (drones) => set({ drones: new Map(drones.map((d) => [d.id, d])) }),
}));
