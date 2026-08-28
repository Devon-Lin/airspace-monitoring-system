import { create } from 'zustand';
import type { ThreatLevel } from './aircraftStore';

interface FilterState {
  visibleThreats: Set<ThreatLevel>;
  toggleThreat: (level: ThreatLevel) => void;
}

const ALL_THREATS: ThreatLevel[] = ['normal', 'warning', 'critical'];

export const useFilterStore = create<FilterState>((set, get) => ({
  visibleThreats: new Set(ALL_THREATS),
  toggleThreat: (level) => {
    const current = new Set(get().visibleThreats);
    if (current.has(level)) {
      current.delete(level);
    } else {
      current.add(level);
    }
    set({ visibleThreats: current });
  },
}));
