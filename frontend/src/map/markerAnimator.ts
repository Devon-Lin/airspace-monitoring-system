import L from 'leaflet';
import { findRotatorElement, writeMarkerTransform, writeSelectionFilter } from './icons';

interface Tracked {
  marker: L.Marker;
  heading: number;
  selected: boolean;
  iconElement: HTMLElement | null;
  rotatorElement: HTMLElement | null;
}

/**
 * Applies each server update directly to a marker's position and heading,
 * rather than smoothly interpolating between ticks with a shared
 * requestAnimationFrame loop (the previous approach). Profiling showed that
 * loop was a meaningful CPU cost on its own, purely from moving ~160
 * markers 30x/second instead of the server's actual 5Hz update rate, even
 * after removing every redundant DOM query/style write inside it. Snapping
 * directly to each update trades a small, largely imperceptible per-tick
 * "hop" for removing the animation loop's cost entirely.
 */
class MarkerAnimator {
  private tracked = new Map<string, Tracked>();

  update(id: string, marker: L.Marker, lat: number, lng: number, heading: number, selected: boolean) {
    marker.setLatLng([lat, lng]);

    const existing = this.tracked.get(id);
    const currentIcon = marker.getElement() ?? null;
    let iconElement = existing?.iconElement ?? null;
    let rotatorElement = existing?.rotatorElement ?? null;
    let iconSwapped = false;
    // Leaflet's DivIcon reuses the same outer wrapper element across setIcon()
    // calls, replacing only its innerHTML (see DivIcon.createIcon) — so a
    // threat-level color change swaps out the inner `.rotator` node without
    // the outer element's identity ever changing. Checking isConnected
    // catches that case; the identity check alone would miss it and keep
    // writing headings to the now-detached old rotator forever.
    if (currentIcon !== iconElement || !rotatorElement?.isConnected) {
      iconElement = currentIcon;
      rotatorElement = findRotatorElement(marker);
      iconSwapped = true;
    }

    if (rotatorElement) {
      writeMarkerTransform(rotatorElement, heading, selected);
      if (iconSwapped || !existing || existing.selected !== selected) {
        writeSelectionFilter(rotatorElement, selected);
      }
    }

    this.tracked.set(id, { marker, heading, selected, iconElement, rotatorElement });
  }

  setSelected(id: string, selected: boolean) {
    const entry = this.tracked.get(id);
    if (!entry || entry.selected === selected) return;
    entry.selected = selected;
    if (entry.rotatorElement) {
      writeMarkerTransform(entry.rotatorElement, entry.heading, selected);
      writeSelectionFilter(entry.rotatorElement, selected);
    }
  }

  remove(id: string) {
    this.tracked.delete(id);
  }
}

export const aircraftAnimator = new MarkerAnimator();
export const droneAnimator = new MarkerAnimator();
