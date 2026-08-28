import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useSelectionStore } from '../state/selectionStore';

// Matches the backend's HISTORY_GAP_THRESHOLD_SECONDS (2x the 200ms tick).
const GAP_THRESHOLD_S = 0.4;

export function useSelectedAircraftLayer(map: L.Map | null) {
  const historyLinesRef = useRef<L.Polyline[]>([]);
  const gapMarkersRef = useRef<L.Marker[]>([]);
  const predictedLineRef = useRef<L.Polyline | null>(null);

  useEffect(() => {
    if (!map) return;

    return useSelectionStore.subscribe((state) => {
      historyLinesRef.current.forEach((line) => line.remove());
      historyLinesRef.current = [];
      gapMarkersRef.current.forEach((marker) => marker.remove());
      gapMarkersRef.current = [];
      predictedLineRef.current?.remove();
      predictedLineRef.current = null;

      if (!state.selection || state.selection.kind !== 'aircraft' || !state.selection.detail) return;
      const trajectory = state.selection.detail.historical_trajectory;

      // Split into separate polylines at each gap, so the break in coverage
      // is visible on the line itself, not just as text in the info panel.
      let segment: [number, number][] = [];
      const flushSegment = () => {
        if (segment.length > 1) {
          historyLinesRef.current.push(
            L.polyline(segment, { color: '#38bdf8', weight: 3, opacity: 0.4 }).addTo(map)
          );
        }
        segment = [];
      };

      for (let i = 0; i < trajectory.length; i++) {
        const point = trajectory[i];
        const previous = trajectory[i - 1];
        if (previous && point.timestamp - previous.timestamp > GAP_THRESHOLD_S) {
          flushSegment();
          const midLat = (previous.lat + point.lat) / 2;
          const midLng = (previous.lng + point.lng) / 2;
          gapMarkersRef.current.push(
            L.marker([midLat, midLng], {
              icon: L.divIcon({
                className: 'map-entity-icon',
                html: `<div class="gap-marker">⚠</div>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8],
              }),
              interactive: false,
            }).addTo(map)
          );
        }
        segment.push([point.lat, point.lng]);
      }
      flushSegment();

      const predictedPath = state.selection.detail.predicted_path;
      if (predictedPath.length > 1) {
        predictedLineRef.current = L.polyline(predictedPath, {
          color: '#a78bfa',
          weight: 2,
          dashArray: '6 6',
          opacity: 0.85,
        }).addTo(map);
      }
    });
  }, [map]);
}
