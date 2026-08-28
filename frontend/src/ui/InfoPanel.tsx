import { useSelectionStore } from '../state/selectionStore';
import { panelStyle, theme, threatColors } from './theme';

const THREAT_LABELS: Record<string, string> = {
  normal: 'Normal',
  warning: 'Warning (closing in)',
  critical: 'Critical (breached)',
};

const DRONE_STATUS_LABELS: Record<string, string> = {
  patrol: 'Patrolling / Available',
  intercept: 'Intercepting',
  monitor: 'Monitoring (holding station)',
  returning: 'Returning to base',
};

function formatTte(tte: number | null): string {
  if (tte === null) return 'N/A';
  if (tte === 0) return 'Inside zone';
  return `${tte.toFixed(0)}s`;
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '2px 0' }}>
      <span style={{ color: theme.textMuted }}>{label}</span>
      <span style={{ color: color ?? theme.text, fontFamily: theme.mono }}>{value}</span>
    </div>
  );
}

export function InfoPanel() {
  const { selection, clear } = useSelectionStore();
  if (!selection) return null;

  return (
    <div style={{ ...panelStyle, position: 'absolute', top: 10, left: 10, zIndex: 1000, padding: '12px 16px', minWidth: 240 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: 6,
          marginBottom: 6,
          borderBottom: `1px solid ${theme.divider}`,
        }}
      >
        <strong style={{ letterSpacing: 0.3 }}>{selection.id}</strong>
        <button
          onClick={clear}
          style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 15, color: theme.textMuted, lineHeight: 1 }}
        >
          ✕
        </button>
      </div>

      {!selection.detail ? (
        <div style={{ color: theme.textMuted }}>Loading…</div>
      ) : selection.kind === 'aircraft' ? (
        <div>
          <Row label="Threat" value={THREAT_LABELS[selection.detail.threat_level]} color={threatColors[selection.detail.threat_level]} />
          <Row label="Position" value={`${selection.detail.lat.toFixed(4)}, ${selection.detail.lng.toFixed(4)}`} />
          <Row label="Altitude" value={`${selection.detail.altitude_m.toFixed(0)}m`} />
          <Row label="Speed" value={`${selection.detail.speed_mps.toFixed(0)} m/s`} />
          <Row label="Heading" value={`${selection.detail.heading_deg.toFixed(0)}°`} />

          {selection.detail.no_drone_available && (
            <div style={{ color: threatColors.warning, marginTop: 4 }}>Breached — no drone available to dispatch.</div>
          )}
          {selection.detail.insufficient_history && (
            <div style={{ color: threatColors.warning, marginTop: 4 }}>Insufficient history for a reliable prediction yet.</div>
          )}
          {selection.detail.has_gap && (
            <div style={{ color: threatColors.warning, marginTop: 4 }}>⚠ Gap detected in historical data (marked on trajectory).</div>
          )}

          <div style={{ marginTop: 8, paddingTop: 6, borderTop: `1px solid ${theme.divider}` }}>
            <div style={{ color: theme.textMuted, marginBottom: 2 }}>Nearest zones</div>
            {selection.detail.nearest_zones.length === 0 ? (
              <div style={{ color: theme.textMuted }}>None</div>
            ) : (
              <ul style={{ margin: '2px 0', paddingLeft: 18 }}>
                {selection.detail.nearest_zones.map((z) => (
                  <li key={z.zone_id}>
                    {(z.distance_m / 1000).toFixed(1)}km — TTE {formatTte(z.tte_seconds)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div>
          <Row label="Status" value={DRONE_STATUS_LABELS[selection.detail.status]} />
          <Row label="Speed" value={`${selection.detail.speed_mps.toFixed(0)} m/s`} />
          <Row label="Heading" value={`${selection.detail.heading_deg.toFixed(0)}°`} />

          {selection.detail.target ? (
            <div style={{ marginTop: 8, paddingTop: 6, borderTop: `1px solid ${theme.divider}` }}>
              <div style={{ color: theme.textMuted, marginBottom: 2 }}>Target</div>
              <Row label="Aircraft" value={selection.detail.target.id} />
              <Row label="Altitude" value={`${selection.detail.target.altitude_m.toFixed(0)}m`} />
              <Row label="Speed" value={`${selection.detail.target.speed_mps.toFixed(0)} m/s`} />
              <Row
                label="Intercept time"
                value={selection.detail.intercept_time_estimate === null ? 'N/A' : `${selection.detail.intercept_time_estimate.toFixed(0)}s`}
              />
            </div>
          ) : (
            <div style={{ marginTop: 8, color: theme.textMuted }}>No target.</div>
          )}
        </div>
      )}
    </div>
  );
}
