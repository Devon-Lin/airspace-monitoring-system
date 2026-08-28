import L from 'leaflet';

// A drone monitoring a breach sits within ~200m of its target aircraft —
// visually right on top of it. Leaflet's default marker pane z-orders
// markers by latitude (for a pseudo-3D "closer is in front" effect), so
// without a dedicated pane, whichever of the two happens to sit marginally
// further south wins clicks at random as they both move — an intermittent,
// hard-to-reproduce "clicked the drone, got the aircraft" bug. Giving drones
// their own pane above the default marker pane makes them always win.
export const DRONE_PANE = 'dronePane';

const AIRCRAFT_SVG = `
<svg viewBox="0 0 24 24" width="20" height="20">
  <path d="M12 1.5 L18 20 L12 16.5 L6 20 Z" fill="currentColor" stroke="rgba(0,0,0,0.5)" stroke-width="0.75"/>
</svg>`;

const BASE_STATION_SVG = `
<svg viewBox="0 0 24 24" width="26" height="26">
  <path d="M12 2 L12 10" stroke="currentColor" stroke-width="2"/>
  <circle cx="12" cy="12" r="2.5" fill="currentColor"/>
  <path d="M7.5 8.5 a6.5 6.5 0 0 0 0 9" fill="none" stroke="currentColor" stroke-width="1.6"/>
  <path d="M16.5 8.5 a6.5 6.5 0 0 1 0 9" fill="none" stroke="currentColor" stroke-width="1.6"/>
  <path d="M9.5 10.5 a3 3 0 0 0 0 5" fill="none" stroke="currentColor" stroke-width="1.6"/>
  <path d="M14.5 10.5 a3 3 0 0 1 0 5" fill="none" stroke="currentColor" stroke-width="1.6"/>
</svg>`;

const DRONE_SVG = `
<svg viewBox="0 0 24 24" width="18" height="18">
  <line x1="12" y1="12" x2="4" y2="6" stroke="currentColor" stroke-width="2"/>
  <line x1="12" y1="12" x2="20" y2="6" stroke="currentColor" stroke-width="2"/>
  <line x1="12" y1="12" x2="4" y2="18" stroke="currentColor" stroke-width="2"/>
  <line x1="12" y1="12" x2="20" y2="18" stroke="currentColor" stroke-width="2"/>
  <circle cx="4" cy="6" r="2.4" fill="currentColor"/>
  <circle cx="20" cy="6" r="2.4" fill="currentColor"/>
  <circle cx="4" cy="18" r="2.4" fill="currentColor"/>
  <circle cx="20" cy="18" r="2.4" fill="currentColor"/>
  <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="rgba(0,0,0,0.5)" stroke-width="0.5"/>
  <path d="M12 8.5 L14 3.5 L10 3.5 Z" fill="currentColor"/>
</svg>`;

/** Builds a divIcon whose inner `.rotator` element can be rotated (and
 * scaled/highlighted) independently of Leaflet's own position transform on
 * the outer wrapper, via direct DOM manipulation on updates rather than
 * recreating the icon every tick. */
function buildIcon(svg: string, size: number, color: string, className: string): L.DivIcon {
  return L.divIcon({
    className: 'map-entity-icon',
    html: `<div class="${className}" style="color:${color}; width:${size}px; height:${size}px;">${svg}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function buildAircraftIcon(color: string): L.DivIcon {
  return buildIcon(AIRCRAFT_SVG, 20, color, 'rotator aircraft-icon');
}

export function buildDroneIcon(color: string): L.DivIcon {
  return buildIcon(DRONE_SVG, 18, color, 'rotator drone-icon');
}

export function buildBaseStationIcon(color: string): L.DivIcon {
  return buildIcon(BASE_STATION_SVG, 26, color, 'base-station-icon');
}

/** Applies heading rotation (and optional selection emphasis) to a marker's
 * icon element directly, avoiding an icon rebuild on every tick. */
export function applyMarkerTransform(marker: L.Marker, headingDeg: number, selected = false): void {
  const element = marker.getElement()?.querySelector<HTMLElement>('.rotator');
  if (!element) return;
  const scale = selected ? 1.6 : 1;
  element.style.transform = `rotate(${headingDeg}deg) scale(${scale})`;
  element.style.filter = selected ? 'drop-shadow(0 0 6px #fde047) drop-shadow(0 0 3px #fde047)' : 'none';
}
