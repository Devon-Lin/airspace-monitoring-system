import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useDroneStore } from '../state/droneStore';
import { useSelectionStore } from '../state/selectionStore';
import type { DroneStatus } from '../state/selectionStore';
import { buildDroneIcon } from './icons';
import { droneAnimator } from './markerAnimator';
import { droneStatusColors } from '../ui/theme';

const STATUS_COLORS: Record<DroneStatus, string> = droneStatusColors;

export function useDroneLayer(map: L.Map | null) {
  const markersRef = useRef<Map<string, { marker: L.Marker; status: DroneStatus }>>(new Map());
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
      return selection?.kind === 'drone' ? selection.id : null;
    };

    const unsubscribeDrones = useDroneStore.subscribe((state) => {
      const layerGroup = layerGroupRef.current;
      if (!layerGroup) return;
      const markers = markersRef.current;
      const seen = new Set<string>();
      const selectedId = getSelectedId();

      state.drones.forEach((drone, id) => {
        seen.add(id);
        const color = STATUS_COLORS[drone.status];
        const existing = markers.get(id);
        if (existing) {
          if (existing.status !== drone.status) {
            existing.marker.setIcon(buildDroneIcon(color));
            existing.status = drone.status;
          }
        } else {
          const marker = L.marker([drone.lat, drone.lng], { icon: buildDroneIcon(color) });
          marker.on('click', () => useSelectionStore.getState().selectDrone(id));
          marker.addTo(layerGroup);
          markers.set(id, { marker, status: drone.status });
        }
        droneAnimator.update(id, markers.get(id)!.marker, drone.lat, drone.lng, drone.heading_deg, id === selectedId);
      });

      markers.forEach((entry, id) => {
        if (!seen.has(id)) {
          entry.marker.remove();
          markers.delete(id);
          droneAnimator.remove(id);
        }
      });
    });

    const unsubscribeSelection = useSelectionStore.subscribe(() => {
      const selectedId = getSelectedId();
      markersRef.current.forEach((_entry, id) => {
        droneAnimator.setSelected(id, id === selectedId);
      });
    });

    return () => {
      unsubscribeDrones();
      unsubscribeSelection();
    };
  }, []);
}
