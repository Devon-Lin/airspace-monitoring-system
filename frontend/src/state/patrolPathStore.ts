import { create } from 'zustand';

interface PatrolPathState {
  coordinates: [number, number][] | null;
  set: (coordinates: [number, number][] | null) => void;
}

export const usePatrolPathStore = create<PatrolPathState>((set) => ({
  coordinates: null,
  set: (coordinates) => set({ coordinates }),
}));
