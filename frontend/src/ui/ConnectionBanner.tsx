import { useConnectionStore } from '../state/connectionStore';
import { theme, threatColors } from './theme';

export function ConnectionBanner() {
  const connected = useConnectionStore((s) => s.connected);
  if (connected) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 2000,
        background: threatColors.critical,
        color: 'white',
        textAlign: 'center',
        padding: '6px 0',
        fontSize: 13,
        fontFamily: theme.sans,
        letterSpacing: 0.3,
      }}
    >
      ⚠ Connection lost — reconnecting…
    </div>
  );
}
