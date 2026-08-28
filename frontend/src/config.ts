// Defaults below match the values used throughout development, so this runs
// correctly for a fresh clone with no .env file at all (matching the
// backend's approach in config/settings.py).

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:8000/api';

export const BASE_STATION = {
  lat: parseFloat((import.meta.env.VITE_BASE_STATION_LAT as string) || '37.7749'),
  lng: parseFloat((import.meta.env.VITE_BASE_STATION_LNG as string) || '-122.4194'),
};

export const SIMULATION_RADIUS_METERS =
  parseFloat((import.meta.env.VITE_SIMULATION_RADIUS_KM as string) || '100') * 1000;
