import L from 'leaflet';
import { BASE_STATION, SIMULATION_RADIUS_METERS } from '../config';

export function isWithinSimulationRadius(latlng: L.LatLng): boolean {
  return latlng.distanceTo(L.latLng(BASE_STATION.lat, BASE_STATION.lng)) <= SIMULATION_RADIUS_METERS;
}
