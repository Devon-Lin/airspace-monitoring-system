import L from 'leaflet';

const AIRCRAFT_SVG = `
<svg viewBox="0 0 24 24" width="20" height="20">
  <path d="M12 1.5 L18 20 L12 16.5 L6 20 Z" fill="currentColor" stroke="rgba(0,0,0,0.5)" stroke-width="0.75"/>
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

/** Applies heading rotation (and optional selection emphasis) to a marker's
 * icon element directly, avoiding an icon rebuild on every tick. */
export function applyMarkerTransform(marker: L.Marker, headingDeg: number, selected = false): void {
  const element = marker.getElement()?.querySelector<HTMLElement>('.rotator');
  if (!element) return;
  const scale = selected ? 1.6 : 1;
  element.style.transform = `rotate(${headingDeg}deg) scale(${scale})`;
  element.style.filter = selected ? 'drop-shadow(0 0 6px #fde047) drop-shadow(0 0 3px #fde047)' : 'none';
}
