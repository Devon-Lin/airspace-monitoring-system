import type { CSSProperties } from 'react';

export const theme = {
  panelBg: '#111827e6',
  panelBorder: '#2d3748',
  text: '#e5e7eb',
  textMuted: '#9ca3af',
  accent: '#38bdf8',
  divider: '#374151',
  shadow: '0 4px 16px rgba(0,0,0,0.45)',
  radius: 8,
  mono: "'SF Mono', 'Menlo', 'Consolas', monospace",
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

export const threatColors = {
  normal: '#22c55e',
  warning: '#f59e0b',
  critical: '#ef4444',
};

export const droneStatusColors = {
  patrol: '#38bdf8',
  intercept: '#f59e0b',
  monitor: '#ef4444',
  returning: '#6b7280',
};

export const panelStyle: CSSProperties = {
  background: theme.panelBg,
  backdropFilter: 'blur(6px)',
  color: theme.text,
  border: `1px solid ${theme.panelBorder}`,
  borderRadius: theme.radius,
  boxShadow: theme.shadow,
  fontFamily: theme.sans,
  fontSize: 13,
};

export const buttonStyle: CSSProperties = {
  background: '#1f2937',
  color: theme.text,
  border: `1px solid ${theme.panelBorder}`,
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: theme.sans,
};
