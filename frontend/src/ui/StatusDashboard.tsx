import { useAircraftStore } from '../state/aircraftStore';
import { useZoneStore } from '../state/zoneStore';
import { useDroneStore } from '../state/droneStore';
import { useConnectionStore } from '../state/connectionStore';
import { panelStyle, theme, threatColors } from './theme';

export function StatusDashboard() {
  const aircraft = useAircraftStore((s) => s.aircraft);
  const zones = useZoneStore((s) => s.zones);
  const drones = useDroneStore((s) => s.drones);
  const connected = useConnectionStore((s) => s.connected);

  let warningCount = 0;
  let criticalCount = 0;
  aircraft.forEach((a) => {
    if (a.threat_level === 'warning') warningCount++;
    if (a.threat_level === 'critical') criticalCount++;
  });

  let availableDrones = 0;
  drones.forEach((d) => {
    if (d.status === 'patrol') availableDrones++;
  });

  const row = (label: string, value: string | number, color?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '2px 0' }}>
      <span style={{ color: theme.textMuted }}>{label}</span>
      <strong style={{ color: color ?? theme.text, fontFamily: theme.mono }}>{value}</strong>
    </div>
  );

  return (
    <div style={{ ...panelStyle, padding: '10px 14px', minWidth: 200 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 6,
          paddingBottom: 6,
          borderBottom: `1px solid ${theme.divider}`,
          fontWeight: 600,
          letterSpacing: 0.4,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: connected ? threatColors.normal : threatColors.critical,
            boxShadow: connected ? `0 0 4px ${threatColors.normal}` : `0 0 4px ${threatColors.critical}`,
            flexShrink: 0,
          }}
        />
        <span>{connected ? 'LIVE' : 'DISCONNECTED'}</span>
      </div>
      {row('Aircraft', aircraft.size)}
      {row('Zones', zones.size)}
      {row('Drones available', `${availableDrones}/${drones.size}`)}
      {row('Warning', warningCount, warningCount > 0 ? threatColors.warning : undefined)}
      {row('Critical', criticalCount, criticalCount > 0 ? threatColors.critical : undefined)}
    </div>
  );
}
