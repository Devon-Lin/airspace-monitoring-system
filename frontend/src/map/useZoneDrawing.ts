import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { API_BASE_URL } from '../config';

const CLOSE_CLICK_THRESHOLD_PX = 12;
const MIN_VERTICES = 3;

function postZone(coordinates: [number, number][]) {
  fetch(`${API_BASE_URL}/zones/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates }),
  }).then(async (response) => {
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      console.error('Zone rejected:', body.error ?? response.statusText);
    }
  });
}

export function useZoneDrawing(map: L.Map | null) {
  const [isDrawing, setIsDrawing] = useState(false);
  const drawingRef = useRef(false);
  const pointsRef = useRef<L.LatLng[]>([]);
  const previewLineRef = useRef<L.Polyline | null>(null);
  const vertexLayerRef = useRef<L.LayerGroup | null>(null);

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
      previewLineRef.current = L.polyline(points, { color: '#dc2626', weight: 2, dashArray: '4 4' }).addTo(map);
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
        color: '#dc2626',
        fillColor: index === 0 ? '#fff' : '#dc2626',
        fillOpacity: 1,
        weight: 2,
      }).addTo(vertexLayerRef.current!);
    });
  };

  const finalize = () => {
    const points = pointsRef.current;
    if (points.length >= MIN_VERTICES) {
      postZone(points.map((p) => [p.lat, p.lng]));
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
      pointsRef.current.push(e.latlng);
      redrawPreview();
    };

    const handleDblClick = () => {
      if (!drawingRef.current) return;
      // Browsers fire click, click, dblclick — the second click already
      // added a point via handleClick; drop it before finalizing.
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

  return { isDrawing, startDrawing, cancelDrawing };
}
