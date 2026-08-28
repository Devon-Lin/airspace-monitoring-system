import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useAircraftStore } from '../state/aircraftStore';
import { useSelectionStore } from '../state/selectionStore';

const RING_SIZE = 34;

const ringIcon = L.divIcon({
  className: 'map-entity-icon',
  html: `<div class="selection-ring"></div>`,
  iconSize: [RING_SIZE, RING_SIZE],
  iconAnchor: [RING_SIZE / 2, RING_SIZE / 2],
});

export function useSelectionRingLayer(map: L.Map | null) {
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!map) return;

    const update = () => {
      const selection = useSelectionStore.getState().selection;
      if (!selection || selection.kind !== 'aircraft') {
        markerRef.current?.remove();
        markerRef.current = null;
        return;
      }
      const aircraft = useAircraftStore.getState().aircraft.get(selection.id);
      if (!aircraft) {
        markerRef.current?.remove();
        markerRef.current = null;
        return;
      }
      if (!markerRef.current) {
        markerRef.current = L.marker([aircraft.lat, aircraft.lng], {
          icon: ringIcon,
          interactive: false,
        }).addTo(map);
      } else {
        markerRef.current.setLatLng([aircraft.lat, aircraft.lng]);
      }
    };

    const unsubscribeSelection = useSelectionStore.subscribe(update);
    const unsubscribeAircraft = useAircraftStore.subscribe(update);

    return () => {
      unsubscribeSelection();
      unsubscribeAircraft();
      markerRef.current?.remove();
      markerRef.current = null;
    };
  }, [map]);
}
