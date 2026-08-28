import { useAircraftStore, type ThreatLevel } from '../state/aircraftStore';
import { useZoneStore } from '../state/zoneStore';
import { useDroneStore } from '../state/droneStore';
import { useConnectionStore } from '../state/connectionStore';
import { useFilterStore } from '../state/filterStore';
import { panelStyle, theme, threatColors } from './theme';

const THREAT_ORDER: ThreatLevel[] = ['normal', 'warning', 'critical'];
const THREAT_LABELS: Record<ThreatLevel, string> = {
  normal: 'Normal',
  warning: 'Warning',
  critical: 'Critical',
};

export function StatusDashboard() {
  const aircraft = useAircraftStore((s) => s.aircraft);
  const zones = useZoneStore((s) => s.zones);
  const drones = useDroneStore((s) => s.drones);
  const connected = useConnectionStore((s) => s.connected);
  const visibleThreats = useFilterStore((s) => s.visibleThreats);
  const toggleThreat = useFilterStore((s) => s.toggleThreat);

  const threatCounts: Record<ThreatLevel, number> = { normal: 0, warning: 0, critical: 0 };
  aircraft.forEach((a) => {
    threatCounts[a.threat_level]++;
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

      <div
        style={{
          marginTop: 6,
          paddingTop: 6,
          borderTop: `1px solid ${theme.divider}`,
          color: theme.textMuted,
          fontSize: 11,
          letterSpacing: 0.4,
        }}
      >
        SHOW AIRCRAFT
      </div>
      {THREAT_ORDER.map((level) => {
        const active = visibleThreats.has(level);
        const color = threatCounts[level] > 0 ? threatColors[level] : undefined;
        return (
          <label
            key={level}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 16,
              padding: '3px 0',
              cursor: 'pointer',
              opacity: active ? 1 : 0.45,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: theme.textMuted }}>
              <input type="checkbox" checked={active} onChange={() => toggleThreat(level)} style={{ margin: 0 }} />
              {THREAT_LABELS[level]}
            </span>
            <strong style={{ color: color ?? theme.text, fontFamily: theme.mono }}>{threatCounts[level]}</strong>
          </label>
        );
      })}
    </div>
  );
}
