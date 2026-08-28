import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { API_BASE_URL } from '../config';
import { isWithinSimulationRadius } from './simulationBounds';

const CLOSE_CLICK_THRESHOLD_PX = 12;
const MIN_VERTICES = 3;
const ERROR_DISPLAY_MS = 4000;

function postPatrolPath(coordinates: [number, number][], onError: (message: string) => void) {
  fetch(`${API_BASE_URL}/patrol-path/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates }),
  })
    .then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        onError(body.error ?? 'Failed to save patrol path.');
      }
    })
    .catch(() => onError('Failed to reach the server.'));
}

export function usePatrolPathDrawing(map: L.Map | null) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drawingRef = useRef(false);
  const pointsRef = useRef<L.LatLng[]>([]);
  const previewLineRef = useRef<L.Polyline | null>(null);
  const vertexLayerRef = useRef<L.LayerGroup | null>(null);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showError = (message: string) => {
    setError(message);
    if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
    errorTimeoutRef.current = setTimeout(() => setError(null), ERROR_DISPLAY_MS);
  };

  const clearPreview = () => {
    previewLineRef.current?.remove();
    previewLineRef.current = null;
    vertexLayerRef.current?.clearLayers();
    pointsRef.current = [];
  };

  const redrawPreview = () => {
    if (!map) return;
    const points = pointsRef.current;

    if (!previewLineRef.current) {
      previewLineRef.current = L.polyline(points, { color: '#2563eb', weight: 2, dashArray: '4 4' }).addTo(map);
    } else {
      previewLineRef.current.setLatLngs(points);
    }

    if (!vertexLayerRef.current) {
      vertexLayerRef.current = L.layerGroup().addTo(map);
    }
    vertexLayerRef.current.clearLayers();
    points.forEach((point, index) => {
      L.circleMarker(point, {
        radius: index === 0 ? 6 : 4,
        color: '#2563eb',
        fillColor: index === 0 ? '#fff' : '#2563eb',
        fillOpacity: 1,
        weight: 2,
      }).addTo(vertexLayerRef.current!);
    });
  };

  const finalize = () => {
    const points = pointsRef.current;
    if (points.length >= MIN_VERTICES) {
      postPatrolPath(points.map((p) => [p.lat, p.lng]), showError);
    }
    clearPreview();
    drawingRef.current = false;
    setIsDrawing(false);
  };

  const cancelDrawing = () => {
    clearPreview();
    drawingRef.current = false;
    setIsDrawing(false);
  };

  const startDrawing = () => {
    clearPreview();
    drawingRef.current = true;
    setIsDrawing(true);
  };

  useEffect(() => {
    if (!map) return;

    const isNearFirstPoint = (latlng: L.LatLng) => {
      const points = pointsRef.current;
      if (points.length < MIN_VERTICES) return false;
      const a = map.latLngToContainerPoint(latlng);
      const b = map.latLngToContainerPoint(points[0]);
      return a.distanceTo(b) <= CLOSE_CLICK_THRESHOLD_PX;
    };

    const handleClick = (e: L.LeafletMouseEvent) => {
      if (!drawingRef.current) return;
      if (isNearFirstPoint(e.latlng)) {
        finalize();
        return;
      }
      if (!isWithinSimulationRadius(e.latlng)) {
        showError('Patrol path points must be inside the simulation radius around the base station.');
        return;
      }
      pointsRef.current.push(e.latlng);
      redrawPreview();
    };

    const handleDblClick = () => {
      if (!drawingRef.current) return;
      pointsRef.current.pop();
      if (pointsRef.current.length >= MIN_VERTICES) {
        finalize();
      } else {
        redrawPreview();
      }
    };

    map.on('click', handleClick);
    map.on('dblclick', handleDblClick);
    return () => {
      map.off('click', handleClick);
      map.off('dblclick', handleDblClick);
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    if (isDrawing) {
      map.doubleClickZoom.disable();
    } else {
      map.doubleClickZoom.enable();
    }
  }, [map, isDrawing]);

  return { isDrawing, startDrawing, cancelDrawing, error };
}
