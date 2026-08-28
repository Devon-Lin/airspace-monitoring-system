import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { usePatrolPathStore } from '../state/patrolPathStore';

export function usePatrolPathLayer(map: L.Map | null) {
  const polygonRef = useRef<L.Polygon | null>(null);

  useEffect(() => {
    if (!map) return;
    return usePatrolPathStore.subscribe((state) => {
      polygonRef.current?.remove();
      polygonRef.current = null;
      if (!state.coordinates || state.coordinates.length < 2) return;
      polygonRef.current = L.polygon(state.coordinates, {
        color: '#2563eb',
        weight: 2,
        dashArray: '8 6',
        fill: false,
      }).addTo(map);
    });
  }, [map]);
}
