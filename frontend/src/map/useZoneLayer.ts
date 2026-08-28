import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { API_BASE_URL } from '../config';
import { useZoneStore, type Zone } from '../state/zoneStore';

const ZONE_STYLE = { color: '#ef4444', weight: 2, fillColor: '#ef4444', fillOpacity: 0.15 };
const ZONE_STYLE_SELECTED = { color: '#fca5a5', weight: 3, fillColor: '#ef4444', fillOpacity: 0.3 };

function deleteZone(zoneId: string) {
  fetch(`${API_BASE_URL}/zones/${zoneId}/`, { method: 'DELETE' });
}

export function useZoneLayer(map: L.Map | null) {
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const polygonsRef = useRef<Map<string, L.Polygon>>(new Map());

  useEffect(() => {
    if (!map) return;
    const layerGroup = L.layerGroup().addTo(map);
    layerGroupRef.current = layerGroup;
    return () => {
      layerGroup.remove();
      layerGroupRef.current = null;
      polygonsRef.current.clear();
    };
  }, [map]);

  useEffect(() => {
    return useZoneStore.subscribe((state) => {
      const layerGroup = layerGroupRef.current;
      if (!layerGroup) return;
      const polygons = polygonsRef.current;
      const seen = new Set<string>();

      state.zones.forEach((zone: Zone, id) => {
        seen.add(id);
        if (polygons.has(id)) return;

        const polygon = L.polygon(zone.coordinates, ZONE_STYLE);
        polygon.bindPopup(
          `<strong>${zone.name || 'Restricted Zone'}</strong><br/><button id="delete-zone-${id}">Delete Zone</button>`
        );
        // Requirement 5.6: the currently viewed/selected zone is emphasized
        // while its popup is open.
        polygon.on('popupopen', () => {
          polygon.setStyle(ZONE_STYLE_SELECTED);
          document.getElementById(`delete-zone-${id}`)?.addEventListener('click', () => deleteZone(id));
        });
        polygon.on('popupclose', () => polygon.setStyle(ZONE_STYLE));
        polygon.addTo(layerGroup);
        polygons.set(id, polygon);
      });

      polygons.forEach((polygon, id) => {
        if (!seen.has(id)) {
          polygon.remove();
          polygons.delete(id);
        }
      });
    });
  }, []);
}
