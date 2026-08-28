import L from 'leaflet';
import { applyMarkerTransform } from './icons';

const DURATION_MS = 200; // matches the backend's 200ms tick interval

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number) {
  let diff = ((b - a + 180) % 360) - 180;
  if (diff < -180) diff += 360;
  return (a + diff * t + 360) % 360;
}

interface Tracked {
  marker: L.Marker;
  fromLat: number;
  fromLng: number;
  fromHeading: number;
  toLat: number;
  toLng: number;
  toHeading: number;
  start: number;
  selected: boolean;
}

/**
 * A single shared requestAnimationFrame loop that smoothly interpolates
 * many markers' positions/headings between server ticks, rather than
 * snapping instantly on each update (Design Analysis §5.1/§7.2). Computing
 * "from" as wherever the marker is *currently interpolated to* (not the
 * previous raw target) means a new update arriving early or late never
 * causes a visible jump.
 */
class MarkerAnimator {
  private tracked = new Map<string, Tracked>();
  private frameHandle: number | null = null;

  update(id: string, marker: L.Marker, lat: number, lng: number, heading: number, selected: boolean) {
    const now = performance.now();
    const existing = this.tracked.get(id);
    let fromLat = lat;
    let fromLng = lng;
    let fromHeading = heading;
    if (existing) {
      const t = Math.min(1, (now - existing.start) / DURATION_MS);
      fromLat = lerp(existing.fromLat, existing.toLat, t);
      fromLng = lerp(existing.fromLng, existing.toLng, t);
      fromHeading = lerpAngle(existing.fromHeading, existing.toHeading, t);
    }
    this.tracked.set(id, {
      marker,
      fromLat,
      fromLng,
      fromHeading,
      toLat: lat,
      toLng: lng,
      toHeading: heading,
      start: now,
      selected,
    });
    this.ensureRunning();
  }

  setSelected(id: string, selected: boolean) {
    const entry = this.tracked.get(id);
    if (entry) entry.selected = selected;
  }

  remove(id: string) {
    this.tracked.delete(id);
  }

  private ensureRunning() {
    if (this.frameHandle !== null) return;
    const step = () => {
      const now = performance.now();
      this.tracked.forEach((entry) => {
        const t = Math.min(1, (now - entry.start) / DURATION_MS);
        const lat = lerp(entry.fromLat, entry.toLat, t);
        const lng = lerp(entry.fromLng, entry.toLng, t);
        const heading = lerpAngle(entry.fromHeading, entry.toHeading, t);
        entry.marker.setLatLng([lat, lng]);
        applyMarkerTransform(entry.marker, heading, entry.selected);
      });
      this.frameHandle = this.tracked.size > 0 ? requestAnimationFrame(step) : null;
    };
    this.frameHandle = requestAnimationFrame(step);
  }
}

export const aircraftAnimator = new MarkerAnimator();
export const droneAnimator = new MarkerAnimator();
