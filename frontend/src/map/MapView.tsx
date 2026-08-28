import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BASE_STATION, SIMULATION_RADIUS_METERS } from '../config';
import { useAircraftLayer } from './useAircraftLayer';
import { useZoneLayer } from './useZoneLayer';
import { useZoneDrawing } from './useZoneDrawing';
import { useSelectedAircraftLayer } from './useSelectedAircraftLayer';
import { useSelectionRingLayer } from './useSelectionRingLayer';
import { useDroneLayer } from './useDroneLayer';
import { usePatrolPathLayer } from './usePatrolPathLayer';
import { usePatrolPathDrawing } from './usePatrolPathDrawing';
import { InfoPanel } from '../ui/InfoPanel';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { StatusDashboard } from '../ui/StatusDashboard';
import { buttonStyle, panelStyle, theme } from '../ui/theme';

export function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [map, setMap] = useState<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const instance = L.map(containerRef.current, {
      preferCanvas: true,
      center: [BASE_STATION.lat, BASE_STATION.lng],
      zoom: 8,
      zoomControl: false,
    });
    mapRef.current = instance;
    setMap(instance);

    // Default zoom control lives top-left, which collides with the info
    // panel — move it to the bottom-left corner instead.
    L.control.zoom({ position: 'bottomleft' }).addTo(instance);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(instance);

    L.marker([BASE_STATION.lat, BASE_STATION.lng]).addTo(instance).bindPopup('Base Station');

    const boundaryCircle = L.circle([BASE_STATION.lat, BASE_STATION.lng], {
      radius: SIMULATION_RADIUS_METERS,
      color: '#2563eb',
      weight: 2,
      fill: false,
      dashArray: '6 6',
    }).addTo(instance);

    instance.fitBounds(boundaryCircle.getBounds());

    // Deliberately no cleanup here: MapView is the app's single persistent
    // view and never legitimately unmounts mid-session. Tearing the map down
    // on cleanup only exists to satisfy React StrictMode's dev-only
    // mount->unmount->remount simulation, but Leaflet's canvas renderer can
    // have a redraw already scheduled (via requestAnimationFrame) when
    // `instance.remove()` runs, which then fires against a torn-down
    // context and throws. Guarding creation on `mapRef.current` (above) is
    // enough to make the double-invoke a no-op safely.
  }, []);

  useAircraftLayer(map);
  useZoneLayer(map);
  useSelectedAircraftLayer(map);
  useSelectionRingLayer(map);
  useDroneLayer(map);
  usePatrolPathLayer(map);

  const zoneDrawing = useZoneDrawing(map);
  const patrolDrawing = usePatrolPathDrawing(map);

  const drawingHintStyle = { ...panelStyle, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10 };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ConnectionBanner />
      <div
        style={{
          position: 'absolute',
          top: 10,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 900,
          ...panelStyle,
          padding: '6px 20px',
          fontSize: 15,
          fontWeight: 600,
          letterSpacing: 1,
          color: theme.text,
        }}
      >
        AIRSPACE MONITOR
      </div>
      <InfoPanel />
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000 }}>
        <StatusDashboard />
      </div>
      <div style={{ position: 'absolute', bottom: 16, right: 10, zIndex: 1000, display: 'flex', gap: 8 }}>
        {zoneDrawing.isDrawing ? (
          <div style={drawingHintStyle}>
            <span style={{ fontSize: 13 }}>Click to add zone points, double-click (or click the first point) to finish (min 3)</span>
            <button onClick={zoneDrawing.cancelDrawing} style={buttonStyle}>
              Cancel
            </button>
          </div>
        ) : patrolDrawing.isDrawing ? (
          <div style={drawingHintStyle}>
            <span style={{ fontSize: 13 }}>Click to add patrol points, double-click (or click the first point) to finish (min 3)</span>
            <button onClick={patrolDrawing.cancelDrawing} style={buttonStyle}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <button onClick={zoneDrawing.startDrawing} style={buttonStyle}>
              Draw Restricted Zone
            </button>
            <button onClick={patrolDrawing.startDrawing} style={buttonStyle}>
              Draw Patrol Path
            </button>
          </>
        )}
      </div>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
