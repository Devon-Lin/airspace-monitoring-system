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

    const clearAll = () => {
      historyLinesRef.current.forEach((line) => line.remove());
      historyLinesRef.current = [];
      gapMarkersRef.current.forEach((marker) => marker.remove());
      gapMarkersRef.current = [];
      predictedLineRef.current?.remove();
      predictedLineRef.current = null;
    };

    return useSelectionStore.subscribe((state) => {
      if (!state.selection || state.selection.kind !== 'aircraft' || !state.selection.detail) {
        clearAll();
        return;
      }
      const trajectory = state.selection.detail.historical_trajectory;

      // Split into gap-free segments first (cheap: just grouping points),
      // then reuse existing polyline objects via setLatLngs rather than
      // destroying and recreating them every poll — with up to ~1500 points
      // in the trajectory, a full remove+recreate every ~1s while an
      // aircraft is selected was a real, measured CPU cost.
      const segments: [number, number][][] = [];
      const gapMidpoints: [number, number][] = [];
      let segment: [number, number][] = [];
      for (let i = 0; i < trajectory.length; i++) {
        const point = trajectory[i];
        const previous = trajectory[i - 1];
        if (previous && point.timestamp - previous.timestamp > GAP_THRESHOLD_S) {
          if (segment.length > 1) segments.push(segment);
          gapMidpoints.push([(previous.lat + point.lat) / 2, (previous.lng + point.lng) / 2]);
          segment = [];
        }
        segment.push([point.lat, point.lng]);
      }
      if (segment.length > 1) segments.push(segment);

      segments.forEach((points, i) => {
        const existing = historyLinesRef.current[i];
        if (existing) {
          existing.setLatLngs(points);
        } else {
          historyLinesRef.current[i] = L.polyline(points, { color: '#38bdf8', weight: 3, opacity: 0.4 }).addTo(map);
        }
      });
      while (historyLinesRef.current.length > segments.length) {
        historyLinesRef.current.pop()?.remove();
      }

      // Gaps are rare (usually zero, occasionally one) — a full rebuild here
      // isn't worth the extra bookkeeping the trajectory lines needed above.
      gapMarkersRef.current.forEach((marker) => marker.remove());
      gapMarkersRef.current = gapMidpoints.map((point) =>
        L.marker(point, {
          icon: L.divIcon({ className: 'map-entity-icon', html: `<div class="gap-marker">⚠</div>`, iconSize: [16, 16], iconAnchor: [8, 8] }),
          interactive: false,
        }).addTo(map)
      );

      const predictedPath = state.selection.detail.predicted_path;
      if (predictedPath.length > 1) {
        if (predictedLineRef.current) {
          predictedLineRef.current.setLatLngs(predictedPath);
        } else {
          predictedLineRef.current = L.polyline(predictedPath, {
            color: '#a78bfa',
            weight: 2,
            dashArray: '6 6',
            opacity: 0.85,
          }).addTo(map);
        }
      } else {
        predictedLineRef.current?.remove();
        predictedLineRef.current = null;
      }
    });
  }, [map]);
}
