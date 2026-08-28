import { create } from 'zustand';

export interface Zone {
  id: string;
  name: string;
  coordinates: [number, number][]; // [lat, lng]
}

interface ZoneStoreState {
  zones: Map<string, Zone>;
  applySnapshot: (zones: Zone[]) => void;
  addZone: (zone: Zone) => void;
  removeZone: (zoneId: string) => void;
}

export const useZoneStore = create<ZoneStoreState>((set, get) => ({
  zones: new Map(),

  applySnapshot: (zones) => {
    set({ zones: new Map(zones.map((z) => [z.id, z])) });
  },

  addZone: (zone) => {
    const next = new Map(get().zones);
    next.set(zone.id, zone);
    set({ zones: next });
  },

  removeZone: (zoneId) => {
    const next = new Map(get().zones);
    next.delete(zoneId);
    set({ zones: next });
  },
}));
