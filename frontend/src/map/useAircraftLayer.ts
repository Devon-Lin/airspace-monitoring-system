import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useAircraftStore, type ThreatLevel } from '../state/aircraftStore';
import { useSelectionStore } from '../state/selectionStore';
import { useFilterStore } from '../state/filterStore';
import { buildAircraftIcon } from './icons';
import { aircraftAnimator } from './markerAnimator';
import { threatColors } from '../ui/theme';

const THREAT_COLORS: Record<ThreatLevel, string> = threatColors;

export function useAircraftLayer(map: L.Map | null) {
  const markersRef = useRef<Map<string, { marker: L.Marker; threat: ThreatLevel }>>(new Map());
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!map) return;
    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;
    return () => {
      layerGroup.remove();
      layerGroupRef.current = null;
      markersRef.current.clear();
    };
  }, [map]);

  useEffect(() => {
    const getSelectedId = () => {
      const selection = useSelectionStore.getState().selection;
      return selection?.kind === 'aircraft' ? selection.id : null;
    };

    const applyVisibility = () => {
      const layerGroup = layerGroupRef.current;
      if (!layerGroup) return;
      const visibleThreats = useFilterStore.getState().visibleThreats;
      markersRef.current.forEach((entry) => {
        const shouldShow = visibleThreats.has(entry.threat);
        const isShown = layerGroup.hasLayer(entry.marker);
        if (shouldShow && !isShown) layerGroup.addLayer(entry.marker);
        if (!shouldShow && isShown) layerGroup.removeLayer(entry.marker);
      });
    };

    const unsubscribeAircraft = useAircraftStore.subscribe((state) => {
      const layerGroup = layerGroupRef.current;
      if (!layerGroup) return;
      const markers = markersRef.current;
      const seen = new Set<string>();
      const selectedId = getSelectedId();

      state.aircraft.forEach((aircraft, id) => {
        seen.add(id);
        const color = THREAT_COLORS[aircraft.threat_level];
        const existing = markers.get(id);
        if (existing) {
          if (existing.threat !== aircraft.threat_level) {
            existing.marker.setIcon(buildAircraftIcon(color));
            existing.threat = aircraft.threat_level;
          }
        } else {
          const marker = L.marker([aircraft.lat, aircraft.lng], { icon: buildAircraftIcon(color) });
          marker.on('click', () => useSelectionStore.getState().selectAircraft(id));
          markers.set(id, { marker, threat: aircraft.threat_level });
        }
        aircraftAnimator.update(id, markers.get(id)!.marker, aircraft.lat, aircraft.lng, aircraft.heading_deg, id === selectedId);
      });

      markers.forEach((entry, id) => {
        if (!seen.has(id)) {
          entry.marker.remove();
          markers.delete(id);
          aircraftAnimator.remove(id);
        }
      });

      applyVisibility();
    });

    const unsubscribeSelection = useSelectionStore.subscribe(() => {
      const selectedId = getSelectedId();
      markersRef.current.forEach((_entry, id) => {
        aircraftAnimator.setSelected(id, id === selectedId);
      });
    });

    const unsubscribeFilter = useFilterStore.subscribe(() => applyVisibility());

    return () => {
      unsubscribeAircraft();
      unsubscribeSelection();
      unsubscribeFilter();
    };
  }, []);
}
